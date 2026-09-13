import { useCallback } from "react";
import { isKnownDay, seasonOfDate } from "@/lib/scoreboard-archive";
import { useShell } from "~/shell/shell-context";
import { useToast } from "~/ui/toast";
import { gameRecord, loadSlate, loadTeamNames, sideOf } from "~/views/scoreboard/board-model";
import type { GameRecord, How } from "~/views/game/game-model";

/**
 * From a game log row to its game page.
 *
 * THE LOGS CARRY NO GAME ID. A team or player log row is (date, team, opponent),
 * and the id lives on that night's slate, so a row finds its game by looking:
 * the slate for its date, the game one side of which is the row's team.
 *
 * MEASURED ON EVERY TEAM ROW, 2014 TO 2026: about 95% of rows find their game on
 * the same date, and where the opponent could be named the game found was always
 * the right one. The rest fall on nights the slate itself is short (the archive
 * holds 23 of the games played on 2025-11-06, for one), so a miss is a gap in
 * the slate rather than a wrong match. A game played a day either side of the
 * log's date (2020-21 moved plenty) counts only when the opponent agrees too.
 *
 * Nothing here is new data: the slate and the name bridge are the Scoreboard's,
 * loaded into the same cache under the same keys.
 */

const DAY_MS = 86_400_000;

/** A log row's day offset as the slate's date. */
export const logDate = (epochMs: number, offset: number): string => new Date(epochMs + offset * DAY_MS).toISOString().slice(0, 10);

const shift = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export async function findGame(date: string, team: string, opp: string): Promise<GameRecord | null> {
  const names = await loadTeamNames();
  for (const off of [0, -1, 1]) {
    const day = shift(date, off);
    if (!isKnownDay(day)) continue;
    const slate = await loadSlate(day).catch(() => null);
    for (const g of slate?.games ?? []) {
      const away = sideOf(names, g.away.team).ours;
      const home = sideOf(names, g.home.team).ours;
      if (away !== team && home !== team) continue;
      const other = away === team ? home : away;
      // Same night: the team alone places it, unless the other side is a school
      // we know and it is not this opponent. Another night: both must agree.
      if (other === opp || (off === 0 && other === null)) return gameRecord(seasonOfDate(day), g, names);
    }
  }
  return null;
}

/**
 * Open a log row's game, or, when the slate does not have it, whatever the row
 * opened before this existed, with a word about why.
 */
export function useOpenGame(): (row: { date: string; team: string; opp: string }, how: Partial<How>, fallback: () => void) => void {
  const { openRecord } = useShell();
  const toast = useToast();
  return useCallback(
    (row, how, fallback) => {
      void findGame(row.date, row.team, row.opp).then((record) => {
        if (record) {
          openRecord(record, { newTab: how.newTab, side: how.side });
          return;
        }
        fallback();
        toast({ title: "No box score for this game", body: `The archive's slate for that night does not list ${row.team} against ${row.opp}.` });
      });
    },
    [openRecord, toast],
  );
}
