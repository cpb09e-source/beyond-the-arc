/**
 * Quadrant classification for game logs — our own equivalent of the NCAA's
 * NET quadrants.
 *
 * WHY OURS AND NOT NET: the NCAA's NET only exists from the 2018-19 season
 * onward (it replaced RPI), so five of our thirteen seasons can never have a
 * NET number. CBBD doesn't serve NET either — its ranking endpoints are AP and
 * Coaches polls only. Rather than ship a filter that silently covers 8 of 13
 * seasons, we rank teams by our own adjusted net rating (built by
 * scripts/build-team-ratings.mjs, calibrated against CBBD at r=0.995) and apply
 * the *official NCAA quadrant thresholds* to that rank. Same shape, full
 * history, no external dependency. Label it "Quad", never "NET Quad".
 *
 * Thresholds are the real NCAA ones, and they depend on venue — which is why
 * the venue dimension is a prerequisite for this feature.
 */

export type Quad = 1 | 2 | 3 | 4;
export type QuadVenue = "home" | "away" | "neutral";

/** Upper bound (inclusive) of opponent rank for Q1/Q2/Q3 at each venue. */
const QUAD_BOUNDS: Record<QuadVenue, [number, number, number]> = {
  home:    [30, 75, 160],
  neutral: [50, 100, 200],
  away:    [75, 135, 240],
};

/**
 * Quadrant for a game, given the opponent's rank and where it was played.
 * A null/unknown rank means a non-D1 opponent (they never appear in the
 * ratings file), which the committee also treats as the bottom quadrant.
 */
export function quadFor(oppRank: number | null | undefined, venue: QuadVenue): Quad {
  if (oppRank == null || !Number.isFinite(oppRank)) return 4;
  const [q1, q2, q3] = QUAD_BOUNDS[venue];
  if (oppRank <= q1) return 1;
  if (oppRank <= q2) return 2;
  if (oppRank <= q3) return 3;
  return 4;
}

/**
 * Normalizer bridging the two team-name spaces we have to join: game logs use
 * Bart-style names ("Ohio St.", "N.C. State") while team-ratings uses CBBD
 * names ("Ohio State", "NC State"). Expanding "St." → "state" fixes most of
 * it; TEAM_RATING_ALIASES covers the rest.
 */
export function normTeamKey(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state")
    .replace(/\bu\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * game-log `team_name` → team-ratings `team`, for the 29 names that don't
 * survive normalization. Verified as an exact 1:1 pairing of the two
 * unmatched sets for 2026; re-check when a season's team list changes.
 */
export const TEAM_RATING_ALIASES: Record<string, string> = {
  "Albany": "UAlbany",
  "American": "American University",
  "Appalachian St.": "App State",
  "Cal Baptist": "California Baptist",
  "Connecticut": "UConn",
  "FIU": "Florida International",
  "Grambling St.": "Grambling",
  "Hawaii": "Hawai'i",
  "IU Indy": "IU Indianapolis",
  "Illinois Chicago": "UIC",
  "LIU": "Long Island University",
  "Louisiana Monroe": "UL Monroe",
  "Loyola MD": "Loyola Maryland",
  "McNeese St.": "McNeese",
  "Miami FL": "Miami",
  "Mississippi": "Ole Miss",
  "N.C. State": "NC State",
  "Nebraska Omaha": "Omaha",
  "Nicholls St.": "Nicholls",
  "Penn": "Pennsylvania",
  "Queens": "Queens University",
  "Saint Francis": "St. Francis (PA)",
  // Distinct school from St. Francis (PA) — the Brooklyn one, which dropped to
  // D3 after 2022-23. Appears in 10 of our 13 seasons.
  "St. Francis NY": "St. Francis Brooklyn",
  "Sam Houston St.": "Sam Houston",
  "Southeastern Louisiana": "SE Louisiana",
  "St. Thomas": "St. Thomas-Minnesota",
  "Tennessee Martin": "UT Martin",
  "Texas A&M Corpus Chris": "Texas A&M-Corpus Christi",
  "UMKC": "Kansas City",
  "USC Upstate": "South Carolina Upstate",
};

/**
 * Teams that legitimately have no rating in a given season (so their games
 * fall to Q4) are NOT alias bugs — scripts/build-team-ratings.mjs drops teams
 * with too few games. Audited across 2014-2026: the residue is ~29 team-seasons,
 * almost all low-major (Alcorn St., Coppin St., Mississippi Valley St.) where
 * Q4 is the correct answer anyway, plus five 2021 COVID-shortened teams
 * (American, Bucknell, Maine, Howard, Chicago St.) that opted out mid-season.
 */

/** Apply the alias table, then normalize. Use for BOTH sides of the join. */
export function ratingKey(gameLogTeamName: string): string {
  return normTeamKey(TEAM_RATING_ALIASES[gameLogTeamName] ?? gameLogTeamName);
}

export type TeamRatingsFile = {
  season: number;
  teams: Array<{ team: string; rank_net: number; adj_net: number }>;
};

/** normalized team key → rank_net, for one season. */
export function buildRankMap(file: TeamRatingsFile): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of file.teams) m.set(normTeamKey(t.team), t.rank_net);
  return m;
}

/**
 * The numeric prefix of `cbba_game_id` ("2736013-103902-game-true") is shared
 * by both teams' rows for the same game. Pairing on it is far more reliable
 * than matching `opp_team_market`, which is a third name space (~781 distinct
 * values in 2026, including non-D1 opponents that never appear as team_name).
 */
export function gameKey(cbbaGameId: string | null | undefined): string {
  return String(cbbaGameId ?? "").split("-")[0] ?? "";
}
