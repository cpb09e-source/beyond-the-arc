/**
 * backfill-player-photos.mjs — fills in player headshots that the per-team
 * roster fetch (fetch-player-images.mjs) couldn't get. That script only sees
 * ESPN's CURRENT rosters, so historical players (~9k since 2013) come up
 * empty. This script searches ESPN by player name + tries the CDN directly.
 *
 * Strategy:
 *   1. Read existing player-photos.json (the cache built by fetch:photos).
 *   2. Walk every ranked player profile (the ones with /players/<id> pages).
 *   3. For each one without a photo, query ESPN's search-v2 endpoint.
 *   4. Find a basketball athlete that best matches the name; grab their CDN
 *      headshot (may be under nba/, mens-college-basketball/, etc).
 *   5. Download + optimize via Sharp; update player-photos.json incrementally.
 *
 * Politeness: 1 req/sec to ESPN. ~9k players → ~3 hours full run. Incremental
 * — re-running picks up where it left off via the photo-map cache + a
 * per-bartId "tried" set so we don't re-search hopeless misses.
 *
 * Run: node scripts/backfill-player-photos.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUB = path.resolve("public/images/players");
const DATA = path.resolve("src/data");
const PHOTOS_JSON = path.join(DATA, "player-photos.json");
const TRIED_JSON = path.join(DATA, "player-photos-tried.json");
const RANKS_DIR = path.resolve("public/data/player-ranks");
const PLAYER_DIR = path.resolve("public/data/player");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, image/*, */*;q=0.8",
};

// Polite throttle — 1 req/sec to ESPN.
const MIN_INTERVAL_MS = 1100;
let lastFetchAt = 0;
async function throttled(url, opts) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, { ...opts, headers: { ...UA, ...(opts?.headers ?? {}) } });
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function loadJsonIf(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function downloadImage(url, destPng) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    // Reject tiny files (ESPN's missing-photo placeholder is small).
    if (buf.length < 2000) return { error: "placeholder" };
    await fs.writeFile(destPng, buf);
    return { bytes: buf.length };
  } catch (e) {
    return { error: e.message };
  }
}

async function optimize(srcPng, destWebp, destThumbWebp) {
  if (!existsSync(destWebp)) {
    await sharp(srcPng).webp({ quality: 82 }).toFile(destWebp);
  }
  if (!existsSync(destThumbWebp)) {
    await sharp(srcPng)
      .resize(240, 174, { fit: "cover", position: "top" })
      .webp({ quality: 78 })
      .toFile(destThumbWebp);
  }
}

// Try a few ESPN CDN paths for a given athlete id. Returns the first that 200s.
const CDN_PATHS = [
  "mens-college-basketball",
  "nba",
  "wnba",
];
async function findHeadshotUrl(athleteId) {
  for (const sport of CDN_PATHS) {
    const url = `https://a.espncdn.com/i/headshots/${sport}/players/full/${athleteId}.png`;
    try {
      const res = await throttled(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch {}
  }
  return null;
}

// ESPN search-v2 endpoint — returns players matching the name across leagues.
// Returns array of { id, name, league, image }.
async function searchEspn(name) {
  const url = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=20&type=player`;
  try {
    const res = await throttled(url);
    if (!res.ok) return [];
    const j = await res.json();
    const players = (j.results ?? [])
      .filter((r) => r.type === "player")
      .flatMap((r) => r.contents ?? []);
    return players
      .filter((p) => p.sport === "basketball")
      .map((p) => {
        // The uid contains `a:<athleteId>` — pull it out.
        const m = /a:(\d+)/.exec(p.uid ?? "");
        return {
          id: m?.[1] ?? null,
          name: p.displayName ?? "",
          subtitle: p.subtitle ?? "",
          image: p.image?.default ?? null,
          league: p.defaultLeagueSlug ?? "",
        };
      })
      .filter((p) => p.id);
  } catch {
    return [];
  }
}

async function main() {
  await fs.mkdir(PUB, { recursive: true });
  await fs.mkdir(DATA, { recursive: true });

  /** @type {Record<string, string>} */
  const photoMap = await loadJsonIf(PHOTOS_JSON, {});
  /** @type {Record<string, { tried_at: string; reason?: string }>} */
  const triedMap = await loadJsonIf(TRIED_JSON, {});

  // Build the working set: ranked players (those with profile pages) who
  // don't have a photo yet and haven't been tried recently.
  const rankFiles = await fs.readdir(RANKS_DIR);
  const rankedIds = new Set(
    rankFiles
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseInt(f.replace(".json", ""), 10))
      .filter(Number.isFinite),
  );
  console.log(`Total ranked players: ${rankedIds.size}`);
  console.log(`Already photographed:  ${Object.keys(photoMap).length}`);
  console.log(`Already tried:         ${Object.keys(triedMap).length}`);

  // Targets = ranked & no photo & not tried.
  const targets = [];
  for (const bartId of rankedIds) {
    if (photoMap[bartId]) continue;
    if (triedMap[bartId]) continue;
    targets.push(bartId);
  }
  console.log(`Backfill targets:      ${targets.length}\n`);

  let attempted = 0;
  let found = 0;
  let cdnHits = 0;
  let downloads = 0;
  let saveCounter = 0;
  const t0 = Date.now();

  for (const bartId of targets) {
    attempted++;
    if (attempted % 50 === 0) {
      const rate = attempted / ((Date.now() - t0) / 1000);
      const eta = (targets.length - attempted) / rate;
      process.stdout.write(
        `  ${attempted}/${targets.length} | found=${found} | rate=${rate.toFixed(1)}/s | ETA=${Math.round(eta / 60)}min\r`,
      );
    }

    // Read player profile to get name (and most-recent team for disambiguation).
    let name = null;
    let mostRecentTeam = null;
    try {
      const p = JSON.parse(await fs.readFile(path.join(PLAYER_DIR, `${bartId}.json`), "utf8"));
      const latest = p.seasons?.[0];
      const row = latest?.raw_row;
      name = Array.isArray(row) && typeof row[0] === "string" ? row[0] : null;
      mostRecentTeam = latest?.team_name ?? null;
    } catch {}
    if (!name) {
      triedMap[bartId] = { tried_at: new Date().toISOString(), reason: "no name" };
      continue;
    }

    const results = await searchEspn(name);
    if (results.length === 0) {
      triedMap[bartId] = { tried_at: new Date().toISOString(), reason: "no results" };
    } else {
      // Prefer the best match: exact name + basketball + has image.
      const normTarget = norm(name);
      let best = results.find((r) => norm(r.name) === normTarget && r.image);
      if (!best) best = results.find((r) => norm(r.name) === normTarget);
      if (!best) best = results[0];

      let url = best.image;
      // If search didn't return an image, try the CDN paths directly.
      if (!url && best.id) {
        url = await findHeadshotUrl(best.id);
        if (url) cdnHits++;
      }

      if (url) {
        found++;
        const pngPath = path.join(PUB, `${bartId}.png`);
        const webpPath = path.join(PUB, `${bartId}.webp`);
        const thumbPath = path.join(PUB, `${bartId}-sm.webp`);
        const r = await downloadImage(url, pngPath);
        if (r.bytes) {
          downloads++;
          try {
            await optimize(pngPath, webpPath, thumbPath);
            photoMap[bartId] = `/images/players/${bartId}.webp`;
            await fs.unlink(pngPath).catch(() => {});
          } catch {
            triedMap[bartId] = { tried_at: new Date().toISOString(), reason: "sharp fail" };
          }
        } else {
          triedMap[bartId] = { tried_at: new Date().toISOString(), reason: r.error ?? "dl fail" };
        }
      } else {
        triedMap[bartId] = { tried_at: new Date().toISOString(), reason: "no headshot" };
      }
    }

    // Persist every 100 attempts so a kill doesn't lose progress.
    saveCounter++;
    if (saveCounter >= 100) {
      saveCounter = 0;
      await fs.writeFile(PHOTOS_JSON, JSON.stringify(photoMap, null, 2));
      await fs.writeFile(TRIED_JSON, JSON.stringify(triedMap));
    }
  }

  // Final save.
  await fs.writeFile(PHOTOS_JSON, JSON.stringify(photoMap, null, 2));
  await fs.writeFile(TRIED_JSON, JSON.stringify(triedMap));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${elapsed}s (${Math.round(elapsed / 60)}min).`);
  console.log(`  attempted:    ${attempted}`);
  console.log(`  photos found: ${found}`);
  console.log(`  CDN-fallback: ${cdnHits}`);
  console.log(`  downloaded:   ${downloads}`);
  console.log(`  photo-map:    ${Object.keys(photoMap).length} entries`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
