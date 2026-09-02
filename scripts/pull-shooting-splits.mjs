#!/usr/bin/env node
/**
 * pull-shooting-splits.mjs — per-player season shooting profiles from CBBD
 * (/stats/player/shooting/season): rim/mid/three splits, assisted%, shot diet.
 * Pre-aggregated by CBBD, so this is a light pull — batched by conference
 * (season-wide needs a filter; per-team would be 370 calls/season).
 *
 * Archives raw per season so the join/derive step (export-shooting-json.mjs)
 * runs offline:  data/cbbd/<season>/shooting-players.json.gz
 *
 * Resumable (existing season files skipped). Server-side key only.
 * Run: node scripts/pull-shooting-splits.mjs --from 2014 --to 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const API = "https://api.collegebasketballdata.com";
const OUT_ROOT = path.resolve("data/cbbd");
const PAUSE_MS = Number(process.env.CBBD_PAUSE_MS) || 1000;

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.CBBD_API_KEY;
if (!KEY) { console.error("CBBD_API_KEY missing"); process.exit(1); }

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FROM = Number(opt("from") || 2014), TO = Number(opt("to") || 2026);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Set the first time CBBD rejects the key, and never cleared.
 *
 * THIS SCRIPT HAD THE WORST VERSION OF THE BUG. It loops ~35 conferences per
 * season, warns on each failure and carries on, so a dead key produced 35
 * warnings and an empty `byAthlete` map — which was then gzipped and written
 * out as a real `shooting-players.json.gz`. `[]` makes the season look
 * archived, and the `already archived` guard refuses to retry it. See the long
 * note above `fatalAuth` in pull-player-box-v2.mjs.
 */
let fatalAuth = null;
let failures = 0;

async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (r.status === 401 || r.status === 403) {
        fatalAuth = `HTTP ${r.status} — CBBD rejected CBBD_API_KEY`;
        return { error: fatalAuth };
      }
      if (!r.ok) return { error: r.status };
      return { data: await r.json() };
    } catch { await sleep(2500 * (attempt + 1)); }
  }
  return { error: "retries" };
}

// Conference abbreviations (CBBD). Some don't exist every season — empty pulls
// are harmless. Fetched once up front so realignment years still work.
async function confList() {
  const { data } = await getJson(`${API}/conferences`);
  return (data || []).map((c) => c.abbreviation).filter(Boolean);
}

async function main() {
  const confs = await confList();
  // NO CONFERENCES IS NOT AN EMPTY SEASON, it is a broken run. Every request
  // below is keyed on this list, so continuing writes an empty file for every
  // season in the range.
  if (confs.length === 0) {
    console.error(
      `\n✗ ${fatalAuth ?? "the conference list came back empty"}. Nothing written.\n` +
      (fatalAuth
        ? "\n  The key in .env.local is being rejected outright. CBBD revokes a key\n" +
          "  when the Patreon subscription lapses, and re-subscribing issues a NEW\n" +
          "  one. Get the current key from collegebasketballdata.com and replace\n" +
          "  CBBD_API_KEY in .env.local.\n"
        : ""),
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${confs.length} conferences`);
  let totalCalls = 0;
  for (let season = FROM; season <= TO; season++) {
    if (fatalAuth) break;
    const dir = path.join(OUT_ROOT, String(season));
    fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, "shooting-players.json.gz");
    if (fs.existsSync(dst)) { console.log(`✓ ${season}: already archived`); continue; }
    const byAthlete = new Map(); // dedupe (a player can't be in 2 confs, but be safe)
    let confFailures = 0;
    for (const c of confs) {
      const { data, error } = await getJson(`${API}/stats/player/shooting/season?season=${season}&conference=${encodeURIComponent(c)}`);
      totalCalls++;
      if (error) {
        console.warn(`  ✗ ${season}/${c}: ${error}`);
        confFailures++;
        // Do not walk the remaining 34 conferences to collect the same 401.
        if (fatalAuth) break;
        await sleep(PAUSE_MS);
        continue;
      }
      for (const row of data || []) byAthlete.set(`${row.athleteId}:${row.teamId}`, row);
      await sleep(PAUSE_MS);
    }
    const rows = [...byAthlete.values()];
    // An empty pull is a failed pull. Writing it is worse than writing nothing:
    // `[]` makes the season look archived and the guard above skips it forever.
    if (rows.length === 0) {
      console.error(
        `✗ ${season}: 0 players from ${confFailures} failed conference(s) — nothing written`,
      );
      failures++;
      process.exitCode = 1;
      continue;
    }
    if (confFailures) {
      // Written, but say so: a season missing a league is not a clean archive.
      console.warn(`  ! ${season}: ${confFailures} conference(s) failed — file is incomplete`);
      failures++;
      process.exitCode = 1;
    }
    fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
    console.log(`✓ ${season}: ${rows.length} players → ${path.basename(dst)}`);
  }
  if (fatalAuth) {
    console.error(
      `\n✗ stopped: ${fatalAuth}.\n\n` +
      `  The key in .env.local is being rejected outright, so this is not a\n` +
      `  transient failure. CBBD revokes a key when the Patreon subscription\n` +
      `  lapses, and re-subscribing issues a NEW one. Get the current key from\n` +
      `  collegebasketballdata.com and replace CBBD_API_KEY in .env.local.\n`,
    );
    process.exitCode = 1;
  }
  console.log(
    `done — ${totalCalls} API calls` + (failures ? `, ${failures} season(s) failed or incomplete` : ""),
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
