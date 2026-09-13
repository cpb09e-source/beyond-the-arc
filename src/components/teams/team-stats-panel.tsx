"use client";

import { useMemo, useState } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { Select } from "@/components/select";
import { BlurOverlay } from "@/components/teams/preview-blur";
import { TEAM_VIEWS, fmtValue, type TeamSplitStat, type TeamSplits, type TeamStatsView } from "@/lib/team-stat-cards";

export type { TeamSplitRow, TeamSplitStat, TeamSplits } from "@/lib/team-stat-cards";

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
        ranked against every other team&rsquo;s away numbers, not against the full season. Gray chips
        mark stats with no good direction — tempo, shot diet and the scoring shares — where the rank
        says how unusual a team is, not how good.
      </p>
    </div>
  );
}
