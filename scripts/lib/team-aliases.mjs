/**
 * Colloquial team names → the canonical bart name used across public/data.
 * Attached to search-index team entries as the `k` field (space-joined,
 * lowercase) so "uconn" finds Connecticut. Shared by build-search-index.mjs
 * and export-static-data.mts — one list, or the two indexes drift.
 *
 * Keep entries colloquial-only. Anything that's a substring of the real name
 * ("app" → Appalachian St., "wisco…" → Wisconsin) already matches without help.
 */
export const TEAM_ALIASES = {
  "Connecticut": ["uconn"],
  "North Carolina": ["unc", "tar heels"],
  "Pittsburgh": ["pitt"],
  "Villanova": ["nova"],
  "Gonzaga": ["zags"],
  "Massachusetts": ["umass"],
  "Virginia": ["uva"],
  "Mississippi": ["ole miss", "olemiss"],
  "Syracuse": ["cuse"],
  "Alabama": ["bama"],
  "California": ["cal", "berkeley"],
  "USC": ["southern cal", "southern california"],
  "Washington St.": ["wazzu"],
  "Saint Joseph's": ["st joes", "saint joes"],
  "N.C. State": ["nc state", "north carolina state"],
  "Louisiana": ["ul lafayette", "louisiana lafayette"],
};

/** Lowercase space-joined keyword string for a team name, or null. */
export function aliasKeywords(name) {
  const list = TEAM_ALIASES[name];
  return list ? list.join(" ").toLowerCase() : null;
}
