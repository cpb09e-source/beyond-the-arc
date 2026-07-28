#!/usr/bin/env node
/**
 * build-demo-slate.mjs — bake the offseason demo data.
 *
 *   node scripts/build-demo-slate.mjs
 *
 * Writes two static files that the site reads directly while
 * SCOREBOARD_MODE is "demo" (see src/lib/flags.ts):
 *
 *   public/data/demo-slate.json — one full day's slate, for the ticker and the
 *                                 /scoreboard page. Both read the same file, so
 *                                 the second one is a browser cache hit.
 *   public/data/demo-game.json  — one complete game bundle, which every demo
 *                                 link opens.
 *
 * WHY BAKE RATHER THAN PIN THE FUNCTION TO A DATE. Both produce the same
 * bytes, but the function route makes every visitor on every page of the site
 * wait on a serverless invocation that calls CBBD five times to build a file
 * that cannot change. Baked, it is a gzipped asset on the CDN with the poll
 * loop switched off — cheaper for the reader, free against the quota, and it
 * keeps the ticker off the local dev proxy, which leaks on every request
 * (docs/dev-scoreboard.md).
 *
 * Run this again only to change which day or which game the demo shows.
 * Deleting both files is what SCOREBOARD_MODE = "live" expects.
 */
import fs from "node:fs";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";

// CBBD resolves IPv6-first behind Cloudflare; see the note atop
// netlify/functions/scoreboard.mts.
setDefaultResultOrder("ipv4first");

/** The day and game the demo shows. Keep in step with DEMO_GAME in src/lib/flags.ts. */
const DATE = "2026-02-07";
const GAME_ID = 214837;

const root = process.cwd();
const outDir = path.join(root, "public", "data");

const key = fs.readFileSync(path.join(root, ".env.local"), "utf8")
  .match(/^CBBD_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("CBBD_API_KEY not found in .env.local");
process.env.CBBD_API_KEY = key;

// The functions ARE the builders. Importing their handlers rather than
// reimplementing the CBBD calls means the baked file is byte-for-byte the shape
// the live path returns, so switching SCOREBOARD_MODE cannot change the render.
const { default: scoreboard } = await import("../netlify/functions/scoreboard.mts");
const { default: game } = await import("../netlify/functions/game.mts");

async function call(handler, url) {
  const res = await handler(new Request(url), {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const json = JSON.parse(text);
  if (json?.error) throw new Error(`${url} → ${json.error}`);
  return { json, bytes: Buffer.byteLength(text) };
}

fs.mkdirSync(outDir, { recursive: true });

const slate = await call(scoreboard, `http://x/api/scoreboard?date=${DATE}`);
if (!slate.json.games?.length) throw new Error("empty slate — refusing to write");
fs.writeFileSync(path.join(outDir, "demo-slate.json"), JSON.stringify(slate.json));
console.log(`demo-slate.json  ${slate.json.games.length} games  ${(slate.bytes / 1024).toFixed(0)} KB`);

const bundle = await call(game, `http://x/api/game?id=${GAME_ID}&date=${DATE}`);
const g = bundle.json.game;
fs.writeFileSync(path.join(outDir, "demo-game.json"), JSON.stringify(bundle.json));
console.log(
  `demo-game.json   ${g.away.team} ${g.away.points} @ ${g.home.team} ${g.home.points}` +
  `  ${(bundle.bytes / 1024).toFixed(0)} KB`,
);
