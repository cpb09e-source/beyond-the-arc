/**
 * Shared plumbing for the team sub-page routes — Roster, School History,
 * Shooting, Lineups and On/Off.
 *
 * THE RECENT SEASONS GET THESE ROUTES, plus every season of the review teams.
 * Older seasons of everyone else render all their sections on the season page
 * itself, with the tab strip scrolling to anchors instead of navigating.
 *
 * THERE IS NO THIRD OPTION. next.config sets `output: "export"` — a full
 * static export with no server at runtime — so a route generateStaticParams
 * does not emit is a 404, not an on-demand render. Restricting the prebuild
 * therefore REQUIRES a fallback for the seasons left out, and the anchor mode
 * in team-tabs.tsx is that fallback. The two settings below cannot be tightened
 * without it.
 *
 * The cost, measured from teams-all.json — five tab pages per team-season:
 *
 *   seasons kept    tab pages     vs all 12
 *   ------------    ---------     ---------
 *    1 (25-26)          1,825       -19,540
 *    5 (21-22 on)       9,060       -12,305   <- current setting
 *    8 (18-19 on)      12,590        -8,775
 *   12 (all)           21,365             0
 *
 * The preview year is separately excluded and keeps the single-page layout:
 * its sections are reordered around a game-less season and most of them are
 * blurred, so a Roster route pointing at one would open on a page that had
 * already moved its roster somewhere else.
 */

/**
 * How many of the most recent seasons get real tab routes, for every team.
 * See the table above. This is a count of seasons we actually hold, newest
 * first, so 2020-21 counts like any other — it is far enough back that it has
 * never reached the tabbed window anyway.
 */
export const TABBED_SEASONS = 5;

/**
 * Teams that get real tab routes on EVERY season they have, regardless of the
 * window.
 *
 * Vermont is the review team for this redesign — it is also the only team with
 * a baked season grid (scripts/build-team-seasons.mts --team Vermont) — so
 * every part of the rebuild can be clicked through end to end on one team
 * without paying for all 368 of them.
 *
 * COST: about 35 extra pages per team listed, so this is cheap to extend and
 * cheap to leave. It is not a permanent mechanism though — once the window is
 * settled, this should either empty out or be replaced by widening
 * TABBED_SEASONS.
 */
export const FULLY_TABBED_SLUGS: ReadonlySet<string> = new Set(["vermont"]);
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

/** The most recent TABBED_SEASONS seasons we hold, newest first. */
export async function tabbedSeasonYears(): Promise<number[]> {
  const all = await readAllTeams();
  const years = [...new Set(all.map((t) => t.year))].sort((a, b) => b - a);
  return years.slice(0, TABBED_SEASONS);
}

/**
 * Whether one team-season has real tab routes, or falls back to the one-page
 * anchor layout.
 *
 * The page and the sitemap BOTH go through this. They have to agree exactly:
 * a sitemap listing a season the build did not emit is a list of 404s, and a
 * page rendering route-mode tabs for one is a strip of links that all 404.
 */
export async function isTabbedSeason(slug: string, year: number): Promise<boolean> {
  if (FULLY_TABBED_SLUGS.has(slug)) return true;
  return (await tabbedSeasonYears()).includes(year);
}

/**
 * (slug, year) for every team-season that gets real tab routes.
 *
 * Deliberately does NOT include the preview year, which the [year] route adds
 * for itself — see the note above.
 */
export async function tabbedSeasonParams(): Promise<Array<{ slug: string; year: string }>> {
  const all = await readAllTeams();
  const keep = new Set(await tabbedSeasonYears());
  const seen = new Set<string>();
  const out: Array<{ slug: string; year: string }> = [];
  for (const t of all) {
    const slug = teamSlug(t.name);
    if (!keep.has(t.year) && !FULLY_TABBED_SLUGS.has(slug)) continue;
    const key = `${slug}|${t.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug, year: String(t.year) });
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
