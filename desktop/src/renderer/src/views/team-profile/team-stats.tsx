import { useMemo, useState } from "react";
import { TEAM_VIEWS, fmtValue, type TeamSplitRow, type TeamSplitStat, type TeamStatsView } from "@/lib/team-stat-cards";
import { useLoaded } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { seasonLabel } from "~/ui/format";
import { StatCard, StatCardGrid, StatCardRow, StatCardsHeader, StatCardsNote } from "~/ui/stat-cards";

/**
 * Every number the site holds on a team, in its nine cards, sliced its eight
 * ways: the Team Stats panel from btacbb.xyz's team pages
 * (src/components/teams/team-stats-panel.tsx), reading the same season file.
 *
 * THE CARDS COME FROM THE DATA, in the order the file gives them, and a view is
 * a filter over their groups (src/lib/team-stat-cards.ts). Everything is the
 * default, as on the site: nine cards are three rows.
 */

type TeamSplitsFile = {
  season: number;
  splits: { key: string; label: string }[];
  stats: TeamSplitStat[];
  groups: Record<string, string>;
  /** team name -> split key -> that split's row. */
  teams: Record<string, Record<string, TeamSplitRow>>;
};

const VIEW_KEY = "bta.team.statsView";

function readView(): TeamStatsView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return TEAM_VIEWS.some((o) => o.key === v) ? (v as TeamStatsView) : "everything";
  } catch {
    return "everything";
  }
}

export function TeamStats({ year, team }: { year: number; team: string }) {
  const [state] = useLoaded<TeamSplitsFile | null>(`team-splits|${year}`, async () => {
    const { json, source } = await window.bta.data("team-splits", year);
    return { value: JSON.parse(json) as TeamSplitsFile | null, source };
  });
  const [view, setView] = useState<TeamStatsView>(readView);
  const [split, setSplit] = useState("full");

  const file = state.status === "ready" ? state.value : null;
  const rows = file?.teams[team] ?? null;

  const cards = useMemo(() => {
    if (!file) return [];
    const order: string[] = [];
    const byGroup = new Map<string, Array<{ stat: TeamSplitStat; i: number }>>();
    file.stats.forEach((stat, i) => {
      if (!byGroup.has(stat.group)) {
        byGroup.set(stat.group, []);
        order.push(stat.group);
      }
      byGroup.get(stat.group)!.push({ stat, i });
    });
    const wanted = TEAM_VIEWS.find((v) => v.key === view)?.groups;
    return order
      .filter((g) => !wanted || wanted.includes(g))
      .map((g) => ({ group: g, label: file.groups[g] ?? g, items: byGroup.get(g)! }));
  }, [file, view]);

  if (state.status === "loading") return <p className="text-[13px] text-ink-muted">Loading the stat cards…</p>;

  const active = rows?.[split] ? split : "full";
  const row = rows?.[active];
  if (!file || !rows || !row) {
    return (
      <p className="text-[13px] text-ink-muted">
        {state.status === "error" ? "The stat cards did not load." : `No split stats on record for ${team} in ${seasonLabel(year)}.`}
      </p>
    );
  }

  // Only splits the team played: no neutral-site games, no Away + Neutral.
  const available = file.splits.filter((s) => (rows[s.key]?.games ?? 0) > 0);
  const pickView = (key: string) => {
    setView(key as TeamStatsView);
    try {
      localStorage.setItem(VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  return (
    <section>
      <StatCardsHeader title="Stats" meta={`${row.games} game${row.games === 1 ? "" : "s"} in this split`}>
        <Picker label="View" value={view} options={TEAM_VIEWS} onChange={pickView} />
        <Picker label="Split" value={active} options={available} onChange={setSplit} />
      </StatCardsHeader>
      <StatCardGrid>
        {cards.map((card) => (
          <StatCard key={card.group} title={card.label}>
            {card.items.map(({ stat, i }) => (
              <StatCardRow
                key={stat.key}
                label={stat.label}
                value={fmtValue(row.v[i] ?? null, stat.fmt)}
                pct={row.p[i] ?? null}
                neutral={stat.neutral}
              />
            ))}
          </StatCard>
        ))}
      </StatCardGrid>
      <StatCardsNote>
        Chips are national percentiles within the split: a team&apos;s away numbers are ranked against every other team&apos;s away numbers.
        Gray chips mark stats with no good direction, like pace and the scoring shares, where the rank says how unusual a team is rather
        than how good.
      </StatCardsNote>
    </section>
  );
}
