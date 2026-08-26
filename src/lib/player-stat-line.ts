import { fromStart, fromEnd, type StatRow } from "@/lib/bart-row";

/**
 * The seven-figure stat line the player hero carries below xl — games, PPG,
 * RPG, APG, FG%, 3P%, FT% for the season on screen.
 *
 * WHY IT EXISTS AT ALL. The career table below the hero is the canonical
 * record, and on a wide screen it shows every column at once, so a summary
 * above it would be pure repetition. It cannot do that at every width: it needs
 * about 1293px of wrapper to lay out and swipes sideways below that, so a phone
 * reader sees three or four columns of a twenty-column row and has to scroll to
 * learn what a player averaged. The band is that answer without the scroll,
 * which is why it renders only where the table has stopped fitting.
 *
 * WHY THE ARITHMETIC IS ITS OWN MODULE. There is no combined field-goal column
 * in Bart's row — only 2P and 3P — so the FG% every box score prints has to be
 * rebuilt from the two halves, and rebuilding it from the wrong pair of columns
 * fails silently. The career table's own rows run the same reconstruction over
 * the same columns and the two sit a swipe apart on a phone, so THEY HAVE TO
 * AGREE: a band that says 46.3 above a table that says 46.7 is worse than
 * either number alone.
 *
 * A career aggregate lived here too, until the band stopped showing one. The
 * rule it encoded is worth keeping in mind if it comes back: a career shooting
 * percentage is TOTALS OVER TOTALS, never the mean of the season rates. A
 * player who went 3-for-4 as a freshman and 300-for-700 as a senior did not
 * shoot 59% for his career; he shot 43%.
 */

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
