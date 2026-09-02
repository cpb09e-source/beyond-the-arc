/**
 * Conference-level constants shared between the scripts and the React app.
 *
 *  - `POWER_CONFS` is the canonical "Power" tier used site-wide: /portal's
 *    "worst transfer classes (power confs only)" sidebar, the /coaches Tier
 *    filter (All / Power / Mid Major), and the coach composite-score formula.
 *    Big East is included because, in our 2013-26 window, it's a Tier-1
 *    conference by every quantitative measure (2 national titles via
 *    Villanova, top BTA RTGs).
 *  - `confMultiplier()` returns the BTA PRTG multiplier for a player's
 *    conference. Tiers are pegged to the conference rankings shown on / under
 *    "View Conference Rankings →" and frozen at the 2025-26 season — revisit
 *    after the season ends if rankings shift materially.
 */

// P10 = Pac-10 (2008-2011, before it became the Pac-12). Same power tier.
export const POWER_CONFS = new Set(["ACC", "B10", "B12", "P12", "P10", "SEC", "BE"]);

/**
 * Is this a high-major conference, whatever it is called here?
 *
 * THERE ARE THREE VOCABULARIES FOR A CONFERENCE ON THIS SITE and they do not
 * agree, which is why POWER_CONFS on its own is not safe to test against an
 * arbitrary string:
 *
 *   1. Bart's compact codes — B10, B12, BE, P12 — the wire format of
 *      teams-all.json and what POWER_CONFS above holds.
 *   2. CONF_DISPLAY's labels in conf-display.ts, which render those codes for
 *      readers. Note it produces "Big 10", with a digit.
 *   3. The SCOREBOARD feed, which carries neither: its games say "Big Ten",
 *      "Big 12", "Big East" in full, spelled its own way.
 *
 * Testing the scoreboard's values against POWER_CONFS silently half-worked —
 * "ACC" and "SEC" are spelled the same in both, so those matched while Big
 * Ten, Big 12 and Big East did not. A Mid Majors filter therefore showed
 * Arizona and Oklahoma State, which is the kind of wrong that looks like a
 * data problem rather than a naming one. Found on the scoreboard, 2026-09-02.
 *
 * So this matches on a normalised form and accepts every spelling of each. Add
 * aliases here rather than at a call site; a second copy of this list is how
 * the next filter disagrees with this one.
 *
 * Pac-12 stays in for the archive. It has no members in the current data after
 * realignment, but seasons back to 2014 do, and this function is asked about
 * them.
 */
const POWER_ALIASES = new Set([
  "acc", "atlantic coast",
  "b10", "big 10", "big ten",
  "b12", "big 12", "big twelve",
  "be", "big east",
  "sec", "southeastern",
  "p12", "p10", "pac 12", "pac-12", "pac 10", "pac-10", "pacific 12",
]);

export function isPowerConference(conf: string | null | undefined): boolean {
  if (!conf) return false;
  // Fold punctuation and spacing so "Pac-12", "Pac 12" and "pac12" agree.
  const k = conf.trim().toLowerCase().replace(/[.\-_]+/g, " ").replace(/\s+/g, " ");
  return POWER_ALIASES.has(k) || POWER_ALIASES.has(k.replace(/\s+/g, ""));
}

// Conference → BTA PRTG multiplier. Tier comments map to the 2025-26 rankings.
// Right column shows the gap vs the Tier 1 (top-5) baseline of ×1.19, which is
// the lens the user designs against.
//   Tier 1 (rank 1-5)   → ×1.19  (+19 %, baseline)
//   Tier 2 (rank 6-10)  → ×0.96  (-4 %, 23 pts below T1)
//   Tier 3 (rank 11-14) → ×0.89  (-11 %, 30 pts below T1)
//   Tier 4 (rank 15-22) → ×0.82  (-18 %, 37 pts below T1)
//   Tier 5 (rank 23-31) → ×0.77  (-23 %, 42 pts below T1)
const CONF_PRTG_MULTIPLIER: Record<string, number> = {
  SEC: 1.19, B12: 1.19, B10: 1.19, ACC: 1.19, BE: 1.19,
  MWC: 0.96, A10: 0.96, WCC: 0.96, Amer: 0.96, MVC: 0.96,
  WAC: 0.89, Ivy: 0.89, CUSA: 0.89, BW: 0.89,
  MAC: 0.82, CAA: 0.82, BSky: 0.82, BSth: 0.82, Horz: 0.82, Slnd: 0.82, SB: 0.82, Sum: 0.82,
  SC: 0.77, MAAC: 0.77, ASun: 0.77, Pat: 0.77, OVC: 0.77, AE: 0.77, NEC: 0.77, SWAC: 0.77, MEAC: 0.77,
};

export function confMultiplier(conf: string | null | undefined): number {
  if (conf == null) return 1.0;
  return CONF_PRTG_MULTIPLIER[conf] ?? 1.0;
}

// ---- Defensive component (shared by all BTA PRTG call sites) ----
// BTA PRTG's two core inputs (PIR, PORPAG) are offense-heavy and reward volume,
// which buries efficient two-way players (rim protectors, low-usage glue bigs).
// We add a small per-game defensive index as an ADDITIVE z-tilt on top of the
// offensive blend (NOT a third averaged term — that would recompress the whole
// scale): blend = avg(0.69·z(PIR), z(PORPAG)) + BTA_DEF_WEIGHT·z(def).
//   def index = blocks (weighted most) + steals + a slice of defensive glass.
// BTA_DEF_WEIGHT is small on purpose — defense tilts the ranking, offense still
// dominates the magnitude. Mirror this in every BTA PRTG site (see bta-prtg.mts).
export const BTA_DEF_WEIGHT = 0.15;
export function btaDefScore(
  blk: number | null, stl: number | null, reb: number | null,
): number {
  return (blk ?? 0) * 1.0 + (stl ?? 0) * 0.7 + (reb ?? 0) * 0.25;
}

// Top-32 D-I teams for the 2025-26 season, by BTA RTG. Players currently on
// these rosters get an additional +8 % BTA PRTG boost (top-team competition
// adjustment). Snapshot from `processTeams(allTeams, years=[2026])`; regenerate
// after the season ends or after another export:data refresh.
const TOP_32_TEAMS_2026 = new Set<string>([
  "Michigan", "Duke", "Florida", "Arizona", "Houston", "Iowa St.", "Illinois",
  "Purdue", "Gonzaga", "Connecticut", "Michigan St.", "St. John's", "Tennessee",
  "Virginia", "Vanderbilt", "Louisville", "Arkansas", "Alabama", "Texas Tech",
  "Nebraska", "Iowa", "Saint Mary's", "Wisconsin", "Saint Louis", "Utah St.",
  "Kentucky", "Miami FL", "North Carolina", "BYU", "Santa Clara", "Georgia",
  "Kansas",
]);

export function topTeamMultiplier(teamName: string | null | undefined): number {
  if (teamName == null) return 1.0;
  return TOP_32_TEAMS_2026.has(teamName) ? 1.08 : 1.0;
}

// Top 5 teams per Tier 1 conference by overall regular-season record (wins,
// then fewer losses as tiebreaker) for 2025-26. Players on these rosters get
// an additional +6 % bump on top of the conference + top-32 multipliers — a
// "you played for a flagship program in a flagship league" adjustment.
// In-conference standings would be a tighter signal but Bart's data only
// exposes overall record, so this is the closest approximation we have.
const TOP_5_TIER_1_TEAMS_2026 = new Set<string>([
  // SEC
  "Arkansas", "Florida", "Vanderbilt", "Alabama", "Tennessee",
  // Big 12
  "Arizona", "Houston", "Iowa St.", "Kansas", "Texas Tech",
  // Big Ten
  "Michigan", "Purdue", "Nebraska", "Illinois", "Michigan St.",
  // ACC
  "Duke", "Virginia", "Miami FL", "North Carolina", "Clemson",
  // Big East
  "Connecticut", "St. John's", "Villanova", "Seton Hall", "Butler",
]);

export function top5Tier1Multiplier(teamName: string | null | undefined): number {
  if (teamName == null) return 1.0;
  return TOP_5_TIER_1_TEAMS_2026.has(teamName) ? 1.06 : 1.0;
}

// Top 3 teams in EVERY conference by overall regular-season record (wins,
// then fewer losses) for 2025-26. Players on these rosters get an additional
// +6 %. STACKS with top5Tier1Multiplier — a top-3-ACC team like Duke gets
// both bumps (which is intentional: best-of-best in best-of-best).
const TOP_3_BY_CONF_2026 = new Set<string>([
  "Saint Louis", "VCU", "Dayton",                       // A10
  "Duke", "Virginia", "Miami FL",                        // ACC
  "UMBC", "Vermont", "NJIT",                             // AE
  "Tulsa", "South Florida", "Wichita St.",               // Amer
  "Austin Peay", "Central Arkansas", "Queens",           // ASun
  "Michigan", "Purdue", "Nebraska",                      // B10
  "Arizona", "Houston", "Iowa St.",                      // B12
  "Connecticut", "St. John's", "Villanova",              // BE
  "Idaho", "Portland St.", "Northern Colorado",          // BSky
  "High Point", "Winthrop", "Radford",                   // BSth
  "Hawaii", "UC San Diego", "UC Irvine",                 // BW
  "UNC Wilmington", "Hofstra", "Charleston",             // CAA
  "Liberty", "Sam Houston St.", "Kennesaw St.",          // CUSA
  "Wright St.", "Robert Morris", "Northern Kentucky",    // Horz
  "Yale", "Penn", "Harvard",                             // Ivy
  "Merrimack", "Siena", "Fairfield",                     // MAAC
  "Miami OH", "Akron", "Kent St.",                       // MAC
  "Howard", "Norfolk St.", "Morgan St.",                 // MEAC
  "Belmont", "Northern Iowa", "Illinois St.",            // MVC
  "Utah St.", "New Mexico", "Nevada",                    // MWC
  "LIU", "Central Connecticut", "Mercyhurst",            // NEC
  "Tennessee St.", "Tennessee Martin", "Southeast Missouri St.", // OVC
  "Navy", "Colgate", "Lehigh",                           // Pat
  "Troy", "South Alabama", "Georgia Southern",           // SB
  "East Tennessee St.", "Furman", "Mercer",              // SC
  "Arkansas", "Florida", "Vanderbilt",                   // SEC
  "McNeese St.", "Stephen F. Austin", "UT Rio Grande Valley", // Slnd
  "North Dakota St.", "St. Thomas", "North Dakota",      // Sum
  "Prairie View A&M", "Alabama A&M", "Bethune Cookman",  // SWAC
  "Utah Valley", "Cal Baptist", "Utah Tech",             // WAC
  "Gonzaga", "Saint Mary's", "Santa Clara",              // WCC
]);

export function top3InConfMultiplier(teamName: string | null | undefined): number {
  if (teamName == null) return 1.0;
  return TOP_3_BY_CONF_2026.has(teamName) ? 1.06 : 1.0;
}

// Team-strength tilt by 2025-26 national BTA RANK (1 = best of 365). A slight
// reward for playing on an elite roster and a slight penalty for a bad one, so
// equal box-score production is worth a touch more at a top-15 program than at a
// sub-300 one. Stacks with the multipliers above (an elite team also collects
// the +8 % top-32 bump, etc.). Snapshot — regenerate from teams-all.json
// (year 2026, sorted by bta_rank) after a data refresh.
//   ELITE  = top 30      → ×1.05
//   WEAK   = bottom 137  → ×0.92
const ELITE_TEAMS_2026 = new Set<string>([
  "Michigan", "Duke", "Florida", "Arizona", "Houston", "Iowa St.", "Illinois", "Purdue",
  "Gonzaga", "Connecticut", "Michigan St.", "St. John's", "Tennessee", "Virginia",
  "Vanderbilt", "Louisville", "Arkansas", "Alabama", "Texas Tech", "Nebraska", "Iowa",
  "Saint Mary's", "Wisconsin", "Saint Louis", "Utah St.", "Kentucky", "Miami FL",
  "North Carolina", "BYU", "Santa Clara",
]);
const WEAK_TEAMS_2026 = new Set<string>([
  "Tarleton St.", "Stony Brook", "Montana", "Iona", "Radford", "Ohio",
  "Charleston Southern", "Green Bay", "Georgia Southern", "Longwood", "La Salle",
  "New Orleans", "Colgate", "San Diego", "Lindenwood", "Eastern Michigan",
  "Abilene Christian", "Nicholls St.", "Tulane", "Wofford", "Bethune Cookman",
  "UNC Asheville", "Milwaukee", "San Jose St.", "Elon", "Idaho St.", "SIU Edwardsville",
  "Old Dominion", "Portland", "Hampton", "Princeton", "Boston University",
  "Long Beach St.", "UTEP", "Mount St. Mary's", "Presbyterian", "Northeastern",
  "East Carolina", "Mercyhurst", "UC Riverside", "Nebraska Omaha", "Southern",
  "Purdue Fort Wayne", "Dartmouth", "Incarnate Word", "Denver", "Brown", "North Dakota",
  "Western Michigan", "USC Upstate", "Ball St.", "Jacksonville", "Grambling St.",
  "Sacramento St.", "Central Michigan", "Lehigh", "Loyola Chicago", "South Dakota",
  "Eastern Kentucky", "Louisiana", "West Georgia", "Pepperdine", "Sacred Heart",
  "Southeastern Louisiana", "Oral Roberts", "Wagner", "North Carolina A&T",
  "UNC Greensboro", "Prairie View A&M", "Houston Christian", "Alabama St.", "Le Moyne",
  "Southern Utah", "Alabama A&M", "Northwestern St.", "Central Connecticut", "Florida A&M",
  "East Texas A&M", "IU Indy", "Morehead St.", "UMass Lowell", "Chattanooga",
  "Georgia St.", "Delaware", "Albany", "Stonehill", "Loyola MD", "Norfolk St.", "Stetson",
  "Texas Southern", "Lafayette", "Tennessee Tech", "Little Rock", "Arkansas Pine Bluff",
  "Eastern Illinois", "Army", "New Haven", "Evansville", "NJIT", "Bucknell", "Bellarmine",
  "Holy Cross", "Southern Indiana", "Cleveland St.", "New Hampshire", "Northern Arizona",
  "Canisius", "Fairleigh Dickinson", "Northern Illinois", "Cal St. Bakersfield",
  "Manhattan", "Niagara", "Maine", "North Alabama", "The Citadel", "Morgan St.",
  "Chicago St.", "North Florida", "Bryant", "UTSA", "Air Force", "Maryland Eastern Shore",
  "Saint Francis", "Jackson St.", "Alcorn St.", "Rider", "North Carolina Central",
  "South Carolina St.", "Louisiana Monroe", "Delaware St.", "Binghamton", "UMKC", "VMI",
  "Gardner Webb", "Coppin St.", "Western Illinois", "Mississippi Valley St.",
]);

export function teamStrengthMultiplier(teamName: string | null | undefined): number {
  if (teamName == null) return 1.0;
  if (ELITE_TEAMS_2026.has(teamName)) return 1.05;
  if (WEAK_TEAMS_2026.has(teamName)) return 0.92;
  return 1.0;
}

// Power-conference teams that finished UNDER .500 in 2025-26. A power-league
// schedule already collects the +19 % conf bump (and maybe a top-team bump), so
// padding stats on a losing high-major squad shouldn't ride that bonus untaxed —
// a slight ×0.95 claws some of it back. Membership already encodes both
// conditions (power conf AND sub-.500), so it's a plain set lookup. Snapshot —
// regenerate from teams-all.json (year 2026, POWER_CONFS, wins < losses).
const POWER_SUB_500_2026 = new Set<string>([
  "Utah", "Maryland", "Boston College", "Georgia Tech", "Marquette", "Oregon",
  "Kansas St.", "Penn St.", "Pittsburgh", "South Carolina", "Mississippi St.", "Rutgers",
  "Mississippi", "Notre Dame", "Northwestern", "Minnesota", "Providence", "Xavier", "LSU",
  "Georgetown", "Syracuse", "Creighton", "Washington",
]);

export function powerConfSub500Multiplier(teamName: string | null | undefined): number {
  if (teamName == null) return 1.0;
  return POWER_SUB_500_2026.has(teamName) ? 0.95 : 1.0;
}
