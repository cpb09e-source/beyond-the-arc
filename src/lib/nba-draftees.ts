/**
 * Client-side lazy loader for the NBA-players lookup. The underlying JSON
 * (public/data/nba-draftees.json) holds every player from the 2013-2025 NBA
 * Draft plus every undrafted player who logged an NBA game between 2013-2026
 * (catches Fred VanVleet-style cases). Keyed by a normalized lowercase name.
 *
 * Used by the team roster + headshot strip and the per-game box-score modal
 * to drop a small "NBA" pill next to a player's name. One fetch per page
 * session, cached at module scope.
 */

export type NbaDraftee = {
  year: number;
  pick: number | null;
  team: string | null;
  college: string | null;
};

let CACHE: Record<string, NbaDraftee> | null = null;
let FETCH: Promise<Record<string, NbaDraftee>> | null = null;

export function loadNbaDraftees(): Promise<Record<string, NbaDraftee>> {
  if (CACHE) return Promise.resolve(CACHE);
  if (FETCH) return FETCH;
  FETCH = fetch("/data/nba-draftees.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: Record<string, NbaDraftee>) => { CACHE = j; return j; })
    .catch(() => ({}));
  return FETCH;
}

/**
 * Name normalizer matching the format used as keys in nba-draftees.json.
 * Strips diacritics, lowercases, collapses non-alphanumerics, and drops
 * generational suffixes ("Jr.", "Sr.", "II", "III", "IV", "V") so
 * "Walter Clayton Jr." matches the scrape's "Walter Clayton".
 */
export function normNbaName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}

/**
 * Franchise code → full name. Codes are Basketball-Reference's, so a few of
 * them name a franchise that has since been renamed and TWO of them are
 * genuinely ambiguous on their own:
 *
 *   CHA is the Bobcats in 2013 and the Hornets in 2026 — the scrape that
 *       produced the recent drafts uses CHA where BBRef switched to CHO in
 *       2014, so the code alone cannot decide it.
 *   NOH is the Hornets, who became the Pelicans (NOP) from 2013-14 on.
 *
 * nbaTeamName() therefore takes the draft year: a name shown against a 2013
 * pick should be the name the franchise had when it made that pick.
 */
const NBA_TEAM_NAMES: Record<string, string> = {
  ATL: "Atlanta Hawks", BOS: "Boston Celtics", BRK: "Brooklyn Nets",
  CHI: "Chicago Bulls", CHO: "Charlotte Hornets", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons",
  GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "Los Angeles Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies",
  MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOH: "New Orleans Hornets", NOP: "New Orleans Pelicans", NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers",
  PHO: "Phoenix Suns", POR: "Portland Trail Blazers", SAC: "Sacramento Kings",
  SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz",
  WAS: "Washington Wizards",
};

/** Full franchise name for a code, as of the given draft year. */
export function nbaTeamName(code: string | null, year: number): string | null {
  if (!code) return null;
  // The Bobcats became the Hornets for 2014-15; before that CHA is the Bobcats.
  if (code === "CHA") return year <= 2014 ? "Charlotte Bobcats" : "Charlotte Hornets";
  return NBA_TEAM_NAMES[code] ?? code;
}

/**
 * Round for an OVERALL pick number. Every draft in this file runs 1..60 with
 * 30 teams, so the round boundary is 30 regardless of how many picks a given
 * year actually made (2022-24 ran short on forfeited picks).
 */
export function draftRound(pick: number): number {
  return pick <= 30 ? 1 : 2;
}

/** "1st", "2nd", "3rd", "11th"… for the pick number. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
