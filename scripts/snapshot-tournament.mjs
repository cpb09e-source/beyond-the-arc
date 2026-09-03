#!/usr/bin/env node
/**
 * snapshot-tournament.mjs — bake the tournament feed into src/data/<slug>.json.
 *
 * The coach pages under /t/ render this file first and fall back to it if the
 * feed is unreachable, so it should be refreshed whenever the organiser moves
 * a game. It is a copy of what netlify/functions/tournament.mts returns, minus
 * the per-game `raw` diagnostic bag and the timestamp — neither belongs in the
 * page HTML.
 *
 * Reads from the LOCAL dev server by default so the function code being baked
 * is the code in the tree. Pass --prod to read from production instead, which
 * is the right choice on the day if dev is not running.
 *
 * Usage:
 *   node scripts/snapshot-tournament.mjs               # cig, from localhost:8899
 *   node scripts/snapshot-tournament.mjs --slug cig --prod
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const slug = opt("slug") ?? "cig";
const base = args.includes("--prod") ? "https://btacbb.xyz" : "http://localhost:8899";
const out = path.resolve(`src/data/${slug}-2026.json`);

const url = `${base}/api/tournament?event=${encodeURIComponent(slug)}`;
const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) { console.error(`✗ ${url} → HTTP ${res.status}`); process.exit(1); }
const payload = await res.json();
if (payload.error) { console.error(`✗ feed error: ${payload.error}\n  Nothing written; the existing snapshot is untouched.`); process.exit(1); }
if (!Array.isArray(payload.games) || payload.games.length === 0) {
  console.error("✗ feed returned no games. Nothing written; the existing snapshot is untouched.");
  process.exit(1);
}

for (const g of payload.games) g.raw = {};
payload.fetchedAt = "";

fs.writeFileSync(out, JSON.stringify(payload, null, 1) + "\n");
const finals = payload.games.filter((g) => g.status === "final").length;
console.log(`✓ ${path.relative(process.cwd(), out)} — ${payload.games.length} games (${finals} final), ${payload.teams.length} teams, from ${base}`);
