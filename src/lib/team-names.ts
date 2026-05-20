/**
 * team-names.ts — short-form display names for tight chrome (mobile box scores,
 * narrow tables). Pair with the <TeamName> component (src/components/team-name.tsx)
 * which renders the short form below the `sm` breakpoint and the canonical
 * name on desktop.
 *
 * Names are keyed by the canonical Bart/SR name we store in the database. Add
 * entries when a new program needs a tighter mobile label; if a program isn't
 * mapped, the canonical name is used unchanged.
 */

const SHORT_NAMES: Record<string, string> = {
  // Big, standard college-hoops abbreviations
  "Connecticut": "UConn",
  "North Carolina": "UNC",
  "Brigham Young": "BYU",
  "Massachusetts": "UMass",
  "Pittsburgh": "Pitt",
  "Cincinnati": "Cincy",

  // Just punctuation / standard form
  "Saint Mary's": "St. Mary's",
  "St. John's (NY)": "St. John's",

  // Long names → recognized abbreviations
  "Maryland Eastern Shore": "UMES",
  "Fairleigh Dickinson": "FDU",
  "Loyola Marymount": "LMU",
  "Loyola (IL)": "Loyola Chicago",
  "Mississippi Valley St.": "MVSU",
  "Texas A&M Corpus Christi": "TAMUCC",
  "North Carolina A&T": "NC A&T",
  "Eastern Washington": "Eastern Wash.",
  "Mississippi St.": "Miss St.",
};

/**
 * Return the canonical name's short form, or the name unchanged if no entry.
 */
export function teamShortName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}
