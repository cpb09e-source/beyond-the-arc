"use client";

import { useEffect, useState } from "react";
import { TeamPageView } from "@/components/teams/team-page-view";
import { dataUrl } from "@/lib/data-url";
import { decodeLiveTeamPage, liveTeamPath, type LiveTeamBundle } from "@/lib/live-team-page";
import type { TeamPageData } from "@/lib/team-page-data";

/**
 * The live season's team page: the same page, fetched instead of baked.
 *
 * THE CLIENT ENTRY POINT, and the only reason this file exists. TeamPageView
 * has no directive of its own, so importing it from here is what compiles a
 * client copy of it — the frozen routes go on importing the very same
 * component from a Server Component and go on rendering it on the server. One
 * renderer, two graphs. See live-team-page.ts for why that mattered more than
 * the bundle it costs.
 *
 * WHAT THE PAGE SHIPS AS HTML. Whatever was true at the last build, passed in
 * as `fallback` — so this is not a spinner-first page. The prebuilt markup is
 * complete and correct as of that build, Google indexes it, and the fetch
 * replaces it a moment later with tonight's numbers. A page that rendered
 * nothing until the fetch landed would trade a stale number for no number,
 * which is the worse of the two.
 *
 * A FAILED FETCH KEEPS THE FALLBACK. Being a night behind is a small problem;
 * an empty team page is a large one, and the reader cannot tell the difference
 * between the two failures without being told. `stale` drives that line.
 */
export function LiveTeamPage({
  slug,
  fallback,
  tab,
}: {
  slug: string;
  /** The last build's data, rendered until (and if) the live file arrives. */
  fallback: TeamPageData;
  tab: Parameters<typeof TeamPageView>[0]["tab"];
}) {
  const [data, setData] = useState<TeamPageData>(fallback);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(dataUrl(liveTeamPath(slug)))
      .then((r) => (r.ok ? (r.json() as Promise<LiveTeamBundle>) : null))
      .then((b) => {
        if (!live) return;
        if (b) setData(decodeLiveTeamPage(b));
        else setStale(true);
      })
      .catch(() => { if (live) setStale(true); });
    return () => { live = false; };
  }, [slug]);

  return (
    <>
      {stale && (
        <p className="mx-auto max-w-7xl px-6 lg:px-10 pt-3 text-[0.7rem] text-ink-muted">
          Live numbers are unavailable right now — showing the most recent published figures.
        </p>
      )}
      <TeamPageView {...data} tab={tab} />
    </>
  );
}
