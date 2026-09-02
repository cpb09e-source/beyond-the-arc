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
  /** Last season's EPM + its percentile. Was `prtg` (retired BTA PRTG). */
  epm: number | null; epmP: number | null;
  /** Last season's eWins + on/off, from epm-<year>.json — the same source
   *  readImpactExtrasForYear feeds a normal team page, percentiles included. */
  ewins?: number | null; ewinsP?: number | null;
  on_off?: number | null; on_offP?: number | null;
  pir: number | null; pirP: number | null;
  pts: number | null; ptsP: number | null;
  reb: number | null; rebP: number | null;
  ast: number | null; astP: number | null;
  fg3: number | null; fg3P: number | null;
  ft: number | null; ftP: number | null;
  /** Last season's shooting/usage, same carryover as every other column here. */
  ts: number | null; tsP: number | null;
  usg: number | null; usgP: number | null;
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
    // EPM is LAST season's, carried over — nobody has played a 2026-27 game, so
    // every number in this table is a carryover and this one is no different.
    // It used to be hard-coded null while the file still shipped a `prtg` the
    // table never read, which left the impact column blank for every roster.
    epm: p.epm,
    // Also last season's, carried over on exactly the same terms as EPM. These
    // two were hard-coded null here on the belief that they needed this
    // season's play-by-play; they don't — build-season-preview reads them out
    // of epm-<year>.json now, next to the EPM it was already carrying. Portal-
    // only players (not in Bart's feed) still come through null.
    ewins: p.ewins ?? null,
    on_off: p.on_off ?? null,
    // Same carryover. These do come from the rank files, keyed ts_pct/`usage`.
    ts_pct: p.ts, usg_pct: p.usg,
    pcts: {
      pir: p.pirP, pts: p.ptsP, reb: p.rebP,
      ast: p.astP, fg3_pct: p.fg3P, ft_pct: p.ftP,
      epm: p.epmP, ts_pct: p.tsP, usg_pct: p.usgP,
      ewins: p.ewinsP ?? null, on_off: p.on_offP ?? null,
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
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-5">
      {/* No inset of its own. The section's px-6 is the page's one gutter —
          24px on a phone, the same as the hero and the same as every other
          page on the site — and SortableRosterTable bleeds out of exactly that
          with -mx-6. The two numbers have to agree or the table stops meeting
          the screen edge. */}
      <div className="mb-2 sm:mb-4">
        <h2 className="font-display text-3xl text-ink whitespace-nowrap">Roster — {shortLabel}</h2>
      </div>
      <SortableRosterTable roster={roster} rankedPlayerIds={linkableIds} />
    </section>
  );
}
