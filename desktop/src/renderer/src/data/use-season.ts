import { useCallback, useEffect, useState } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import type { SeasonSource } from "../../../preload";
import { shapeSeason, type Season } from "./team-model";

export type SeasonState =
  | { status: "loading"; year: number }
  | { status: "ready"; year: number; season: Season; source: SeasonSource; ms: number }
  | { status: "error"; year: number; reason: "gated" | "failed"; message: string };

type Loaded = { season: Season; source: SeasonSource; ms: number };

/**
 * Shaped seasons, kept for the life of the window. A frozen season never
 * changes, so there is nothing to invalidate: switching back to one is a map
 * lookup, not a reload.
 */
const loaded = new Map<number, Loaded>();

export function useSeason(year: number): [SeasonState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SeasonState>({ status: "loading", year });
  const hit = loaded.get(year);

  useEffect(() => {
    if (loaded.has(year)) return;
    let stale = false;
    const started = performance.now();
    window.bta
      .season("teams", year)
      .then(({ json, source }) => {
        const season = shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);
        const entry: Loaded = { season, source, ms: Math.round(performance.now() - started) };
        loaded.set(year, entry);
        if (!stale) setResult({ status: "ready", year, ...entry });
      })
      .catch((err: unknown) => {
        if (stale) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({
          status: "error",
          year,
          reason: message.includes("season-gated") ? "gated" : "failed",
          message,
        });
      });
    return () => {
      stale = true;
    };
  }, [year, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Read the cache during render, so a season already open shows on the same
  // frame it is picked. A result belonging to another year is never shown for
  // this one.
  if (hit) return [{ status: "ready", year, ...hit }, retry];
  if (result.year === year) return [result, retry];
  return [{ status: "loading", year }, retry];
}
