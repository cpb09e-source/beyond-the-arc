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
 *   Not wired yet — requires "graduating" 2027 into the main pipeline
 *   (YEARS arrays, year clamps, ranks cohort). The script detects the season
 *   has started, refreshes the preview as usual, and prints a loud reminder.
 *   When we wire it: sync:bart YEARS=2027 → export:data → compute-player-ranks
 *   → prune-search-index → build 32-0 index → sync:r2 → build → deploy.
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

  // 1. Rebuild the preview artifact.
  run("node", ["scripts/build-season-preview.mjs"]);

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
