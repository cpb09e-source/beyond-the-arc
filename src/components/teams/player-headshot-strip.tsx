"use client";

import Link from "next/link";
import { PlayerPhoto } from "@/components/player-photo";

type RosterEntry = {
  id: number;
  bart_player_id: number | null;
  name: string;
  class: string | null;
};

/**
 * Visual roster strip — horizontal row of player headshots above the roster
 * table. Roster reads as a team (faces + names) before it reads as a
 * spreadsheet of stats. Falls back to PlayerPhoto's initials monogram when
 * there's no headshot. Click-and-drag scroll, hidden scrollbar — same
 * interaction model as the schedule ticker.
 */
export function PlayerHeadshotStrip({
  players,
  rankedPlayerIds,
}: {
  players: RosterEntry[];
  rankedPlayerIds: Set<number>;
}) {
  if (players.length === 0) return null;
  return (
    <div className="overflow-x-auto select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-start gap-4 min-w-min py-2">
        {players.map((p) => <Cell key={p.id} player={p} rankedPlayerIds={rankedPlayerIds} />)}
      </div>
    </div>
  );
}

function Cell({
  player,
  rankedPlayerIds,
}: {
  player: RosterEntry;
  rankedPlayerIds: Set<number>;
}) {
  const isLinkable = player.bart_player_id !== null && rankedPlayerIds.has(player.bart_player_id);
  const lastName = player.name.split(" ").slice(-1)[0] ?? player.name;
  const firstName = player.name.split(" ").slice(0, -1).join(" ") || player.name;

  const inner = (
    <span className="flex flex-col items-center gap-1.5 w-[64px] group">
      <PlayerPhoto bartPlayerId={player.bart_player_id} name={player.name} size={60} />
      <span className="flex flex-col items-center leading-tight text-center">
        <span className="text-[0.65rem] text-ink-muted leading-none">{firstName}</span>
        <span className="text-xs font-medium text-ink leading-tight">{lastName}</span>
        {player.class && (
          <span className="text-[0.6rem] text-ink-muted leading-none mt-0.5">{player.class}</span>
        )}
      </span>
    </span>
  );

  if (isLinkable && player.bart_player_id !== null) {
    return (
      <Link
        href={`/players/${player.bart_player_id}/`}
        className="shrink-0 rounded transition-colors hover:bg-[var(--accent-tint)] p-1 -m-1"
        title={player.name}
      >
        {inner}
      </Link>
    );
  }
  return <div className="shrink-0 p-1 -m-1" title={player.name}>{inner}</div>;
}
