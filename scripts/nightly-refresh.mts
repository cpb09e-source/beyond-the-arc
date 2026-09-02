/**
 * nightly-refresh.mts — the in-season pipeline, as one command.
 *
 * ── WHAT CHANGED, AND WHY THIS IS NOT daily-refresh.mjs ───────────────────
 *
 * daily-refresh.mjs is the PRESEASON loop: rebuild season-preview.json, copy it
 * into out/, single-file deploy. Its header carries the in-season chain in full
 * and says it is "still not wired". This is that chain, wired — and the last
 * two steps of it are gone.
 *
 * The documented ending was `build-with-r2-stash.mjs` then `netlify deploy`:
 * an 8-minute build and an upload of 319,000 files, nightly, to publish
 * numbers. That was the only option while every team page baked its stats into
 * HTML. It is not any more — LIVE_SEASON's pages read
 * /data/live/team/<slug>.json at load (see src/lib/live-team-page.ts), so
 * publishing is now: write the files, upload the files. Nothing is rebuilt.
 *
 * ── PHASES, AND WHY THEY ARE SEPARABLE ────────────────────────────────────
 *
 *   ingest    the network half. CBBD box scores and plays, AP polls, Bart.
 *   derive    local derivations over the archive on disk. No network.
 *   publish   the artifacts the browser actually reads, then the R2 upload.
 *
 * Separable because they fail for unrelated reasons. An upstream 500 during
 * ingest should not cost the derivations that already succeeded, and
 * re-publishing after a fixed builder should not re-pull a night of box scores.
 * `--phase publish` is also the only part that should run at all today: the
 * archive is frozen until 2026-10-01, and this script refuses the ingest phase
 * until then. The scripts it calls do NOT refuse on their own — see the note
 * on INGEST for how that was found out.
 *
 * ── THE ORDER IS NOT A STYLE CHOICE ───────────────────────────────────────
 *
 * Every step after the ingest reads the previous step's output off disk. Run
 * them out of order and nothing errors — a downstream builder reads yesterday's
 * file and publishes numbers that disagree with the ones beside them. The
 * sequence below is daily-refresh.mjs's documented chain in its order, with the
 * join table still ahead of everything that resolves a team name, because a new
 * or renamed program appears there first and a missing id silently drops a
 * team's games.
 *
 * ── IT WRITES ITS OWN STATUS ──────────────────────────────────────────────
 *
 * Every run records what it did to public/data/live/refresh-status.json and
 * then uploads it, plus a one-line-per-run history, with
 * scripts/publish-run-record.mjs. That is what the admin page reads. A job
 * whose only record is a log on a machine nobody is looking at is a job that
 * fails silently for a week.
 *
 * It does NOT "ride to R2 with everything else", which is what this comment
 * used to say: the sync runs inside the publish phase and the record is
 * written after every phase, so the sync could only ever carry the previous
 * night's. The upload has to be its own step, after the record exists.
 *
 * Usage:
 *   npx tsx scripts/nightly-refresh.mts                    # every phase
 *   npx tsx scripts/nightly-refresh.mts --phase publish    # just republish
 *   npx tsx scripts/nightly-refresh.mts --dry-run          # print, run nothing
 *   npx tsx scripts/nightly-refresh.mts --no-sync          # build, do not upload
 *   npx tsx scripts/nightly-refresh.mts --season 2027
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { LIVE_SEASON } from "@/lib/seasons";
// @ts-expect-error — plain .mjs helper with no type declarations.
import { assertUnfrozen } from "./lib/data-freeze.mjs";

const ROOT = process.cwd();
const STATUS_PATH = path.join(ROOT, "public", "data", "live", "refresh-status.json");

const has = (f: string) => process.argv.includes(f);
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

const DRY = has("--dry-run");
const NO_SYNC = has("--no-sync");
const seasonArg = arg("--season");
const SEASON = seasonArg ? Number(seasonArg) : LIVE_SEASON;
// rollback is absent from the default on purpose — see ROLLBACK.
const PHASES = (arg("--phase") ?? "ingest,derive,publish").split(",").map((s) => s.trim());

if (SEASON === null || !Number.isFinite(SEASON)) {
  console.error(
    "No season to refresh. LIVE_SEASON in src/lib/seasons.ts is null, which means\n" +
    "no season is being played and there is nothing nightly to do.\n" +
    "Pass --season <year> to run the pipeline against one anyway.",
  );
  process.exit(1);
}
const YEAR = String(SEASON);

type Step = { cmd: string; args: string[]; note?: string };

/**
 * A. INGEST — the only phase that touches the network.
 *
 * THE FREEZE IS GUARDED HERE, BY THIS FILE, and that is not belt-and-braces.
 * An earlier version of this comment asserted that each script below calls
 * assertUnfrozen for itself. NONE OF THEM DO — the guard lives in
 * daily-refresh.mjs and build-season-preview.mjs and nowhere else. Running this
 * phase during the freeze therefore pulled Bart's live 2027 feed and upserted
 * it into Supabase, which is the same way the freeze was crossed once before:
 * a wrapper that was assumed to be guarded because the scripts under it looked
 * like they would be.
 *
 * So the wrapper asserts before the phase runs, once, where the message can
 * name the thing someone actually typed. Six scripts that each need their own
 * guard is six chances to add a seventh without one.
 *
 * It also needs a live CBBD_API_KEY; a 401 there is a subscription problem,
 * not something a retry fixes.
 */
const INGEST: Step[] = [
  { cmd: "node", args: ["scripts/cbbd-ingest.mjs", "--season", YEAR], note: "plays + box" },
  { cmd: "node", args: ["scripts/pull-team-box-v2.mjs", "--season", YEAR], note: "cap-aware team box" },
  { cmd: "node", args: ["scripts/pull-player-box-v2.mjs", "--season", YEAR], note: "cap-aware player box" },
  { cmd: "node", args: ["scripts/pull-rankings.mjs"], note: "AP polls" },
  { cmd: "node", args: ["scripts/pull-adjusted-ratings.mjs"], note: "CBBD adjusted ratings" },
  { cmd: "node", args: ["scripts/pull-shooting-splits.mjs"], note: "shooting profile" },
  /**
   * Bart, and it lives HERE rather than at the top of publish where the
   * documented chain lists it. sync-bart fetches barttorvik.com — it is a pull,
   * and a pull in the publish phase would mean `--phase publish` could not run
   * without the network, which is the one property that phase exists to have.
   *
   * Worth knowing: unlike the CBBD pulls above it, sync-bart does NOT call
   * assertUnfrozen, so it is the one step here that would cross the data freeze
   * if this phase were run by hand before 2026-10-01.
   */
  { cmd: "npx", args: ["tsx", "scripts/sync-bart.mts"], note: `Bart T-Rank + advanced, YEARS=${YEAR}` },
];

/**
 * B + C + D. DERIVE — local, over the archive on disk.
 *
 * build-cbbd-team-map is first and alone in its group for the reason the chain
 * gives: it is the join table, and everything after resolves a team name
 * through it.
 *
 * build-second-chance is ahead of the game-log build because the log build
 * reads its sidecar for scp_diff. That is the one place the documented order
 * looks wrong and is not.
 */
const DERIVE: Step[] = [
  { cmd: "node", args: ["scripts/build-cbbd-team-map.mjs"], note: "join table — before anything that resolves a name" },
  { cmd: "node", args: ["scripts/build-second-chance.mjs", "--season", YEAR], note: "sidecar the log build reads" },
  { cmd: "node", args: ["scripts/build-game-logs-cbbd.mjs", "--season", YEAR], note: "the keystone" },
  { cmd: "node", args: ["scripts/build-adjusted-ratings.mjs", "--season", YEAR] },
  { cmd: "node", args: ["scripts/build-team-season-stats.mjs"], note: "reads both above" },
  { cmd: "node", args: ["scripts/build-shot-distribution.mjs", "--season", YEAR] },
  { cmd: "node", args: ["scripts/build-player-season-adv.mjs"] },
  { cmd: "node", args: ["scripts/export-game-box-json.mjs", YEAR] },
  { cmd: "node", args: ["scripts/export-game-players-json.mjs", "--season", YEAR] },
  { cmd: "node", args: ["scripts/cbbd-build-stints.mjs", "--season", YEAR], note: "needs onFloor — 2024+" },
  { cmd: "python", args: ["scripts/compute-epm.py", "--season", YEAR] },
  { cmd: "python", args: ["scripts/compute-epm-extras.py", "--season", YEAR], note: "on/off + lineups" },
  { cmd: "node", args: ["scripts/export-epm-json.mjs"] },
  { cmd: "node", args: ["scripts/export-lineups-json.mjs", "--from", YEAR, "--to", YEAR] },
  { cmd: "npx", args: ["tsx", "scripts/compute-player-ranks.mts"] },
  { cmd: "node", args: ["scripts/prune-search-index.mjs"] },
];

/**
 * E. PUBLISH — the files the browser reads.
 *
 * export-static-data is here rather than in DERIVE because it is the step that
 * turns the derivations into the site's own JSON, and because it fails loudly
 * if DERIVE did not write what it expects: it no longer generates game logs or
 * team stats, it reads them, and throws rather than publishing a season of
 * nulls.
 *
 * The index builders and the live bundles come last because each reads what
 * export-static-data wrote. build-live-team-pages runs the real page loader
 * once per team, which makes it the closest thing this pipeline has to an
 * end-to-end assertion that the season renders at all.
 */
const PUBLISH: Step[] = [
  { cmd: "npx", args: ["tsx", "scripts/export-static-data.mts"], note: "reads DERIVE's files, throws if absent" },
  // Keeps the admin page's destination typeahead current — a new or renamed
  // program has to be offerable the season it appears, not the season after.
  { cmd: "node", args: ["scripts/build-team-names.mjs"], note: "team names for the admin typeahead" },
  { cmd: "node", args: ["scripts/build-team-game-index.mjs", "--season", YEAR] },
  { cmd: "node", args: ["scripts/build-game-index.mjs", "--season", YEAR] },
  { cmd: "npx", args: ["tsx", "scripts/build-team-season-games.mts", "--season", YEAR], note: "per-team game files" },
  { cmd: "npx", args: ["tsx", "scripts/build-live-team-pages.mts", "--season", YEAR], note: "the live team pages" },
  { cmd: "npx", args: ["tsx", "scripts/build-live-player-pages.mts", "--season", YEAR], note: "the live player pages" },
];

/**
 * The upload. Narrowed with --only rather than a full sync, which HEADs about
 * 152,000 existing objects just to skip them — minutes of waiting for four
 * directories that are the only ones a nightly run can have changed.
 */
const SYNC: Step[] = [
  /**
   * SNAPSHOT FIRST, and the order is the whole point. Taken after the upload,
   * "previous" would mean the run that just happened, and rolling back a bad
   * night would restore the bad night.
   */
  { cmd: "node", args: ["scripts/r2-snapshot.mjs", "--snapshot"], note: "keep last night, so a bad run can be undone" },
  { cmd: "node", args: ["scripts/sync-data-to-r2.mjs", "--only", "live"], note: "the live team pages" },
  { cmd: "node", args: ["scripts/sync-data-to-r2.mjs", "--only", "team-season-games"] },
  { cmd: "node", args: ["scripts/sync-data-to-r2.mjs", "--only", "team-game-index"] },
  { cmd: "node", args: ["scripts/sync-data-to-r2.mjs", "--only", "game-index"] },
];

type Result = { step: string; note?: string; ms: number; status: "ok" | "failed" | "skipped" };

const results: Result[] = [];
const started = new Date();

function runStep(s: Step): boolean {
  const label = `${s.cmd} ${s.args.join(" ")}`;
  if (DRY) {
    console.log(`  would run  ${label}${s.note ? `   — ${s.note}` : ""}`);
    results.push({ step: label, note: s.note, ms: 0, status: "skipped" });
    return true;
  }
  console.log(`\n> ${label}${s.note ? `   — ${s.note}` : ""}`);
  const t0 = Date.now();
  // YEARS is how sync-bart selects its seasons; setting it here keeps the
  // season in one place rather than in a shell line that can disagree.
  const env = { ...process.env, YEARS: YEAR };
  const r = spawnSync(s.cmd, s.args, { stdio: "inherit", shell: true, cwd: ROOT, env });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  results.push({ step: label, note: s.note, ms, status: ok ? "ok" : "failed" });
  if (!ok) console.error(`FAILED: exited ${r.status} after ${(ms / 1000).toFixed(1)}s`);
  return ok;
}

function writeStatus(outcome: "ok" | "failed", failedAt: string | null) {
  const finished = new Date();
  const status = {
    season: SEASON,
    phases: PHASES,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    outcome,
    failedAt,
    dryRun: DRY,
    steps: results,
  };
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  console.log(`\nstatus -> public/data/live/refresh-status.json`);
  publishRecord();
}

/**
 * Send the record to R2, where the admin page reads it.
 *
 * THIS IS WHAT MAKES THE RECORD REACH ANYONE. The sync steps in PUBLISH ran
 * before writeStatus could exist, so they uploaded whatever status file was on
 * disk from the night before — and on Actions there is no night before. The
 * admin page was reading a record that was one run stale at best, and on a
 * failed run nothing at all. See the header of scripts/publish-run-record.mjs.
 *
 * Deliberately NOT a tracked step: the record is already written by the time
 * this runs, so its own failure has nowhere to be recorded except the log. It
 * cannot change the outcome and it must not — a run that published every file
 * and then could not upload its receipt still succeeded.
 *
 * --no-sync means "touch nothing on R2", and that includes this.
 */
function publishRecord() {
  const args = ["scripts/publish-run-record.mjs", ...(NO_SYNC ? ["--no-upload"] : [])];
  const r = spawnSync("node", args, { stdio: "inherit", shell: true, cwd: ROOT });
  if (r.status !== 0) console.error("could not publish the run record — the run itself is unaffected");
}

/**
 * ROLLBACK — put last night's files back, and nothing else.
 *
 * A phase rather than a separate script so it runs through the same runner,
 * writes the same status record and is dispatched the same way. The thing you
 * reach for when the site is wrong is not the moment to be using a code path
 * nothing else exercises.
 *
 * It is never part of a default run: PHASES has to name it explicitly.
 */
const ROLLBACK: Step[] = [
  { cmd: "node", args: ["scripts/r2-snapshot.mjs", "--restore"], note: "restore the previous publish" },
];

const GROUPS: Array<[string, Step[]]> = [
  ["ingest", INGEST],
  ["derive", DERIVE],
  ["publish", NO_SYNC ? PUBLISH : [...PUBLISH, ...SYNC]],
  ["rollback", ROLLBACK],
];

console.log(`\n=== BTA nightly refresh - season ${SEASON} ===`);
console.log(`phases: ${PHASES.join(", ")}${DRY ? "   (dry run)" : ""}${NO_SYNC ? "   (no sync)" : ""}`);

for (const [name, steps] of GROUPS) {
  if (!PHASES.includes(name)) { console.log(`\n-- ${name}: skipped`); continue; }
  // See the note on INGEST. Deliberately not inside runStep: the point is to
  // refuse the phase before its first request, not to fail partway through one.
  if (name === "ingest" && !DRY) assertUnfrozen("scripts/nightly-refresh.mts", "CBBD and Bart feeds");
  console.log(`\n-- ${name} --`);
  for (const s of steps) {
    if (!runStep(s)) {
      writeStatus("failed", `${s.cmd} ${s.args.join(" ")}`);
      console.error(`\nnightly refresh FAILED in ${name}. Nothing after this ran.`);
      process.exit(1);
    }
  }
}

writeStatus("ok", null);
const secs = ((Date.now() - started.getTime()) / 1000).toFixed(0);
console.log(`\nnightly refresh complete in ${secs}s - ${results.filter((r) => r.status === "ok").length} steps`);
