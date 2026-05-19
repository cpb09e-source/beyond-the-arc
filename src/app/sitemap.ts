import type { MetadataRoute } from "next";
import { readIndex, readAllTeams } from "@/lib/static-data";
import { loadAllCoachProfiles } from "@/lib/coaches";

// Required for Next 16 metadata routes under `output: "export"` — opts the
// generated file into the static export bundle. Without it the build errors.
export const dynamic = "force-static";

/**
 * Generates /sitemap.xml at build time. Covers every static URL we serve:
 *
 *   /, /players, /teams, /coaches, /portal, /calc
 *   /teams/<slug>                  — one per D-I team
 *   /teams/<slug>/<year>           — one per team-season
 *   /players/<bartId>              — one per player (~27k)
 *   /coaches/<slug>                — one per head coach (~800)
 *
 * NEXT_PUBLIC_SITE_URL lets us swap to a custom domain later without a
 * code change. Falls back to the Netlify default.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app").replace(/\/$/, "");

function slugForTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const idx = await readIndex();
  const allTeams = await readAllTeams();
  const coaches = await loadAllCoachProfiles();

  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();

  // Top-level pages — high priority, weekly refresh
  for (const path of ["", "/players", "/teams", "/coaches", "/portal", "/calc"]) {
    entries.push({
      url: `${BASE_URL}${path}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: path === "" ? 1.0 : 0.8,
    });
  }

  // /teams/<slug> — every team's latest-season landing page
  for (const slug of idx.teamSlugs) {
    entries.push({
      url: `${BASE_URL}/teams/${slug}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // /teams/<slug>/<year> — every team-season variant. Dedupe in case
  // readAllTeams ever returns multiple rows for the same (slug, year).
  const seenTeamYear = new Set<string>();
  for (const t of allTeams) {
    const slug = slugForTeam(t.name);
    const key = `${slug}|${t.year}`;
    if (seenTeamYear.has(key)) continue;
    seenTeamYear.add(key);
    entries.push({
      url: `${BASE_URL}/teams/${slug}/${t.year}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  // /players/<bartId> — long tail; lower priority but worth indexing
  for (const id of idx.playerIds) {
    entries.push({
      url: `${BASE_URL}/players/${id}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    });
  }

  // /coaches/<slug> — every head coach we have history for
  for (const c of coaches) {
    entries.push({
      url: `${BASE_URL}/coaches/${c.slug}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
