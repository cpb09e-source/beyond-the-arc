import { notFound } from "next/navigation";
import { readPlayersForYear, readTeam, readAllTeams, readRankedPlayerIds, readConfRecordsByTeam, readGameLogsForYear, readAllPlayerRanks } from "@/lib/static-data";
import { TeamPageView, buildRoster, attachRosterRanks } from "@/components/teams/team-page-view";
import { buildShootingRanks, buildFourFactorRanks } from "@/components/teams/distribution-panel";

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

  const team = await readTeam(slug);
  if (!team) notFound();

  const current = team.seasons.find((s) => s.year === year);
  if (!current) notFound();

  const rosterPool = await readPlayersForYear(year);
  const rosterBase = buildRoster(rosterPool, current.id, year);
  const rankedPlayerIds = await readRankedPlayerIds();
  const allPlayerRanks = await readAllPlayerRanks();
  const roster = attachRosterRanks(rosterBase, allPlayerRanks, year);
  const confRecordsAll = await readConfRecordsByTeam();
  const confRecords = confRecordsAll.get(team.name) ?? new Map();
  const allTeams = await readAllTeams();
  const yearCohort = allTeams.filter((t) => t.year === year);
  const shootingRanks = buildShootingRanks(current, yearCohort);
  const fourFactorRanks = buildFourFactorRanks(current, yearCohort);
  const allGames = await readGameLogsForYear(year);
  const scheduleGames = allGames
    .filter((g) => g.team_id === current.id)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""));

  return (
    <TeamPageView
      team={team}
      current={current}
      roster={roster}
      slug={slug}
      rankedPlayerIds={rankedPlayerIds}
      confRecords={confRecords}
      shootingRanks={shootingRanks}
      fourFactorRanks={fourFactorRanks}
      scheduleGames={scheduleGames}
    />
  );
}
