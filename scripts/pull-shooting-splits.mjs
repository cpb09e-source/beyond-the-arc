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
async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
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
  console.log(`${confs.length} conferences`);
  let totalCalls = 0;
  for (let season = FROM; season <= TO; season++) {
    const dir = path.join(OUT_ROOT, String(season));
    fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, "shooting-players.json.gz");
    if (fs.existsSync(dst)) { console.log(`✓ ${season}: already archived`); continue; }
    const byAthlete = new Map(); // dedupe (a player can't be in 2 confs, but be safe)
    for (const c of confs) {
      const { data, error } = await getJson(`${API}/stats/player/shooting/season?season=${season}&conference=${encodeURIComponent(c)}`);
      totalCalls++;
      if (error) { console.warn(`  ✗ ${season}/${c}: ${error}`); await sleep(PAUSE_MS); continue; }
      for (const row of data || []) byAthlete.set(`${row.athleteId}:${row.teamId}`, row);
      await sleep(PAUSE_MS);
    }
    const rows = [...byAthlete.values()];
    fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
    console.log(`✓ ${season}: ${rows.length} players → ${path.basename(dst)}`);
  }
  console.log(`done — ${totalCalls} API calls`);
}
main().catch((e) => { console.error(e); process.exit(1); });
