import { useEffect, useMemo, useState } from "react";
import { ALL_SEASONS } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { loadPlayerSeason, type Player } from "~/data/player-model";
import { shapeSeason, type Team } from "~/data/team-model";
import { loadOnce } from "~/data/use-corpus";
import type { Candidate } from "./similar-model";

/**
 * Every season's teams or players, read three seasons at a time.
 *
 * THE SAME CACHE AS THE TABLES (~/data/use-corpus.ts), under the same keys, so
 * a season the Team Explorer already opened is not read twice, and a season
 * read here opens at once there.
 */

export type Pool<R> = { rows: Candidate<R>[]; done: number; total: number; missing: number[] };

const loadTeams = (y: number): Promise<Candidate<Team>[]> =>
  loadOnce(`teams|${y}`, async () => {
    const { json, source } = await window.bta.data("teams", y);
    return { value: shapeSeason(y, JSON.parse(json) as StaticTeamSeasonRow[]), source };
  }).then((s) => s.teams.map((t) => ({ id: `${y}|${t.id}`, year: y, row: t })));

const loadPlayers = (y: number): Promise<Candidate<Player>[]> =>
  loadOnce(`player-season|${y}`, () => loadPlayerSeason(y)).then((s) => s.players.map((p) => ({ id: `${y}|${p.id}`, year: y, row: p })));

function usePool<R>(enabled: boolean, load: (y: number) => Promise<Candidate<R>[]>): Pool<R> {
  const [got, setGot] = useState<{ seasons: Map<number, Candidate<R>[]>; missing: number[] }>(() => ({ seasons: new Map(), missing: [] }));
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    const years = [...ALL_SEASONS];
    const next = async (): Promise<void> => {
      const y = years.shift();
      if (y == null || stale) return;
      try {
        const rows = await load(y);
        if (!stale) setGot((g) => ({ ...g, seasons: new Map(g.seasons).set(y, rows) }));
      } catch {
        // A season this account cannot read, or one that failed: matched without it, and said so.
        if (!stale) setGot((g) => ({ ...g, missing: g.missing.includes(y) ? g.missing : [...g.missing, y] }));
      }
      return next();
    };
    void Promise.all([next(), next(), next()]);
    return () => {
      stale = true;
    };
    // `load` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  const rows = useMemo(() => ALL_SEASONS.flatMap((y) => got.seasons.get(y) ?? []), [got.seasons]);
  return { rows, done: got.seasons.size + got.missing.length, total: ALL_SEASONS.length, missing: got.missing };
}

export const useTeamPool = (enabled: boolean): Pool<Team> => usePool(enabled, loadTeams);
export const usePlayerPool = (enabled: boolean): Pool<Player> => usePool(enabled, loadPlayers);
