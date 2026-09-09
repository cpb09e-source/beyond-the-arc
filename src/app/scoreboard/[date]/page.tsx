import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScoreboardClient } from "@/components/scoreboard/scoreboard-client";
import { archivedDays, isArchivedSeason, knownSeasons, seasonLabel, seasonOfDate } from "@/lib/scoreboard-archive";
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
  return knownSeasons().flatMap((s) => archivedDays(s).map((date) => ({ date })));
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  const slate = await readArchivedSlate(date);
  const n = slate?.games.length ?? 0;
  // A day that has not been played yet is a fixture list, and its title has
  // to say so — "Final scores from all 56 games" about tomorrow night would
  // be the page lying before anyone has read a word of it.
  if (!isArchivedSeason(seasonOfDate(date))) {
    return {
      title: `College Basketball Schedule — ${dateLabel(date)}, ${date.slice(0, 4)}`,
      description: n
        ? `All ${n} Division I men's college basketball games scheduled for ${dateLabel(date)}, ${date.slice(0, 4)}, with live scores once they tip.`
        : `College basketball schedule for ${dateLabel(date)}, ${date.slice(0, 4)}.`,
      alternates: { canonical: `/scoreboard/${date}/` },
    };
  }
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
  /**
   * A COMPLETED DAY IS FIXED; A SCHEDULED ONE IS NOT. The file for a night
   * already played can never change, so the client is told not to ask again.
   * The file for a night still to come holds fixtures and no scores, so the
   * page renders those for a crawler and then asks the live feed what is
   * actually happening.
   */
  const settled = isArchivedSeason(seasonOfDate(date));
  return (
    <ScoreboardClient
      initial={{ date, slate, fixed: settled }}
      seasonNote={settled ? `${seasonLabel(seasonOfDate(date))} season` : undefined}
    />
  );
}
