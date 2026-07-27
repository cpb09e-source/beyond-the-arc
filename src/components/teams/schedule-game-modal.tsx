"use client";

/**
 * The team-page box score.
 *
 * A thin adapter over the shared modal in @/components/box/game-box-modal —
 * the same component the Win Calculator renders. This used to be a separate
 * ~460-line implementation reading /data/team-games/<year>/<gameId>.json, a
 * directory of 76,895 files built from CBB Analytics player game logs. That
 * source is gone (docs/data-sources.md), and keeping a second, plainer
 * box-score renderer against a second data shape is how the team pages and
 * /calc ended up showing the same game two different ways.
 *
 * The only real work left is finding the OPPONENT's row. The logs store one row
 * per team per game and every two-sided comparison in the box score needs the
 * pair, but a team page only holds its own schedule. loadGamesForYear() and
 * loadGameBox() are both module-cached and already used by /calc, so on most
 * navigations this resolves with no network round trip at all.
 */

import { useEffect, useState } from "react";
import { GameBoxModal } from "@/components/box/game-box-modal";
import { loadGamesForYear, type GameLog } from "@/lib/game-filters";
import { attachGameBox, loadGameBox } from "@/lib/game-box";
import { gameKey } from "@/lib/quad";

/**
 * Deliberately minimal. Callers hold the NARROWER GameLog from
 * @/lib/static-data (schedule tickers only need enough to draw a strip), while
 * the box score needs the full filter-layer row. Rather than force every caller
 * to widen, this takes the two fields needed to look the real row up and
 * re-reads it from the cached season log.
 */
type GameRef = { game_id?: string | null; game_date: string };

/** Season-end year for a game date: Nov-Dec belong to the next year's season. */
function seasonOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return (m ?? 1) >= 8 ? (y ?? 0) + 1 : (y ?? 0);
}

export function ScheduleGameModal({
  game,
  onClose,
}: {
  game: GameRef;
  /** Accepted for call-site compatibility; the modal reads names off the rows. */
  teamName?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ own: GameLog; opp: GameLog | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = gameKey(game.game_id);
    const season = seasonOf(game.game_date);
    if (!key) { setFailed(true); return; }

    Promise.all([loadGamesForYear(season), loadGameBox(season)])
      .then(([logs, box]) => {
        if (cancelled) return;
        // Both perspectives share the numeric game-id prefix. A non-D1 opponent
        // has no row of its own, so `opp` staying null here is a legitimate
        // outcome rather than a lookup failure.
        const pair = logs.filter((r) => gameKey(r.game_id) === key);
        const own = pair.find((r) => r.game_id === game.game_id) ?? pair[0];
        if (!own) { setFailed(true); return; }
        const opp = pair.find((r) => r.game_id !== own.game_id) ?? null;
        const withBox = attachGameBox(opp ? [own, opp] : [own], box);
        setRows({ own: withBox[0]!, opp: withBox[1] ?? null });
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [game]);

  if (failed) return null;

  // GameBoxModal owns its own loading/empty states once mounted, but it needs
  // the row pair to render anything at all.
  if (!rows) return null;
  return <GameBoxModal game={rows.own} opp={rows.opp} onClose={onClose} />;
}
