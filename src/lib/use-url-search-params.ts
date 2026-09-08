"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * The URL's query string, without costing the page its prerender.
 *
 * WHY THIS EXISTS INSTEAD OF next/navigation's useSearchParams.
 *
 * On a static export, `useSearchParams()` cannot be answered at build time, so
 * Next renders the nearest Suspense boundary's FALLBACK into the HTML and the
 * real component only appears after hydration. The front page paid for that
 * twice over: a crawler indexed a 25-row preview instead of the table, and a
 * reader watched a simple table sit there for about a second and then be
 * replaced by a different one — new toolbar, new filter bar, band headings,
 * twelve columns, everything shifted down the page. It read as a fault.
 *
 * Nothing about the explorer actually needs the params DURING the server
 * render. It needs them on the client, and on the server it needs the same
 * answer a first-time visitor gets: none. That is exactly the shape
 * useSyncExternalStore is for — a server snapshot that differs from the client
 * one, handled without a hydration mismatch.
 *
 * So the page prerenders the real table with default filters, which is both
 * what most visitors are about to see anyway and a strictly better thing for
 * Google to index. A visitor who arrives WITH a query string still gets one
 * re-render, because the HTML cannot know their filters — but that is a
 * shared link, not the front door.
 *
 * WHY HISTORY IS PATCHED. `popstate` fires for the back button and nothing
 * else; the App Router's `router.replace` — which the explorer calls on every
 * filter, sort and page change — goes through `history.replaceState` silently.
 * Without hearing that, this hook would return a stale query string the moment
 * anyone touched a control. Patching the two methods to announce themselves is
 * the standard way to observe it, and it is done once, lazily, on the first
 * subscription.
 */

const EVENT = "bta:urlchange";
let patched = false;

function patchHistory() {
  if (patched || typeof history === "undefined") return;
  patched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function patchedMethod(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      /**
       * DEFERRED, and it has to be. The App Router updates history from
       * inside an insertion effect, so announcing the change synchronously
       * made every store subscriber schedule a render during that phase —
       * React answers with "useInsertionEffect must not schedule updates",
       * once per subscriber, on every sort click. A microtask runs after the
       * commit unwinds and before paint, so nothing is stale on screen.
       */
      queueMicrotask(() => window.dispatchEvent(new Event(EVENT)));
      return result;
    };
  }
}

function subscribe(onChange: () => void): () => void {
  patchHistory();
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const getSnapshot = () => window.location.search;
/** A build has no URL, and a first-time visitor has no query. Same answer. */
const getServerSnapshot = () => "";

/**
 * Drop-in for `useSearchParams()`. Returns a real URLSearchParams, which
 * carries the same `get` / `getAll` / `has` / `entries` / `toString` surface
 * the call sites use.
 */
export function useUrlSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => new URLSearchParams(search), [search]);
}
