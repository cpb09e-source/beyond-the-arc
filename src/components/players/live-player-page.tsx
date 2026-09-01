"use client";

import { useEffect, useState } from "react";
import { PlayerPageView } from "@/components/players/player-page-view";
import { dataUrl } from "@/lib/data-url";
import { decodeLivePlayerPage, livePlayerPath, type LivePlayerBundle } from "@/lib/live-player-page";
import type { PlayerPageData } from "@/lib/player-page-data";

/**
 * A player page whose live season is fetched rather than baked.
 *
 * THE CLIENT ENTRY POINT, and the only reason this file exists. PlayerPageView
 * has no directive of its own, so importing it from here is what compiles a
 * client copy — the frozen pages go on importing the same component from a
 * Server Component and go on being prerendered. One renderer, two graphs.
 *
 * WHY EVERY PLAYER WITH A LIVE ROW, not only the ones being looked at during
 * the season: the inconsistency this fixes is between two pages, not within
 * one. Team pages already read live data, so Duke's roster row would show
 * tonight's line while Cooper Flagg's career table showed last week's, and a
 * reader clicking from one to the other would watch the number change.
 *
 * The page ships the last build's numbers as HTML and keeps them if the fetch
 * fails, for the reasons LiveTeamPage documents. The stale line is quieter
 * here — a career table that is a night behind is a much smaller problem than
 * a team page that is, because twelve of its thirteen rows are frozen anyway.
 */
export function LivePlayerPage({ fallback }: { fallback: PlayerPageData }) {
  const [data, setData] = useState<PlayerPageData>(fallback);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(dataUrl(livePlayerPath(fallback.bartId)))
      .then((r) => (r.ok ? (r.json() as Promise<LivePlayerBundle>) : null))
      .then((b) => {
        if (!live) return;
        if (b) setData(decodeLivePlayerPage(b));
        else setStale(true);
      })
      .catch(() => { if (live) setStale(true); });
    return () => { live = false; };
  }, [fallback.bartId]);

  return (
    <>
      {stale && (
        <p className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-3 text-[0.7rem] text-ink-muted">
          This season&rsquo;s line may be a day behind — live numbers are unavailable right now.
        </p>
      )}
      <PlayerPageView {...data} />
    </>
  );
}
