/**
 * The six-figure stat line the player hero carries — one for the season on
 * screen, one for the career behind it.
 *
 * WHY THIS IS ITS OWN MODULE. The arithmetic is not obvious and getting it
 * wrong is invisible: a career shooting percentage is TOTALS OVER TOTALS, never
 * the mean of the season rates. A player who went 3-for-4 as a freshman and
 * 300-for-700 as a senior did not shoot 59% for his career, which is what
 * averaging the two claims; he shot 43%. Per-game figures have the same shape —
 * weighted by games, not averaged across seasons of wildly different length.
 *
 * The season table's Career row in career-table.tsx runs the same rules over
 * the same columns. THE TWO HAVE TO AGREE — a hero that says 9.7 above a table
 * that says 9.9 is worse than either number alone. That row still does its own
 * summing because it carries fourteen columns to this file's six and reads them
 * in totals mode as well as per-game; if you change an offset or a rule here,
 * change it there.
 *
 * Everything comes out of Bart's season CSV, which arrives as a positional
 * array. Some columns are indexed from the front and some from the back — the
 * row has grown at the front over the years and the per-game block has always
 * been the tail, so both directions are load-bearing.
 */

export type StatRow = Array<string | number | null> | null;

export type StatSeason = {
  year: number;
  games: number | null;
  raw_row: StatRow;
};

export type StatLine = {
  games: number | null;
  /** Per game. Null where the row has no minutes column. */
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  /** 0-100. Null when nobody took a shot of that kind. */
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
};

/**
 * Bart's row is positional and has grown at the FRONT over the years, while the
 * per-game block has always been the tail — so both directions are load-bearing
 * and neither can be expressed in terms of the other. Exported because the hero
 * modules read the same row for a different set of columns.
 */
export function fromEnd(row: StatRow, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  return num(row[row.length - 1 - offset]);
}

export function fromStart(row: StatRow, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  return num(row[idx]);
}

function num(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Made and attempted for the three shot types, summed out of one season row. */
function shots(row: StatRow) {
  const fg3m = fromStart(row, 19) ?? 0;
  const fg3a = fromStart(row, 20) ?? 0;
  return {
    ftm: fromStart(row, 13) ?? 0,
    fta: fromStart(row, 14) ?? 0,
    // Bart splits twos and threes; there is no combined field-goal column, so
    // the FG% every box score prints has to be rebuilt from the two halves.
    fgm: (fromStart(row, 16) ?? 0) + fg3m,
    fga: (fromStart(row, 17) ?? 0) + fg3a,
    fg3m,
    fg3a,
  };
}

function rate(made: number, att: number): number | null {
  return att > 0 ? (made / att) * 100 : null;
}

/** One season, as it stands on its own. */
export function seasonLine(season: StatSeason): StatLine {
  const row = season.raw_row;
  const s = shots(row);
  return {
    games: season.games,
    mpg: fromStart(row, 54),
    ppg: fromEnd(row, 3),
    apg: fromEnd(row, 6),
    rpg: fromEnd(row, 7),
    fgPct: rate(s.fgm, s.fga),
    fg3Pct: rate(s.fg3m, s.fg3a),
    ftPct: rate(s.ftm, s.fta),
  };
}

/**
 * Every season a player has, as one line.
 *
 * Counting stats are reconstituted into totals (per-game × games) and divided
 * back out by the career games, so a 37-game senior year outweighs an 8-game
 * freshman one exactly as much as it should. Shooting rates sum the makes and
 * the attempts and divide once at the end.
 *
 * A season with no games contributes nothing rather than dragging the line
 * toward zero — that is a row Bart has but the player did not play.
 */
export function careerLine(seasons: StatSeason[]): StatLine {
  let g = 0, min = 0, pts = 0, reb = 0, ast = 0;
  let ftm = 0, fta = 0, fgm = 0, fga = 0, fg3m = 0, fg3a = 0;
  let sawMin = false;

  for (const s of seasons) {
    const row = s.raw_row;
    const n = s.games ?? 0;
    if (n <= 0) continue;
    g += n;

    const m = fromStart(row, 54);
    if (m !== null) { min += m * n; sawMin = true; }
    pts += (fromEnd(row, 3) ?? 0) * n;
    ast += (fromEnd(row, 6) ?? 0) * n;
    reb += (fromEnd(row, 7) ?? 0) * n;

    const sh = shots(row);
    ftm += sh.ftm; fta += sh.fta;
    fgm += sh.fgm; fga += sh.fga;
    fg3m += sh.fg3m; fg3a += sh.fg3a;
  }

  const per = (total: number) => (g > 0 ? total / g : null);
  return {
    games: g || null,
    mpg: sawMin ? per(min) : null,
    ppg: per(pts),
    apg: per(ast),
    rpg: per(reb),
    fgPct: rate(fgm, fga),
    fg3Pct: rate(fg3m, fg3a),
    ftPct: rate(ftm, fta),
  };
}
