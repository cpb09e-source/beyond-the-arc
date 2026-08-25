import { notFound } from "next/navigation";
import { readPlayersForYear, readImpactForYear, readImpactExtrasForYear, readTeam, readAllTeams, netRanksForTeam, readTeamSplits, readRankedPlayerIds, readConfRecordsByTeam, readGameLogsForYear, readAssistNetwork, readClockSplits } from "@/lib/static-data";
import { TeamPageView, buildRoster, attachRosterRanks, PREVIEW_SEASON_YEAR, PREVIEW_SEASON_LABEL } from "@/components/teams/team-page-view";
import { buildShootingRanks, buildFourFactorRanks } from "@/components/teams/distribution-panel";
import { loadTournamentGames, buildGamesByTeamYear, gamesForTeamYear } from "@/lib/coaches";

// Same SHORT_ROUND mapping the coach page uses for tournament-round badges,
// so a March-Madness game in the schedule ticker reads as "R1 / R2 / S16…"
// matching the coach-resume tickers.
const SHORT_ROUND: Record<string, string> = {
  "First Four": "FF",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "NC",
  "Champion": "NC",
};

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

  const team = await readTeam(slug);
  if (!team) notFound();

  // Next-season preview — renders the last-completed-season layout with the
  // game-dependent sections blurred (no 2026-27 games played yet). We hand
  // TeamPageView the most-recent completed season for structure + the projected
  // record/T-Rank for the hero.
  const isPreview = year === PREVIEW_SEASON_YEAR;
  const effYear = isPreview ? (team.seasons[0]?.year ?? year) : year;

  const current = team.seasons.find((s) => s.year === effYear);
  if (!current) notFound();

  const rosterPool = await readPlayersForYear(effYear);
  const epmByBart = await readImpactForYear(effYear);
  const extrasByBart = await readImpactExtrasForYear(effYear);
  const rosterBase = buildRoster(rosterPool, current.id, effYear, epmByBart, extrasByBart);
  const rankedPlayerIds = await readRankedPlayerIds();
  const roster = attachRosterRanks(rosterBase, current.roster_ranks);
  const confRecordsAll = await readConfRecordsByTeam();
  const confRecords = confRecordsAll.get(team.name) ?? new Map();
  const allTeams = await readAllTeams();
  // Headline badge + the five-year average both read aNET position in D-I.
  const netRanks = netRanksForTeam(allTeams, team.name, team.seasons.map((s) => s.year));
  // Eight-way stat splits for the season on screen. Season file is read once
  // and cached, so all ~365 team pages for a year share one parse.
  const teamSplits = await readTeamSplits(effYear, team.name);
  const assistNetwork = await readAssistNetwork(effYear, team.name);
  const clockSplits = await readClockSplits(effYear, team.name);
  const yearCohort = allTeams.filter((t) => t.year === effYear);
  const shootingRanks = buildShootingRanks(current, yearCohort);
  const fourFactorRanks = buildFourFactorRanks(current, yearCohort);
  const allGames = await readGameLogsForYear(effYear);
  // Tag any of this team's games that match a March Madness date so the
  // ticker shows the round (R1, S16, NC, etc.) above the W/L pill.
  const tourneyGamesAll = await loadTournamentGames();
  const tourneyLookup = buildGamesByTeamYear(tourneyGamesAll);
  const teamTourneyGames = gamesForTeamYear(tourneyLookup, team.name, effYear);
  const roundByDate = new Map<string, string>();
  for (const tg of teamTourneyGames) {
    if (!tg.date) continue;
    roundByDate.set(tg.date, SHORT_ROUND[tg.round] ?? tg.round);
  }
  const scheduleGames = allGames
    // Join on name, NOT id. The CBBD migration re-keyed game_logs.team_id to
    // CBBD's ids while team/*.json kept the bart id (Florida: 87 vs 3228), so
    // `g.team_id === current.id` matched nothing and the ticker silently
    // rendered as absent rather than broken. Names are exact across both
    // exports — checked all 2,158 team-seasons, zero unmatched. Same rule
    // find-game-trigger already follows.
    .filter((g) => g.team_name === team.name)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""))
    .map((g) => {
      const round = g.game_date ? roundByDate.get(g.game_date) : undefined;
      return round ? { ...g, tournamentRound: round } : g;
    });

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
      netRanks={netRanks}
      teamSplits={teamSplits}
      assistNetwork={assistNetwork}
      clockSplits={clockSplits}
      preview={isPreview}
    />
  );
}
