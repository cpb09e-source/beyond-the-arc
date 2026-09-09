import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameClient } from "@/components/game/game-client";
import { archivedSeasons, gameSlug, idFromSlug } from "@/lib/scoreboard-archive";
import { minimalBundle, readArchiveIndex, shortDate, type ArchiveGame } from "@/lib/game-archive";

/**
 * /games/<season>/<id>-<away>-vs-<home>/ — one game of a completed season.
 *
 * THIS IS THE PAGE A SEARCH FOR THE SCORE SHOULD LAND ON. /game?id=… is one
 * HTML file that fetches everything after hydration, which is right for a
 * game that tips tomorrow and wrong for the 5,900 that are already final: a
 * crawler that arrives there reads "Loading the game…". This route gives every
 * archived game its own URL with the final score, the halves, the venue and
 * both records in the markup, a title that says who beat whom, and a
 * SportsEvent record for the machines. The full box score and play-by-play
 * still arrive from R2 once the page is open — 120 KB a game would be 700 MB
 * of HTML across the season, for a body a crawler does not need.
 *
 * The header is rendered from the SAME component and the SAME shape the full
 * bundle fills in, so nothing moves when it lands; only the tabs go from a
 * loading line to their content.
 */
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ season: string; slug: string }>> {
  const out: Array<{ season: string; slug: string }> = [];
  for (const s of archivedSeasons()) {
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
  const halves = g.home.periods.length >= 2 && g.away.periods.length >= 2
    ? ` Halves: ${g.away.periods.map((p, i) => `${p}-${g.home.periods[i]}`).join(", ")}.`
    : "";
  const where = g.neutral ? (g.venue ? ` at ${g.venue} (neutral site)` : " at a neutral site") : g.venue ? ` at ${g.venue}` : "";
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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <GameClient id={String(g.id)} date={g.date} initial={initial} />
    </>
  );
}
