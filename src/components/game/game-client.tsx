"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GameDetail } from "./game-detail";
import { isFinal, isLive, type GameBundle } from "./types";

/** Matches the function's live edge cache; polling faster only re-serves bytes. */
const POLL_MS = 60_000;
/**
 * A request that never answers must fail rather than hang. Without this the
 * page sits on "Loading the game…" indefinitely — no error, no retry, nothing
 * the reader can act on — which is strictly worse than saying it went wrong.
 */
const REQUEST_TIMEOUT_MS = 15_000;
/** One silent retry before showing an error. A cold function plus a dropped
 *  connection is common enough that the first failure is not worth a page. */
const RETRY_DELAY_MS = 1_500;

/**
 * /game?id=…&date=… — fetches one game from the Netlify function.
 *
 * The date is in the URL rather than looked up because CBBD's per-game
 * endpoints ignore a gameId filter and everything has to be scoped by a date
 * window (see netlify/functions/game.mts). Carrying it in the link also makes
 * a shared URL self-contained.
 *
 * POLLING IS CONDITIONAL, the same three ways the ticker's is: a final game
 * never polls, a hidden tab stops polling, and the interval matches the edge
 * cache. A completed game is the overwhelmingly common case and costs exactly
 * one request.
 */
export function GameClient() {
  const params = useSearchParams();
  const id = params.get("id");
  const date = params.get("date");
  const [bundle, setBundle] = useState<GameBundle | null>(null);
  const [failed, setFailed] = useState(false);

  // A link with no id or date can never resolve, so that is DERIVED during
  // render rather than set from inside the effect — setting state
  // synchronously in an effect body causes a cascading render, which is what
  // react-hooks/set-state-in-effect flags.
  const usable = Boolean(id && date);
  const state: "loading" | "ready" | "error" =
    !usable || failed ? "error" : bundle ? "ready" : "loading";

  // Mirrors the last good bundle so the poll loop can read it without taking
  // `bundle` as a dependency — that would tear the loop down and rebuild it on
  // every refresh. Written only from the fetch callback: assigning during
  // render is what react-hooks/refs-during-render forbids.
  const bundleRef = useRef<GameBundle | null>(null);

  useEffect(() => {
    if (!id || !date) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const load = async () => {
      // Abort on unmount OR on the timeout, whichever comes first.
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = typeof AbortSignal.any === "function"
        ? AbortSignal.any([ctrl.signal, timeout])
        : ctrl.signal;
      const res = await fetch(
        `/api/game?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`,
        { signal },
      );
      const j = await res.json();
      if (!res.ok || j?.error || !j?.game) throw new Error(j?.error ?? `HTTP ${res.status}`);
      return j as GameBundle;
    };

    const tick = async (attempt = 0) => {
      try {
        const j = await load();
        if (cancelled) return;
        bundleRef.current = j;
        setBundle(j);
        setFailed(false);
        // Keep asking only while there is something left to happen.
        if (!isFinal(j.game)) timer = setTimeout(() => void tick(), POLL_MS);
      } catch {
        if (cancelled) return;
        // A failed poll on a game we already hold keeps showing what we have.
        if (bundleRef.current) {
          if (!isFinal(bundleRef.current.game)) timer = setTimeout(() => void tick(), POLL_MS);
          return;
        }
        // Cold failure: one quiet retry before the reader sees anything.
        if (attempt === 0) {
          timer = setTimeout(() => void tick(1), RETRY_DELAY_MS);
          return;
        }
        setFailed(true);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") { if (timer) clearTimeout(timer); timer = undefined; return; }
      if (bundleRef.current && isFinal(bundleRef.current.game)) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, date]);

  if (state === "loading") {
    return <Shell><p className="text-ink-muted">Loading the game…</p></Shell>;
  }
  if (state === "error" || !bundle) {
    return (
      <Shell>
        <h1 className="font-display text-2xl text-ink mb-2">We couldn&rsquo;t load that game.</h1>
        <p className="text-ink-soft max-w-prose">
          The link needs both a game id and its date. Out of season there may be nothing to show at all.
        </p>
        <Link href="/scoreboard" className="inline-block mt-4 text-coral hover:underline">Back to the scoreboard</Link>
      </Shell>
    );
  }

  return (
    <>
      <GameDetail b={bundle} />
      {isLive(bundle.game) && (
        <p className="sr-only" role="status">Live game; the page refreshes every minute.</p>
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-20">{children}</div>;
}
