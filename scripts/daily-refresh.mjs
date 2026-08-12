/**
 * daily-refresh.mjs — the self-updating loop for the 2026-27 season.
 *
 * PRESEASON MODE (now → first game):
 *   1. Rebuild public/data/season-preview.json from Bart's living offseason
 *      feed + our portal commitments (scripts/build-season-preview.mjs).
 *   2. Copy it into out/data/ and `netlify deploy --prod --dir=out --no-build`
 *      — Netlify uploads just the changed file (~30s). No site rebuild.
 *
 * IN-SEASON MODE (auto-detected once Bart's 2027 game feed has rows):
 *   Still not wired — it needs 2027 "graduated" into the app first (YEARS
 *   arrays, season clamps, ranks cohort). The script detects the season has
 *   started, refreshes the preview, and prints a loud reminder.
 *
 *   THE ORDER MATTERS, and it changed completely when the CBB Analytics
 *   dependency was removed (docs/data-sources.md). Everything below the ingest
 *   is a local derivation over the archive, so the chain has to run in
 *   dependency order or a downstream step reads a stale file:
 *
 *     A. INGEST (network)
 *        node scripts/cbbd-ingest.mjs --season 2027            plays + box
 *        node scripts/pull-team-box-v2.mjs --season 2027        cap-aware team box
 *        node scripts/pull-player-box-v2.mjs --season 2027      cap-aware player box
 *        node scripts/pull-rankings.mjs                        AP polls
 *        node scripts/pull-adjusted-ratings.mjs                CBBD adj ratings
 *        node scripts/pull-shooting-splits.mjs                 shooting profile
 *
 *     B. JOIN TABLE — run BEFORE anything that resolves a team name. New/renamed
 *        programs appear here first; a missing id silently drops a team's games.
 *        node scripts/build-cbbd-team-map.mjs
 *
 *     C. DERIVE (each reads the previous step's output)
 *        node scripts/build-game-logs-cbbd.mjs --season 2027    <- the keystone
 *        node scripts/build-adjusted-ratings.mjs --season 2027
 *        node scripts/build-team-season-stats.mjs               reads both above
 *        node scripts/build-shot-distribution.mjs --season 2027
 *        node scripts/build-player-season-adv.mjs
 *        node scripts/export-game-box-json.mjs 2027
 *        node scripts/export-game-players-json.mjs --season 2027
 *        node scripts/build-second-chance.mjs --season 2027   (before game-logs;
 *            the log build reads its sidecar for scp_diff)
 *        node scripts/build-tournament-game-ids.mjs           (after the March
 *            box scrape — maps SR slugs onto our ids so the coach pages open
 *            the shared box modal instead of the fallback)
 *
 *     D. LINEUPS / EPM (needs onFloor, so 2024+ only)
 *        node scripts/cbbd-build-stints.mjs --season 2027
 *        python scripts/compute-epm.py --season 2027
 *        python scripts/compute-epm-extras.py --season 2027     on/off + lineups
 *        node scripts/export-epm-json.mjs
 *        node scripts/export-lineups-json.mjs --from 2027 --to 2027
 *
 *     E. BART + PUBLISH
 *        YEARS=2027 npm run sync:bart
 *        npm run export:data                                    reads C's files
 *        npx tsx scripts/compute-player-ranks.mts
 *        node scripts/prune-search-index.mjs
 *        npm run sync:r2
 *        node scripts/build-with-r2-stash.mjs
 *        netlify deploy --prod --dir=out --no-build
 *
 *   NOTE ON export:data: it no longer generates game logs or team stats — it
 *   READS the files step C wrote and will throw if they are missing. That is
 *   deliberate; it fails loudly rather than publishing a season of nulls.
 *
 * Schedule daily via Windows Task Scheduler, STARTING 2026-11-01 (season opens):
 *   schtasks /Create /TN "BTA Daily Refresh" /SC DAILY /SD 11/01/2026 /ST 07:00 /F /TR ^
 *     "cmd /c cd /d C:\Users\Colin\websites\beyond-the-arc && node scripts\daily-refresh.mjs >> daily-refresh.log 2>&1"
 *
 * Run manually: node scripts/daily-refresh.mjs           (build + deploy)
 *               node scripts/daily-refresh.mjs --no-deploy (build only)
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertUnfrozen } from "./lib/data-freeze.mjs";

const ROOT = process.cwd();
const NO_DEPLOY = process.argv.includes("--no-deploy");
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, cwd: ROOT });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

async function seasonHasStarted() {
  // Bart's game feed for 2027 is empty until real games are played.
  try {
    const res = await fetch("https://barttorvik.com/getgamestats.php?year=2027&csv=1", { headers: UA });
    const text = (await res.text()).trim();
    return text.length > 50; // any real row ≫ 50 chars
  } catch {
    return false;
  }
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`\n═══ BTA daily refresh @ ${stamp} ═══`);

  // Every branch below this line touches the network — the preview rebuild, the
  // season-start probe and the deploy. Refuse the whole run during the freeze
  // rather than guarding each call, and refuse it HERE so the message names the
  // script someone actually typed. The schedule starts 2026-11-01, after the
  // thaw, so this only ever fires on a manual run.
  assertUnfrozen("scripts/daily-refresh.mjs", "Bart's offseason and game feeds");

  // 1. Rebuild the preview artifact.
  run("node", ["scripts/build-season-preview.mjs"]);

  // 1b. Finish the impact group. The builder reads its carried-over stat line
  // from the rank files, which cover fewer players than the EPM fit does — 654
  // preview players are in epm-<year>.json with no rank file, and without this
  // pass they show an eWins and an on/off beside a blank EPM. This stamps the
  // value from the same file the live team pages read. Idempotent, so it is
  // safe here whether or not the builder already filled the row.
  run("node", ["scripts/patch-preview-impact.mjs"]);

  // 2. Season-start detection.
  if (await seasonHasStarted()) {
    console.log(
      "\n⚠⚠⚠  2026-27 GAMES DETECTED in Bart's feed. The in-season pipeline is\n" +
        "not wired yet — time to graduate year 2027 into YEARS + clamps and switch\n" +
        "this script to the full sync→export→ranks→R2→build→deploy loop.\n",
    );
  }

  // 3. Ship the refreshed file (single-file diff upload).
  if (NO_DEPLOY) {
    console.log("--no-deploy: skipping upload.");
    return;
  }
  const outData = path.join(ROOT, "out", "data");
  if (!fs.existsSync(outData)) {
    console.log("⚠ out/data missing — run a full build once (node scripts/build-with-r2-stash.mjs) before scheduling. Skipping deploy.");
    return;
  }
  fs.copyFileSync(
    path.join(ROOT, "public", "data", "season-preview.json"),
    path.join(outData, "season-preview.json"),
  );
  console.log("\n🚀 deploying (diff upload — only the changed file goes up)…");
  execSync("netlify deploy --prod --dir=out --no-build", { stdio: "inherit", cwd: ROOT });
  console.log("✓ daily refresh complete.");
}

main().catch((e) => {
  console.error("daily refresh FAILED:", e.message);
  process.exit(1);
});
