"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { TeamGamesClient } from "@/components/games/team-games-client";

/**
 * The team page's Game Log section — the explorer, scoped to this team-season.
 *
 * WHY THIS FILE EXISTS AT ALL, given it renders one component: the fetch.
 *
 * It used to be a big one. The table's corpus was the whole season's
 * /data/team-game-index/<year>.json — about 1.6 MB to draw thirty rows,
 * because the percentile chips are ranked against every game in the season and
 * the client could only do that by holding the season. In scoped mode it now
 * reads /data/team-season-games/<year>/<slug>.json instead, about 9 KB, with
 * the ranking already done over the same cohort. See loadTeamSeasonGames.
 *
 * The lazy mount survives that, and is worth keeping for the reason it was
 * built: half the team pages have no tab routes, so those seasons render all
 * seven sections as one scroll (see team-tab-route.ts) and this one sits three
 * screens below the fold where most readers never reach it. 9 KB is cheap, but
 * it is not free, and neither is the work of mounting a table nobody looks at.
 *
 * So the client is mounted on approach rather than on render. In route mode
 * the section is the top of the page and the observer fires on the first
 * frame, which is indistinguishable from mounting directly. In anchor mode it
 * fires when the reader scrolls to it, or immediately if they arrived on the
 * #game-log anchor. Either way the request happens because somebody is about
 * to look at the table.
 *
 * 400px OF ROOT MARGIN, AND THAT NUMBER WAS MEASURED. A full viewport, which
 * is the reflex, does not work here: the section is second of seven, and on a
 * one-page 2016 team page it starts at y=1703 against a 900px window — so a
 * 900px margin has it intersecting at scroll position zero and the "lazy"
 * fetch fires on every page load, which is the whole thing this was for. 400px
 * puts the trigger at roughly half a screen of scrolling, far enough that a
 * reader who bounces never pays for it and close enough that the table is
 * usually populated before it arrives.
 *
 * In route mode the section is at the top of the page, so it intersects on the
 * first frame at any margin.
 */
export function TeamGameLogSection({
  slug,
  season,
  basePath,
}: {
  slug: string;
  season: number;
  /** This page's own path — where sort links and filter edits write. */
  basePath: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (an old browser, or a test renderer) means the
    // section loads eagerly. Degrading to "fetches too early" is right; the
    // alternative degrades to a table that never appears.
    //
    // Through a timer rather than a bare setNear(true): setting state in the
    // body of an effect cascades a second render before paint, and the initial
    // state cannot answer this either — `IntersectionObserver` is undefined
    // during the prerender and defined on the client, so a useState
    // initializer that read it would hydrate to a different tree than it
    // rendered.
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <div ref={ref}>
      {near ? (
        // TeamGamesClient keeps its whole state in useSearchParams, which a
        // static export requires inside a Suspense boundary — same reason the
        // explorer page wraps it.
        <Suspense fallback={<Placeholder />}>
          <TeamGamesClient scope={{ slug, season, basePath }} />
        </Suspense>
      ) : (
        <Placeholder />
      )}
    </div>
  );
}

/**
 * A box the size of the table, so the page does not jump when it arrives.
 *
 * Not a skeleton with fake rows: the row count is unknown until the season
 * loads, and a shimmering approximation of a table is a worse promise than an
 * honest empty frame with the word on it.
 */
function Placeholder() {
  return (
    <div className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md ring-0 lg:ring-1 ring-ink/5 h-80 flex items-center justify-center">
      <span className="text-ink-muted text-sm">Loading game log…</span>
    </div>
  );
}
