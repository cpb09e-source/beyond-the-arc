/**
 * CBBD's spelling of a school → ours. Pure, dependency-free, and shared.
 *
 * WHY IT IS ITS OWN MODULE. Two callers need this answer and they run in
 * different places: src/lib/game-team-links.ts resolves it at BUILD time from
 * teams-all.json for the box score's team and coach links, and
 * src/lib/team-link.ts resolves it in the BROWSER from the small
 * /data/team-names.json for the standings table. One alias table with two
 * consumers cannot drift; two copies would, and the failure mode of a drifted
 * copy is a link to the wrong school.
 *
 * WHY ANY OF THIS IS NEEDED. The scoreboard archive and the live feed are
 * CBBD's names; every team page, slug and coach record here is ours. Measured
 * across 2025-26, a raw string match finds 269 of the 370 D-I programs. The
 * fold below takes that to 339 and the alias table takes it to 365 — every
 * team that actually appears in the season.
 *
 * NOTHING HERE GUESSES. Token-similarity matching was tried for the last 26
 * and scored against the real name list it proposed "Cal Baptist" from
 * "Baptist (Fl)", "Penn" from "Penn State-York", "Mississippi" from
 * "Mississippi University For Women" and "St. Thomas" from "Thomas (ME)" —
 * four schools, four confident wrong answers. An unresolved name renders as
 * plain text, which costs nothing; a link to the wrong school is a lie.
 *
 * A MISS IS USUALLY CORRECT. A season's schedule names ~719 teams, because
 * D-I plays D-II, D-III and NAIA opponents — Millsaps, Widener, Arlington
 * Baptist. Those have no page here and must not be linked.
 */

/**
 * CBBD's spelling → ours, for the names no rule reaches.
 *
 * Verified one by one against the 2025-26 schedule and public/data/team-names.json
 * on 2026-09-09. Both sides are exact strings; do not "tidy" either.
 *
 * NOT LISTED, DELIBERATELY: Hartford, St. Francis NY, Savannah St., Centenary
 * and Winston Salem St. are in our team list but have left D-I, so they never
 * appear in a current schedule and need no alias.
 */
export const TEAM_ALIAS: Record<string, string> = {
  "UAlbany": "Albany",
  "App State": "Appalachian St.",
  "California Baptist": "Cal Baptist",
  "UConn": "Connecticut",
  "Florida International": "FIU",
  "Grambling": "Grambling St.",
  "UIC": "Illinois Chicago",
  "IU Indianapolis": "IU Indy",
  "Long Island University": "LIU",
  "UL Monroe": "Louisiana Monroe",
  "Loyola Maryland": "Loyola MD",
  "McNeese": "McNeese St.",
  "Miami": "Miami FL",
  "Ole Miss": "Mississippi",
  "Omaha": "Nebraska Omaha",
  "Nicholls": "Nicholls St.",
  "Pennsylvania": "Penn",
  "Sam Houston": "Sam Houston St.",
  "Seattle U": "Seattle",
  "SE Louisiana": "Southeastern Louisiana",
  "St. Thomas-Minnesota": "St. Thomas",
  "UT Martin": "Tennessee Martin",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris",
  "Kansas City": "UMKC",
  "South Carolina Upstate": "USC Upstate",
  "St. Francis (PA)": "Saint Francis",
};

/**
 * Case, accents, punctuation, "University", and State → St.
 *
 * `\bstate\b` → `st` is the single highest-value rule: CBBD writes the word out
 * and we abbreviate it, across dozens of programs. "Miami (OH)" and "Miami OH"
 * both land on "miami oh", which is what makes the parenthesised forms work.
 */
export function foldTeamName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/\buniversity\b|\buniv\b/g, " ")
    .replace(/\bstate\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** folded name → canonical name, from our list of team names. */
export function buildCanonMap(ourNames: Iterable<string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of ourNames) m.set(foldTeamName(n), n);
  return m;
}

/** Our canonical name for a CBBD spelling, or null if it is not a D-I program. */
export function canonicalTeamName(canon: Map<string, string>, cbbdName: string): string | null {
  const aliased = TEAM_ALIAS[cbbdName];
  if (aliased) return aliased;
  return canon.get(foldTeamName(cbbdName)) ?? null;
}
