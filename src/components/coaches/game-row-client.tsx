"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BoxscoreModal } from "./boxscore-modal";
import { useGameLinks } from "@/lib/game-link";

/**
 * Client wrapper rendering a clickable `<tr>` that opens a box score. Children
 * are the row's `<td>` cells. A row with no `gameSlug` renders static, with no
 * click handler.
 *
 * WHERE A CLICK GOES: to that game's own page — /games/<season>/<id>-<away>-
 * vs-<home>/ — whenever the game resolves to one of ours, and to the older
 * Sports-Reference modal otherwise. It used to open our box score in a modal;
 * the page has the same box score plus play-by-play and four factors, at a URL
 * that can be shared and indexed.
 *
 * The two sources share no id. The coach pages are driven by SR scrapes in
 * public/data/tournament-box/, keyed by slugs like
 * "2019-03-21-12-louisiana-state"; our logs are keyed by CBBD game id.
 * scripts/build-tournament-game-ids.mjs resolves the two OFFLINE on
 * (date, team, score) and emits the lookup this component reads — 755 of 818
 * box scores, which is 63/63 for every season from 2014 on. The 63 misses are
 * all 2013, which predates our data floor.
 *
 * That matching deliberately does not happen at runtime. A team name that
 * resolved slightly wrong would silently open a DIFFERENT game's box score,
 * which is worse than an inconsistent style — so it is verified once at build
 * time, and anything unmatched keeps the old modal.
 */

// One fetch per page session, shared by every row. Resolves to an empty map on
// failure, so a missing file just means every row falls back to the SR modal.
let _idMap: Record<string, string> | null = null;
let _idMapFetch: Promise<Record<string, string>> | null = null;
function loadTournamentIds(): Promise<Record<string, string>> {
  if (_idMap) return Promise.resolve(_idMap);
  if (_idMapFetch) return _idMapFetch;
  _idMapFetch = fetch("/data/tournament-game-ids.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: Record<string, string>) => { _idMap = j; return j; })
    .catch(() => ({}));
  return _idMapFetch;
}

/**
 * Navigate once the id and the slug map have both landed.
 *
 * A component rather than an effect in the parent because it must run only
 * while a resolved click is outstanding, and unmount the moment it has.
 * A null href means the season has no pages, which cannot happen for a game
 * the id map matched — but if it ever did, nothing happens rather than a
 * navigation to a 404.
 */
function GoToGame({ href, onGo }: { href: string | null; onGo: (href: string) => void }) {
  useEffect(() => {
    if (href) onGo(href);
  }, [href, onGo]);
  return null;
}

export function GameRowTr({
  children,
  year,
  gameSlug,
  sportsRefHref,
  title,
}: {
  children: ReactNode;
  year: number;
  gameSlug: string | null;
  sportsRefHref: string;
  title: string;
}) {
  const router = useRouter();
  const gameLink = useGameLinks();
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  // Resolved on open rather than on mount: a coach page renders dozens of these
  // rows and none of them need the map until someone actually clicks one.
  useEffect(() => {
    if (!open || resolved || !gameSlug) return;
    let canceled = false;
    loadTournamentIds().then((map) => {
      if (canceled) return;
      setGameId(map[`${year}/${gameSlug}`] ?? null);
      setResolved(true);
    });
    return () => { canceled = true; };
  }, [open, resolved, year, gameSlug]);

  if (!gameSlug) {
    return (
      <tr title={title} className="border-b border-hairline/40 last:border-0">
        {children}
      </tr>
    );
  }

  return (
    <>
      <tr
        onClick={() => setOpen(true)}
        title={title}
        className="border-b border-hairline/40 last:border-0 cursor-pointer hover:bg-paper-deep/40 transition-colors"
      >
        {children}
      </tr>
      {/* Resolved to one of ours: leave for its page rather than opening
          anything. Rendered as an effect-free branch because the id only
          arrives after the click that asked for it. */}
      {open && resolved && gameId && <GoToGame href={gameLink(year, gameId)} onGo={(h) => { setOpen(false); router.push(h); }} />}
      {open && resolved && !gameId && (
        <BoxscoreModal
          open
          onClose={() => setOpen(false)}
          year={year}
          gameSlug={gameSlug}
          sportsRefHref={sportsRefHref}
        />
      )}
    </>
  );
}
