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

export const POWER_CONFS = new Set(["ACC", "B10", "B12", "P12", "SEC", "BE"]);

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
