"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BoxscoreModal } from "./boxscore-modal";
import { GameBoxModalById } from "@/components/box/game-box-modal";

/**
 * Client wrapper rendering a clickable `<tr>` that opens a box score. Children
 * are the row's `<td>` cells. A row with no `gameSlug` renders static, with no
 * click handler.
 *
 * WHICH MODAL OPENS: the shared one (the same component /calc and the team pages
 * render) whenever this game resolves to one of ours, and the older
 * Sports-Reference renderer otherwise.
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
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  // Resolved on open rather than on mount: a coach page renders dozens of these
  // rows and none of them need the map until someone actually clicks one.
  useEffect(() => {
    if (!open || resolved || !gameSlug) return;
    let cancelled = false;
    loadTournamentIds().then((map) => {
      if (cancelled) return;
      setGameId(map[`${year}/${gameSlug}`] ?? null);
      setResolved(true);
    });
    return () => { cancelled = true; };
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
      {open && resolved && gameId && (
        <GameBoxModalById gameId={gameId} season={year} onClose={() => setOpen(false)} />
      )}
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
