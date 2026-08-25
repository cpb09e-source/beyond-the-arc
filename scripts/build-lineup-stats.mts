/**
 * build-lineup-stats.mts — per-team five-man lineup tables for the Lineups tab,
 * plus the season league distributions the percentile chips are read against.
 *
 * Reads data/cbbd/<season>/{stints.csv.gz, players.csv.gz} and writes:
 *
 *   public/data/lineup-stats/<slug>-<season>.json      one team's units
 *   public/data/lineup-stats/benchmarks-<season>.json  league percentile breakpoints
 *
 * WHY COUNTING STATS AND NOT RATES. The page has to answer three questions the
 * shipped numbers could not: what a lineup did, what a SUBSET of players did
 * together (2-, 3- and 4-man combos), and what the team did with player X on
 * the floor and player Y off it. All three are one operation — take the
 * five-man rows that match, add the counts, recompute the rates from the sums.
 * Averaging rates would be wrong in every case and silently so. Nothing here is
 * stored pre-divided; see src/lib/lineup-stats.ts, which owns the formulas for
 * both this script and the browser so the two cannot drift.
 *
 * WHY BENCHMARKS ARE DISTRIBUTIONS, NOT BAKED PERCENTILES. Most rows the page
 * ranks do not exist in any cohort: a 3-man combo, or the Totals of an on/off
 * filter, is an aggregate nobody precomputed. Shipping the league's percentile
 * breakpoints per stat lets one binary search place every row — real lineups,
 * combos and totals alike — against the same field.
 *
 * EVERY LINEUP SHIPS, including one-possession ones. MIN_POSS is a
 * QUALIFICATION threshold deciding which rows get a chip and which read DNQ,
 * not an export filter. Vermont's qualifying units are 48% of its possessions;
 * a Totals row built from those alone would quietly omit half a season.
 *
 * SEASON COVERAGE IS 2024+. The lineup attribution comes from `onFloor` on each
 * play, and CBBD did not populate it before 2024 — measured at 0.0% for 2022
 * and 2023, 98.5% and up from 2024. Those seasons produce zero valid stints and
 * are skipped rather than half-built.
 *
 * ACCURACY. The stint columns this reads were validated against
 * box-teams-full: FGA, FGM, 3PA, FTA, OREB, DREB, STL, BLK and TOV all land
 * within 0.6% of official season totals, assists within 2.5%. The shortfall is
 * uniform, so rates are unaffected; treat counts as very close, not exact.
 *
 * Reads only committed data, so it is safe to run during the freeze.
 *
 * Usage:
 *   npx tsx scripts/build-lineup-stats.mts --from 2024 --to 2026
 *   npx tsx scripts/build-lineup-stats.mts --season 2026 --team Vermont
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import process from "node:process";
import {
  EMPTY_TOTALS,
  LINEUP_STATS,
  MIN_POSS,
  type LineupTotals,
} from "@/lib/lineup-stats";
import { teamSlug } from "@/lib/team-slug";
// @ts-expect-error — plain JS helper shared with the other CBBD builders.
import { norm, buildPlayerIndex, resolvePlayer } from "./lib/cbbd-join.mjs";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const ONE = opt("season");
const FROM = Number(ONE ?? opt("from") ?? 2024);
const TO = Number(ONE ?? opt("to") ?? 2026);
const ONLY_TEAM = opt("team");

const OUT_DIR = path.resolve("public/data/lineup-stats");

/**
 * Serialisation order for the per-lineup `s` array, taken from the totals type
 * itself so the two can never fall out of step. The page reads `cols` out of
 * the file rather than assuming this order.
 */
const COLS = Object.keys(EMPTY_TOTALS) as (keyof LineupTotals)[];

/** Stat columns per side, mapped to their stint CSV column prefixes. */
const OWN: Array<[keyof LineupTotals, string]> = [
  ["pts", "pts"], ["fga", "fga"], ["fgm", "fgm"], ["fg3a", "fg3a"], ["fg3m", "fg3m"],
  ["rima", "rima"], ["rimm", "rimm"], ["mida", "mida"], ["midm", "midm"],
  ["fta", "fta"], ["ftm", "ftm"], ["oreb", "oreb"], ["dreb", "dreb"],
  ["ast", "ast"], ["stl", "stl"], ["blk", "blk"], ["pf", "pf"], ["tov", "tov"],
];
const OPP: Array<[keyof LineupTotals, string]> = [
  ["oppPts", "pts"], ["oppFga", "fga"], ["oppFgm", "fgm"], ["oppFg3a", "fg3a"], ["oppFg3m", "fg3m"],
  ["oppFta", "fta"], ["oppFtm", "ftm"], ["oppOreb", "oreb"], ["oppDreb", "dreb"],
  ["oppAst", "ast"], ["oppStl", "stl"], ["oppBlk", "blk"], ["oppPf", "pf"], ["oppTov", "tov"],
];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let wroteFiles = 0, wroteLineups = 0, linkedPlayers = 0, totalPlayers = 0;

  for (let season = FROM; season <= TO; season++) {
    const dir = path.resolve("data/cbbd", String(season));
    const stintsPath = path.join(dir, "stints.csv.gz");
    const playersPath = path.join(dir, "players.csv.gz");
    if (!fs.existsSync(stintsPath) || !fs.existsSync(playersPath)) {
      console.warn(`  skip ${season}: no stints/players on disk`);
      continue;
    }

    /**
     * CBBD player id -> bart player id, so a name in the grid can link to its
     * player page (those routes are keyed on bart ids, not CBBD's).
     *
     * Uses the shared resolver rather than matching names by hand. `norm` here
     * is the TEAM normaliser from cbbd-join and rewrites "St." to "state"; a
     * hand-rolled one left 18.8% of teams unresolved when the assist builder
     * tried it.
     */
    const bartIdx = (() => {
      const fp = path.resolve("public/data/players-by-year", `${season}.json`);
      if (!fs.existsSync(fp)) return buildPlayerIndex([]);
      return buildPlayerIndex(JSON.parse(fs.readFileSync(fp, "utf8")));
    })();

    const players = new Map<string, { name: string; team: string }>();
    for (const line of zlib.gunzipSync(fs.readFileSync(playersPath)).toString().split("\n").slice(1)) {
      const m = line.match(/^(\d+),"(.*)","(.*)"$/);
      if (m) players.set(m[1]!, { name: m[2]!, team: m[3]! });
    }
    if (players.size === 0) {
      // 2022 and 2023: the play feed carries no onFloor, so no stint can be
      // attributed to a five-man unit and players.csv comes out empty.
      console.warn(`  skip ${season}: no players — this season's plays carry no onFloor`);
      continue;
    }

    const text = zlib.gunzipSync(fs.readFileSync(stintsPath)).toString();
    const lines = text.split("\n");
    const idx = Object.fromEntries(lines[0]!.split(",").map((c, i) => [c, i])) as Record<string, number>;
    if (idx.fgaHome === undefined) {
      console.warn(`  skip ${season}: stints.csv.gz predates the box-line columns — re-run cbbd-build-stints.mjs`);
      continue;
    }

    const byTeam = new Map<string, Map<string, LineupTotals & { __ids: string[] }>>();
    const gamesSeen = new Map<string, Map<string, Set<string>>>();

    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];
      if (!line) continue;
      const f = line.split(",");
      // Invalid stints are the ones where onFloor was not ten players. They
      // cannot be attributed to a unit at all, so they are dropped rather than
      // guessed at.
      if (f[idx.valid!] !== "1") continue;
      const gameId = f[idx.gameId!]!;
      const secs = Number(f[idx.secs!]) || 0;

      for (const [side, S, oS] of [["home", "Home", "Away"], ["away", "Away", "Home"]] as const) {
        const ids = f[idx[side + "5"]!]!.split(";");
        if (ids.length !== 5) continue;
        const teams = new Set(ids.map((i) => players.get(i)?.team).filter(Boolean));
        if (teams.size !== 1) continue;
        const team = [...teams][0]!;
        if (ONLY_TEAM && team !== ONLY_TEAM) continue;

        const sorted = ids.slice().sort((a, b) => Number(a) - Number(b));
        const key = sorted.join("|");
        let teamMap = byTeam.get(team);
        if (!teamMap) { teamMap = new Map(); byTeam.set(team, teamMap); }
        let acc = teamMap.get(key);
        if (!acc) { acc = { ...EMPTY_TOTALS, __ids: sorted }; teamMap.set(key, acc); }

        let gs = gamesSeen.get(team);
        if (!gs) { gs = new Map(); gamesSeen.set(team, gs); }
        let gset = gs.get(key);
        if (!gset) { gset = new Set(); gs.set(key, gset); }
        gset.add(gameId);

        const n = (c: string) => Number(f[idx[c]!]) || 0;
        acc.secs += secs;
        acc.poss += n("poss" + S);
        acc.oppPoss += n("poss" + oS);
        for (const [field, col] of OWN) acc[field] += n(col + S);
        for (const [field, col] of OPP) acc[field] += n(col + oS);
      }
    }

    // ---- league benchmarks, from the qualifying units of every team.
    const qualifying: LineupTotals[] = [];
    for (const teamMap of byTeam.values()) {
      for (const acc of teamMap.values()) if (acc.poss >= MIN_POSS) qualifying.push(acc);
    }
    const q: Record<string, number[]> = {};
    for (const stat of LINEUP_STATS) {
      if (!stat.ranked) continue;
      const vals = qualifying
        .map((t) => stat.value(t))
        .filter((v): v is number => v !== null && Number.isFinite(v))
        .sort((a, b) => a - b);
      if (vals.length < 20) continue;
      // 51 breakpoints, every 2nd percentile, rounded to 4 decimals.
      //
      // These get embedded in EVERY lineups page, so one season's array is
      // duplicated across ~365 team pages: resolution here is paid for 365
      // times over. The chip renders an integer 0-100 and the reader compares
      // colours, so interpolating between 2-percentile steps is worth about
      // two thirds of the bytes and costs at most a point of precision on a
      // number nobody reads to the unit.
      q[stat.key] = Array.from({ length: 51 }, (_, i) => {
        const pos = (i / 50) * (vals.length - 1);
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        const v = lo === hi ? vals[lo]! : vals[lo]! + (vals[hi]! - vals[lo]!) * (pos - lo);
        return Number(v.toFixed(4));
      });
    }
    // NOT written on a --team run. ONLY_TEAM filters the accumulation, so
    // `qualifying` would hold one team's units and the season's league field
    // would be silently replaced by thirteen rows — every chip on every other
    // team's page then reads against the wrong distribution. A single-team run
    // is for iterating on one team's file; the benchmarks are a season-level
    // artifact and only a full run may write them.
    if (ONLY_TEAM) {
      console.log(`  ${season}: --team set, leaving benchmarks-${season}.json alone`);
    } else {
      fs.writeFileSync(
        path.join(OUT_DIR, `benchmarks-${season}.json`),
        JSON.stringify({ season, n: qualifying.length, q }),
      );
    }

    for (const [team, teamMap] of byTeam) {
      const roster = new Map<string, string>();
      for (const acc of teamMap.values()) {
        for (const id of acc.__ids) {
          const p = players.get(id);
          if (p && !roster.has(id)) roster.set(id, p.name);
        }
      }

      const lineups = [];
      for (const [key, acc] of teamMap) {
        acc.gp = gamesSeen.get(team)?.get(key)?.size ?? 0;
        lineups.push({
          p: acc.__ids.map(Number),
          s: COLS.map((c) => (c === "poss" || c === "oppPoss" || c === "secs"
            ? Number(acc[c].toFixed(2))
            : acc[c])),
        });
      }
      // Most possessions first: the units that decided the season lead.
      const possAt = COLS.indexOf("poss");
      lineups.sort((a, b) => b.s[possAt]! - a.s[possAt]!);

      const tk = norm(team);
      let linked = 0;
      const rosterOut = [...roster.entries()]
        .map(([id, name]) => {
          // null when the name does not resolve — the grid renders those as
          // plain text rather than a link to a page that does not exist.
          const bart = resolvePlayer(bartIdx, tk, name) as number | null;
          if (bart != null) linked++;
          return { id: Number(id), name, b: bart };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      linkedPlayers += linked;
      totalPlayers += rosterOut.length;

      fs.writeFileSync(
        path.join(OUT_DIR, `${teamSlug(team)}-${season}.json`),
        JSON.stringify({ season, team, cols: COLS, players: rosterOut, lineups }),
      );
      wroteFiles++;
      wroteLineups += lineups.length;
    }
    console.log(`  ${season}: ${byTeam.size} teams, ${qualifying.length.toLocaleString()} qualifying units`);
  }

  const pct = totalPlayers ? ((linkedPlayers / totalPlayers) * 100).toFixed(1) : "0";
  console.log(`wrote ${wroteFiles} team files, ${wroteLineups.toLocaleString()} lineups`);
  console.log(`  ${linkedPlayers.toLocaleString()} of ${totalPlayers.toLocaleString()} players resolved to a bart id (${pct}%)`);
}

main();
