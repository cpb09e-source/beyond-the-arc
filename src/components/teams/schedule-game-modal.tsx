"use client";

/**
 * The team-page box score.
 *
 * A thin adapter over the shared modal — the same component /calc and the coach
 * pages render. This used to be a separate ~460-line implementation reading
 * /data/team-games/<year>/<gameId>.json, a directory of 76,895 files built from
 * CBB Analytics player game logs. That source is gone (docs/data-sources.md),
 * and keeping a second, plainer box-score renderer against a second data shape
 * is how the team pages and /calc ended up drawing the same game two different
 * ways.
 *
 * All that's left here is deriving the season from the game date. The pair
 * resolution lives in GameBoxModalById so every caller shares one copy.
 */

import { GameBoxModalById } from "@/components/box/game-box-modal";

/**
 * Deliberately minimal. Callers hold the NARROWER GameLog from
 * @/lib/static-data — a schedule ticker only needs enough to draw a strip —
 * so this takes the two fields needed to look the real row up rather than
 * forcing every call site to widen.
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
  if (!game.game_id) return null;
  return (
    <GameBoxModalById
      gameId={game.game_id}
      season={seasonOf(game.game_date)}
      onClose={onClose}
    />
  );
}
