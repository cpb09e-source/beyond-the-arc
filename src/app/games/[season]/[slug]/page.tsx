import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameClient } from "@/components/game/game-client";
import { gameSlug, idFromSlug, isArchivedSeason, knownSeasons } from "@/lib/scoreboard-archive";
import { minimalBundle, readArchiveIndex, shortDate, type ArchiveGame } from "@/lib/game-archive";
import { gameTeamLinks } from "@/lib/game-team-links";

/**
 * /games/<season>/<id>-<away>-vs-<home>/ — one game, played or scheduled.
 *
 * THIS IS THE PAGE A SEARCH FOR THE SCORE SHOULD LAND ON. /game?id=… is one
 * HTML file that fetches everything after hydration, so a crawler arriving
 * there reads "Loading the game…". This route gives every game its own URL
 * with the teams, the venue and (once played) the final score and halves in
 * the markup, a title that says who beat whom, and a SportsEvent record for
 * the machines. The box score and play-by-play still arrive afterwards —
 * 120 KB a game would be 700 MB of HTML across a season, for a body a crawler
 * does not need.
 *
 * BUILT FROM THE FIXTURE LIST, NOT ONLY FROM RESULTS, and that is what makes a
 * season work without deploying every night. CBBD publishes the schedule weeks
 * ahead, so a game has an id — and therefore a page — long before it is
 * played. The page renders the matchup on the server, fetches the live score
 * while the game is on, and is rebuilt with the result baked in whenever the
 * archive is next run. The URL is identical throughout, so a link shared at
 * tip-off still resolves years later.
 *
 * The header is rendered from the SAME component and the SAME shape the full
 * bundle fills in, so nothing moves when it lands.
 */
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ season: string; slug: string }>> {
  const out: Array<{ season: string; slug: string }> = [];
  for (const s of knownSeasons()) {
    const idx = await readArchiveIndex(s);
    if (!idx) continue;
    for (const g of idx.games) out.push({ season: String(s), slug: gameSlug(g.id, g.away.team, g.home.team) });
  }
  return out;
}

async function lookup(season: string, slug: string): Promise<ArchiveGame | null> {
  const id = idFromSlug(slug);
  if (id === null) return null;
  const idx = await readArchiveIndex(Number(season));
  return idx?.byId.get(id) ?? null;
}

/** "North Carolina 71, Duke 68" — winner first, the way a result is spoken. */
function resultLine(g: ArchiveGame): string {
  const h = g.home, a = g.away;
  if (h.pts === null || a.pts === null) return `${a.team} at ${h.team}`;
  const [w, l] = h.winner ? [h, a] : [a, h];
  return `${w.team} ${w.pts}, ${l.team} ${l.pts}`;
}

export async function generateMetadata({ params }: { params: Promise<{ season: string; slug: string }> }): Promise<Metadata> {
  const { season, slug } = await params;
  const g = await lookup(season, slug);
  if (!g) return { title: "Game" };
  const when = shortDate(g.start);
  const where = g.neutral ? (g.venue ? ` at ${g.venue} (neutral site)` : " at a neutral site") : g.venue ? ` at ${g.venue}` : "";
  const played = g.home.pts !== null && g.away.pts !== null;
  // A GAME THAT HAS NOT HAPPENED MUST NOT CLAIM A SCORE. The page is built
  // from the fixture list weeks ahead, so until it is played the honest title
  // is the matchup and the date; the result replaces it at the next rebuild,
  // at the same URL.
  if (!played) {
    return {
      title: `${g.away.team} vs ${g.home.team} — ${when}`,
      description:
        `${g.away.team} vs ${g.home.team} men's college basketball, ${when}${where}. Live score, box score and play-by-play.`,
      alternates: { canonical: `/games/${season}/${slug}/` },
    };
  }
  const halves = g.home.periods.length >= 2 && g.away.periods.length >= 2
    ? ` Halves: ${g.away.periods.map((p, i) => `${p}-${g.home.periods[i]}`).join(", ")}.`
    : "";
  return {
    title: `${g.away.team} vs ${g.home.team} — ${resultLine(g)} · ${when}`,
    description:
      `Final score: ${resultLine(g)}. ${g.away.team} vs ${g.home.team} men's college basketball, ${when}${where}.${halves} Box score, player stats, four factors and play-by-play.`,
    alternates: { canonical: `/games/${season}/${slug}/` },
  };
}

export default async function ArchivedGamePage({ params }: { params: Promise<{ season: string; slug: string }> }) {
  const { season, slug } = await params;
  const g = await lookup(season, slug);
  if (!g) notFound();
  const initial = minimalBundle(g, Number(season));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${g.away.team} at ${g.home.team}`,
    sport: "Basketball",
    startDate: g.start,
    eventStatus: "https://schema.org/EventScheduled",
    ...(g.venue ? {
      location: {
        "@type": "Place",
        name: g.venue,
        ...(g.city ? { address: { "@type": "PostalAddress", addressLocality: g.city, ...(g.state ? { addressRegion: g.state } : {}) } } : {}),
      },
    } : {}),
    homeTeam: { "@type": "SportsTeam", name: g.home.team },
    awayTeam: { "@type": "SportsTeam", name: g.away.team },
    ...(g.home.pts !== null && g.away.pts !== null ? { description: `Final: ${resultLine(g)}` } : {}),
  };
  // A played game is finished and its file is final; a scheduled one has to
  // ask the live feed what is happening.
  const settled = isArchivedSeason(Number(season)) && g.home.pts !== null;

  /**
   * The box score's team and coach links, resolved HERE rather than in the
   * browser. CBBD's team spelling has to be reconciled against ours before a
   * /teams/ or /coaches/ URL can be built, and doing that at build time costs
   * the reader nothing and ships no lookup table. A team we cannot identify —
   * every D-II and D-III opponent on the schedule — comes back null and
   * renders as plain text, which is the correct answer for a school with no
   * page here. See src/lib/game-team-links.ts.
   */
  const links = await gameTeamLinks(g.home.team, g.away.team, Number(season));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <GameClient id={String(g.id)} date={g.date} initial={initial} live={!settled} links={links} />
    </>
  );
}
