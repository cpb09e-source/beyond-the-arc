"use client";

import { useMemo, useState } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { Select } from "@/components/select";
import { BlurOverlay } from "@/components/teams/preview-blur";

/**
 * Every advanced number we hold on a team, in nine cards, sliced eight ways.
 *
 * The payload is columnar — `stats` is the shared header and each split carries
 * parallel `v` (value) and `p` (percentile) arrays indexed against it. Built by
 * scripts/build-team-splits.mjs; see that file for why the percentiles are
 * precomputed rather than derived here.
 *
 * The split lives in component state, not the URL. It is a way of looking at
 * one page rather than a different page, nobody links to "Michigan's away
 * splits", and putting it in the URL would push a history entry per change.
 */

export type TeamSplitStat = { key: string; group: string; label: string; fmt: "num1" | "num2" | "pct1" | "x2"; neutral?: boolean };
export type TeamSplitRow = { games: number; v: (number | null)[]; p: (number | null)[] };
export type TeamSplits = {
  season: number;
  splits: { key: string; label: string }[];
  stats: TeamSplitStat[];
  groups: Record<string, string>;
  /** split key -> that split's row for THIS team. */
  rows: Record<string, TeamSplitRow>;
};

function fmtValue(v: number | null, fmt: TeamSplitStat["fmt"]): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "pct1": return v.toFixed(1) + "%";
    case "num2": return v.toFixed(2);
    case "x2":   return v.toFixed(2) + "x";
    default:     return v.toFixed(1);
  }
}

/**
 * Which stat groups each view shows, by the group KEY the data uses.
 *
 * THE CARDS COME FROM THE DATA, not from a list in this file — every group in
 * team-splits is rendered, in the order it appears there. So a view is a
 * filter over group keys rather than a second definition of the panels, and
 * adding a stat to an existing group needs no change here.
 *
 * EVERYTHING IS THE DEFAULT, and there is no Overview. An Overview view is
 * worth having when the full set is too much to land on; nine cards on a
 * three-column grid is three tidy rows, so the shortened version was hiding
 * two thirds of the panel to save a scroll nobody minded. The narrower views
 * stay for when a reader has a side of the ball in mind.
 *
 * THE OTHER TWO ARE GROUPED BY THE QUESTION, matching the player overview.
 * Someone reading a team wants to know how they score or how they defend —
 * "Adv Offense" and "Box Score" describe where a number came from, which is
 * this site's problem rather than the reader's.
 *
 * CORE RIDES IN BOTH, for the same reason Role does on the player page: net
 * rating, tempo and the four factors are the context every other number is
 * read against, and nobody should switch views to find out a team plays at 62
 * possessions. Box Score appears in both because rebounds, steals and blocks
 * are as much a defensive answer as an offensive one.
 *
 * A GROUP IN THE DATA AND IN NEITHER VIEW would show only under Everything.
 * That is the safe direction — it stays reachable, and it is now what the
 * reader sees first — but if a group is added upstream it belongs in a view
 * here too.
 */
type TeamStatsView = "everything" | "offense" | "defense";

const TEAM_VIEWS: Array<{ key: TeamStatsView; label: string; groups: string[] | null }> = [
  // null is not a group list — it is the absence of one. Filtering Everything
  // would mean a list that has to be updated every time a group is added.
  { key: "everything", label: "Everything", groups: null },
  { key: "offense", label: "Scoring & shooting", groups: ["Core", "Shooting", "Misc", "AdvOff"] },
  { key: "defense", label: "Defense & rebounding", groups: ["Core", "OppShoot", "Allowed", "AdvDef", "Box"] },
];

export function TeamStatsPanel({
  splits,
  blurBody = false,
}: {
  splits: TeamSplits;
  blurBody?: boolean;
}) {
  // Only offer splits this team actually played. A team with no neutral-site
  // games should not have an "Away + Neutral" option that silently shows the
  // same numbers as "Away", and one that never lost should not offer "Losses"
  // as an empty card.
  const available = useMemo(
    () => splits.splits.filter((s) => (splits.rows[s.key]?.games ?? 0) > 0),
    [splits],
  );
  const [split, setSplit] = useState(available[0]?.key ?? "full");
  const [view, setView] = useState<TeamStatsView>("everything");
  const row = splits.rows[split] ?? splits.rows.full;

  const cards = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { stat: TeamSplitStat; i: number }[]>();
    splits.stats.forEach((stat, i) => {
      if (!byGroup.has(stat.group)) { byGroup.set(stat.group, []); order.push(stat.group); }
      byGroup.get(stat.group)!.push({ stat, i });
    });
    const all = order.map((g) => ({ group: g, label: splits.groups[g] ?? g, items: byGroup.get(g)! }));
    const wanted = TEAM_VIEWS.find((v) => v.key === view)?.groups;
    // Filtered AFTER grouping, so the cards keep the order the data gives them
    // rather than the order this file happens to list them in.
    return wanted ? all.filter((c) => wanted.includes(c.group)) : all;
  }, [splits, view]);

  if (!row) return null;

  const body = (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 lg:gap-6">
      {cards.map((card) => (
        <section
          key={card.group}
          className="bg-paper-deep/25 -mx-6 md:mx-0 rounded-none md:rounded-xl border-y border-x-0 md:border-x border-hairline shadow-sm px-5 lg:px-6 py-4"
        >
          <h3 className="text-xs uppercase tracking-widest text-coral font-medium mb-3">{card.label}</h3>
          <ul className="divide-y divide-hairline/40">
            {card.items.map(({ stat, i }) => (
              <li
                key={stat.key}
                className="flex items-center gap-3 py-2 px-1 -mx-1 rounded transition-colors hover:bg-[var(--accent-tint)]"
              >
                <span className="flex-1 min-w-0 text-ink-soft text-sm truncate">{stat.label}</span>
                <span className="flex-none font-medium text-ink tabular text-sm w-16 text-right">
                  {fmtValue(row.v[i] ?? null, stat.fmt)}
                </span>
                {/* The chip is the point of the row: the value alone doesn't say
                    whether 70.8 possessions is fast or slow. */}
                {row.p[i] !== null && row.p[i] !== undefined ? (
                  <PercentileChip
                    pct={row.p[i]!}
                    neutral={stat.neutral}
                    className="flex-none w-9 justify-center"
                  >
                    {row.p[i]}
                  </PercentileChip>
                ) : (
                  <span className="flex-none w-9 text-center text-[0.65rem] text-ink-muted">—</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-3xl text-ink">Team Stats</h2>
          <span className="text-sm text-ink-muted tabular">
            {row.games} game{row.games === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {/* View sits BEFORE Split, so the row reads in the order the questions
            are asked: which stats, then which games. Same control name and the
            same labels as the player overview — the two panels are read the
            same way and should not disagree about what the control is called.
            The list itself is shorter here: this panel leads with Everything
            and has no Overview, because nine cards fit without one. */}
        <label className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">View</span>
          <Select
            value={view}
            onChange={(v) => setView(v as TeamStatsView)}
            ariaLabel="Which stats to show"
            compact
            className="w-52"
          >
            {TEAM_VIEWS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Split</span>
          <Select
            value={split}
            onChange={setSplit}
            ariaLabel="Stat split"
            compact
            className="w-52"
          >
            {available.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Select>
        </label>
        </div>
      </div>
      {blurBody ? <BlurOverlay>{body}</BlurOverlay> : body}
      <p className="mt-3 text-[0.65rem] text-ink-muted">
        Chips are national percentiles within the selected split — a team&rsquo;s away numbers are
        ranked against every other team&rsquo;s away numbers, not against the full season. Grey chips
        mark stats with no good direction — tempo, shot diet and the scoring shares — where the rank
        says how unusual a team is, not how good.
      </p>
    </div>
  );
}
