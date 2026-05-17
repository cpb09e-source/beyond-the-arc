import { notFound } from "next/navigation";
import { readIndex, readPlayersForYear, readTeam, readAllTeams } from "@/lib/static-data";
import { TeamPageView, buildRoster } from "@/components/teams/team-page-view";

function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Build (slug, year) for every team-season we have. Keeps the route fully
// statically pre-rendered alongside the bare /teams/<slug> route.
export async function generateStaticParams() {
  const all = await readAllTeams();
  const seen = new Set<string>();
  const out: Array<{ slug: string; year: string }> = [];
  for (const t of all) {
    const slug = slugFor(t.name);
    const key = `${slug}|${t.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug, year: String(t.year) });
  }
  return out;
}

export default async function TeamSeasonPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isFinite(year)) notFound();

  const team = await readTeam(slug);
  if (!team) notFound();

  const current = team.seasons.find((s) => s.year === year);
  if (!current) notFound();

  const rosterPool = await readPlayersForYear(year);
  const roster = buildRoster(rosterPool, current.id, year);

  return <TeamPageView team={team} current={current} roster={roster} slug={slug} />;
}
