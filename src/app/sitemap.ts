import type { MetadataRoute } from "next";
import { allSitemapEntries, sitemapCount, SITEMAP_CHUNK } from "@/lib/sitemap-entries";

// Required for Next 16 metadata routes under `output: "export"` — opts the
// generated file into the static export bundle. Without it the build errors.
export const dynamic = "force-static";

/**
 * The sitemap, split across several files.
 *
 * WHY IT IS SPLIT. Google rejects a sitemap above 50,000 URLs, and rejects it
 * whole — going over does not truncate, it discards. This site passed that on
 * the day the scoreboard archive landed: 25,474 players and ~11,000 team tab
 * routes were already most of the budget, and a page per game since 2014 adds
 * roughly 76,000 more.
 *
 * `generateSitemaps` writes /sitemap/0.xml, /sitemap/1.xml and so on. Next
 * does NOT emit an index naming them, so robots.txt lists every one — which is
 * a documented discovery mechanism and one fewer file to keep in step.
 *
 * The URL list itself lives in src/lib/sitemap-entries.ts because robots.ts
 * needs the same count, and building it twice would double a walk over every
 * team-season, player and game on disk.
 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  const n = await sitemapCount();
  return Array.from({ length: n }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  // Next 16 hands the id over as a promise that resolves to a STRING — see the
  // version history in generate-sitemaps.md. Treating it as a number would
  // slice from NaN and every file would come out empty.
  const n = Number(await id);
  const all = await allSitemapEntries();
  const start = n * SITEMAP_CHUNK;
  return all.slice(start, start + SITEMAP_CHUNK);
}
