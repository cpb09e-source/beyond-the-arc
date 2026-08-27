#!/usr/bin/env node
/**
 * build-preseason-continuity.mjs — returning minutes for the UPCOMING season.
 *
 *   public/data/preseason-continuity.json
 *
 * WHY THIS IS A SEPARATE FILE FROM team-roster-splits.mjs. That one compares
 * two seasons that have both been played, and emits seven figures. This one
 * looks forward, and only three of those seven can exist:
 *
 *   ret_prior_min    last season's minutes belonging to players who are back
 *   prior_team_min   last season's team minutes
 *   ret_min_pct      the ratio — the preseason continuity number
 *
 * The other four (Continuity %, Ret Curr Min, Team Min, Returner Rotation %)
 * all need minutes from a season that has not been played. They are not
 * "missing" here, they are unknowable, and emitting them as zero or null
 * alongside the three real ones would invite exactly the wrong reading.
 *
 * A RETURNER IS `status: "returning"` in season-preview.json, which is the
 * scraped-and-hand-corrected roster for next season. That status already means
 * "was on this team last year and is on it again", which is the same definition
 * the played-season build uses. Transfers in are `transfer` and freshmen are
 * `newcomer`; neither is continuity.
 *
 * ── THE TAGGING IS NOT FINISHED, AND THIS FILE SAYS SO ─────────────────────
 * The join itself is exact — every one of the ~2,079 players tagged returning
 * carries a bart_id and every one of them matches a minutes record, with zero
 * misses. What is incomplete is the STATUS field on some teams, because the
 * preview roster is a live offseason worklist (see the *_patched_at stamps in
 * season-preview.json). Two signatures give it away, and both are impossible
 * rather than merely unusual:
 *
 *   every minute returning   nobody graduated, nobody transferred out
 *   no minutes returning     the whole roster turned over AND no one was tagged
 *
 * A third and much larger signature only showed up once the page was built:
 * a team whose 2026 SENIORS ARE ALL STILL LISTED AS RETURNING. Seniors
 * graduate. Oklahoma had seven and all seven were tagged back, which is what
 * put them near the top of the table at 96% returning. That is 43 teams, more
 * than the other two signatures combined, and none would have been caught by a
 * percentage threshold — Oklahoma at 96% is indistinguishable from a genuinely
 * veteran roster until you look at who the players are.
 *
 * The fourth is teams with NO INCOMING PLAYERS at all. Every programme signs
 * somebody; a roster with zero transfers and zero freshmen has not had its
 * additions entered.
 *
 * All four are structural — they ask whether a thing that always happens has
 * been recorded — rather than "this number looks too high", which would be
 * fitting the filter to the answer I wanted. UNC Greensboro survives at 98.9%
 * because nothing about its roster is self-contradictory, and an unprovable
 * suspicion is not grounds for hiding a real figure.
 *
 * Those teams are emitted with `confirmed: false` rather than dropped or
 * silently ranked. Dropping them would make the file quietly incomplete;
 * ranking them would put 36 wrong teams at the very top and bottom of the
 * sort, which is precisely where a reader looks first.
 *
 * Reads only committed data — safe during the freeze.
 *
 *   node scripts/build-preseason-continuity.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PREVIEW = path.join(ROOT, "public/data/season-preview.json");
const OUT = path.join(ROOT, "public/data/preseason-continuity.json");
const OFFICIAL = path.join(ROOT, "public/data/official-rosters-2026.json");

/**
 * Teams whose official roster page never scraped properly.
 *
 * THE FIFTH CHECK, AND THE ONE THAT CATCHES GONZAGA. The other four ask whether
 * the preview roster contradicts itself. Gonzaga's does not — it has incoming
 * transfers, it has returners, it is not at 100%, and some seniors did leave —
 * and it is still wrong, because it lists Graham Ike and Jalen Warley months
 * after they left. Nothing internal to the roster reveals that.
 *
 * What reveals it is upstream: gozags.com renders its roster client-side, so the
 * scrape returned four players, so patch-preview-departures.mjs had no authority
 * to check Gonzaga against and left it alone. A team we never got a real roster
 * for cannot have its continuity called confirmed, whatever the numbers look
 * like. 25 of these 34 teams never even resolved a URL.
 */
const MIN_PLAUSIBLE_ROSTER = 10;
const MAX_PLAUSIBLE_ROSTER = 22;
const officialRoster = new Map();
try {
  const off = JSON.parse(fs.readFileSync(OFFICIAL, "utf8"));
  for (const [name, t] of Object.entries(off.teams ?? {})) {
    const n = t?.players?.length ?? 0;
    if (n >= MIN_PLAUSIBLE_ROSTER && n <= MAX_PLAUSIBLE_ROSTER) {
      officialRoster.set(name, t.players.map((p) => p.name));
    }
  }
} catch {
  console.warn("   ! official-rosters-2026.json unreadable — skipping the roster check");
}

/** Compared on letters only; the two sources disagree about punctuation, not people. */
function normName(s) {
  return String(s ?? "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/**
 * Prior-season names, to tell a missing veteran from an unsigned freshman.
 * Filled by the accumulation loop below, which already walks every row.
 */
const playedLastSeason = new Set();
/** Same, split by team, for the stale-page check below. */
const lastSeasonByTeam = new Map();

const preview = JSON.parse(fs.readFileSync(PREVIEW, "utf8"));
const season = Number(preview.season);
const priorSeason = season - 1;

const peFp = path.join(ROOT, "public/data/players-explorer", `${priorSeason}.json`);
if (!fs.existsSync(peFp)) {
  console.error(`✗ no players-explorer/${priorSeason}.json — cannot measure last season's minutes`);
  process.exit(1);
}
const pe = JSON.parse(fs.readFileSync(peFp, "utf8"));
const ix = (name) => {
  const i = pe.fields.indexOf(name);
  if (i < 0) throw new Error(`players-explorer/${priorSeason}.json has no "${name}"`);
  return i;
};
const iId = ix("bart_player_id"), iTeam = ix("team_name");
const iGames = ix("games"), iMin = ix("min_pg"), iClass = ix("class"), iName = ix("name");

/** Last season's minutes, by player and by team. */
const minsById = new Map();
const teamMinutes = new Map();
/** Prior-season seniors per team — the graduation check below needs them. */
const seniorsByTeam = new Map();
for (const row of pe.rows) {
  const minutes = (Number(row[iMin]) || 0) * (Number(row[iGames]) || 0);
  if (minutes <= 0) continue;
  const id = row[iId];
  if (typeof id === "number") minsById.set(id, (minsById.get(id) ?? 0) + minutes);
  const team = row[iTeam];
  if (typeof team !== "string") continue;
  teamMinutes.set(team, (teamMinutes.get(team) ?? 0) + minutes);
  playedLastSeason.add(normName(row[iName]));
  if (!lastSeasonByTeam.has(team)) lastSeasonByTeam.set(team, new Set());
  lastSeasonByTeam.get(team).add(normName(row[iName]));
  if (String(row[iClass] ?? "").trim() === "Sr" && typeof id === "number") {
    if (!seniorsByTeam.has(team)) seniorsByTeam.set(team, []);
    seniorsByTeam.get(team).push(id);
  }
}

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

const teams = {};
let unjoined = 0, noPrior = 0, unconfirmed = 0;

for (const [team, entry] of Object.entries(preview.teams ?? {})) {
  const prior = teamMinutes.get(team);
  // A team with no prior season on file (a new D-I member) has nothing to
  // return FROM, which is different from returning nothing.
  if (!prior || prior <= 0) { noPrior++; continue; }

  const returners = (entry.roster ?? []).filter((p) => p.status === "returning");
  /**
   * INCOMING TRANSFERS, AND THE MINUTES THEY BRING.
   *
   * The other half of an offseason, and the half returning-minutes cannot see:
   * a team can lose its whole rotation and replace it with six thousand proven
   * minutes from the portal, and on returning-minutes alone that reads
   * identically to a team that lost everyone and signed freshmen.
   *
   * Minutes are what the player produced ELSEWHERE last season, which is the
   * only evidence that exists about him in August. 1,185 of 1,203 incoming
   * transfers join a minutes record; the rest are JUCO, international, or sat
   * out, and correctly contribute a body but no minutes.
   */
  const transfers = (entry.roster ?? []).filter((p) => p.status === "transfer");
  let inMin = 0, inJoined = 0;
  for (const p of transfers) {
    const m = typeof p.bart_id === "number" ? minsById.get(p.bart_id) : undefined;
    if (m === undefined) continue;
    inJoined++;
    inMin += m;
  }
  let retMin = 0, joined = 0;
  for (const p of returners) {
    const m = typeof p.bart_id === "number" ? minsById.get(p.bart_id) : undefined;
    if (m === undefined) { unjoined++; continue; }
    joined++;
    retMin += m;
  }

  const pct = retMin / prior;

  // Four structural checks, each asking whether something that ALWAYS happens
  // has been recorded. See the note at the top of this file.
  const retIds = new Set(returners.map((p) => p.bart_id));
  const seniors = seniorsByTeam.get(team) ?? [];
  const seniorsBack = seniors.filter((id) => retIds.has(id)).length;
  const incoming = (entry.roster ?? []).length - returners.length;
  /**
   * THE ROSTER DIFF IS THE ONLY TEST NOW.
   *
   * Four proxy checks used to sit here — no returners tagged, no incoming
   * players, every minute returning, no seniors departed. Each was a way of
   * asking "does this roster contradict itself", which was the best available
   * question while the scraped rosters were a fortnight stale and could not
   * arbitrate. With a same-day scrape they are not just redundant but wrong:
   * a team whose roster matches the school's page exactly, and happens to have
   * its one senior back on a fifth year, would be withheld for a fact the
   * school itself confirms. They cost 26 teams against the direct check.
   *
   * `seniorsBack` and `incoming` are kept as emitted context rather than as
   * gates — they are useful to look at, they are just not evidence of an error.
   */
  const reasons = [];
  /**
   * THE ROSTER MUST MATCH THE SCHOOL'S PAGE IN BOTH DIRECTIONS.
   *
   * This replaced a check that only asked whether we HAD a scraped roster. That
   * let Florida through at 86% returning while its preview still carried two
   * departed players and was missing four the school lists — nothing internal
   * to the roster contradicted itself, so none of the other checks fired.
   *
   * A player we list who is not on the school's page has left. A player on the
   * page we do not list is missing, and is only counted when he has prior D-I
   * minutes — an unrecognised name is a true freshman, and a preview built
   * before signing day will not have him yet.
   */
  const official = officialRoster.get(team);
  if (!official) {
    reasons.push("no verified roster page");
  } else if (official.every((n) => lastSeasonByTeam.get(team)?.has(normName(n)))) {
    /**
     * THE SCHOOL HAS NOT UPDATED ITS PAGE YET.
     *
     * A roster with no name that was not on last season's is last season's
     * roster. Hampton's page carries the same fifteen players, including all
     * seven seniors, and nobody new — so our preview "matched" it perfectly and
     * the team came out at exactly 100.0% returning, top of the table.
     *
     * Matching a stale page is not verification, it is two copies of the same
     * out-of-date list agreeing with each other. Every real roster gains
     * somebody between seasons, so no new names is the tell.
     */
    reasons.push("school has not published next season's roster");
  } else {
    const officialNames = new Set(official.map(normName));
    const ourNames = new Set((entry.roster ?? []).map((p) => normName(p.name)));
    const extra = (entry.roster ?? [])
      .filter((p) => p.status !== "newcomer" && !officialNames.has(normName(p.name)));
    const absent = official
      .filter((n) => !ourNames.has(normName(n)) && playedLastSeason.has(normName(n)));
    if (extra.length) reasons.push(`${extra.length} departed player(s) still listed`);
    if (absent.length) reasons.push(`${absent.length} player(s) missing from our roster`);
  }
  const confirmed = reasons.length === 0;
  if (!confirmed) unconfirmed++;

  teams[team] = {
    conf: entry.conf ?? null,
    ret_prior_min: Math.round(retMin),
    prior_team_min: Math.round(prior),
    ret_min_pct: r3(pct),
    /** Last season minutes belonging to the players transferring IN. */
    in_transfer_min: Math.round(inMin),
    in_transfers_with_min: inJoined,
    /**
     * Returning plus incoming minutes, over last season team total.
     *
     * How much of a full rotation worth of PROVEN D-I minutes the roster holds.
     * It can exceed 100%: a team that returns half its minutes and adds two
     * 1,000-minute starters has more proven production than it fielded last
     * year, which is exactly what the portal made possible and exactly what
     * returning-minutes alone hides.
     */
    proven_min_pct: prior > 0 ? r3((retMin + inMin) / prior) : null,
    /** Minutes that left — the half of the story the percentage hides. */
    departed_min: Math.round(prior - retMin),
    returners: joined,
    /** Everyone on next season's roster, for context on how much is new. */
    roster_size: (entry.roster ?? []).length,
    transfers_in: (entry.roster ?? []).filter((p) => p.status === "transfer").length,
    newcomers: (entry.roster ?? []).filter((p) => p.status === "newcomer").length,
    confirmed,
    /** Why not, so the page can say and a fixer knows where to look. */
    reasons,
  };
}

const list = Object.values(teams);
const ok = list.filter((t) => t.confirmed);
const mean = ok.length ? ok.reduce((a, t) => a + t.ret_min_pct, 0) / ok.length : 0;

fs.writeFileSync(OUT, JSON.stringify({
  season,
  label: preview.label ?? `${season - 1}-${String(season).slice(2)}`,
  prior_season: priorSeason,
  built_from: {
    preview_built_at: preview.built_at ?? null,
    departures_patched_at: preview.departures_patched_at ?? null,
    additions_patched_at: preview.additions_patched_at ?? null,
    manual_transfers_at: preview.manual_transfers_at ?? null,
  },
  teams,
}));

console.log(
  `✓ ${list.length} teams → ${path.relative(ROOT, OUT)}\n` +
  `  ${ok.length} with confirmed rosters, mean returning minutes ${(100 * mean).toFixed(1)}%\n` +
  `  ${unconfirmed} awaiting roster confirmation\n` +
  (noPrior ? `  ${noPrior} with no ${priorSeason} minutes on file\n` : "") +
  (unjoined ? `  ${unjoined} tagged returners did not join a minutes record\n` : ""),
);
