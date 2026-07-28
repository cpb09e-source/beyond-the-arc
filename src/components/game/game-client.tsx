"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GameDetail } from "./game-detail";
import { isFinal, isLive, type GameBundle } from "./types";

/** Matches the function's live edge cache; polling faster only re-serves bytes. */
const POLL_MS = 60_000;

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

    const tick = async () => {
      try {
        const res = await fetch(`/api/game?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`, { signal: ctrl.signal });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || j?.error || !j?.game) { setFailed(true); return; }
        bundleRef.current = j as GameBundle;
        setBundle(j as GameBundle);
        setFailed(false);
        // Keep asking only while there is something left to happen.
        if (!isFinal(j.game)) timer = setTimeout(tick, POLL_MS);
      } catch {
        // A failed poll on a game we already have keeps showing what we have;
        // only a cold failure is an error state.
        if (!cancelled && !bundleRef.current) setFailed(true);
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
