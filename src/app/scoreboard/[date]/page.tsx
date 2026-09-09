import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScoreboardClient } from "@/components/scoreboard/scoreboard-client";
import { archivedDays, archivedSeasons, seasonLabel, seasonOfDate } from "@/lib/scoreboard-archive";
import { readArchivedSlate } from "@/lib/game-archive";
import { dateLabel } from "@/lib/scoreboard";

/**
 * /scoreboard/<YYYY-MM-DD>/ — one day of a completed season, prerendered.
 *
 * A REAL PAGE PER DAY, NOT A QUERY STRING, because the scores are the point
 * and a crawler has to be able to read them. /scoreboard?date=… was one HTML
 * file that fetched its slate after hydration; this is 140-odd files a season
 * with every result in the markup, each with its own title, and each linked
 * from the sitemap. The same component renders both — ScoreboardClient takes
 * the slate as a prop here and fetches it there.
 *
 * Only days the sport played exist. The list comes from the committed index
 * scripts/build-scoreboard-archive.mts writes, and `dynamicParams = false`
 * turns anything else into a 404 rather than an empty page.
 */
export const dynamicParams = false;

export function generateStaticParams(): Array<{ date: string }> {
  return archivedSeasons().flatMap((s) => archivedDays(s).map((date) => ({ date })));
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  const slate = await readArchivedSlate(date);
  const n = slate?.games.length ?? 0;
  // The slate is ordered ranked-first, so the first few are the night's
  // headline results — the ones a searcher is most likely asking about.
  const top = (slate?.games ?? [])
    .filter((g) => g.home.points !== null && g.away.points !== null)
    .slice(0, 3)
    .map((g) => `${g.away.team} ${g.away.points}, ${g.home.team} ${g.home.points}`)
    .join("; ");
  return {
    title: `College Basketball Scores — ${dateLabel(date)}, ${date.slice(0, 4)}`,
    description: n
      ? `Final scores from all ${n} Division I men's college basketball games on ${dateLabel(date)}, ${date.slice(0, 4)}${top ? `: ${top}` : ""}. Box scores and play-by-play for every game.`
      : `College basketball scores for ${dateLabel(date)}, ${date.slice(0, 4)}.`,
    alternates: { canonical: `/scoreboard/${date}/` },
  };
}

export default async function ScoreboardDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const slate = await readArchivedSlate(date);
  if (!slate) notFound();
  return (
    <ScoreboardClient
      initial={{ date, slate, fixed: true }}
      seasonNote={`${seasonLabel(seasonOfDate(date))} season`}
    />
  );
}
