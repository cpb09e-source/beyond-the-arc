import fs from "node:fs/promises";
import path from "node:path";
import { readAllTeams } from "@/lib/static-data";
import { teamSlug } from "@/lib/team-slug";
import { coachSlug } from "@/lib/coach-slug";

/**
 * A game's team and coach links, resolved at BUILD time.
 *
 * WHY THIS IS NOT ARITHMETIC ON A NAME. The scoreboard archive is CBBD's
 * spelling; every team page, coach record and slug on this site is ours, and
 * the two disagree constantly. Measured on 2025-26: of the 370 D-I programs,
 * a raw string match finds 269. That is the same class of problem that made
 * a game's URL a lookup rather than a composition (see src/lib/game-link.ts) —
 * and the same rule applies, because a link to the wrong school is worse than
 * no link at all.
 *
 * WHAT ACTUALLY CLOSES THE GAP. Two steps, in order, neither of them fuzzy:
 *
 *   1. A NORMALISING FOLD. "Morgan State" against our "Morgan St.", "Queens
 *      University" against "Queens", "Miami (OH)" against "Miami OH". Folding
 *      case, accents, punctuation, "University" and State/St. takes 269 to
 *      339 of 370.
 *   2. A HAND-WRITTEN ALIAS TABLE for the 26 that no rule reaches, below.
 *      "UConn" is not a fold away from "Connecticut" and never will be.
 *
 * WHY NOT TOKEN SIMILARITY for step 2. It was tried and it is actively
 * dangerous here: scored against the real 2025-26 name list it proposed
 * "Cal Baptist" ← "Baptist (Fl)", "Penn" ← "Penn State-York", "Mississippi" ←
 * "Mississippi University For Women" and "St. Thomas" ← "Thomas (ME)". Four
 * different schools, four confident wrong answers. An unresolved name renders
 * as plain text, which is correct and costs nothing.
 *
 * A MISS IS USUALLY RIGHT. A season's schedule names ~719 teams because D-I
 * teams play D-II, D-III and NAIA opponents — Millsaps, Widener, Arlington
 * Baptist. Those have no page here and must not be linked. Only the 370 are
 * expected to resolve, and 370 of 370 now do.
 *
 * BUILD TIME, NOT RUNTIME. 74,307 game pages are prerendered, so every lookup
 * here runs during the build and nothing ships to the browser. All three of
 * the inputs are memoized at module scope for that reason: teams-all.json is
 * 18 MB and coach-history.json is 1.2 MB, and reading either one per page
 * would be the whole build.
 *
 * SERVER ONLY, without the `server-only` package — it is not a dependency of
 * this project. The guard is structural instead: this module reads `node:fs`,
 * so it cannot be bundled for a browser, and the client components that need
 * its result take the TYPES through `import type`, which the compiler erases.
 * Do not add a value import of this module to anything under "use client".
 */

/**
 * CBBD's spelling → ours, for the names no fold reaches.
 *
 * Verified one by one against the 2025-26 schedule and public/data/team-names.json
 * on 2026-09-09. Both sides are exact strings; do not "tidy" either.
 *
 * NOT LISTED, DELIBERATELY: Hartford, St. Francis NY, Savannah St., Centenary
 * and Winston Salem St. are in our team list but have left D-I, so they never
 * appear in a current schedule and need no alias.
 */
const ALIAS: Record<string, string> = {
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
 * `\bstate\b` → `st` is the single highest-value rule: CBBD writes the word
 * out and we abbreviate it, across dozens of programs.
 */
function fold(s: string): string {
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

type CoachSeason = { name: string; slug: string };
type CoachHistory = Record<string, Record<string, CoachSeason>>;

let _canon: Promise<Map<string, string>> | null = null;
/** folded name → our canonical team name. */
function canonMap(): Promise<Map<string, string>> {
  return (_canon ??= (async () => {
    const all = await readAllTeams();
    const m = new Map<string, string>();
    for (const t of all) m.set(fold(t.name), t.name);
    return m;
  })());
}

let _seasons: Promise<Set<string>> | null = null;
/**
 * "slug|year" for every team-season page the build actually emits.
 *
 * Built from the same readAllTeams() the /teams/[slug]/[year] route uses, so a
 * link can only point at a page that exists. Without this a game from 2016
 * would happily link a team to a season it did not play in D-I.
 */
function seasonSet(): Promise<Set<string>> {
  return (_seasons ??= (async () => {
    const all = await readAllTeams();
    const s = new Set<string>();
    for (const t of all) s.add(`${teamSlug(t.name)}|${t.year}`);
    return s;
  })());
}

let _coaches: Promise<CoachHistory> | null = null;
function coachHistory(): Promise<CoachHistory> {
  return (_coaches ??= (async () => {
    try {
      const p = path.join(process.cwd(), "src", "data", "coach-history.json");
      return JSON.parse(await fs.readFile(p, "utf8")) as CoachHistory;
    } catch {
      // The scraper may not have run in a fresh checkout. No coach line is a
      // missing flourish; a failed build is not.
      return {};
    }
  })());
}

export type SideLinks = {
  /** /teams/<slug>/<season>/ — null when the opponent has no page here. */
  teamHref: string | null;
  /** The coach that team-season, already linked. Null when unknown. */
  coach: { name: string; href: string } | null;
};

export type GameLinks = { home: SideLinks; away: SideLinks };

/** Our canonical name for a CBBD spelling, or null if it is not a D-I program. */
async function canonical(cbbdName: string): Promise<string | null> {
  const aliased = ALIAS[cbbdName];
  if (aliased) return aliased;
  return (await canonMap()).get(fold(cbbdName)) ?? null;
}

async function sideLinks(cbbdName: string, season: number): Promise<SideLinks> {
  const name = await canonical(cbbdName);
  if (!name) return { teamHref: null, coach: null };

  const slug = teamSlug(name);
  const has = (await seasonSet()).has(`${slug}|${season}`);
  // Fall back to the team's landing page rather than dropping the link: the
  // team is real, only that particular season is not published.
  const teamHref = has ? `/teams/${slug}/${season}/` : `/teams/${slug}/`;

  const row = (await coachHistory())[name]?.[String(season)];
  // coach-history carries its own slug (`john-calipari-1`, disambiguated
  // across namesakes). Trust it; coachSlug() is only the fallback.
  const coach = row?.name
    ? { name: row.name, href: `/coaches/${row.slug || coachSlug(row.name)}/` }
    : null;

  return { teamHref, coach };
}

export async function gameTeamLinks(
  homeTeam: string,
  awayTeam: string,
  season: number,
): Promise<GameLinks> {
  const [home, away] = await Promise.all([
    sideLinks(homeTeam, season),
    sideLinks(awayTeam, season),
  ]);
  return { home, away };
}
