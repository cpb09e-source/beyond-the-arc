/**
 * NCAA Men's Division I Tournament results, keyed by season-end year (so the
 * 2024-25 season is year=2025). Team names use Bart Torvik's exact strings —
 * see `out/data/teams-all.json` for the canonical spelling. Lookups in the
 * UI happen via `tourneyBadge(name, year)` to keep call sites concise.
 */

export type TourneyYear = {
  champion: string;
  finalFour: [string, string, string, string]; // includes champion
};

export const TOURNEY_RESULTS: Record<number, TourneyYear> = {
  2013: {
    // NCAA later vacated Louisville's title (2018) but they won on the court.
    champion: "Louisville",
    finalFour: ["Louisville", "Michigan", "Syracuse", "Wichita St."],
  },
  2014: {
    champion: "Connecticut",
    finalFour: ["Connecticut", "Kentucky", "Florida", "Wisconsin"],
  },
  2015: {
    champion: "Duke",
    finalFour: ["Duke", "Wisconsin", "Kentucky", "Michigan St."],
  },
  2016: {
    champion: "Villanova",
    finalFour: ["Villanova", "North Carolina", "Oklahoma", "Syracuse"],
  },
  2017: {
    champion: "North Carolina",
    finalFour: ["North Carolina", "Gonzaga", "Oregon", "South Carolina"],
  },
  2018: {
    champion: "Villanova",
    finalFour: ["Villanova", "Michigan", "Kansas", "Loyola Chicago"],
  },
  2019: {
    champion: "Virginia",
    finalFour: ["Virginia", "Texas Tech", "Auburn", "Michigan St."],
  },
  // 2020 (2019-20): NCAA tournament cancelled due to COVID-19. No champion / no Final Four.
  2021: {
    champion: "Baylor",
    finalFour: ["Baylor", "Gonzaga", "Houston", "UCLA"],
  },
  2022: {
    champion: "Kansas",
    finalFour: ["Kansas", "North Carolina", "Duke", "Villanova"],
  },
  2023: {
    champion: "Connecticut",
    finalFour: ["Connecticut", "San Diego St.", "Miami FL", "Florida Atlantic"],
  },
  2024: {
    champion: "Connecticut",
    finalFour: ["Connecticut", "Purdue", "Alabama", "N.C. State"],
  },
  2025: {
    champion: "Florida",
    finalFour: ["Florida", "Houston", "Auburn", "Duke"],
  },
  2026: {
    champion: "Michigan",
    finalFour: ["Michigan", "Connecticut", "Illinois", "Arizona"],
  },
};

// Loose match: lowercase + strip non-alphanumerics so "UConn" matches
// "Connecticut" only if explicitly aliased here. Most teams resolve directly.
const ALIASES: Record<string, string> = {
  uconn: "connecticut",
  "san diego state": "san diego st.",
  "nc state": "n.c. state",
  "north carolina state": "n.c. state",
  miami: "miami fl",
};

function normalize(s: string): string {
  const k = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return ALIASES[k] ?? k;
}

export type TourneyBadgeKind = "champion" | "final-four" | null;

export function tourneyBadge(teamName: string, year: number): TourneyBadgeKind {
  const r = TOURNEY_RESULTS[year];
  if (!r) return null;
  const n = normalize(teamName);
  if (normalize(r.champion) === n) return "champion";
  if (r.finalFour.some((t) => normalize(t) === n)) return "final-four";
  return null;
}
