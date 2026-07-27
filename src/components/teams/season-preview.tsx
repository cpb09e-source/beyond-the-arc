"use client";

import { useEffect, useState } from "react";
import { SortableRosterTable } from "@/components/teams/sortable-roster-table";

/**
 * SeasonPreview — the "next season" roster on a team's preview page. Renders the
 * upcoming-season roster from /data/season-preview.json (built by
 * scripts/build-season-preview.mjs, refreshed by scripts/daily-refresh.mjs)
 * through the SAME SortableRosterTable used on every other season, so the look
 * matches exactly. The roster status (returning / transfer / newcomer) shows as
 * an inline badge next to each name — transfers also show their old-school logo.
 *
 * Client-fetched on purpose: the JSON ships via Netlify with a 10-minute edge
 * cache, so a daily refresh is a single-file deploy — no site rebuild. Renders
 * nothing until the file exists / while loading / if the team is missing.
 */

type PreviewPlayer = {
  name: string;
  bart_id: number | null;
  cls: string | null;
  ht: string | null;
  status: "returning" | "transfer" | "newcomer";
  from?: string | null;
  link?: boolean;
  rsci?: number | null;
  prtg: number | null; prtgP: number | null;
  pir: number | null; pirP: number | null;
  pts: number | null; ptsP: number | null;
  reb: number | null; rebP: number | null;
  ast: number | null; astP: number | null;
  fg3: number | null; fg3P: number | null;
  ft: number | null; ftP: number | null;
};
type PreviewFile = {
  label: string;
  recruit_attribution?: string | null;
  teams: Record<string, { roster: PreviewPlayer[] }>;
};

export function SeasonPreview({ teamName }: { teamName: string }) {
  const [data, setData] = useState<PreviewFile | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/data/season-preview.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const t = data?.teams?.[teamName];
  if (!t) return null;

  // Map the preview shape onto the shared RosterEntry the table consumes.
  const roster = t.roster.map((p, i) => ({
    id: p.bart_id ?? -(i + 1),
    bart_player_id: p.bart_id,
    name: p.name,
    class: p.cls,
    height: p.ht,
    hometown: null,
    status: p.status,
    from: p.from ?? null,
    rsci: p.rsci, // undefined for official-added newcomers → no recruit chip; number|null for recruits
    pts: p.pts, reb: p.reb, ast: p.ast,
    fg3_pct: p.fg3, ft_pct: p.ft, pir: p.pir,
    // Upcoming season — no play-by-play EPM / shot data yet.
    epm: null, ts_pct: null, usg_pct: null,
    pcts: {
      pir: p.pirP, pts: p.ptsP, reb: p.rebP,
      ast: p.astP, fg3_pct: p.fg3P, ft_pct: p.ftP,
    },
  }));

  // Names link only for players whose profile page exists (link flag baked in
  // by build-season-preview). SortableRosterTable links when the id is in this
  // set. Short season label (26-27) to match every other Roster heading.
  const linkableIds = new Set(
    t.roster.filter((p) => p.link && p.bart_id != null).map((p) => p.bart_id as number),
  );
  const shortLabel = data!.label.split("-").map((y) => y.slice(-2)).join("-");

  return (
    <section className="mx-auto max-w-7xl px-4 lg:px-10 mt-5">
      <div className="mb-2 sm:mb-4">
        <h2 className="font-display text-3xl text-ink whitespace-nowrap">Roster — {shortLabel}</h2>
      </div>
      <SortableRosterTable roster={roster} rankedPlayerIds={linkableIds} />
    </section>
  );
}
