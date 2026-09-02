"use client";

import { useSyncExternalStore } from "react";
import { TAB_ANCHORS, type TeamTab } from "@/components/teams/team-tabs";

/**
 * Which team-page section the URL hash is pointing at.
 *
 * WHY useSyncExternalStore AND NOT AN EFFECT. Reading `location.hash` into
 * state from a useEffect does two bad things at once: it renders one frame
 * with the wrong tab and then corrects it — a visible flash of Overview on a
 * page opened at #shooting — and it trips `react-hooks/set-state-in-effect`,
 * which this project enforces. The store form has a server snapshot, so the
 * server and the first client render agree by construction and there is no
 * frame to flash. Same reasoning, same shape, as the admin shell's view state.
 *
 * THE SERVER SNAPSHOT IS "overview" AND THAT IS DELIBERATE. A hash is never
 * sent to the server, so it CANNOT be known during prerender; any other
 * default would be a guess that hydration then contradicts. Overview is also
 * the section the strip marks active in static HTML, so the two agree.
 */

const ANCHOR_TO_TAB = new Map<string, TeamTab>(
  (Object.entries(TAB_ANCHORS) as Array<[TeamTab, string]>).map(([tab, anchor]) => [anchor, tab]),
);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): TeamTab {
  const raw = window.location.hash.replace(/^#/, "");
  return ANCHOR_TO_TAB.get(raw) ?? "overview";
}

/** Constant identity, so the store never reports a change on the server. */
const SERVER_TAB: TeamTab = "overview";
const serverSnapshot = () => SERVER_TAB;

export function useHashTab(): TeamTab {
  return useSyncExternalStore(subscribe, readHash, serverSnapshot);
}
