import type { MetadataRoute } from "next";
import { tabbedSeasonParams } from "@/lib/team-tab-route";
import { readIndex, readAllTeams } from "@/lib/static-data";
import { loadAllCoachProfiles } from "@/lib/coaches";
import { archivedDays, gameSlug, isArchivedSeason, knownSeasons } from "@/lib/scoreboard-archive";
import { readArchiveIndex } from "@/lib/game-archive";

/**
 * Every URL the site publishes, in one list — and the arithmetic for splitting
 * it across several sitemap files.
 *
 * WHY THIS IS NOT JUST app/sitemap.ts ANY MORE. Google refuses a sitemap file
 * above 50,000 URLs, and refuses it whole: going over does not truncate, it
 * discards. The scoreboard archive put us over on its own — 25,474 players and
 * ~11,000 team tab routes were already most of the budget, and a game page per
 * game since 2014 is another ~76,000. So the list is built once here and both
 * app/sitemap.ts (which slices it) and app/robots.ts (which has to name every
 * slice) read the same thing.
 *
 * MEMOIZED, because both of those call it and `generateSitemaps` calls it once
 * more to count the slices. Building it walks every team-season, every player
 * and every game index on disk; doing that four times would be four times the
 * build cost for an identical answer.
 */

export const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app").replace(/\/$/, "");

/**
 * URLs per file. Google's ceiling is 50,000; the margin absorbs a season's
 * growth between now and whenever anyone next looks at this number.
 */
export const SITEMAP_CHUNK = 40_000;

function slugForTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function build(): Promise<MetadataRoute.Sitemap> {
  const idx = await readIndex();
  const allTeams = await readAllTeams();
  const coaches = await loadAllCoachProfiles();

  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();

  // Top-level pages — high priority, weekly refresh.
  for (const path of [
    "", "/players", "/teams", "/coaches", "/portal", "/calc",
    "/conferences", "/scoreboard", "/glossary", "/pricing", "/matchup", "/matchup/method",
  ]) {
    entries.push({
      url: `${BASE_URL}${path}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: path === "" ? 1.0 : 0.8,
    });
  }

  // Sources, terms and privacy. Indexed deliberately — on a paid site they are
  // a trust signal a reader goes looking for.
  for (const path of ["/sources", "/terms", "/privacy"]) {
    entries.push({ url: `${BASE_URL}${path}/`, lastModified: now, changeFrequency: "yearly", priority: 0.3 });
  }

  /**
   * The scoreboard archive: a day per night played, and a page per game.
   *
   * The largest block on the site and the reason it is worth having. Somebody
   * searching "oklahoma vs florida state basketball score" is searching for
   * one of these pages.
   */
  for (const season of knownSeasons()) {
    // A finished season never changes again; the one being played changes
    // every night, and saying so is what stops a crawler treating a live
    // fixture page as settled.
    const done = isArchivedSeason(season);
    const freq = done ? ("yearly" as const) : ("daily" as const);
    for (const date of archivedDays(season)) {
      entries.push({
        url: `${BASE_URL}/scoreboard/${date}/`,
        lastModified: now,
        changeFrequency: freq,
        priority: done ? 0.6 : 0.7,
      });
    }
    const gidx = await readArchiveIndex(season);
    for (const g of gidx?.games ?? []) {
      entries.push({
        url: `${BASE_URL}/games/${season}/${gameSlug(g.id, g.away.team, g.home.team)}/`,
        lastModified: now,
        changeFrequency: freq,
        priority: 0.5,
      });
    }
  }

  // /teams/<slug> — every team's latest-season landing page
  for (const slug of idx.teamSlugs) {
    entries.push({ url: `${BASE_URL}/teams/${slug}/`, lastModified: now, changeFrequency: "weekly", priority: 0.7 });
  }

  // /teams/<slug>/<year> — every team-season variant.
  const seenTeamYear = new Set<string>();
  for (const t of allTeams) {
    const slug = slugForTeam(t.name);
    const key = `${slug}|${t.year}`;
    if (seenTeamYear.has(key)) continue;
    seenTeamYear.add(key);
    entries.push({ url: `${BASE_URL}/teams/${slug}/${t.year}/`, lastModified: now, changeFrequency: "monthly", priority: 0.5 });
  }

  // The tab routes. MUST MATCH tabbedSeasonParams() EXACTLY — only some
  // team-seasons are prebuilt, and listing one the build did not emit would
  // be a sitemap full of 404s.
  for (const { slug, year } of await tabbedSeasonParams()) {
    for (const seg of ["games", "roster", "history", "shooting", "lineups", "on-off"]) {
      entries.push({ url: `${BASE_URL}/teams/${slug}/${year}/${seg}/`, lastModified: now, changeFrequency: "monthly", priority: 0.4 });
    }
  }

  // /players/<bartId> — long tail; lower priority but worth indexing
  for (const id of idx.playerIds) {
    entries.push({ url: `${BASE_URL}/players/${id}/`, lastModified: now, changeFrequency: "monthly", priority: 0.4 });
  }

  // /coaches/<slug> — every head coach we have history for
  for (const c of coaches) {
    entries.push({ url: `${BASE_URL}/coaches/${c.slug}/`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
  }

  return entries;
}

let cached: Promise<MetadataRoute.Sitemap> | null = null;
export function allSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  return (cached ??= build());
}

/** How many files the list splits into. At least one, even on an empty build. */
export async function sitemapCount(): Promise<number> {
  const all = await allSitemapEntries();
  return Math.max(1, Math.ceil(all.length / SITEMAP_CHUNK));
}
