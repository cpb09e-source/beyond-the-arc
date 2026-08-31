/**
 * Builds the Game Log Explorer's corpus: every player-game of a season in one
 * file, small enough to hand a browser.
 *
 *   node scripts/build-game-index.mjs                # every season
 *   node scripts/build-game-index.mjs --season 2026  # one
 *
 * Reads public/data/player-games/<bartId>.json — 24,653 files, 1.37M rows
 * across twelve seasons — and writes public/data/game-index/<year>.json.
 *
 * WHY A NEW FILE AND NOT THE PER-PLAYER ONES. The per-player files answer "how
 * did this player do, game by game", which is a page you arrive at already
 * knowing the player. This explorer asks the opposite question — "who had the
 * best games" — and no amount of fetching 24,653 files answers it. The corpus
 * has to be pivoted once, at build time, into season-shaped files.
 *
 * SHAPE. Columnar-ish: a per-season player table holding every string, and rows
 * that are all integers. Nothing derivable is stored — shooting percentages,
 * true shooting, game score and defensive rebounds are all computed in the
 * browser from the counting stats, because a stored percentage costs six bytes
 * a row and a division costs nothing.
 *
 *   ~115k rows/season -> ~9 MB raw, ~2.4 MB gzipped over the wire.
 *
 * The same trick as players-explorer, one order of magnitude further down: that
 * file's 5k rows can afford to repeat the name string, 115k rows cannot.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(".");
const GAMES_DIR = path.join(ROOT, "public/data/player-games");
const EXPLORER_DIR = path.join(ROOT, "public/data/players-explorer");
const OUT_DIR = path.join(ROOT, "public/data/game-index");

const args = process.argv.slice(2);
const seasonArg = (() => {
  const i = args.indexOf("--season");
  return i >= 0 ? Number(args[i + 1]) : null;
})();

/** Field order of a packed row. Mirrored by src/lib/game-index.ts. */
const FIELDS = [
  "p",     // index into the player table
  "d",     // days since the season's epoch date
  "f",     // flags: 1 home, 2 neutral, 4 won, 8 started
  "o",     // index into the opponent table
  "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta",
  "orb", "reb", "ast", "stl", "blk", "tov", "pf",
  "usg",   // usage, per mille (0.247 -> 247)
  "ortg",  // offensive rating x10
  "drtg",  // defensive rating x10
];

const CLASSES = ["", "Fr", "So", "Jr", "Sr", "Gr"];

const seasons = seasonArg
  ? [seasonArg]
  : fs.readdirSync(EXPLORER_DIR)
      .filter((f) => /^\d{4}\.json$/.test(f))
      .map((f) => Number(f.slice(0, 4)))
      .sort();

// ── Player metadata, per season ────────────────────────────────────────────
// player-games rows say who the OPPONENT was but not who the player played
// for — the per-player file already knows, so it never repeats it. Here it is
// the first thing a reader needs, so it comes from the explorer bundle, which
// is the same source the players table is built from and therefore agrees with
// it by construction.
function metaFor(season) {
  const p = path.join(EXPLORER_DIR, `${season}.json`);
  if (!fs.existsSync(p)) return null;
  const { fields, rows } = JSON.parse(fs.readFileSync(p, "utf8"));
  const at = Object.fromEntries(fields.map((f, i) => [f, i]));
  const byBart = new Map();
  for (const r of rows) {
    const bart = r[at.bart_player_id];
    if (typeof bart !== "number") continue;
    byBart.set(bart, {
      name: r[at.name] ?? "—",
      team: r[at.team_name] ?? "—",
      conf: r[at.team_conference] ?? "",
      cls: r[at.class] ?? "",
      page: r[at.has_page] ? 1 : 0,
      rank: typeof r[at.rank_overall] === "number" ? r[at.rank_overall] : 0,
    });
  }
  return byBart;
}

const meta = new Map();
for (const s of seasons) {
  const m = metaFor(s);
  if (m) meta.set(s, m);
  else console.warn(`  ! no players-explorer/${s}.json — season skipped`);
}
const wanted = new Set(meta.keys());
if (!wanted.size) {
  console.error("nothing to build");
  process.exit(1);
}

// ── One pass over the per-player files ─────────────────────────────────────
// Rows are accumulated per season as plain arrays of numbers. 1.37M of those
// is a lot of small objects, so the pass keeps only the seasons asked for.
const acc = new Map();
for (const s of wanted) {
  acc.set(s, {
    rows: [],
    players: new Map(), // bartId -> index
    pNames: [], pTeams: [], pConfs: [], pClass: [], pPage: [], pIds: [], pRank: [],
    opps: new Map(),
    oppList: [],
    minDate: null,
  });
}

const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith(".json"));
console.log(`scanning ${files.length.toLocaleString()} player files for ${[...wanted].join(", ")}…`);

const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);

let scanned = 0;
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), "utf8"));
  const bart = j.bart_player_id;
  for (const g of j.games ?? []) {
    const a = acc.get(g.year);
    if (!a) continue;
    const m = meta.get(g.year).get(bart);
    // No explorer row means the player is not in the season's cohort at all
    // (non-D1 opponent rosters ride along in some files). Nothing to name them
    // with, so nothing worth listing.
    if (!m) continue;

    let pi = a.players.get(bart);
    if (pi === undefined) {
      pi = a.pIds.length;
      a.players.set(bart, pi);
      a.pIds.push(bart);
      a.pNames.push(m.name);
      a.pTeams.push(m.team);
      a.pConfs.push(m.conf);
      a.pClass.push(Math.max(0, CLASSES.indexOf(m.cls)));
      a.pPage.push(m.page);
      a.pRank.push(m.rank);
    }

    const opp = g.opp_team_market ?? "—";
    let oi = a.opps.get(opp);
    if (oi === undefined) {
      oi = a.oppList.length;
      a.opps.set(opp, oi);
      a.oppList.push(opp);
    }

    const day = dayNum(g.game_date);
    if (a.minDate === null || day < a.minDate) a.minDate = day;

    const flags =
      (g.is_home ? 1 : 0) | (g.is_neutral ? 2 : 0) | (g.won ? 4 : 0) | (g.is_starter ? 8 : 0);

    a.rows.push([
      pi, day, flags, oi,
      g.mins ?? 0, g.pts_scored ?? 0, g.fgm ?? 0, g.fga ?? 0, g.fgm3 ?? 0, g.fga3 ?? 0,
      g.ftm ?? 0, g.fta ?? 0, g.orb ?? 0, g.reb ?? 0, g.ast ?? 0, g.stl ?? 0, g.blk ?? 0,
      g.tov ?? 0, g.pf ?? 0,
      Math.round((g.usage_pct ?? 0) * 1000),
      Math.round((g.ortg ?? 0) * 10),
      Math.round((g.drtg ?? 0) * 10),
    ]);
  }
  if (++scanned % 5000 === 0) console.log(`  …${scanned.toLocaleString()}/${files.length.toLocaleString()}`);
}

// ── Write ──────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
let totalRaw = 0;
let totalGz = 0;

for (const s of [...wanted].sort()) {
  const a = acc.get(s);
  if (!a.rows.length) {
    console.warn(`  ! ${s}: no rows`);
    continue;
  }
  // Dates are stored as an offset from the season's first game, which is three
  // digits rather than the five a raw day number needs.
  const epoch = a.minDate;
  for (const r of a.rows) r[1] -= epoch;
  // Sorted by date so the default table reads chronologically and a client-side
  // sort on anything else is a stable re-sort of a sensible order.
  a.rows.sort((x, y) => x[1] - y[1]);

  const out = {
    season: s,
    epoch: new Date(epoch * 86400000).toISOString().slice(0, 10),
    fields: FIELDS,
    classes: CLASSES,
    players: {
      ids: a.pIds,
      names: a.pNames,
      teams: a.pTeams,
      confs: a.pConfs,
      cls: a.pClass,
      page: a.pPage,
      rank: a.pRank,
    },
    opps: a.oppList,
    rows: a.rows,
  };

  const text = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT_DIR, `${s}.json`), text);
  const gz = zlib.gzipSync(text).length;
  totalRaw += text.length;
  totalGz += gz;
  console.log(
    `  ${s}: ${a.rows.length.toLocaleString()} rows, ${a.pIds.length.toLocaleString()} players, ` +
    `${(text.length / 1e6).toFixed(1)} MB (${(gz / 1e6).toFixed(1)} MB gz)`,
  );
}

console.log(`\n✓ ${(totalRaw / 1e6).toFixed(0)} MB total, ${(totalGz / 1e6).toFixed(0)} MB gzipped`);
