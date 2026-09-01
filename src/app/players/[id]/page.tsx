import { notFound } from "next/navigation";
import { readPlayer, readRankedPlayerIds } from "@/lib/static-data";
import { loadPlayerPageData, fmtNum, fromEnd, seasonLabel } from "@/lib/player-page-data";
import { PlayerPageView } from "@/components/players/player-page-view";
import { LivePlayerPage } from "@/components/players/live-player-page";
import { isLiveSeason } from "@/lib/seasons";

export async function generateStaticParams() {
  // Only emit profile pages for ranked players. Unranked players (didn't
  // clear 18g/20mpg/5.3ppg + position bucket) get a 404 — their names render
  // as plain text everywhere else.
  const ranked = await readRankedPlayerIds();
  return [...ranked].map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bartId = Number(id);
  if (!Number.isFinite(bartId)) return { title: "Player not found" };
  const player = await readPlayer(bartId);
  if (!player || player.seasons.length === 0) return { title: "Player not found" };

  const current = player.seasons[0]!;
  const row = current.raw_row;
  const name = typeof row?.[0] === "string" ? row[0] : `Player ${bartId}`;
  const pts = fromEnd(row, 3);
  const reb = fromEnd(row, 7);
  const ast = fromEnd(row, 6);
  const seasonStr = seasonLabel(current.year);

  const lineParts: string[] = [];
  if (pts !== null) lineParts.push(`${fmtNum(pts, 1)} PPG`);
  if (reb !== null) lineParts.push(`${fmtNum(reb, 1)} RPG`);
  if (ast !== null) lineParts.push(`${fmtNum(ast, 1)} APG`);
  const statLine = lineParts.length > 0 ? lineParts.join(" · ") + ". " : "";
  const description = `${name} — ${current.team_name} ${seasonStr}. ${statLine}Full season stats, percentile rankings, and career history.`.trim();
  const ogTitle = `${name} · ${current.team_name}`;

  return {
    title: name,
    description,
    openGraph: {
      title: ogTitle,
      description,
      url: `/players/${bartId}/`,
      type: "profile",
    },
    twitter: { card: "summary_large_image", title: ogTitle, description },
    alternates: { canonical: `/players/${bartId}/` },
  };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bartId = Number(id);
  if (!Number.isFinite(bartId)) notFound();

  const data = await loadPlayerPageData(bartId);
  if (!data) notFound();

  /**
   * A player with a row in the season being PLAYED reads that page as data —
   * see src/lib/live-player-page.ts. `data` is still loaded and passed down: it
   * is the last build's numbers, what this page ships as HTML for crawlers, and
   * what stays on screen if the live file cannot be reached.
   *
   * Tested on the seasons, not on LIVE_SEASON alone: a career that ended in
   * 2019 never moves again and must not pay for a fetch.
   */
  if (data.player.seasons.some((s) => isLiveSeason(s.year))) {
    return <LivePlayerPage fallback={data} />;
  }
  return <PlayerPageView {...data} />;
}
