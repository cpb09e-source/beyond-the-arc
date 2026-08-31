import { readAllTeams } from "@/lib/static-data";
import { teamSlug } from "@/lib/team-slug";

/**
 * The little a gated team page is still allowed to say: which team, which
 * season, which conference.
 *
 * DELIBERATELY THIN. It reads teams-all.json — the same index the nav and the
 * home page use — and nothing else. Every richer loader on the team page
 * (splits, lineups, on/off, the season grid) is exactly what the gate exists
 * to keep out of the HTML, so none of them runs for a gated season.
 *
 * Returns null for a team that does not exist, which the caller turns into the
 * 404 it already was.
 */
export async function archiveGateProps(slug: string, year: number): Promise<{
  teamName: string;
  year: number;
  seasonLabel: string;
  conference: string | null;
} | null> {
  const all = await readAllTeams();
  const match = all.find((t) => teamSlug(t.name) === slug && t.year === year)
    // A team that existed in other seasons but not this one still gets a page
    // saying so, rather than a 404 that reads as "we lost your bookmark".
    ?? all.find((t) => teamSlug(t.name) === slug);
  if (!match) return null;
  return {
    teamName: match.name,
    year,
    seasonLabel: `${(year - 1).toString().slice(-2)}-${year.toString().slice(-2)}`,
    conference: match.conference ?? null,
  };
}
