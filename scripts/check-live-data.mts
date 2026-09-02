/**
 * check-live-data.mts — did the nightly produce what a reader will see tomorrow?
 *
 * ── WHY A SEPARATE STEP ───────────────────────────────────────────────────
 *
 * Every builder in the pipeline checks its own input and exits non-zero when
 * it cannot proceed. None of them can tell whether the RESULT is right,
 * because each sees one file at a time and the failures worth catching are
 * the ones that span files: the slate had forty games and the index gained
 * six; a team's game file has fewer rows than it had yesterday; the live
 * pages were written for 340 teams out of 365 because a name changed in the
 * join table. Every one of those exits zero all the way down and publishes.
 *
 * So this runs LAST — after the R2 sync, so it can also confirm the upload
 * landed — and looks across everything the run wrote, the way a person
 * checking the site in the morning would if they had an hour and a list.
 *
 * ── IT REPORTS. IT DOES NOT GATE. ─────────────────────────────────────────
 *
 * The exit code is zero whatever it finds. A check that stopped the publish
 * would need to be right about what "wrong" is, and it is not: a team can
 * legitimately lose a row (a game vacated, a box withdrawn), a slate can
 * legitimately publish nothing (every game postponed). The job of this file
 * is to put the number in front of someone, marked, so they decide in one
 * look instead of an hour. The admin page's Data tile is where it goes.
 *
 * What it writes:
 *
 *   public/data/live/checks.json     → R2 live/checks.json, no-cache
 *
 *   { at, season, slate, outcome, checks: [{ id, label, state, detail }],
 *     counts: { ... } }
 *
 * `counts` is for tomorrow: the per-team row counts and page totals this run
 * saw, read back from R2 next time so "fewer than yesterday" has a yesterday
 * to compare with. Disk is ephemeral on Actions; R2 is the only memory.
 *
 * Usage:
 *   npx tsx scripts/check-live-data.mts                  # LIVE_SEASON, upload
 *   npx tsx scripts/check-live-data.mts --season 2026    # any season
 *   npx tsx scripts/check-live-data.mts --no-upload      # write locally, touch nothing remote
 *   npx tsx scripts/check-live-data.mts --date 2026-02-14   # a specific slate
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { config as dotenvConfig } from "dotenv";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { LIVE_SEASON } from "@/lib/seasons";
import { teamSlug } from "@/lib/team-slug";
// @ts-expect-error — plain .mjs, no declaration file; scripts/ is outside tsconfig.
import { read as readMeter, months as meterMonths, monthKey } from "./lib/cbbd-meter.mjs";

dotenvConfig({ path: ".env.local" });

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "public", "data", "live", "checks.json");
const OUT_KEY = "live/checks.json";

const has = (f: string) => process.argv.includes(f);
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

const NO_UPLOAD = has("--no-upload");
const seasonArg = arg("--season");
const SEASON = seasonArg ? Number(seasonArg) : LIVE_SEASON;
if (SEASON === null || !Number.isFinite(SEASON)) {
  console.error("No season to check. LIVE_SEASON is null; pass --season <year>.");
  process.exit(1);
}

// ── Types ──────────────────────────────────────────────────────────────────

type State = "ok" | "warn" | "fail" | "skip";
type Check = { id: string; label: string; state: State; detail: string };

/** What tomorrow's run compares against. */
type Counts = {
  season: number;
  teamSeasonRows: Record<string, number>;
  liveTeamPages: number;
  livePlayerPages: number;
  indexRows: number;
};

/**
 * What the ingest has spent this month. The limit comes from the environment
 * because CBBD's plans change and the number is nowhere in the API: with
 * CBBD_MONTHLY_LIMIT set this is a gauge, without it a running count with
 * nothing to compare against except its own history. Never invented.
 */
type Quota = {
  /** UTC, "2026-09". */
  month: string;
  calls: number;
  limit: number | null;
  /** Trailing months, oldest first. */
  history: Array<{ month: string; calls: number }>;
  /** The functions that call CBBD live cannot write to the meter. Always true. */
  ingestOnly: true;
};

type Report = {
  at: string;
  season: number;
  /** The slate examined, as a US-Eastern date. */
  slate: string;
  outcome: "ok" | "warn" | "fail";
  checks: Check[];
  counts: Counts;
  quota: Quota | null;
};

const checks: Check[] = [];
function add(id: string, label: string, state: State, detail: string) {
  checks.push({ id, label, state, detail });
  const glyph = { ok: "✓", warn: "!", fail: "✕", skip: "·" }[state];
  console.log(`  ${glyph} ${label.padEnd(28)} ${detail}`);
}

// ── Dates ──────────────────────────────────────────────────────────────────

/**
 * Game dates are Eastern. A 9pm tip in Los Angeles is a 4pm tip on the
 * following calendar day in UTC, and every builder in this pipeline files it
 * under the Eastern date it was played. So does this.
 */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const etDate = (d: Date | string) => ET.format(typeof d === "string" ? new Date(d) : d);

/**
 * The slate is YESTERDAY, Eastern. The job runs at 11:00 UTC — 7am on the
 * east coast — so yesterday is the slate that just finished, and today's has
 * not tipped.
 */
const SLATE = arg("--date") ?? etDate(new Date(Date.now() - 86_400_000));

// ── Files ──────────────────────────────────────────────────────────────────

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; }
}
function readGz<T>(p: string): T | null {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8")) as T; } catch { return null; }
}
function listDir(dir: string, ext = ".json"): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)); } catch { return []; }
}

// ── R2 ─────────────────────────────────────────────────────────────────────

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const haveCreds = Boolean(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
if (!NO_UPLOAD && !haveCreds) {
  console.error("Missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET. Pass --no-upload to write locally only.");
  process.exit(1);
}
const s3 = haveCreds
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY! },
    })
  : null;

async function readPrior(): Promise<Counts | null> {
  if (NO_UPLOAD || !s3) return readJson<Report>(OUT_PATH)?.counts ?? null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: OUT_KEY }));
    const parsed = JSON.parse(await r.Body!.transformToString()) as Report;
    return parsed?.counts ?? null;
  } catch (e) {
    const err = e as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NoSuchKey") return null;
    throw e;
  }
}

async function headAge(key: string): Promise<{ missing: boolean; hours: number | null }> {
  try {
    const r = await s3!.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const lm = r.LastModified ? r.LastModified.getTime() : null;
    return { missing: false, hours: lm === null ? null : (Date.now() - lm) / 3_600_000 };
  } catch (e) {
    const err = e as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return { missing: true, hours: null };
    throw e;
  }
}

// ── The checks ─────────────────────────────────────────────────────────────

type RawGame = { id: number; startDate: string; status: string; homeTeam: string; awayTeam: string };
type Pack = { season: number; epoch: string; fields: string[]; teams: { names: string[] }; rows: number[][] };

const list = (xs: string[], n = 4) => xs.slice(0, n).join(", ") + (xs.length > n ? ` +${xs.length - n} more` : "");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

/**
 * 1. The slate. What CBBD said was played, against what the index gained.
 *
 * The archive holds the raw /games responses in two-week windows that can
 * overlap when a date is re-pulled, so games are de-duplicated by id. The
 * index row carries a day offset from the season epoch; that offset is
 * turned back into a date and matched against the slate.
 */
function checkSlate(pack: Pack | null): { finals: number } {
  const dir = path.join(ROOT, "data", "cbbd", String(SEASON));
  const files = listDir(dir, ".json.gz").filter((f) => f.startsWith("games-"));
  if (!files.length) {
    add("slate", "Yesterday's slate", "skip", `no games archive for ${SEASON}`);
    return { finals: 0 };
  }
  const byId = new Map<number, RawGame>();
  for (const f of files) {
    const games = readGz<RawGame[]>(path.join(dir, f)) ?? [];
    for (const g of games) if (etDate(g.startDate) === SLATE) byId.set(g.id, g);
  }
  const games = [...byId.values()];
  const finals = games.filter((g) => g.status === "final");
  const other = games.length - finals.length;
  if (!games.length) {
    add("slate", "Yesterday's slate", "ok", `no games on ${SLATE}`);
    return { finals: 0 };
  }

  // Box coverage: of the finals, how many have a team box in the archive.
  // A game missing here never reaches the index, and the fix is upstream.
  const boxFiles = listDir(dir, ".json.gz").filter((f) => f.startsWith("box-teams-"));
  const boxed = new Set<number>();
  for (const f of boxFiles) {
    for (const row of readGz<Array<{ gameId: number }>>(path.join(dir, f)) ?? []) boxed.add(row.gameId);
  }
  const withBox = finals.filter((g) => boxed.has(g.id));
  const noBox = finals.filter((g) => !boxed.has(g.id)).map((g) => `${g.awayTeam} at ${g.homeTeam}`);

  // What the index gained for the day. Each game is two rows — one per
  // team — unless the opponent is outside Division I, so two per final is
  // the ceiling and not the target.
  let rows = 0;
  if (pack) {
    const d = pack.fields.indexOf("d");
    const epoch = Date.parse(`${pack.epoch}T12:00:00-05:00`);
    for (const r of pack.rows) {
      const day = new Date(epoch + r[d]! * 86_400_000);
      if (etDate(day) === SLATE) rows++;
    }
  }
  const published = Math.ceil(rows / 2);

  const detail = `${finals.length} final${other ? `, ${other} not played` : ""} · box for ${withBox.length} of ${finals.length}` +
    ` · ${published} in the index`;
  if (finals.length && published === 0) add("slate", "Yesterday's slate", "fail", `${detail} — a slate was played and nothing was published`);
  else if (noBox.length) add("slate", "Yesterday's slate", "warn", `${detail} — no box: ${list(noBox)}`);
  else if (published < finals.length * 0.9) add("slate", "Yesterday's slate", "warn", `${detail} — ${pct(published, finals.length)} of the slate`);
  else add("slate", "Yesterday's slate", "ok", detail);
  return { finals: finals.length };
}

/**
 * 2. The season index. It must not shrink: games are added to a season,
 * never removed, and a row count below yesterday's means a builder read a
 * partial archive and published it.
 */
function checkIndex(pack: Pack | null, prior: Counts | null): number {
  if (!pack) { add("index", "Season index", "fail", `public/data/team-game-index/${SEASON}.json missing or unreadable`); return 0; }
  const rows = pack.rows.length;
  const nulls = pack.rows.filter((r) => r.some((v) => v === null || (typeof v === "number" && !Number.isFinite(v)))).length;
  const before = prior?.season === SEASON ? prior.indexRows : null;
  const delta = before === null ? "" : ` (${rows - before >= 0 ? "+" : ""}${rows - before} since last run)`;
  if (before !== null && rows < before) add("index", "Season index", "fail", `${rows.toLocaleString()} team-games${delta} — the season lost rows`);
  else if (nulls) add("index", "Season index", "warn", `${rows.toLocaleString()} team-games${delta} · ${nulls} rows with a null stat`);
  else add("index", "Season index", "ok", `${rows.toLocaleString()} team-games · ${pack.teams.names.length} teams${delta}`);
  return rows;
}

/**
 * 3. The per-team game files. One per team in the index, each parseable,
 * none with fewer rows than it had yesterday.
 */
function checkTeamSeasonGames(pack: Pack | null, prior: Counts | null): Record<string, number> {
  const dir = path.join(ROOT, "public", "data", "team-season-games", String(SEASON));
  const counts: Record<string, number> = {};
  const expected = pack ? [...new Set(pack.teams.names.map(teamSlug))] : [];
  const missing: string[] = [];
  const broken: string[] = [];
  const shrank: string[] = [];
  let empty = 0;
  for (const slug of expected) {
    const file = readJson<{ rows?: unknown[] }>(path.join(dir, `${slug}.json`));
    if (!file) { (fs.existsSync(path.join(dir, `${slug}.json`)) ? broken : missing).push(slug); continue; }
    const n = Array.isArray(file.rows) ? file.rows.length : -1;
    if (n < 0) { broken.push(slug); continue; }
    if (n === 0) empty++;
    counts[slug] = n;
    const before = prior?.season === SEASON ? prior.teamSeasonRows[slug] : undefined;
    if (before !== undefined && n < before) shrank.push(`${slug} ${before}→${n}`);
  }
  const have = Object.keys(counts).length;
  const base = `${have} of ${expected.length} teams`;
  if (!expected.length) add("team-files", "Team game files", "skip", "no index to compare against");
  else if (missing.length || broken.length) add("team-files", "Team game files", "fail", `${base} — missing: ${list([...missing, ...broken.map((s) => `${s} (unreadable)`)])}`);
  else if (shrank.length) add("team-files", "Team game files", "fail", `${base} — fewer games than yesterday: ${list(shrank)}`);
  else add("team-files", "Team game files", "ok", `${base}${empty ? ` · ${empty} with no games yet` : ""}`);
  return counts;
}

/**
 * 4. The live team pages. One per team in the season, each large enough to
 * be a page and not an error. The set comes from the season's team list
 * rather than the index, because that is the set the builder uses.
 */
function checkLiveTeamPages(): number {
  const teams = readJson<Array<{ name: string; year: number }>>(path.join(ROOT, "public", "data", "teams-by-year", `${SEASON}.json`)) ?? [];
  const expected = [...new Set(teams.filter((t) => t.year === SEASON).map((t) => teamSlug(t.name)))];
  const dir = path.join(ROOT, "public", "data", "live", "team");
  const missing: string[] = [];
  const thin: string[] = [];
  let have = 0;
  for (const slug of expected) {
    const p = path.join(dir, `${slug}.json`);
    if (!fs.existsSync(p)) { missing.push(slug); continue; }
    const size = fs.statSync(p).size;
    if (size < 2_000 || !readJson(p)) { thin.push(slug); continue; }
    have++;
  }
  if (!expected.length) add("live-teams", "Live team pages", "skip", `no team list for ${SEASON}`);
  else if (missing.length || thin.length) add("live-teams", "Live team pages", "fail", `${have} of ${expected.length} — ${missing.length ? `missing: ${list(missing)}` : ""}${thin.length ? ` unreadable or empty: ${list(thin)}` : ""}`);
  else add("live-teams", "Live team pages", "ok", `${have} of ${expected.length} teams`);
  return have;
}

/**
 * 5. The live player pages. There is no exact expected set — the builder
 * writes one per ranked player and that number moves as players qualify —
 * so the check is against yesterday: a drop of more than a few percent is a
 * cohort that lost a team.
 */
function checkLivePlayerPages(prior: Counts | null): number {
  const dir = path.join(ROOT, "public", "data", "live", "player");
  const n = listDir(dir).length;
  const before = prior?.season === SEASON ? prior.livePlayerPages : null;
  if (n === 0 && !before) { add("live-players", "Live player pages", "skip", "none written yet"); return 0; }
  const delta = before === null ? "" : ` (${n - before >= 0 ? "+" : ""}${n - before} since last run)`;
  if (before !== null && before > 0 && n < before * 0.75) add("live-players", "Live player pages", "fail", `${n}${delta} — a quarter of the pages are gone`);
  else if (before !== null && before > 0 && n < before * 0.95) add("live-players", "Live player pages", "warn", `${n}${delta}`);
  else add("live-players", "Live player pages", "ok", `${n} players${delta}`);
  return n;
}

/**
 * 6. R2 has tonight's files. The sync skips an object whose bytes did not
 * change, so an old timestamp is not by itself wrong — on a night with no
 * games the index is identical. It is wrong when a slate was played and the
 * index on R2 predates it.
 */
/**
 * ── THE CBBD QUOTA ────────────────────────────────────────────────────────
 *
 * Not a check on the data — a check on whether there will BE data next week.
 * CBBD bills monthly and answers 429 when the month is gone, and the first
 * anyone hears of it is an ingest that dies at 3am. The count comes from
 * scripts/lib/cbbd-meter.mjs, which the ingest writes at the end of every
 * run; read its header for why the number is a floor rather than a total.
 *
 * With no CBBD_MONTHLY_LIMIT there is no threshold to cross, so this reports
 * and never warns. Guessing a plan's ceiling would produce an alarm at 80% of
 * a number nobody chose.
 */
function checkQuota(): Quota | null {
  const meter = readMeter();
  if (!meter) {
    add("quota", "CBBD quota", "skip", "no meter yet — the next ingest starts one");
    return null;
  }
  const month = monthKey();
  const history = meterMonths(meter) as Array<{ month: string; calls: number }>;
  const calls = history.find((m) => m.month === month)?.calls ?? 0;
  const raw = Number(process.env.CBBD_MONTHLY_LIMIT);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : null;
  const spent = calls.toLocaleString();

  if (limit === null) {
    const peak = Math.max(0, ...history.map((m) => m.calls));
    add("quota", "CBBD quota", "ok",
      `${spent} calls this month (ingest only)${peak > calls ? `, against a ${peak.toLocaleString()} high` : ""} — set CBBD_MONTHLY_LIMIT to make this a gauge`);
  } else {
    const pct = Math.round((calls / limit) * 100);
    const detail = `${spent} of ${limit.toLocaleString()} this month — ${pct}% (ingest only; the live functions spend from the same quota and are not counted)`;
    add("quota", "CBBD quota", calls >= limit ? "fail" : pct >= 80 ? "warn" : "ok", detail);
  }
  return { month, calls, limit, history, ingestOnly: true };
}

async function checkR2(finals: number, pack: Pack | null) {
  if (NO_UPLOAD || !s3) { add("r2", "R2 has tonight's files", "skip", "--no-upload"); return; }
  const slug = pack?.teams.names[0] ? teamSlug(pack.teams.names[0]) : "duke";
  const keys = [
    `team-game-index/${SEASON}.json`,
    `game-index/${SEASON}.json`,
    `team-season-games/${SEASON}/${slug}.json`,
    `live/team/${slug}.json`,
  ];
  const missing: string[] = [];
  const stale: string[] = [];
  for (const k of keys) {
    const { missing: gone, hours } = await headAge(k);
    if (gone) missing.push(k);
    else if (finals > 0 && hours !== null && hours > 36) stale.push(`${k} (${Math.round(hours / 24)}d old)`);
  }
  if (missing.length) add("r2", "R2 has tonight's files", "fail", `missing: ${list(missing)}`);
  else if (stale.length) add("r2", "R2 has tonight's files", "warn", `a slate was played but these did not change: ${list(stale)}`);
  else add("r2", "R2 has tonight's files", "ok", `${keys.length} objects present${finals ? " and current" : ""}`);
}

// ── Run ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== data checks — season ${SEASON}, slate ${SLATE} ===\n`);
  const prior = await readPrior();
  const pack = readJson<Pack>(path.join(ROOT, "public", "data", "team-game-index", `${SEASON}.json`));

  const { finals } = checkSlate(pack);
  const indexRows = checkIndex(pack, prior);
  const teamSeasonRows = checkTeamSeasonGames(pack, prior);
  const liveTeamPages = checkLiveTeamPages();
  const livePlayerPages = checkLivePlayerPages(prior);
  await checkR2(finals, pack);

  const quota = checkQuota();

  const rank: Record<State, number> = { ok: 0, skip: 0, warn: 1, fail: 2 };
  const worst = Math.max(...checks.map((c) => rank[c.state]));
  const report: Report = {
    at: new Date().toISOString(),
    season: SEASON!,
    slate: SLATE,
    outcome: worst === 2 ? "fail" : worst === 1 ? "warn" : "ok",
    checks,
    counts: { season: SEASON!, teamSeasonRows, liveTeamPages, livePlayerPages, indexRows },
    quota,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n${report.outcome.toUpperCase()} — ${checks.length} checks -> public/data/live/checks.json`);

  if (NO_UPLOAD || !s3) { console.log("--no-upload: nothing sent to R2."); return; }
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: OUT_KEY,
    Body: JSON.stringify(report),
    ContentType: "application/json",
    // Read by one person on the morning it matters — same reasoning as the
    // run record in publish-run-record.mjs.
    CacheControl: "no-cache",
  }));
  console.log(`uploaded ${OUT_KEY}`);
}

main().catch((e) => {
  console.error("check-live-data crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
