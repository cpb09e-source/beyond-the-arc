/**
 * A player's career ledger: each season's line, and the career line under them,
 * per game or as totals.
 *
 * ONE MODULE, TWO SURFACES. The site's player page (components/players/career-table.tsx)
 * and the desktop app's Career tab both read it, so a season never prints two ways.
 *
 * FROM BART'S SEASON ROW (raw_row, positions in scripts/sync-bart.mts) and the
 * CBBD aggregates beside it. Games started and turnovers exist nowhere in Bart's
 * season CSV, so those two columns are the only ones that depend on the CBBD
 * join, and the only ones that go blank for 2021, which has no player box in the
 * archive.
 */

export type CareerSeason = {
  year: number;
  team_name: string;
  team_conference: string | null;
  class: string | null;
  raw_row: Array<string | number | null> | null;
  games: number | null;
  notes: string | null;
  projection: number | null;
  advanced_stats?: { gs?: number | null; tov?: number | null; tov_pg?: number | null } | null;
};

export type CareerView = "per_game" | "totals";

/** One row of the ledger, already in the view asked for. Rates are shares (0.426). */
export type CareerLine = {
  gp: number | null;
  gs: number | null;
  min: number | null;
  fgm: number | null;
  fga: number | null;
  fgPct: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fg3Pct: number | null;
  fta: number | null;
  ftPct: number | null;
  orb: number | null;
  reb: number | null;
  ast: number | null;
  tov: number | null;
  stl: number | null;
  blk: number | null;
  pts: number | null;
};

type Kind = "int" | "count" | "pct";

/** The ledger's columns after Season, Team and Class, in the site's order. */
export const CAREER_COLUMNS: Array<{ key: keyof CareerLine; label: (view: CareerView) => string; kind: Kind }> = [
  { key: "gp", label: () => "GP", kind: "int" },
  { key: "gs", label: () => "GS", kind: "int" },
  // Per game everywhere else on the row switches to a total in Totals, and "MPG"
  // would be a lie about a season's minutes, so this one header follows the view.
  { key: "min", label: (v) => (v === "totals" ? "MIN" : "MPG"), kind: "count" },
  { key: "fgm", label: () => "FGM", kind: "count" },
  { key: "fga", label: () => "FGA", kind: "count" },
  { key: "fgPct", label: () => "FG%", kind: "pct" },
  { key: "fg3m", label: () => "3PM", kind: "count" },
  { key: "fg3a", label: () => "3PA", kind: "count" },
  { key: "fg3Pct", label: () => "3P%", kind: "pct" },
  { key: "fta", label: () => "FTA", kind: "count" },
  { key: "ftPct", label: () => "FT%", kind: "pct" },
  { key: "orb", label: () => "ORB", kind: "count" },
  { key: "reb", label: () => "REB", kind: "count" },
  { key: "ast", label: () => "AST", kind: "count" },
  { key: "tov", label: () => "TOV", kind: "count" },
  { key: "stl", label: () => "STL", kind: "count" },
  { key: "blk", label: () => "BLK", kind: "count" },
  { key: "pts", label: () => "PTS", kind: "count" },
];

/**
 * A cell as the ledger prints it. A count is a whole number in Totals and one
 * decimal per game; a rate is a percentage with at most one decimal. Bart stores
 * ft_pct, fg2_pct and fg3_pct as shares (0.851), which is every rate left here.
 */
export function formatCareer(value: number | null, kind: Kind, view: CareerView): string {
  if (value === null || value === undefined) return "—";
  if (kind === "pct") return (value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  if (kind === "int" || view === "totals") return Math.round(value).toLocaleString("en-US");
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fromEnd(row: CareerSeason["raw_row"], offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fromStart(row: CareerSeason["raw_row"], idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * One season's line. Counts come from Bart's season totals (col 13 is FTM, which
 * the ledger never shows; FT% carries it) and his per-game figures (counted from
 * the end of the row); in Totals a per-game figure is multiplied back out by
 * games, and a total is divided by games per game. Rates are the same in both.
 */
export function seasonLine(s: CareerSeason, view: CareerView): CareerLine {
  const row = s.raw_row;
  const g = s.games;
  const totals = view === "totals";
  const ftAtt = fromStart(row, 14);
  const fg2Made = fromStart(row, 16);
  const fg2Att = fromStart(row, 17);
  const fg3Made = fromStart(row, 19);
  const fg3Att = fromStart(row, 20);
  const fgAtt = fg2Att !== null && fg3Att !== null ? fg2Att + fg3Att : null;
  const fgMade = fg2Made !== null && fg3Made !== null ? fg2Made + fg3Made : null;
  const mpg = fromStart(row, 54);

  // A total, shown per game or as itself.
  const total = (t: number | null) => (totals ? t : t !== null && g ? t / g : null);
  // A per-game figure, shown as itself or multiplied back out.
  const perGame = (pg: number | null) => (totals ? (pg !== null && g ? pg * g : null) : pg);

  // Games started and turnovers are the CBBD box aggregate. `tov` is the season
  // total and `tov_pg` the rate; they use different game counts (a game missing a
  // turnover figure is out of the rate but still in the total), so neither is
  // derived from the other.
  const adv = s.advanced_stats;
  return {
    gp: g,
    gs: adv?.gs ?? null,
    min: perGame(mpg),
    fgm: total(fgMade),
    fga: total(fgAtt),
    fgPct: fgAtt !== null && fgMade !== null && fgAtt > 0 ? fgMade / fgAtt : null,
    fg3m: total(fg3Made),
    fg3a: total(fg3Att),
    fg3Pct: fromStart(row, 21),
    fta: total(ftAtt),
    ftPct: fromStart(row, 15),
    orb: perGame(fromEnd(row, 9)),
    reb: perGame(fromEnd(row, 7)),
    ast: perGame(fromEnd(row, 6)),
    tov: totals ? (adv?.tov ?? null) : (adv?.tov_pg ?? null),
    stl: perGame(fromEnd(row, 5)),
    blk: perGame(fromEnd(row, 4)),
    pts: perGame(fromEnd(row, 3)),
  };
}

/**
 * The career line, under the seasons it sums.
 *
 * EVERY RATE IS TOTALS OVER TOTALS, never a mean of the season rates. A player
 * who shot 3-for-4 as a freshman and 300-for-700 as a senior did not shoot 59%
 * for his career, which is what averaging the two percentages claims; he shot
 * 43%. Per-game figures are weighted by games rather than averaged across
 * seasons of different lengths. Totals sums the counts instead, so the line means
 * what the rows above it mean in whichever view the table is in.
 */
export function careerLine(seasons: readonly CareerSeason[], view: CareerView): CareerLine {
  let g = 0, gs = 0, min = 0, pts = 0, reb = 0, orb = 0, ast = 0, stl = 0, blk = 0, tov = 0;
  let ftm = 0, fta = 0, fgm = 0, fga = 0, fg3m = 0, fg3a = 0;
  let sawGs = false, sawTov = false;

  for (const s of seasons) {
    const r = s.raw_row;
    const n = s.games ?? 0;
    g += n;
    min += (fromStart(r, 54) ?? 0) * n;
    pts += (fromEnd(r, 3) ?? 0) * n;
    blk += (fromEnd(r, 4) ?? 0) * n;
    stl += (fromEnd(r, 5) ?? 0) * n;
    ast += (fromEnd(r, 6) ?? 0) * n;
    reb += (fromEnd(r, 7) ?? 0) * n;
    orb += (fromEnd(r, 9) ?? 0) * n;
    ftm += fromStart(r, 13) ?? 0;
    fta += fromStart(r, 14) ?? 0;
    fgm += (fromStart(r, 16) ?? 0) + (fromStart(r, 19) ?? 0);
    fga += (fromStart(r, 17) ?? 0) + (fromStart(r, 20) ?? 0);
    fg3m += fromStart(r, 19) ?? 0;
    fg3a += fromStart(r, 20) ?? 0;
    const adv = s.advanced_stats;
    if (adv?.gs != null) {
      gs += adv.gs;
      sawGs = true;
    }
    if (adv?.tov != null) {
      tov += adv.tov;
      sawTov = true;
    }
  }

  const count = (t: number) => (view === "totals" ? t : g ? t / g : null);
  const rate = (made: number, att: number) => (att ? made / att : null);
  return {
    gp: g || null,
    gs: sawGs ? gs : null,
    min: count(min),
    fgm: count(fgm),
    fga: count(fga),
    fgPct: rate(fgm, fga),
    fg3m: count(fg3m),
    fg3a: count(fg3a),
    fg3Pct: rate(fg3m, fg3a),
    fta: count(fta),
    ftPct: rate(ftm, fta),
    orb: count(orb),
    reb: count(reb),
    ast: count(ast),
    tov: sawTov ? count(tov) : null,
    stl: count(stl),
    blk: count(blk),
    pts: count(pts),
  };
}
