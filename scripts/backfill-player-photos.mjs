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
 *   4. Find a basketball athlete that best matches the name, then take their
 *      COLLEGE headshot if ESPN has one, falling back to whatever the search
 *      returned (see step 4 note below).
 *   5. Download + optimize via Sharp; update player-photos.json incrementally.
 *
 * Politeness: 1 req/sec to ESPN. ~9k players → ~3 hours full run. Incremental
 * — re-running picks up where it left off via the photo-map cache + a
 * per-bartId "tried" set so we don't re-search hopeless misses.
 *
 * STEP 4 — COLLEGE PHOTO FIRST. ESPN's search returns a player's CURRENT
 * image, so anyone who has gone pro came back wearing an NBA jersey: Chet
 * Holmgren in Thunder blue beside a row reading "Gonzaga · 21-22". The same
 * athlete id serves a different image per sport path, so asking
 * mens-college-basketball/ first gets the college-era shot for one extra HEAD.
 * Verified on Holmgren (4433255): college returns the Gonzaga photo at 236,948
 * bytes, nba the Thunder one at 257,316, both 200.
 *
 * There WAS already a college-first helper here, findHeadshotUrl(). It was
 * unreachable: it only ran when the search result carried no image, which is
 * the rare case. The preference existed and never fired.
 *
 * Photos already downloaded are unaffected — this only changes what future
 * runs fetch. player-photos-source.json records which athlete and which era
 * each photo came from, so correcting the existing ones later is a targeted
 * pass rather than a full re-search.
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
/**
 * bartId → { espn, source } — which ESPN athlete a photo came from and whether
 * it is the college-era shot or the player's current one.
 *
 * A SEPARATE FILE, not extra fields on player-photos.json, because that map is
 * imported straight into the client by PlayerPhoto and is typed as
 * Record<string, string>. Widening it would ship this bookkeeping to every
 * visitor for no reason.
 *
 * Its purpose is to make a future correction pass cheap. Photos fetched before
 * the college-first fix have no entry here, and re-checking them otherwise
 * means re-searching ESPN by name at one request a second for every player.
 */
const SOURCE_JSON = path.join(DATA, "player-photos-source.json");
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

/**
 * PNG → full webp + face-cropped thumbnail.
 *
 * `force` REPLACES existing output. The skip-if-present guard is right for the
 * original backfill, where re-encoding a photo already on disk is pure waste —
 * and silently wrong for a re-fetch, where replacing it is the entire point. It
 * cost a fix: the first --only run downloaded the correct college headshot,
 * reported "downloaded: 1", and left the old NBA webp untouched, because the
 * file it was about to write already existed.
 */
async function optimize(srcPng, destWebp, destThumbWebp, force = false) {
  if (force || !existsSync(destWebp)) {
    await sharp(srcPng).webp({ quality: 82 }).toFile(destWebp);
  }
  if (force || !existsSync(destThumbWebp)) {
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

/**
 * The COLLEGE-ERA headshot for an athlete id, or null.
 *
 * This site is about college basketball, and ESPN's search hands back a
 * player's CURRENT image — for anyone who has gone pro that is their NBA
 * photo. Chet Holmgren in a Thunder jersey beside a row reading
 * "Gonzaga · 21-22" is the visible symptom.
 *
 * ESPN keeps the same athlete id across college and the pros, and serves a
 * DIFFERENT image per sport path. Verified for Holmgren (id 4433255): the
 * college path returns him in a Gonzaga jersey, 236,948 bytes; the nba path
 * returns the Thunder photo, 257,316. Both 200.
 *
 * One HEAD request rather than reusing findHeadshotUrl(), which would also
 * probe nba and wnba — pointless here, because the search result we fall back
 * to already covers those and is known good.
 */
async function collegeHeadshotUrl(athleteId) {
  const url = `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${athleteId}.png`;
  try {
    const res = await throttled(url, { method: "HEAD" });
    if (res.ok) return url;
  } catch {}
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
  /** @type {Record<string, { espn: string | null; source: string }>} */
  const sourceMap = await loadJsonIf(SOURCE_JSON, {});

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

  // --recheck revisits players who ALREADY have a photo, to see whether a
  // college-era shot exists that the old current-photo-first ordering missed.
  //
  // Needed because the ordering fix only governs what future fetches pull, and
  // the cache deliberately skips anyone already photographed — so on its own it
  // would never correct a single one of the ~10k photos already downloaded.
  // Anything carrying a recorded college source is skipped: that one is already
  // right and re-fetching it would spend a request to confirm it.
  //
  // Same politeness and the same incremental saves as a normal run, so it can
  // be interrupted and resumed. Expect roughly an hour per 3,500 players.
  const recheck = process.argv.includes("--recheck");
  // --only=<bartId>[,<bartId>…] — fix one player without a full pass. For
  // spot-correcting a photo someone has noticed is wrong.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg
    ? new Set(onlyArg.slice(7).split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite))
    : null;

  const targets = [];
  if (only) {
    for (const bartId of only) targets.push(bartId);
    console.log(`Only:                  ${targets.join(", ")}\n`);
  } else if (recheck) {
    for (const bartId of rankedIds) {
      if (!photoMap[bartId]) continue;
      if (sourceMap[bartId]?.source === "college") continue;
      targets.push(bartId);
    }
    console.log(`Recheck targets:       ${targets.length}  (already have a photo, era unconfirmed)\n`);
  } else {
    // Targets = ranked & no photo & not tried.
    for (const bartId of rankedIds) {
      if (photoMap[bartId]) continue;
      if (triedMap[bartId]) continue;
      targets.push(bartId);
    }
    console.log(`Backfill targets:      ${targets.length}\n`);
  }

  let attempted = 0;
  let found = 0;
  let cdnHits = 0;
  let collegeHits = 0;
  let noCollege = 0;
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

      // COLLEGE PHOTO FIRST, current photo second.
      //
      // `best.image` is whatever ESPN's search considers current, so for a
      // player who has gone pro it is their NBA headshot. Asking the college
      // path for the same athlete id first gets the college-era shot where one
      // exists, and costs a single HEAD.
      let url = null;
      let source = null;
      if (best.id) {
        url = await collegeHeadshotUrl(best.id);
        if (url) { collegeHits++; source = "college"; }
      }
      // On a recheck the ONLY reason to download is a college shot we don't
      // already have. Falling through to the current photo here would re-fetch
      // and re-encode a file identical to the one on disk, for every player who
      // never went pro — which is most of them.
      if (!url && recheck) {
        sourceMap[bartId] = { espn: best.id ?? null, source: "current" };
        noCollege++;
        saveCounter++;
        continue;
      }
      if (!url && best.image) { url = best.image; source = "current"; }
      // Search gave us nothing either — probe the remaining CDN paths.
      if (!url && best.id) {
        url = await findHeadshotUrl(best.id);
        if (url) { cdnHits++; source = "cdn"; }
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
            // Replacing, not filling a gap, whenever we deliberately re-fetch.
            await optimize(pngPath, webpPath, thumbPath, Boolean(recheck || only));
            photoMap[bartId] = `/images/players/${bartId}.webp`;
            sourceMap[bartId] = { espn: best.id ?? null, source: source ?? "unknown" };
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
      await fs.writeFile(SOURCE_JSON, JSON.stringify(sourceMap));
    }
  }

  // Final save.
  await fs.writeFile(PHOTOS_JSON, JSON.stringify(photoMap, null, 2));
  await fs.writeFile(TRIED_JSON, JSON.stringify(triedMap));
  await fs.writeFile(SOURCE_JSON, JSON.stringify(sourceMap, null, 2));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${elapsed}s (${Math.round(elapsed / 60)}min).`);
  console.log(`  attempted:    ${attempted}`);
  console.log(`  photos found: ${found}`);
  console.log(`  college shot: ${collegeHits}`);
  if (recheck) console.log(`  no college:   ${noCollege}   (kept the existing photo, marked so it is not rechecked)`);
  console.log(`  CDN-fallback: ${cdnHits}`);
  console.log(`  downloaded:   ${downloads}`);
  console.log(`  photo-map:    ${Object.keys(photoMap).length} entries`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
