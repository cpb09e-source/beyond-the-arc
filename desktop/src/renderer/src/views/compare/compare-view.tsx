import { ChevronLeft, ChevronRight, GitCompareArrows, Scale, X } from "lucide-react";
import { differenceQuery } from "~/explain/explain-query";
import { useContextMenu } from "~/ui/context-menu";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PercentileChip, pctBg } from "@/components/percentile-chip";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { ALL_SEASONS } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { loadPlayerSeason, type Player, type PlayerSeason } from "~/data/player-model";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { loadOnce } from "~/data/use-corpus";
import { compareQuery, compareRefsQuery, parseCompareQuery, useCompare, type CompareRef } from "~/shell/compare";
import { useShell } from "~/shell/shell-context";
import { useTabTitle } from "~/shell/tab-title";
import { ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { OVERVIEW_STATS } from "~/views/players/player-columns";

/**
 * Compare: up to four teams or players side by side, each from any season.
 *
 * EVERY NUMBER AND CHIP IS THE EXPLORER'S. A team's percentiles are the Team
 * Explorer's for its own season, a player's the Player Explorer's, so Duke
 * 2014-15 against Duke 2025-26 compares each to its own field rather than one
 * era to the other. The bar under each value is that percentile, and the value
 * that leads its row is the one set in ink.
 *
 * The comparison lives in the tab's query, so ‹ › on a card walks that team or
 * player through the seasons without touching the others, and Alt+Left undoes it.
 */

type Row<T> = {
  key: string;
  label: string;
  title?: string;
  value: (x: T) => number | null;
  fmt: (v: number | null) => string;
  pct: (x: T) => number | null | undefined;
  neutral?: boolean;
};

const TEAM_SECTIONS: Array<{ title: string; rows: Array<Row<Team>> }> = [
  {
    title: "Ratings",
    rows: [
      { key: "net", label: "Adjusted net", title: "Adjusted net rating", value: (t) => t.adjNet, fmt: signed1, pct: (t) => t.pct.a_net },
      { key: "off", label: "Adjusted offense", title: "Adjusted offensive rating", value: (t) => t.adjO, fmt: num1, pct: (t) => t.pct.a_ortg },
      { key: "def", label: "Adjusted defense", title: "Adjusted defensive rating (lower is better)", value: (t) => t.adjD, fmt: num1, pct: (t) => t.pct.a_drtg },
      { key: "tempo", label: "Tempo", title: "Adjusted tempo: no better end", value: (t) => t.tempo, fmt: num1, pct: (t) => t.pct.adjt, neutral: true },
      { key: "sos", label: "Strength of schedule", value: (t) => t.sos, fmt: num1, pct: (t) => t.pct.adj_sos },
    ],
  },
  {
    title: "Four factors",
    rows: [
      { key: "efg", label: "Effective FG%", value: (t) => t.efg, fmt: pct1, pct: (t) => t.pct.cbb_efg },
      { key: "efgd", label: "Opponent eFG%", title: "Lower is better", value: (t) => t.efgDef, fmt: pct1, pct: (t) => t.pct.cbb_efg_def },
      { key: "tov", label: "Turnover rate", title: "Lower is better", value: (t) => t.tov, fmt: pct1, pct: (t) => t.pct.cbb_tov },
      { key: "orb", label: "Offensive rebound rate", value: (t) => t.orb, fmt: pct1, pct: (t) => t.pct.cbb_orb },
    ],
  },
  {
    title: "Shooting and results",
    rows: [
      { key: "fg3", label: "Three-point %", value: (t) => t.fg3, fmt: pct1, pct: (t) => t.pct.cbb_fg3 },
      {
        key: "win", label: "Win %",
        value: (t) => (t.wins + t.losses > 0 ? t.wins / (t.wins + t.losses) : null),
        fmt: pct1, pct: (t) => t.pct.win_pct,
      },
    ],
  },
];

/** Role stats say how big a part a player has, not how well he plays it. */
const ROLE_FIELDS = new Set<string>(["usage_pct", "min_pg"]);
const PLAYER_ROWS: Array<Row<Player>> = OVERVIEW_STATS.map((st) => ({
  key: st.key,
  label: st.label,
  title: st.desc,
  value: (p) => p.s[st.field] as number | null,
  fmt: st.format,
  pct: (p) => (st.pctKey ? p.pct[st.pctKey] : null),
  neutral: ROLE_FIELDS.has(st.field as string),
}));

const loadTeams = (year: number): Promise<Season> =>
  loadOnce(`teams|${year}`, async () => {
    const { json, source } = await window.bta.data("teams", year);
    return { value: shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]), source };
  });
const loadPlayers = (year: number): Promise<PlayerSeason> => loadOnce(`player-season|${year}`, () => loadPlayerSeason(year));

/** Several seasons at once, through the same cache every view uses. */
function useSeasons<T>(years: number[], load: (y: number) => Promise<T>): { values: Map<number, T>; errors: Map<number, string> } {
  const key = [...new Set(years)].sort().join(",");
  const [values, setValues] = useState<Map<number, T>>(() => new Map());
  const [errors, setErrors] = useState<Map<number, string>>(() => new Map());
  useEffect(() => {
    let stale = false;
    for (const y of key ? key.split(",").map(Number) : []) {
      load(y)
        .then((v) => {
          if (!stale) setValues((m) => (m.get(y) === v ? m : new Map(m).set(y, v)));
        })
        .catch((err: unknown) => {
          if (!stale) setErrors((m) => new Map(m).set(y, err instanceof Error ? err.message : String(err)));
        });
    }
    return () => {
      stale = true;
    };
    // `load` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { values, errors };
}

const stepSeason = (year: number, dir: -1 | 1): number | null => {
  // ALL_SEASONS runs newest first.
  const at = ALL_SEASONS.indexOf(year);
  return at < 0 ? null : (ALL_SEASONS[at - dir] ?? null);
};

export function CompareView({ year, query, setQuery }: ViewProps) {
  const { kind, refs } = useMemo(() => parseCompareQuery(query), [query]);
  const tray = useCompare();
  const write = (next: CompareRef[]) => setQuery(compareRefsQuery(kind, next));
  const remove = (i: number) => write(refs.filter((_, j) => j !== i));
  const step = (i: number, dir: -1 | 1) => {
    const y = stepSeason(refs[i]!.year, dir);
    if (y != null) write(refs.map((r, j) => (j === i ? { ...r, year: y } : r)));
  };
  const noun = kind === "team" ? (refs.length === 1 ? "team" : "teams") : refs.length === 1 ? "player" : "players";
  useTabTitle(refs.length === 0 ? null : kind === "team" ? refs.map((r) => r.id).join(" · ") : `${refs.length} players`);

  return (
    <>
      <ViewHeader
        kicker="Tools"
        title="Compare"
        year={year}
        season={false}
        meta={refs.length > 0 ? `${refs.length} ${noun}` : undefined}
        controls={
          <>
            {tray.items.length > 1 && compareQuery(tray.items) !== query && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setQuery(compareQuery(tray.items))}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
              >
                <GitCompareArrows size={14} strokeWidth={2} />
                Compare the tray ({tray.items.length})
              </button>
            )}
            {kind === "team" && refs.length > 1 && <ExplainButton refs={refs} />}
          </>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-auto border-t border-hairline">
        {refs.length === 0 ? (
          <div className="grid h-full place-content-center gap-3 px-6 text-center">
            <GitCompareArrows size={22} strokeWidth={1.75} className="mx-auto text-ink-muted" />
            <p className="text-[14px] font-medium text-ink">Nothing to compare yet.</p>
            <p className="mx-auto max-w-[54ch] text-[12.5px] leading-relaxed text-ink-muted">
              Press <Kbd>C</Kbd> on a row in the Team or Player Explorer, drag a row onto the compare tray, or use Compare on a team or
              player page. Up to four at once, each from any season.
            </p>
          </div>
        ) : kind === "team" ? (
          <TeamCompare refs={refs} onRemove={remove} onStep={step} />
        ) : (
          <PlayerCompare refs={refs} onRemove={remove} onStep={step} />
        )}
      </div>
    </>
  );
}

function TeamCompare({ refs, onRemove, onStep }: { refs: CompareRef[]; onRemove: (i: number) => void; onStep: (i: number, dir: -1 | 1) => void }) {
  const { openRecord } = useShell();
  const { values, errors } = useSeasons(refs.map((r) => r.year), loadTeams);
  const items = refs.map((r) => values.get(r.year)?.teams.find((t) => t.name === r.id) ?? null);
  return (
    <Grid
      n={refs.length}
      cards={refs.map((r, i) => {
        const t = items[i];
        const season = values.get(r.year);
        return (
          <Card
            key={`${r.id}:${r.year}:${i}`}
            year={r.year}
            onRemove={() => onRemove(i)}
            onStep={(dir) => onStep(i, dir)}
            onOpen={(newTab) => openRecord({ kind: "team", name: r.id, logoId: t?.logoId ?? null }, { newTab, year: r.year })}
            avatar={<TeamLogo id={t?.logoId ?? null} name={r.id} size={40} />}
            name={r.id}
            facts={
              t
                ? `${t.wins}–${t.losses} · ${t.confLabel}`
                : errors.has(r.year)
                  ? seasonError(errors.get(r.year)!, r.year)
                  : season
                    ? `Not in Division I in ${seasonLabel(r.year)}`
                    : "Loading…"
            }
            badge={
              t?.btaRank != null ? (
                <span className="rounded-[5px] bg-[var(--accent-wash)] px-1.5 py-[2px] font-mono text-[10.5px] font-semibold text-accent tabular">
                  BTA #{t.btaRank}
                </span>
              ) : null
            }
          />
        );
      })}
    >
      {TEAM_SECTIONS.map((s) => (
        <Section key={s.title} title={s.title} n={refs.length}>
          {s.rows.map((row) => (
            <StatRow key={row.key} row={row} items={items} />
          ))}
        </Section>
      ))}
    </Grid>
  );
}

function PlayerCompare({ refs, onRemove, onStep }: { refs: CompareRef[]; onRemove: (i: number) => void; onStep: (i: number, dir: -1 | 1) => void }) {
  const { openRecord } = useShell();
  const { values, errors } = useSeasons(refs.map((r) => r.year), loadPlayers);
  const items = refs.map((r) => values.get(r.year)?.roster.find((p) => p.bartId === Number(r.id)) ?? null);
  return (
    <Grid
      n={refs.length}
      cards={refs.map((r, i) => {
        const p = items[i];
        const season = values.get(r.year);
        return (
          <Card
            key={`${r.id}:${r.year}:${i}`}
            year={r.year}
            onRemove={() => onRemove(i)}
            onStep={(dir) => onStep(i, dir)}
            onOpen={(newTab) =>
              openRecord(
                { kind: "player", bartId: Number(r.id), name: p?.name ?? "Player", hasPhoto: p?.hasPhoto ?? false },
                { newTab, year: r.year },
              )
            }
            avatar={<PlayerPhoto bartId={Number(r.id)} hasPhoto={p?.hasPhoto ?? false} name={p?.name ?? "?"} size={42} />}
            name={p?.name ?? (season ? "Not on a roster" : "Loading…")}
            facts={
              p ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <TeamLogo id={p.teamLogoId} name={p.team} size={14} />
                  <span className="truncate">{p.team}</span>
                  <ClassBadge cls={p.cls} />
                </span>
              ) : errors.has(r.year) ? (
                seasonError(errors.get(r.year)!, r.year)
              ) : season ? (
                `No season on record in ${seasonLabel(r.year)}`
              ) : (
                ""
              )
            }
            badge={p?.rank != null && p.rank <= 100 ? <TopHundredPill rank={p.rank} title={`Top 100: #${p.rank} in ${seasonLabel(r.year)}`} /> : null}
          />
        );
      })}
    >
      <Section title="The Player Explorer's overview" n={refs.length}>
        {PLAYER_ROWS.map((row) => (
          <StatRow key={row.key} row={row} items={items} />
        ))}
      </Section>
    </Grid>
  );
}

/** Why two of the compared teams differ: straight there for a pair, a choice of pairs for three or four. */
function ExplainButton({ refs }: { refs: CompareRef[] }) {
  const { openView } = useShell();
  const openMenu = useContextMenu();
  const pairs = refs.flatMap((r, i) => refs.slice(i + 1).map((s) => [r, s] as const));
  const mixed = new Set(refs.map((r) => r.year)).size > 1;
  const name = (r: CompareRef) => (mixed ? `${r.id} ${seasonLabel(r.year)}` : r.id);
  const go = (p: readonly [CompareRef, CompareRef], newTab: boolean) =>
    openView("difference", { newTab, query: differenceQuery({ year: p[0].year, name: p[0].id }, { year: p[1].year, name: p[1].id }) });
  return (
    <button
      type="button"
      title={pairs.length === 1 ? `Why ${name(pairs[0]![0])} and ${name(pairs[0]![1])} differ  ·  Ctrl-click for a new tab` : "Pick two of these teams"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (pairs.length === 1) {
          go(pairs[0]!, e.ctrlKey || e.metaKey);
          return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        openMenu({
          x: r.left,
          y: r.bottom + 4,
          label: "Explain a difference",
          entries: pairs.map((p) => ({ kind: "item", id: `${p[0].year}:${p[0].id}|${p[1].year}:${p[1].id}`, label: `${name(p[0])} vs ${name(p[1])}`, onSelect: () => go(p, false) })),
        });
      }}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
    >
      <Scale size={14} strokeWidth={2} />
      Explain the difference{pairs.length > 1 ? "…" : ""}
    </button>
  );
}

const seasonError = (message: string, year: number) =>
  message.includes("season-gated") ? `${seasonLabel(year)} needs a Season Pass` : `${seasonLabel(year)} did not load`;

function Grid({ n, cards, children }: { n: number; cards: ReactNode[]; children: ReactNode }) {
  const template = `208px repeat(${n}, minmax(220px, 1fr))`;
  return (
    <div className="min-w-fit pb-10">
      <div className="sticky top-0 z-10 grid border-b border-hairline bg-paper" style={{ gridTemplateColumns: template }}>
        <div />
        {cards}
      </div>
      <div className="grid" style={{ gridTemplateColumns: template }}>
        {children}
      </div>
    </div>
  );
}

function Card({
  year,
  avatar,
  name,
  facts,
  badge,
  onRemove,
  onStep,
  onOpen,
}: {
  year: number;
  avatar: ReactNode;
  name: string;
  facts: ReactNode;
  badge: ReactNode;
  onRemove: () => void;
  onStep: (dir: -1 | 1) => void;
  onOpen: (newTab: boolean) => void;
}) {
  const older = stepSeason(year, -1);
  const newer = stepSeason(year, 1);
  return (
    <div className="group relative flex min-w-0 flex-col gap-2.5 border-l border-hairline px-4 pb-3 pt-4">
      <button
        type="button"
        aria-label={`Remove ${name}`}
        title="Remove from this comparison"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-ink-muted opacity-0 transition-opacity hover:bg-[var(--row-hover)] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={13} strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Open the page  ·  Ctrl-click for a new tab"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => onOpen(e.ctrlKey || e.metaKey)}
        className="flex min-w-0 items-center gap-3 pr-6 text-left"
      >
        <span className="shrink-0">{avatar}</span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink hover:underline">{name}</span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{facts}</span>
        </span>
      </button>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex h-[24px] items-center rounded-md border border-hairline bg-card">
          <button
            type="button"
            aria-label="Older season"
            disabled={older == null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(-1)}
            className="grid h-full w-[22px] place-items-center text-ink-muted transition-colors enabled:hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={13} strokeWidth={2} />
          </button>
          <span className="px-1 text-[12px] font-medium text-ink tabular">{seasonLabel(year)}</span>
          <button
            type="button"
            aria-label="Newer season"
            disabled={newer == null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(1)}
            className="grid h-full w-[22px] place-items-center text-ink-muted transition-colors enabled:hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        </span>
        {badge}
      </div>
    </div>
  );
}

function Section({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  return (
    <>
      <div
        className="px-6 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
        style={{ gridColumn: `1 / span ${n + 1}` }}
      >
        {title}
      </div>
      {children}
    </>
  );
}

function StatRow<T>({ row, items }: { row: Row<T>; items: Array<T | null> }) {
  const pcts = items.map((x) => (x ? (row.pct(x) ?? null) : null));
  const known = pcts.filter((p): p is number => p != null);
  // The leader is the best percentile, which already knows which end is better.
  const lead = !row.neutral && known.length > 1 ? Math.max(...known) : null;
  return (
    <>
      <div title={row.title} className="flex items-center border-t border-hairline/60 px-6 py-2 text-[12.5px] text-ink-soft">
        <span className="truncate">{row.label}</span>
      </div>
      {items.map((x, i) => {
        const v = x ? row.value(x) : null;
        const pct = pcts[i] ?? null;
        const leads = lead != null && pct === lead;
        return (
          <div key={i} className="flex min-w-0 items-center gap-2.5 border-l border-t border-hairline/60 px-4 py-2">
            <span className={`w-[54px] shrink-0 text-right text-[14px] tabular ${leads ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {x ? row.fmt(v) : "–"}
            </span>
            <span className="relative h-[6px] min-w-[40px] flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]">
              {pct != null && (
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(3, pct)}%`, background: row.neutral ? "var(--pct-bg-4)" : pctBg(pct) }}
                />
              )}
            </span>
            <PercentileChip pct={pct} neutral={row.neutral} className="min-w-[28px] px-1 py-[2px] text-[10.5px]" />
            <span
              role={leads ? "img" : undefined}
              aria-label={leads ? "Leads this row" : undefined}
              aria-hidden={leads ? undefined : true}
              className={`-ml-1 size-[5px] shrink-0 rounded-full ${leads ? "bg-accent" : ""}`}
            />
          </div>
        );
      })}
    </>
  );
}
