#!/usr/bin/env node
/**
 * build-players-explorer.mjs — the slim per-season file /players actually needs.
 *
 * THE PROBLEM. The explorer fetches /data/players-by-year/<year>.json, which is
 * the Supabase row shipped whole: 3.99 MB raw, 1.14 MB gzipped for 2025. Half
 * those bytes are `raw_row`, Bart's 67-column CSV line stored verbatim, and the
 * page reads 22 of those 67. Another ~28% is the same nine JSON keys repeated
 * 5,060 times, and ten fields (name, team, class, height, hometown, year,
 * bart id, games, notes) are carried twice — once as a column and again inside
 * raw_row.
 *
 * WHAT THIS SHIPS INSTEAD. The finished PlayerSummary, already transformed, as
 * a `fields` header plus an array of arrays. No keys, no unread columns, no
 * duplication, and no per-row transform left for the browser to run on 5,060
 * players before it can paint.
 *
 * The transform is a port of transformPlayer in players-client.tsx. It has to
 * stay a faithful one — scripts/verify-players-explorer.mjs re-runs the client
 * version against the source file and asserts every field of every player
 * matches, and is the reason to trust this.
 *
 * players-by-year is NOT retired: readPlayersForYear() builds the team pages
 * from it, and 19 pipeline scripts read it offline. It stays in public/ as the
 * build-time source and is stripped from out/ instead, so it no longer rides
 * along in the deploy either.
 *
 *   node scripts/build-players-explorer.mjs [--year 2025]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SRC = path.resolve("public/data/players-by-year");
const OUT = path.resolve("public/data/players-explorer");

// Bart's 67-column CSV offsets. Mirrors PLAYER_COLS in src/lib/players.ts —
// these are the only ones the explorer reads.
const FROM_START = {
  ft_att: 14, ft_pct: 15,
  fg2_made: 16, fg2_att: 17, fg2_pct: 18,
  fg3_made: 19, fg3_att: 20, fg3_pct: 21,
  blk_rate: 22, stl_rate: 23,
  porpag: 28, missed_ft_pg: 44, missed_fg_pg: 52, min_pg: 54,
};
const FROM_END = {
  notes: 2, pts_pg: 3, blk_pg: 4, stl_pg: 5, ast_pg: 6, reb_pg: 7, orb_pg: 9,
};

/**
 * Field order of every emitted row. The client rebuilds PlayerSummary from
 * this, so the two must agree — it is written into the file rather than
 * hardcoded on both sides so a mismatch is impossible to introduce silently.
 */
export const FIELDS = [
  "id", "bart_player_id", "has_page", "name", "team_name", "team_conference",
  "team_id", "year", "class", "height", "hometown", "position_note", "games",
  "min_pg", "pts_pg", "reb_pg", "ast_pg", "stl_pg", "blk_pg", "fg_pct",
  "fg3_pct", "fg2_pct", "ft_pct", "ts_pct", "efg_pct", "fta_rate", "orb_pg",
  "tov_pg", "tov_pct", "usage_pct", "net_rtg", "ast_to_tov", "drb_pg",
  "hkm_pct", "pir", "porpag", "bta_porpag", "fg3_made", "fg3_att", "ppp",
];

/**
 * BTA's own points-over-replacement, by bart id, from
 * scripts/build-bta-porpag.mjs. Merged in here rather than fetched separately
 * so the explorer still makes one request per season. Absent for 2021, which
 * has no CBBD box scores.
 */
function btaPorpagFor(year) {
  const file = path.resolve("public/data", `porpag-${year}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).players;
}

/**
 * bart_player_ids that get a profile page. A port of readRankedPlayerIds() in
 * src/lib/static-data.ts, which is what generateStaticParams enumerates.
 *
 * Ported rather than imported because that file is TypeScript and pulling tsx
 * onto the production build's critical path is a worse trade than duplicating
 * twenty lines. The duplication is guarded: scripts/verify-player-links.mjs
 * runs after `next build` and fails the build if this set and the directories
 * actually written to out/players/ disagree, so drift cannot ship quietly.
 *
 * Three rules, in the same order:
 *   1. every public/data/player-ranks/<id>.json  (cleared 18g/20mpg/5.3ppg)
 *   2. freshman pass — any player whose MOST RECENT season was a freshman year
 *   3. MANUAL_PROFILE_IDS
 */
const FRESHMAN_SCAN_START_YEAR = 2013;
const LATEST_PLAYER_YEAR = 2026;
const MANUAL_PROFILE_IDS = [73737]; // Tommy Murr (Lipscomb) — requested by hand

function rankedPlayerIds() {
  const ids = new Set();

  const ranksDir = path.resolve("public/data/player-ranks");
  if (fs.existsSync(ranksDir)) {
    for (const f of fs.readdirSync(ranksDir)) {
      if (!f.endsWith(".json")) continue;
      const n = parseInt(f.replace(".json", ""), 10);
      if (Number.isFinite(n)) ids.add(n);
    }
  }

  const latestByBartId = new Map();
  for (let year = FRESHMAN_SCAN_START_YEAR; year <= LATEST_PLAYER_YEAR; year++) {
    const file = path.join(SRC, `${year}.json`);
    if (!fs.existsSync(file)) continue;
    for (const p of JSON.parse(fs.readFileSync(file, "utf8"))) {
      const bartId = p.bart_player_id;
      if (bartId == null || !Number.isFinite(bartId)) continue;
      const prev = latestByBartId.get(bartId);
      if (!prev || prev.year < year) latestByBartId.set(bartId, { year, cls: p.class ?? null });
    }
  }
  for (const [bartId, latest] of latestByBartId) {
    if (latest.cls === "Fr") ids.add(bartId);
  }

  for (const id of MANUAL_PROFILE_IDS) ids.add(id);
  return ids;
}

const asNum = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const fromEnd = (row, offset) => (!row || row.length <= offset ? null : row[row.length - 1 - offset]);
const fromStart = (row, idx) => (!row || row.length <= idx ? null : row[idx]);

/**
 * Values are written at full float precision, deliberately.
 *
 * Trimming to nine significant digits looked free — every column formats to at
 * most three decimals — and saved 62 KB gzipped. It moved 660 of 5,060 HKM
 * percentiles. HKM is BLK% + STL%, which packs players tightly, and rounding
 * collapses near-neighbours into exact ties whose order then falls out of the
 * sort rather than the data. Percentile chips are the visible casualty, and a
 * chip that changes by two for no reason a reader can see is worse than the
 * bytes are worth.
 */

/**
 * CBBD season aggregate, used ONLY to fill holes in advanced_stats.
 *
 * The upstream advanced row is matched on name, and the match misses when the
 * two sources spell a player differently — CBBD has "MJ Collins Jr.", Bart has
 * "MJ Collins". When it misses, usage, TOV%, PPP and Net Rtg all vanish
 * together, because all four come off that one row: 59 of 2,090 players at 20+
 * mpg in 2026, every one of them missing the identical four fields.
 *
 * The CBBD join in build-cbbd-player-season.mjs normalises suffixes, so it
 * already has these players. It recovers 49 of the 59.
 *
 * SAFE TO SUBSTITUTE because the two agree where both exist: r = 0.980 on
 * usage over 2,030 qualified 2026 players, mean absolute difference 0.31 usage
 * points, identical means to one decimal. Only ever used as a FALLBACK — where
 * the real row is present it wins, so no player's number changes.
 *
 * 2022 onward, which is where CBBD's per-game archive starts.
 */
const cbbdCache = new Map();
function cbbdSeason(year) {
  if (!cbbdCache.has(year)) {
    const f = path.resolve("data/derived", `cbbd-season-${year}.json`);
    cbbdCache.set(year, fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")).players ?? {}) : {});
  }
  return cbbdCache.get(year);
}

/** Port of transformPlayer() in players-client.tsx. Keep in step with it. */
export function transformPlayer(raw) {
  const team = Array.isArray(raw.teams) ? raw.teams[0] : raw.teams;
  const stats = Array.isArray(raw.player_bart_stats) ? raw.player_bart_stats[0] : raw.player_bart_stats;
  const row = stats?.raw_row ?? null;
  const adv = raw.advanced_stats ?? null;
  const cb = raw.bart_player_id != null ? (cbbdSeason(raw.year)?.[String(raw.bart_player_id)] ?? null) : null;

  const games = stats?.games ?? null;
  const pts_pg = asNum(fromEnd(row, FROM_END.pts_pg));
  const reb_pg = asNum(fromEnd(row, FROM_END.reb_pg));
  const ast_pg = asNum(fromEnd(row, FROM_END.ast_pg));
  const stl_pg = asNum(fromEnd(row, FROM_END.stl_pg));
  const blk_pg = asNum(fromEnd(row, FROM_END.blk_pg));

  const fg2_made = asNum(fromStart(row, FROM_START.fg2_made));
  const fg2_att = asNum(fromStart(row, FROM_START.fg2_att));
  const fg3_made = asNum(fromStart(row, FROM_START.fg3_made));
  const fg3_att = asNum(fromStart(row, FROM_START.fg3_att));
  const ft_att = asNum(fromStart(row, FROM_START.ft_att));

  const fgm = fg2_made !== null && fg3_made !== null ? fg2_made + fg3_made : null;
  const fga = fg2_att !== null && fg3_att !== null ? fg2_att + fg3_att : null;
  const fg_pct = fgm !== null && fga !== null && fga > 0 ? fgm / fga : null;

  let ts_pct = null;
  if (pts_pg !== null && games !== null && fga !== null && ft_att !== null) {
    const denom = 2 * (fga + 0.44 * ft_att);
    ts_pct = denom > 0 ? (pts_pg * games) / denom : null;
  }

  const efg_pct = fgm !== null && fg3_made !== null && fga !== null && fga > 0
    ? (fgm + 0.5 * fg3_made) / fga : null;

  // Points Per Possession — points scored per possession the player USED.
  //
  //     PPP = PTS / (FGA + 0.44 * FTA + TOV)
  //
  // Same numerator as TS%, and the difference is the point of it: TS% divides by
  // shooting possessions only, so a turnover is invisible to it. PPP puts
  // turnovers in the denominator, which is where they belong — a possession
  // ended with a giveaway was still a possession spent. A high-TS% guard who
  // coughs it up eight times a night reads differently here than he does there.
  //
  // Note this is possessions USED, not the team-possession formula (no
  // offensive-rebound term): it answers what he did with the ball, not how many
  // trips the team took. Null when the turnover feed has no row for the player
  // (~5% of historical seasons) rather than pretending TOV was zero, which would
  // silently flatter exactly the players it should catch.
  const tov_total = adv?.tov_pg !== null && adv?.tov_pg !== undefined && games !== null
    ? adv.tov_pg * games
    : typeof cb?.tov === "number" ? cb.tov : null;
  const ppp = pts_pg !== null && games !== null && fga !== null && ft_att !== null
    && tov_total !== null && (fga + 0.44 * ft_att + tov_total) > 0
    ? (pts_pg * games) / (fga + 0.44 * ft_att + tov_total) : null;
  const fta_rate = ft_att !== null && fga !== null && fga > 0 ? ft_att / fga : null;

  const orb_pg = asNum(fromEnd(row, FROM_END.orb_pg));

  const missed_fg_pg = asNum(fromStart(row, FROM_START.missed_fg_pg));
  const missed_ft_pg = asNum(fromStart(row, FROM_START.missed_ft_pg));
  let pir = null;
  if (pts_pg !== null && reb_pg !== null && ast_pg !== null && stl_pg !== null && blk_pg !== null) {
    pir = (pts_pg + reb_pg + ast_pg + stl_pg + blk_pg) - ((missed_fg_pg ?? 0) + (missed_ft_pg ?? 0));
  }

  const blkRate = asNum(fromStart(row, FROM_START.blk_rate));
  const stlRate = asNum(fromStart(row, FROM_START.stl_rate));

  return {
    id: raw.id,
    bart_player_id: raw.bart_player_id,
    name: raw.name,
    team_name: team?.name ?? "—",
    team_conference: team?.conference ?? null,
    team_id: team?.id ?? 0,
    year: raw.year,
    class: raw.class,
    height: raw.height,
    hometown: raw.hometown,
    position_note: fromEnd(row, FROM_END.notes) ?? null,
    games,
    min_pg: asNum(fromStart(row, FROM_START.min_pg)),
    pts_pg, reb_pg, ast_pg, stl_pg, blk_pg,
    fg_pct,
    fg3_pct: asNum(fromStart(row, FROM_START.fg3_pct)),
    fg2_pct: asNum(fromStart(row, FROM_START.fg2_pct)),
    ft_pct: asNum(fromStart(row, FROM_START.ft_pct)),
    ts_pct,
    ppp,
    efg_pct,
    fta_rate,
    orb_pg,
    // Each falls back to the CBBD aggregate when the advanced row is missing.
    // usage arrives as a percentage there and a fraction here; TOV% and PPP are
    // recomputed from the turnover total rather than taken over, so they use the
    // same formula for every player however the turnovers were sourced.
    tov_pg: adv?.tov_pg ?? (tov_total !== null && games ? tov_total / games : null),
    tov_pct: adv?.tov_pct
      ?? (tov_total !== null && fga !== null && ft_att !== null && (fga + 0.44 * ft_att + tov_total) > 0
        ? tov_total / (fga + 0.44 * ft_att + tov_total) : null),
    usage_pct: adv?.usage_pct ?? (typeof cb?.usg === "number" ? cb.usg / 100 : null),
    net_rtg: adv?.net_rtg
      ?? (typeof cb?.ortg === "number" && typeof cb?.drtg === "number" ? cb.ortg - cb.drtg : null),
    ast_to_tov: ast_pg !== null && adv?.tov_pg != null && adv.tov_pg > 0
      ? ast_pg / adv.tov_pg
      : (typeof cb?.ato === "number" ? cb.ato : null),
    drb_pg: reb_pg !== null && orb_pg !== null ? reb_pg - orb_pg : null,
    hkm_pct: blkRate !== null && stlRate !== null ? blkRate + stlRate : null,
    pir,
    porpag: asNum(fromStart(row, FROM_START.porpag)),
    fg3_made,
    fg3_att,
  };
}

function main() {
  const only = process.argv.includes("--year")
    ? process.argv[process.argv.indexOf("--year") + 1]
    : null;

  if (!fs.existsSync(SRC)) {
    console.error(`  ${path.relative(process.cwd(), SRC)} not found. Run the data export first.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const files = fs.readdirSync(SRC)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => (only ? f === `${only}.json` : true))
    .sort();

  const ranked = rankedPlayerIds();
  console.log(`  ${ranked.size.toLocaleString()} players have a profile page; the rest render as plain text.\n`);

  let rawBefore = 0, rawAfter = 0, gzBefore = 0, gzAfter = 0, linked = 0, unlinked = 0;
  for (const file of files) {
    const srcPath = path.join(SRC, file);
    const srcBuf = fs.readFileSync(srcPath);
    const players = JSON.parse(srcBuf.toString("utf8"));

    const btaPor = btaPorpagFor(Number(file.replace(".json", "")));
    const rows = players.map((p) => {
      const s = transformPlayer(p);
      s.has_page = s.bart_player_id != null && ranked.has(s.bart_player_id);
      if (s.has_page) linked++; else unlinked++;
      s.bta_porpag = btaPor && s.bart_player_id != null
        ? btaPor[String(s.bart_player_id)]?.porpag ?? null
        : null;
      return FIELDS.map((f) => s[f] ?? null);
    });

    const outBuf = Buffer.from(JSON.stringify({ fields: FIELDS, rows }));
    fs.writeFileSync(path.join(OUT, file), outBuf);

    const gzB = zlib.gzipSync(srcBuf, { level: 9 }).length;
    const gzA = zlib.gzipSync(outBuf, { level: 9 }).length;
    rawBefore += srcBuf.length; rawAfter += outBuf.length;
    gzBefore += gzB; gzAfter += gzA;

    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(
      `  ${file.padEnd(11)} ${String(rows.length).padStart(5)} players  ` +
      `${kb(srcBuf.length).padStart(10)} -> ${kb(outBuf.length).padStart(9)}  |  ` +
      `gz ${kb(gzB).padStart(9)} -> ${kb(gzA).padStart(8)}  (${((1 - gzA / gzB) * 100).toFixed(0)}% smaller)`,
    );
  }

  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(
    `\n  ${files.length} seasons.  raw ${mb(rawBefore)} -> ${mb(rawAfter)}   ` +
    `gz ${mb(gzBefore)} -> ${mb(gzAfter)}  (${((1 - gzAfter / gzBefore) * 100).toFixed(1)}% smaller over the wire)`,
  );
  const total = linked + unlinked;
  console.log(
    `  ${linked.toLocaleString()} rows link to a profile, ` +
    `${unlinked.toLocaleString()} render as plain text ` +
    `(${((unlinked / total) * 100).toFixed(1)}% — these were 404 links).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-players-explorer.mjs")) {
  main();
}
