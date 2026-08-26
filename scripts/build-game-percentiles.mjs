#!/usr/bin/env node
/**
 * build-game-percentiles.mjs — national percentile ladders for a SINGLE GAME's
 * shooting rates.
 *
 * WHAT THIS ANSWERS. The player game log prints a night's FG% and wants to say
 * where that night ranks in the country. Nothing in the corpus could answer
 * that: player-ranks holds SEASON percentiles, and the game log's own rows can
 * only rank a player against himself. The population that answers it is every
 * D-I player-game, which does exist — game-players/<year>/<gameId>.json carries
 * both teams' box lines for every game — but as ~6,300 files a season, far too
 * many to read while rendering ~15,700 player pages.
 *
 * So it is precomputed here, once, into a file small enough to ship: a sorted
 * ladder of 101 breakpoints per stat, per position bucket, per season.
 *
 * BUCKETED BY POSITION, like the Player Overview chips. A centre shooting 55%
 * from the floor is ordinary and a guard shooting 55% is not, and a single
 * national ladder would call both the same thing. The bucket comes from the box
 * line's own `pos`, folded to G/F/C.
 *
 * A MINIMUM ATTEMPT COUNT IS PART OF THE DEFINITION. One-for-one is 100% and
 * would otherwise sit at the top of the ladder alongside 11-for-14, and the
 * thousands of 0-for-1 nights would drag the bottom just as hard. Games under
 * MIN_ATT are excluded from the ladder, and the reader excludes them from
 * shading too, so the two agree about what counts as a shooting night.
 *
 * Reads local files only — no network, so the data freeze does not apply.
 *
 *   node scripts/build-game-percentiles.mjs            # every season
 *   node scripts/build-game-percentiles.mjs 2026 2025  # named seasons only
 */
import fs from "node:fs/promises";
import path from "node:path";

const DATA = path.resolve("public/data");
const SRC = path.join(DATA, "game-players");
const OUT = path.join(DATA, "game-percentiles.json");

/** Attempts needed before a night's rate is a rate rather than a coin flip. */
const MIN_ATT = 2;

/** How many breakpoints the ladder keeps. 101 = one per whole percentile. */
const STEPS = 101;

/**
 * The rates, each with the attempts that qualify it.
 *
 * eFG and TS are derived here rather than read off the box line's `ts`: the
 * source's TS uses its own denominator, and a percentile is only meaningful
 * against a population computed the same way for every row.
 */
const STATS = {
  fgp: (p) => [p.fgm, p.fga],
  "2pp": (p) => [p.fgm - p.fg3m, p.fga - p.fg3a],
  "3pp": (p) => [p.fg3m, p.fg3a],
  ftp: (p) => [p.ftm, p.fta],
  efg: (p) => [p.fgm + 0.5 * p.fg3m, p.fga],
  // The 0.475 the rest of the site uses, not the textbook 0.44 — see the note
  // in the player page's summarize().
  ts: (p) => [p.pts / 2, p.fga + 0.475 * p.fta],
};

function bucketOf(pos) {
  const s = String(pos ?? "").toUpperCase();
  if (s.startsWith("C")) return "C";
  if (s.startsWith("F")) return "F";
  return "G";
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Down-sample a sorted array to STEPS breakpoints.
 *
 * The full population is ~250,000 numbers a season per stat; keeping it would
 * make a file nobody can ship. 101 quantiles reproduce any whole percentile
 * exactly, which is the only resolution the chips print.
 */
function ladderOf(values) {
  if (values.length < 200) return null;
  values.sort((a, b) => a - b);
  const out = new Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    const idx = Math.min(values.length - 1, Math.round((i / (STEPS - 1)) * (values.length - 1)));
    out[i] = Math.round(values[idx] * 10000) / 10000;
  }
  return out;
}

async function seasonLadders(year) {
  const dir = path.join(SRC, String(year));
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }

  /** bucket -> stat -> number[] */
  const acc = { G: {}, F: {}, C: {} };
  for (const b of Object.keys(acc)) for (const k of Object.keys(STATS)) acc[b][k] = [];

  let games = 0, lines = 0;
  // Sequential rather than a Promise.all over 6,300 files: the whole point of
  // this script is that the population is large, and opening it all at once is
  // how a build machine runs out of handles.
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let doc;
    try {
      doc = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    games++;
    // The file is { teams: [ { team, logName, players: [...] }, ... ] }. It is
    // read defensively because the archive was written over several years and
    // the older seasons are not guaranteed to share a wrapper.
    const teams = Array.isArray(doc) ? doc : Array.isArray(doc?.teams) ? doc.teams : [doc];
    for (const t of teams) {
      for (const p of t?.players ?? []) {
        lines++;
        const b = acc[bucketOf(p.pos)];
        for (const [key, get] of Object.entries(STATS)) {
          const [made, att] = get({
            fgm: num(p.fgm) ?? 0, fga: num(p.fga) ?? 0,
            fg3m: num(p.fg3m) ?? 0, fg3a: num(p.fg3a) ?? 0,
            ftm: num(p.ftm) ?? 0, fta: num(p.fta) ?? 0,
            pts: num(p.pts) ?? 0,
          });
          if (!(att >= MIN_ATT)) continue;
          b[key].push(made / att);
        }
      }
    }
  }

  const out = {};
  for (const [b, stats] of Object.entries(acc)) {
    out[b] = {};
    for (const [k, vals] of Object.entries(stats)) {
      const l = ladderOf(vals);
      if (l) out[b][k] = l;
    }
  }
  return { ladders: out, games, lines };
}

async function main() {
  const named = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
  const years = named.length
    ? named
    : (await fs.readdir(SRC)).filter((d) => /^\d{4}$/.test(d)).map(Number).sort();

  // Merge into whatever is already there, so a single season can be rebuilt
  // without a ten-minute walk over every other one.
  let doc = { min_att: MIN_ATT, steps: STEPS, seasons: {} };
  try {
    const prev = JSON.parse(await fs.readFile(OUT, "utf8"));
    if (prev?.seasons) doc = { ...doc, seasons: prev.seasons };
  } catch { /* first run */ }

  for (const y of years) {
    const t0 = Date.now();
    const res = await seasonLadders(y);
    if (!res) { console.log(`${y}  — no game-players directory, skipped`); continue; }
    doc.seasons[String(y)] = res.ladders;
    const buckets = Object.entries(res.ladders)
      .map(([b, s]) => `${b}:${Object.keys(s).length}`).join(" ");
    console.log(
      `${y}  ${String(res.games).padStart(5)} games  ${String(res.lines).padStart(6)} box lines  ` +
      `${buckets}  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }

  await fs.writeFile(OUT, JSON.stringify(doc));
  const size = (await fs.stat(OUT)).size;
  console.log(`\n✓ ${OUT}  ${(size / 1024).toFixed(0)} KB  ${Object.keys(doc.seasons).length} season(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
