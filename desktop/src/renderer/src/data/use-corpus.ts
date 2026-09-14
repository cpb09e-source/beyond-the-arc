import { useCallback, useEffect, useMemo, useState } from "react";
import type { Corpus, DataSource } from "../../../preload";

export type CorpusState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; source: DataSource; ms: number }
  | { status: "error"; reason: "gated" | "failed"; message: string };

type Loaded = { value: unknown; source: DataSource; ms: number };

/**
 * Loaded, shaped values, kept for the life of the window, by key.
 *
 * A frozen season never changes, so there is nothing to invalidate: returning
 * to one is a map lookup, not a reload. The value stored is the SHAPED result,
 * so the parse and the shaping pass are paid once per season, not once per visit.
 */
const loaded = new Map<string, Loaded>();

/**
 * Load something once per key and keep it.
 *
 * `load` resolves to the shaped value and the source to report. It is read on
 * the first render for a key and deliberately not tracked afterwards: the key
 * is what a cached entry means, and a closure recreated every render would
 * otherwise look like a new request without being one.
 */
export function useLoaded<T>(
  key: string,
  load: () => Promise<{ value: T; source: DataSource }>,
): [CorpusState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: CorpusState<T> }>({
    key,
    state: { status: "loading" },
  });

  useEffect(() => {
    if (loaded.has(key)) return;
    let stale = false;
    const started = performance.now();
    load()
      .then(({ value, source }) => {
        const entry = { value, source, ms: Math.round(performance.now() - started) };
        loaded.set(key, entry);
        if (!stale) setResult({ key, state: { status: "ready", ...entry } });
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

/**
 * One corpus-season, shaped for a view. `shape` must be a module-level function
 * for the same reason `load` is not tracked above.
 */
export function useCorpus<T>(
  corpus: Corpus,
  year: number,
  shape: (json: string, year: number) => T,
): [CorpusState<T>, () => void] {
  return useLoaded(`${corpus}|${year}`, async () => {
    const { json, source } = await window.bta.data(corpus, year);
    return { value: shape(json, year), source };
  });
}

export type ManyState<T> = {
  /** Every key loaded so far, in the order asked for. */
  values: Array<{ key: string; value: T; source: DataSource; ms: number }>;
  /** Keys still on their way. */
  loading: string[];
  /** Keys that could not load, each with why. */
  failed: Array<{ key: string; reason: "gated" | "failed"; message: string }>;
};

/** How many keys load at once: a season of players is four files and a shaping pass. */
const MANY_AT_ONCE = 3;

/**
 * Several keys at once, for a table that spans seasons (the explorers with more
 * than one season picked).
 *
 * THE SAME CACHE AS useLoaded, so a season already open reads on the same frame
 * and one opened here opens at once anywhere else. The rest load three at a time.
 *
 * ONE FAILURE IS ONE KEY. A season this account cannot read, or one that failed,
 * is reported by itself, and the seasons that did load still show.
 *
 * The state object only changes when a key lands or fails, so a table can memo
 * on it without refiltering every render.
 */
export function useLoadedMany<T>(keys: readonly string[], load: (key: string) => Promise<{ value: T; source: DataSource }>): [ManyState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [landed, setLanded] = useState(0);
  const [failed, setFailed] = useState<ManyState<T>["failed"]>([]);
  const sig = keys.join(",");

  useEffect(() => {
    let stale = false;
    setFailed([]);
    const queue = keys.filter((k) => !loaded.has(k));
    const next = async (): Promise<void> => {
      const key = queue.shift();
      if (key == null || stale) return;
      const started = performance.now();
      try {
        const { value, source } = await load(key);
        loaded.set(key, { value, source, ms: Math.round(performance.now() - started) });
        if (!stale) setLanded((n) => n + 1);
      } catch (err) {
        if (!stale) {
          const message = err instanceof Error ? err.message : String(err);
          setFailed((f) => [...f, { key, reason: message.includes("season-gated") ? "gated" : "failed", message }]);
        }
      }
      return next();
    };
    void Promise.all(Array.from({ length: Math.min(MANY_AT_ONCE, queue.length) }, next));
    return () => {
      stale = true;
    };
    // `keys` is read through `sig`; `load` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const have = keys.filter((k) => loaded.has(k)).length;
  const state = useMemo<ManyState<T>>(() => {
    const values: ManyState<T>["values"] = [];
    const loading: string[] = [];
    for (const key of keys) {
      const hit = loaded.get(key);
      if (hit) values.push({ key, value: hit.value as T, source: hit.source, ms: hit.ms });
      else if (!failed.some((f) => f.key === key)) loading.push(key);
    }
    return { values, loading, failed: failed.filter((f) => keys.includes(f.key)) };
    // Recomputed when a key lands (`have`, `landed`) or fails, or the keys change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, have, landed, failed]);
  return [state, retry];
}

/**
 * The same cache, for a caller that needs several keys at once: Compare, with a
 * season per card. Shares entries with useLoaded and useCorpus under the same keys.
 */
export async function loadOnce<T>(key: string, load: () => Promise<{ value: T; source: DataSource }>): Promise<T> {
  const hit = loaded.get(key);
  if (hit) return hit.value as T;
  const started = performance.now();
  const { value, source } = await load();
  loaded.set(key, { value, source, ms: Math.round(performance.now() - started) });
  return value;
}

/** Where a file came from, in the words a person would use. */
export const SOURCE_LABEL: Record<DataSource, string> = {
  memory: "Already open",
  repo: "Read from the site's data folder",
  cache: "Read from this computer",
  network: "Downloaded from btacbb.xyz",
};
