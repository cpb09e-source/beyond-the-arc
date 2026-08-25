/**
 * Shared plumbing for the team sub-page routes (Roster, Shooting,
 * Play-by-play).
 *
 * ONLY THE CURRENT SEASON GETS THESE ROUTES. Every team-season would be
 * roughly 15,000 extra pages on top of the 5,009 that exist, close to doubling
 * the site build; the latest season alone is about 1,100. Older seasons render
 * every section on one page with the tab strip in anchor mode instead, so
 * nothing is unreachable or unindexed — see the note at the top of
 * team-tabs.tsx.
 *
 * Note this is the latest season we hold RESULTS for, not the preview year.
 * Preview pages keep the single-page layout (their sections are reordered
 * around a game-less season and most of them are blurred), so a Roster route
 * pointing at one would open on a page that had already moved its roster.
 */
import { readAllTeams, readTeam } from "@/lib/static-data";
import { teamSlug } from "@/lib/team-slug";

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/** The most recent season with results. */
export async function latestSeasonYear(): Promise<number> {
  const all = await readAllTeams();
  let latest = 0;
  for (const t of all) latest = Math.max(latest, t.year);
  return latest;
}

/** (slug, year) for every team active in the most recent season. */
export async function currentSeasonParams(): Promise<Array<{ slug: string; year: string }>> {
  const all = await readAllTeams();
  let latest = 0;
  for (const t of all) latest = Math.max(latest, t.year);
  const seen = new Set<string>();
  const out: Array<{ slug: string; year: string }> = [];
  for (const t of all) {
    if (t.year !== latest) continue;
    const slug = teamSlug(t.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, year: String(latest) });
  }
  return out;
}

/**
 * Metadata for one tab of one team-season.
 *
 * Each tab gets its own title and canonical rather than inheriting Overview's.
 * These are separate URLs with separate content, and pointing them all at the
 * same canonical would tell Google to drop three of the four.
 */
export async function tabMetadata({
  slug,
  yearStr,
  tabLabel,
  segment,
  describe,
}: {
  slug: string;
  yearStr: string;
  tabLabel: string;
  segment: string;
  /** The sentence after the em dash, naming what is actually on the page. */
  describe: string;
}) {
  const year = Number(yearStr);
  if (!Number.isFinite(year)) return { title: "Team season not found" };
  const team = await readTeam(slug);
  if (!team) return { title: "Team not found" };
  const current = team.seasons.find((s) => s.year === year);
  if (!current) return { title: "Team season not found" };

  const seasonStr = seasonLabel(year);
  const title = `${team.name} ${seasonStr} ${tabLabel}`;
  const description = `${team.name} ${seasonStr} — ${describe}`;
  const url = `/teams/${slug}/${year}/${segment}/`;

  return {
    title,
    description,
    openGraph: { title: `${team.name} · ${seasonStr} ${tabLabel}`, description, url, type: "website" },
    twitter: { card: "summary_large_image" as const, title: `${team.name} · ${seasonStr} ${tabLabel}`, description },
    alternates: { canonical: url },
  };
}
