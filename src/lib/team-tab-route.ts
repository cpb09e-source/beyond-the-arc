/**
 * Shared plumbing for the team sub-page routes — Roster, School History,
 * Shooting, Lineups and On/Off.
 *
 * EVERY SEASON GETS THESE ROUTES. This started as current-season-only, on the
 * grounds that five extra routes across 5,009 team-seasons is about 25,000
 * pages and more than doubles the site build. That was the right trade until
 * you actually used it: picking 18-19 out of the season dropdown and landing
 * on a page shaped differently from 25-26 — no tabs, the roster somewhere down
 * a long scroll — reads as the older season being a lesser page rather than
 * the same page about a different year. The build cost is real and is the
 * price of that consistency.
 *
 * The preview year is the exception and keeps the single-page layout: its
 * sections are reordered around a game-less season and most of them are
 * blurred, so a Roster route pointing at one would open on a page that had
 * already moved its roster somewhere else.
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

/**
 * (slug, year) for every team-season we hold.
 *
 * Deliberately does NOT include the preview year, which the [year] route adds
 * for itself — see the note above.
 */
export async function allSeasonParams(): Promise<Array<{ slug: string; year: string }>> {
  const all = await readAllTeams();
  const seen = new Set<string>();
  const out: Array<{ slug: string; year: string }> = [];
  for (const t of all) {
    const slug = teamSlug(t.name);
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
