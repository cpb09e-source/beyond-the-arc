"use client";

import type { CSSProperties, ReactNode } from "react";
import { useHashTab } from "@/lib/use-hash-tab";
import { TeamTabBar, TeamBottomBar } from "@/components/teams/team-tabs";

/** The bars' own prop types, minus what these wrappers supply themselves. */
type TeamTabBarProps = React.ComponentProps<typeof TeamTabBar>;
type TeamBottomBarProps = React.ComponentProps<typeof TeamBottomBar>;

/**
 * The team page wrapper for a season that has no tab ROUTES.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 *
 * Only the most recent TABBED_SEASONS seasons get real routes; everything
 * older renders every section on one page and the strip scrolls rather than
 * switches. That is a build-cost decision and a sound one — measured from the
 * current export, a tabbed team-season costs 76 files against an untabbed
 * one's 10, so giving all 3,166 older team-seasons routes would add 208,956
 * files and roughly 43 minutes to a full deploy.
 *
 * But it made the site inconsistent in the one place a reader notices: the
 * same control behaves differently depending on how old the season is.
 *
 * ── WHAT THIS DOES INSTEAD ────────────────────────────────────────────────
 *
 * Sets `data-team-tab` on the wrapper and lets CSS hide the panes that are not
 * the active one (see globals.css). Costs zero pages and zero deploy time.
 *
 * THE SECTIONS STAY SERVER-RENDERED. They arrive as `children` — a client
 * component may receive server-rendered children as a prop without dragging
 * them across the boundary — so only this wrapper and the strip ship as client
 * code. TeamPageView itself is untouched and still prerenders.
 *
 * HIDING RATHER THAN NOT RENDERING is the point. Every section is in the HTML,
 * so Google still indexes the whole season exactly as it did before, the reader
 * downloads no more than they already did, and switching a tab costs no fetch
 * and no navigation. It is a display change over markup that was already there.
 *
 * NO-JS DEGRADES TO WHAT IT WAS. Without the attribute nothing is hidden and
 * the page is the long scroll it has always been, with anchors that work.
 */
export function AnchorTabShell({
  cssVars,
  children,
}: {
  cssVars: CSSProperties;
  children: ReactNode;
}) {
  const tab = useHashTab();
  return (
    <div className="team-accent" data-team-tab={tab} style={cssVars}>
      {children}
    </div>
  );
}

/**
 * The tab strips, in anchor mode, following the hash.
 *
 * WHY THEY ARE SEPARATE WRAPPERS AND NOT A PROP. The strips render deep inside
 * TeamPageView, which stays a server component — there is no way to hand them
 * state from the shell above without dragging the whole page across the client
 * boundary. Each reads the same hash independently, which is not duplication of
 * truth: useSyncExternalStore is subscribed to one browser value, so the shell
 * and both strips cannot disagree.
 *
 * Importing TeamTabBar here compiles a client copy of it. The strip is small
 * and its links still render in the HTML, so nothing is lost to SEO or to a
 * reader with JS off — they just get the anchors that already worked.
 */
export function AnchorTabBar(props: Omit<TeamTabBarProps, "active" | "mode">) {
  const tab = useHashTab();
  return <TeamTabBar {...props} active={tab} mode="anchors" />;
}

export function AnchorBottomBar(props: Omit<TeamBottomBarProps, "active" | "mode">) {
  const tab = useHashTab();
  return <TeamBottomBar {...props} active={tab} mode="anchors" />;
}
