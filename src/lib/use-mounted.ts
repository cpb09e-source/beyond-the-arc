"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to — the answer changes once, at hydration. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * "Has this rendered on the client yet?" — for portals and anything else that
 * needs `document`.
 *
 * REPLACES useState(false) + useEffect(() => setMounted(true), []), which was
 * in seven components and is the single most common way to trip
 * react-hooks/set-state-in-effect. That pattern works, but it renders twice on
 * purpose: once saying "not mounted", then an effect, then again saying
 * "mounted". useSyncExternalStore says the same thing in one pass, because it
 * is built for exactly this — a value the server and the client disagree about
 * at first paint.
 *
 * The subscribe function is a no-op: the answer flips once, when React
 * hydrates, and React re-renders then anyway.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}
