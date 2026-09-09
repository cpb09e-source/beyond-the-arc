"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUrlSearchParams } from "@/lib/use-url-search-params";
import { dataUrl } from "@/lib/data-url";
import { gameBundleUrl, isArchivedSeason, seasonOfDate } from "@/lib/scoreboard-archive";
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
export function GameClient({
  id: idProp,
  date: dateProp,
  initial,
}: {
  /** Given by the static archive route; read from the URL otherwise. */
  id?: string;
  date?: string;
  /**
   * The scoreline, prerendered. An archived game page renders this on the
   * server so the result is in the HTML, then swaps in the full bundle — same
   * shape, same components, so only the tabs change when it lands.
   */
  initial?: GameBundle;
} = {}) {
  const params = useUrlSearchParams();
  const id = idProp ?? params.get("id");
  const date = dateProp ?? params.get("date");
  const [bundle, setBundle] = useState<GameBundle | null>(initial ?? null);
  const [failed, setFailed] = useState(false);

  // A link with no id or date can never resolve, so that is DERIVED during
  // render rather than set from inside the effect — setting state
  // synchronously in an effect body causes a cascading render, which is what
  // react-hooks/set-state-in-effect flags.
  const usable = Boolean(id && date);
  const state: "loading" | "ready" | "error" =
    bundle ? "ready" : !usable || failed ? "error" : "loading";
  /**
   * The header is real but the box score has not arrived.
   *
   * `failed` ends it either way: a prerendered page whose bundle never lands
   * must say so, not sit on "Loading the box score…" forever. The scoreline
   * above it is still true and still worth reading, so the page stays.
   */
  const partial = bundle === initial && initial !== undefined && !failed;
  const detailFailed = bundle === initial && initial !== undefined && failed;

  // Mirrors the last good bundle so the poll loop can read it without taking
  // `bundle` as a dependency — that would tear the loop down and rebuild it on
  // every refresh. Written only from the fetch callback: assigning during
  // render is what react-hooks/refs-during-render forbids.
  const bundleRef = useRef<GameBundle | null>(null);
  /**
   * A COMPLETED SEASON IS A STATIC FILE, NOT A FUNCTION CALL. Every game of
   * the archive was baked by scripts/build-scoreboard-archive.mts and lives on
   * R2, so opening one costs a CDN hit and nothing against the CBBD quota —
   * which is what lets 5,900 game pages be free and indexable. Only a game in
   * the season being played goes through /api/game.
   */
  const archived = Boolean(date) && isArchivedSeason(seasonOfDate(date!));

  useEffect(() => {
    if (!id || !date) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const load = async () => {
      // Abort on unmount OR on the timeout, whichever comes first.
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = typeof AbortSignal.any === "function"
        ? AbortSignal.any([ctrl.signal, timeout])
        : ctrl.signal;
      // Demo mode reads the one baked bundle, whatever id the URL carries —
      // every demo link points here anyway (see gameHref), and honoring a
      // hand-typed id would mean a CBBD call for a season that has no data.
      const res = await fetch(
        archived
          ? dataUrl(gameBundleUrl(seasonOfDate(date), Number(id)))
          : `/api/game?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`,
        { signal },
      );
      const j = await res.json();
      if (!res.ok || j?.error || !j?.game) throw new Error(j?.error ?? `HTTP ${res.status}`);
      return j as GameBundle;
    };

    const tick = async (attempt = 0) => {
      try {
        const j = await load();
        if (canceled) return;
        bundleRef.current = j;
        setBundle(j);
        setFailed(false);
        // Keep asking only while there is something left to happen.
        if (!isFinal(j.game)) timer = setTimeout(() => void tick(), POLL_MS);
      } catch {
        if (canceled) return;
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
      canceled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `archived` is derived from `date`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <Link href="/scoreboard" className="inline-block mt-4 text-coral hover:underline" prefetch={false}>Back to the scoreboard</Link>
      </Shell>
    );
  }

  return (
    <>
      <GameDetail b={bundle} partial={partial} detailFailed={detailFailed} />
      {isLive(bundle.game) && (
        <p className="sr-only" role="status">Live game; the page refreshes every minute.</p>
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[var(--page-narrow)] px-6 lg:px-10 pt-10 pb-20">{children}</div>;
}
