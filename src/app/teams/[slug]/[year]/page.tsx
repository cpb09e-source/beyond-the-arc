import { notFound } from "next/navigation";
import { readTeam, readAllTeams } from "@/lib/static-data";
import { TeamPageView, PREVIEW_SEASON_YEAR, PREVIEW_SEASON_LABEL } from "@/components/teams/team-page-view";
import { LiveTeamPage } from "@/components/teams/live-team-page";
import { isLiveSeason } from "@/lib/seasons";
import { loadTeamPageData } from "@/lib/team-page-data";
import { isTabbedSeason } from "@/lib/team-tab-route";


function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Build (slug, year) for every team-season we have. Keeps the route fully
// statically pre-rendered alongside the bare /teams/<slug> route. Teams active
// in the most recent completed season also get a PREVIEW_SEASON_YEAR page
// (next-season preview — roster + projections hydrate client-side).
export async function generateStaticParams() {
  const all = await readAllTeams();
  const seen = new Set<string>();
  const out: Array<{ slug: string; year: string }> = [];
  let latest = 0;
  for (const t of all) latest = Math.max(latest, t.year);
  for (const t of all) {
    const slug = slugFor(t.name);
    const key = `${slug}|${t.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug, year: String(t.year) });
    if (t.year === latest && !seen.has(`${slug}|${PREVIEW_SEASON_YEAR}`)) {
      seen.add(`${slug}|${PREVIEW_SEASON_YEAR}`);
      out.push({ slug, year: String(PREVIEW_SEASON_YEAR) });
    }
  }
  return out;
}

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isFinite(year)) return { title: "Team season not found" };
  const team = await readTeam(slug);
  if (!team) return { title: "Team not found" };
  if (year === PREVIEW_SEASON_YEAR) {
    const description = `${team.name} ${PREVIEW_SEASON_LABEL} season preview — projected record, preseason T-Rank, and next season's roster.`;
    return {
      title: `${team.name} ${PREVIEW_SEASON_LABEL} Preview`,
      description,
      openGraph: { title: `${team.name} · ${PREVIEW_SEASON_LABEL} Preview`, description, url: `/teams/${slug}/${year}/`, type: "website" },
      twitter: { card: "summary_large_image", title: `${team.name} · ${PREVIEW_SEASON_LABEL} Preview`, description },
      alternates: { canonical: `/teams/${slug}/${year}/` },
    };
  }
  const current = team.seasons.find((s) => s.year === year);
  if (!current) return { title: "Team season not found" };

  const trank = current.team_trank_stats;
  const recordBit = trank?.record ? `${trank.record} ` : "";
  const confBit = current.conference ? ` (${current.conference})` : "";
  const seasonStr = seasonLabel(year);
  const description = `${team.name}${confBit} ${seasonStr} ${recordBit}— full season stats, roster, and advanced metrics.`.trim();

  return {
    title: `${team.name} ${seasonStr}`,
    description,
    openGraph: {
      title: `${team.name} · ${seasonStr}`,
      description,
      url: `/teams/${slug}/${year}/`,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: `${team.name} · ${seasonStr}`, description },
    alternates: { canonical: `/teams/${slug}/${year}/` },
  };
}

export default async function TeamSeasonPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isFinite(year)) notFound();

  const data = await loadTeamPageData(slug, year);
  if (!data) notFound();

  // A season with real tab routes renders one tab; one without renders every
  // section on this page, with the strip scrolling to anchors. Preview pages
  // are always the latter, and get no strip at all. See team-tab-route.ts.
  const tabbed = !data.preview && (await isTabbedSeason(slug, year));
  const tab = tabbed ? "overview" as const : "all" as const;

  /**
   * The live season is fetched, not baked — see src/lib/live-team-page.ts.
   * `data` is still loaded and passed down: it is the last build's numbers,
   * and it is both what this page ships as HTML for search engines and what
   * stays on screen if the live file cannot be reached.
   */
  if (isLiveSeason(year)) {
    return <LiveTeamPage slug={slug} fallback={data} tab={tab} />;
  }
  return <TeamPageView {...data} tab={tab} />;
}
