import { useCallback, useEffect, useState } from "react";
import type { Corpus, DataSource } from "../../../preload";

export type CorpusState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; source: DataSource; ms: number }
  | { status: "error"; reason: "gated" | "failed"; message: string };

type Loaded = { value: unknown; source: DataSource; ms: number };

/**
 * Shaped corpora, kept for the life of the window, keyed by corpus and season.
 *
 * A frozen season never changes, so there is nothing to invalidate: returning
 * to one is a map lookup, not a reload. The value stored is the SHAPED result,
 * so the parse and the shaping pass are paid once per file, not once per visit.
 */
const loaded = new Map<string, Loaded>();

/**
 * Load one corpus-season and shape it for a view.
 *
 * `shape` must be a module-level function. It is part of what a cached entry
 * means, and a closure recreated on every render would read as a new shape
 * without actually being one, so it is deliberately left out of the effect's
 * dependencies.
 */
export function useCorpus<T>(
  corpus: Corpus,
  year: number,
  shape: (json: string, year: number) => T,
): [CorpusState<T>, () => void] {
  const key = `${corpus}|${year}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: CorpusState<T> }>({
    key,
    state: { status: "loading" },
  });

  useEffect(() => {
    if (loaded.has(key)) return;
    let stale = false;
    const started = performance.now();
    window.bta
      .data(corpus, year)
      .then(({ json, source }) => {
        const entry: Loaded = { value: shape(json, year), source, ms: Math.round(performance.now() - started) };
        loaded.set(key, entry);
        if (!stale) setResult({ key, state: { status: "ready", ...(entry as { value: T; source: DataSource; ms: number }) } });
      })
      .catch((err: unknown) => {
        if (stale) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({
          key,
          state: { status: "error", reason: message.includes("season-gated") ? "gated" : "failed", message },
        });
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Read the cache during render, so something already open shows on the same
  // frame it is picked. A result belonging to another key is never shown.
  const hit = loaded.get(key) as { value: T; source: DataSource; ms: number } | undefined;
  if (hit) return [{ status: "ready", ...hit }, retry];
  if (result.key === key) return [result.state, retry];
  return [{ status: "loading" }, retry];
}

/** Where a file came from, in the words a person would use. */
export const SOURCE_LABEL: Record<DataSource, string> = {
  memory: "Already open",
  repo: "Read from the site's data folder",
  cache: "Read from this computer",
  network: "Downloaded from btacbb.xyz",
};
