"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dataUrl } from "@/lib/data-url";
import { isKnownSeason } from "@/lib/scoreboard-archive";

/**
 * The link to a game's page, from its id and season.
 *
 * WHY A LOOKUP RATHER THAN ARITHMETIC. The URL carries both team names, and
 * the only place those exact spellings live is CBBD's schedule. Everything
 * else on the site runs on the game LOGS, which spell teams differently —
 * "Morgan St" for "Morgan State", "Queens" for "Queens University", "IU Indy"
 * for "IU Indianapolis". Measured across 2025-26, composing a slug from log
 * names gets 41% of them wrong, and a wrong slug is a 404 rather than a near
 * miss. scripts/build-game-slugs.mjs writes the real answer; this fetches it.
 *
 * ONE FETCH PER SEASON, SHARED ACROSS CALLERS, AND ONLY ON DEMAND. A page
 * nobody scrolls never asks for a map. The promise rather than the result is
 * cached, so a table of thirty rows mounting together makes one request.
 *
 * SEASONS ARE REQUESTED, NOT DECLARED UP FRONT, because /calc can show games
 * from thirteen seasons at once and a team page shows one. Asking for a
 * season that has not loaded schedules it and re-renders when it lands, so a
 * caller just calls and renders whatever it gets.
 */

type SlugFile = { season: number; slugs: Record<string, string> };

/** Module-level so two components on one page share a season's map. */
const cache = new Map<number, Promise<Record<string, string>>>();

function load(season: number): Promise<Record<string, string>> {
  let p = cache.get(season);
  if (!p) {
    p = fetch(dataUrl(`/data/scoreboard/${season}/slugs.json`))
      .then((r) => (r.ok ? (r.json() as Promise<SlugFile>) : null))
      .then((j) => j?.slugs ?? {})
      .catch(() => {
        // Let a later mount retry a genuine network failure rather than
        // caching "no links on this page" for the rest of the session.
        cache.delete(season);
        return {};
      });
    cache.set(season, p);
  }
  return p;
}

/**
 * Returns `(season, id) => href | null`.
 *
 * null means "no link yet" — the map is still in flight, or the season
 * predates the archive. Callers render their previous, unlinked treatment in
 * that case, so a missing map degrades to plain text rather than a dead link.
 */
export function useGameLinks(): (season: number | null | undefined, id: number | string | null | undefined) => string | null {
  const [maps, setMaps] = useState<Record<number, Record<string, string>>>({});
  const asked = useRef(new Set<number>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  return useCallback((season, id) => {
    if (typeof season !== "number" || id == null || !isKnownSeason(season)) return null;
    const have = maps[season];
    if (!have) {
      // Request it once. Reading state during render is fine; the fetch is
      // started from a ref-guarded branch and only ever sets state later.
      if (!asked.current.has(season)) {
        asked.current.add(season);
        void load(season).then((m) => {
          if (alive.current) setMaps((prev) => (prev[season] ? prev : { ...prev, [season]: m }));
        });
      }
      return null;
    }
    // A game id can arrive as "214837-1234" from the logs, where the suffix
    // identifies the team's row. Only the leading number names the game.
    const gid = String(id).split("-")[0]!;
    const tail = have[gid];
    return tail ? `/games/${season}/${gid}-${tail}/` : null;
  }, [maps]);
}
