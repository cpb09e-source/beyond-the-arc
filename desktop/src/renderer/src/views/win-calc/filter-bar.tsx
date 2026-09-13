import {
  CalendarRange,
  Layers,
  MapPin,
  Plus,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { conditionGroups, FLAG_KEYS, isPctKey } from "@/lib/condition-stats";
import { confDisplay } from "@/lib/conf-display";
import { CALC_STAT_OPTIONS, type Op } from "@/lib/game-filters";
import { ALL_SEASONS, isFlaggedSeason, SEASON_CEIL, seasonFlagNote } from "@/lib/seasons";
import { CALC_CONFERENCES, CONF_GROUP_LABELS, MAX_CONDITIONS, newRow, statLabel, type CalcRow, type Venue } from "@/lib/win-calc";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { Popover } from "~/ui/popover";
import { ListFooterButton, SearchList, type ListItem } from "~/ui/search-list";
import { crestOf } from "./calc-model";
import { DEFAULT_CALC, serializeCalc, VALUE_PATTERN, withIds, type CalcState } from "./calc-state";

/**
 * The question, as a row of filters: which games, then what happened in them.
 *
 * LINEAR'S FILTER ROW. Every part of the question is a chip that reads as a
 * sentence ("Team is Duke", "3P% ≥ 40 %") and is edited where it sits: the
 * value opens its list, the comparison opens its own, × takes it away. One
 * "Filter" button adds anything, scope and stats alike, from one searchable
 * list, so there is no panel of sixty controls to scroll past for the one being
 * asked about.
 *
 * A CONDITION WITH NO VALUE IS A COLUMN. Its chip is dashed: the stat shows in
 * the table and filters nothing, the site's "Add Columns". Chip order is column
 * order; drag a chip by its name, or Alt+← → from its value box.
 *
 * NOTHING HERE WAITS FOR A BUTTON. The answer below follows every change.
 */

type Dim = "season" | "venue" | "quad" | "conference" | "team" | "coach" | "opponent";
type Open = { kind: "dim"; dim: Dim } | { kind: "op"; id: number } | { kind: "add" } | null;

const OP_SYMBOL: Record<Op, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };
const OP_ITEMS: ListItem[] = [
  { key: "gte", label: "at least", leading: <span className="w-3 text-center text-ink">≥</span> },
  { key: "gt", label: "more than", leading: <span className="w-3 text-center text-ink">&gt;</span> },
  { key: "lte", label: "at most", leading: <span className="w-3 text-center text-ink">≤</span> },
  { key: "lt", label: "less than", leading: <span className="w-3 text-center text-ink">&lt;</span> },
  { key: "eq", label: "exactly", leading: <span className="w-3 text-center text-ink">=</span> },
];

const SEASON_ITEMS: ListItem[] = ALL_SEASONS.map((y) => ({
  key: String(y),
  label: seasonLabel(y),
  meta: isFlaggedSeason(y) ? "COVID season" : undefined,
  title: seasonFlagNote(y) ?? undefined,
}));

const VENUE_ITEMS: ListItem[] = [
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "neutral", label: "Neutral floor" },
];

const QUAD_ITEMS: ListItem[] = [
  { key: "1", label: "Quad 1", meta: "Top 30 home · 50 neutral · 75 away" },
  { key: "2", label: "Quad 2", meta: "31–75 · 51–100 · 76–135" },
  { key: "3", label: "Quad 3", meta: "76–160 · 101–200 · 136–240" },
  { key: "4", label: "Quad 4", meta: "The rest, and non-D-I" },
];

const CONFERENCE_ITEMS: ListItem[] = CALC_CONFERENCES.map((c) => ({
  key: c.value,
  label: c.label,
  group: CONF_GROUP_LABELS[c.group],
  keywords: c.value,
}));

const DIMS: Record<Dim, { label: string; icon: LucideIcon; width: number; noun: string }> = {
  season: { label: "Season", icon: CalendarRange, width: 240, noun: "seasons" },
  venue: { label: "Venue", icon: MapPin, width: 220, noun: "venues" },
  quad: { label: "Quad", icon: Layers, width: 360, noun: "quads" },
  conference: { label: "Conference", icon: Trophy, width: 300, noun: "conferences" },
  team: { label: "Team", icon: Shield, width: 320, noun: "teams" },
  coach: { label: "Coach", icon: UserRound, width: 340, noun: "coaches" },
  opponent: { label: "Opponent", icon: Swords, width: 320, noun: "opponents" },
};

const STAT_ITEMS = conditionGroups(CALC_STAT_OPTIONS).flatMap(([group, opts]) =>
  opts.map((o) => ({ key: `stat:${o.key as string}`, stat: o.key as string, label: statLabel(o.key as string), group, keywords: o.key as string })),
);

function seasonsText(years: number[]): string {
  const ys = [...years].sort((a, b) => a - b);
  if (ys.length === ALL_SEASONS.length) return "All seasons";
  if (ys.length === 1) return seasonLabel(ys[0]!);
  const asc = [...ALL_SEASONS].sort((a, b) => a - b);
  const at = asc.indexOf(ys[0]!);
  const contiguous = ys.every((y, k) => asc[at + k] === y);
  return contiguous ? `${seasonLabel(ys[0]!)} to ${seasonLabel(ys[ys.length - 1]!)}` : `${ys.length} seasons`;
}

const namesText = (list: string[], noun: string, show: (s: string) => string = (s) => s): string =>
  list.length === 0 ? "" : list.length <= 2 ? list.map(show).join(", ") : `${list.length} ${noun}`;

/** A typical range as words: "-26 to 34" rather than "-26–34", which reads as a subtraction. */
const rangeText = (b: [number, number], pct: boolean): string => (pct ? `${b[0]}% to ${b[1]}%` : `${b[0]} to ${b[1]}`);

const toggle = (list: string[], key: string): string[] =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

export function FilterBar({
  state,
  update,
  bounds,
  teams,
  opponents,
  coaches,
}: {
  state: CalcState;
  update: (fn: (s: CalcState) => CalcState) => void;
  /** The typical range of every stat in the loaded games, for the value hints. */
  bounds: Map<string, [number, number]>;
  teams: ListItem[];
  opponents: ListItem[];
  coaches: ListItem[];
}) {
  const [open, setOpen] = useState<Open>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // Where each popover hangs: the value it edits.
  const anchors = useRef(new Map<string, HTMLElement>());
  const anchorRef = (key: string) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(key, el);
    else anchors.current.delete(key);
  };
  const anchorOf = (key: string) => ({
    get current() {
      return anchors.current.get(key) ?? null;
    },
  });

  const isOpen = (dim: Dim) => open?.kind === "dim" && open.dim === dim;
  const flip = (dim: Dim) => setOpen(isOpen(dim) ? null : { kind: "dim", dim });

  const patchRow = (id: number, patch: Partial<CalcRow>) =>
    update((s) => ({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeRow = (id: number) => update((s) => ({ ...s, rows: withIds(s.rows.filter((r) => r.id !== id)) }));

  // ── Reordering ─────────────────────────────────────────────────────────────
  // The site's lift-and-slide (src/components/calc/calc-client.tsx): the real
  // chip follows the pointer at full opacity, rows swap live as the pointer
  // crosses a neighbour's middle, and FLIP slides everything else into place.
  const [dragId, setDragId] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const rects = useRef(new Map<number, DOMRect>());
  const lift = useRef<{ id: number; startX: number; startY: number; dx: number; dy: number; origin: DOMRect; el: HTMLElement } | null>(null);

  const snapshot = () => {
    const m = new Map<number, DOMRect>();
    stripRef.current?.querySelectorAll<HTMLElement>("[data-row-id]").forEach((el) => {
      m.set(Number(el.dataset.rowId), el.getBoundingClientRect());
    });
    rects.current = m;
  };

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prev = rects.current;
    const next = new Map<number, DOMRect>();
    const held = lift.current;
    strip.querySelectorAll<HTMLElement>("[data-row-id]").forEach((el) => {
      const id = Number(el.dataset.rowId);
      el.style.transition = "none";
      el.style.transform = "";
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      if (held && held.id === id) {
        el.style.transform = `translate(${held.origin.left + held.dx - rect.left}px, ${held.origin.top + held.dy - rect.top}px)`;
        return;
      }
      const old = prev.get(id);
      if (!old || reduce) return;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (!dx && !dy) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
    });
    rects.current = next;
  });

  const moveRow = (fromId: number, toId: number) =>
    update((s) => {
      const from = s.rows.findIndex((x) => x.id === fromId);
      const to = s.rows.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0 || from === to) return s;
      const next = [...s.rows];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return { ...s, rows: withIds(next) };
    });

  const nudgeRow = (id: number, delta: -1 | 1) => {
    const at = state.rows.findIndex((x) => x.id === id);
    const other = state.rows[at + delta];
    if (at < 0 || !other) return;
    snapshot();
    moveRow(id, other.id);
  };

  const liftRow = (e: ReactPointerEvent<HTMLElement>, id: number) => {
    if (e.button !== 0) return;
    const el = e.currentTarget.closest<HTMLElement>("[data-row-id]");
    if (!el) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the lift still works while the pointer stays on the grip */
    }
    lift.current = { id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, origin: el.getBoundingClientRect(), el };
    el.style.transition = "none";
    document.body.style.cursor = "grabbing";
    setDragId(id);
  };

  const dropRow = (e: ReactPointerEvent<HTMLElement>) => {
    if (!lift.current) return;
    lift.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    snapshot();
    setDragId(null);
  };

  const trackRow = (e: ReactPointerEvent<HTMLElement>) => {
    const held = lift.current;
    if (!held) return;
    held.dx = e.clientX - held.startX;
    held.dy = e.clientY - held.startY;
    const slot = rects.current.get(held.id) ?? held.origin;
    held.el.style.transform = `translate(${held.origin.left + held.dx - slot.left}px, ${held.origin.top + held.dy - slot.top}px)`;
    const from = state.rows.findIndex((x) => x.id === held.id);
    for (const [id, rect] of rects.current) {
      if (id === held.id) continue;
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) continue;
      const to = state.rows.findIndex((x) => x.id === id);
      if (to < 0) continue;
      // On one line the pointer has to pass the neighbour's middle in the
      // direction of travel; swapping on first contact made unequal chips flip
      // back and forth under a pointer that was not moving.
      if (Math.abs(slot.top - rect.top) < rect.height / 2) {
        const mid = rect.left + rect.width / 2;
        if (to > from && e.clientX < mid) return;
        if (to < from && e.clientX > mid) return;
      }
      snapshot();
      moveRow(held.id, id);
      return;
    }
  };

  // ── Adding ─────────────────────────────────────────────────────────────────
  const full = state.rows.length >= MAX_CONDITIONS;
  const addItems: ListItem[] = [
    ...(Object.keys(DIMS) as Dim[]).map((dim) => {
      const Icon = DIMS[dim].icon;
      return { key: `dim:${dim}`, label: DIMS[dim].label, group: "Which games", leading: <Icon size={14} strokeWidth={2} /> };
    }),
    ...(state.d1Only
      ? []
      : [{ key: "d1", label: "D-I opponents only", group: "Which games", leading: <ShieldCheck size={14} strokeWidth={2} /> }]),
    ...STAT_ITEMS.map((it) => {
      const b = bounds.get(it.stat);
      return {
        ...it,
        meta: full ? "12 is the most" : b && !FLAG_KEYS.has(it.stat) ? rangeText(b, isPctKey(it.stat)) : undefined,
      };
    }),
  ];

  const pickAdd = (key: string) => {
    if (key === "d1") {
      update((s) => ({ ...s, d1Only: true }));
      close();
    } else if (key.startsWith("dim:")) {
      setOpen({ kind: "dim", dim: key.slice(4) as Dim });
    } else if (key.startsWith("stat:") && !full) {
      const stat = key.slice(5);
      const rows = withIds([...state.rows, newRow(stat, 0)]);
      if (!FLAG_KEYS.has(stat)) setFocusId(rows[rows.length - 1]!.id);
      update((s) => ({ ...s, rows }));
      close();
    }
  };

  // ── Scope lists ────────────────────────────────────────────────────────────
  const dimList = (dim: Dim): ReactNode => {
    const clear = (field: "conferences" | "teams" | "coaches" | "opponents") => (
      <ListFooterButton onClick={() => update((s) => ({ ...s, [field]: [] }))}>Clear</ListFooterButton>
    );
    switch (dim) {
      case "season":
        return (
          <SearchList
            items={SEASON_ITEMS}
            label="Seasons"
            multi
            search={false}
            selected={new Set(state.years.map(String))}
            onPick={(k) =>
              update((s) => {
                const y = Number(k);
                if (!s.years.includes(y)) return { ...s, years: [...s.years, y] };
                // Never no season: the last one stays until another is chosen.
                return s.years.length === 1 ? s : { ...s, years: s.years.filter((x) => x !== y) };
              })
            }
            onClose={close}
            footer={
              <>
                <ListFooterButton onClick={() => update((s) => ({ ...s, years: [...ALL_SEASONS] }))}>All seasons</ListFooterButton>
                <ListFooterButton onClick={() => update((s) => ({ ...s, years: [SEASON_CEIL] }))}>Latest only</ListFooterButton>
              </>
            }
          />
        );
      case "venue":
        return (
          <SearchList
            items={VENUE_ITEMS}
            label="Venue"
            search={false}
            selected={new Set([state.venue])}
            onPick={(k) => {
              update((s) => ({ ...s, venue: k as Venue }));
              close();
            }}
            onClose={close}
          />
        );
      case "quad":
        return (
          <SearchList
            items={QUAD_ITEMS}
            label="Quadrants"
            multi
            search={false}
            selected={new Set(state.quads)}
            onPick={(k) => update((s) => ({ ...s, quads: toggle(s.quads, k).sort() }))}
            onClose={close}
          />
        );
      case "conference":
        return (
          <SearchList
            items={CONFERENCE_ITEMS}
            label="Conferences"
            placeholder="Find a conference"
            multi
            selected={new Set(state.conferences)}
            onPick={(k) => update((s) => ({ ...s, conferences: toggle(s.conferences, k) }))}
            onClose={close}
            footer={clear("conferences")}
          />
        );
      case "team":
        return (
          <SearchList
            items={teams}
            label="Teams"
            placeholder="Find a team"
            multi
            selected={new Set(state.teams)}
            onPick={(k) => update((s) => ({ ...s, teams: toggle(s.teams, k) }))}
            onClose={close}
            footer={clear("teams")}
          />
        );
      case "coach":
        return (
          <SearchList
            items={coaches}
            label="Coaches"
            placeholder="Find a coach"
            multi
            selected={new Set(state.coaches)}
            onPick={(k) => update((s) => ({ ...s, coaches: toggle(s.coaches, k) }))}
            onClose={close}
            footer={clear("coaches")}
          />
        );
      case "opponent":
        return (
          <SearchList
            items={opponents}
            label="Opponents"
            placeholder="Find an opponent"
            multi
            selected={new Set(state.opponents)}
            onPick={(k) => update((s) => ({ ...s, opponents: toggle(s.opponents, k) }))}
            onClose={close}
            footer={clear("opponents")}
          />
        );
    }
  };

  const scopeChip = (dim: Dim, has: boolean, op: string, value: string, extra: { leading?: ReactNode; onRemove?: () => void; removeLabel?: string } = {}) =>
    has || isOpen(dim) ? (
      <ScopeChip
        key={dim}
        icon={DIMS[dim].icon}
        label={DIMS[dim].label}
        op={op}
        value={value}
        valueLeading={extra.leading}
        anchorRef={anchorRef(dim)}
        expanded={isOpen(dim)}
        onOpen={() => flip(dim)}
        onRemove={extra.onRemove}
        removeLabel={extra.removeLabel ?? `Remove the ${DIMS[dim].label.toLowerCase()} filter`}
      />
    ) : null;

  const many = (n: number) => (n > 1 ? "is any of" : "is");
  const pristine = serializeCalc({ ...DEFAULT_CALC, years: state.years }) === serializeCalc(state);
  const openRow = open?.kind === "op" ? state.rows.find((r) => r.id === open.id) : undefined;

  return (
    <div
      ref={stripRef}
      role="group"
      aria-label="Filters"
      className={`flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-3 ${dragId !== null ? "select-none" : ""}`}
    >
      {scopeChip("season", true, /^[0-9]+ seasons$/.test(seasonsText(state.years)) ? "is any of" : "is", seasonsText(state.years), {
        onRemove:
          state.years.length === 1 && state.years[0] === SEASON_CEIL
            ? undefined
            : () => update((s) => ({ ...s, years: [SEASON_CEIL] })),
        removeLabel: "Back to the latest season",
      })}
      {state.d1Only && (
        <div
          title="Games against non-D-I schools count toward a team's official record, but NET, KenPom and Torvik leave them out. Remove this to count them."
          className="inline-flex h-[26px] items-stretch divide-x divide-hairline overflow-hidden rounded-md border border-hairline bg-card text-[12.5px]"
        >
          <span className="inline-flex items-center gap-1.5 px-2 text-ink-soft">
            <ShieldCheck size={13} strokeWidth={2} className="text-ink-muted" />
            Opponents
          </span>
          <span className="inline-flex items-center px-1.5 text-ink-muted">are</span>
          <span className="inline-flex items-center px-2 font-medium text-ink">D-I only</span>
          <RemoveButton label="Count games against non-D-I opponents too" onClick={() => update((s) => ({ ...s, d1Only: false }))} />
        </div>
      )}
      {scopeChip("venue", state.venue !== "all", "is", VENUE_ITEMS.find((v) => v.key === state.venue)?.label ?? "", {
        onRemove: () => update((s) => ({ ...s, venue: "all" })),
      })}
      {scopeChip("quad", state.quads.length > 0, many(state.quads.length), state.quads.map((q) => `Q${q}`).join(", "), {
        onRemove: () => update((s) => ({ ...s, quads: [] })),
      })}
      {scopeChip("conference", state.conferences.length > 0, many(state.conferences.length), namesText(state.conferences, "conferences", confDisplay), {
        onRemove: () => update((s) => ({ ...s, conferences: [] })),
      })}
      {scopeChip("team", state.teams.length > 0, many(state.teams.length), namesText(state.teams, "teams"), {
        leading: state.teams.length === 1 ? <TeamLogo id={crestOf(state.teams[0])} name={state.teams[0]!} size={14} /> : undefined,
        onRemove: () => update((s) => ({ ...s, teams: [] })),
      })}
      {scopeChip("coach", state.coaches.length > 0, many(state.coaches.length), namesText(state.coaches, "coaches"), {
        onRemove: () => update((s) => ({ ...s, coaches: [] })),
      })}
      {scopeChip("opponent", state.opponents.length > 0, many(state.opponents.length), namesText(state.opponents, "opponents"), {
        leading: state.opponents.length === 1 ? <TeamLogo id={crestOf(state.opponents[0])} name={state.opponents[0]!} size={14} /> : undefined,
        onRemove: () => update((s) => ({ ...s, opponents: [] })),
      })}

      {state.rows.map((row) => {
        const b = bounds.get(row.stat);
        return (
          <ConditionChip
            key={row.id}
            row={row}
            hint={b ? `${b[0]} to ${b[1]}` : "value"}
            autoFocus={row.id === focusId}
            onFocused={() => focusId !== null && setFocusId(null)}
            onChange={(patch) => patchRow(row.id, patch)}
            onRemove={() => removeRow(row.id)}
            opRef={anchorRef(`op:${row.id}`)}
            opOpen={open?.kind === "op" && open.id === row.id}
            onOpenOp={() => setOpen(open?.kind === "op" && open.id === row.id ? null : { kind: "op", id: row.id })}
            onNudge={(d) => nudgeRow(row.id, d)}
            lifted={dragId === row.id}
            drag={{
              onPointerDown: (e) => liftRow(e, row.id),
              onPointerMove: trackRow,
              onPointerUp: dropRow,
              onPointerCancel: dropRow,
            }}
          />
        );
      })}

      <button
        ref={anchorRef("add")}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open?.kind === "add"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(open?.kind === "add" ? null : { kind: "add" })}
        className={`inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-[12.5px] transition-colors hover:bg-[var(--row-hover)] hover:text-ink ${
          open?.kind === "add" ? "bg-[var(--row-hover)] text-ink" : "text-ink-muted"
        }`}
      >
        <Plus size={14} strokeWidth={2} />
        Filter
      </button>

      {!pristine && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => update((s) => ({ ...DEFAULT_CALC, years: s.years }))}
          className="ml-auto h-[26px] px-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          Clear
        </button>
      )}

      {open?.kind === "dim" && (
        <Popover anchor={anchorOf(open.dim)} onClose={close} width={DIMS[open.dim].width} label={DIMS[open.dim].label}>
          {dimList(open.dim)}
        </Popover>
      )}
      {open?.kind === "op" && openRow && (
        <Popover anchor={anchorOf(`op:${open.id}`)} onClose={close} width={180} label="Comparison">
          <SearchList
            items={OP_ITEMS}
            label="Comparison"
            search={false}
            selected={new Set([openRow.op])}
            onPick={(k) => {
              patchRow(openRow.id, { op: k as Op });
              close();
            }}
            onClose={close}
          />
        </Popover>
      )}
      {open?.kind === "add" && (
        <Popover anchor={anchorOf("add")} onClose={close} width={340} label="Add a filter">
          <SearchList items={addItems} label="Add a filter" placeholder="Filter by…" onPick={pickAdd} onClose={close} />
        </Popover>
      )}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid w-[24px] shrink-0 place-items-center text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
    >
      <X size={12} strokeWidth={2.25} />
    </button>
  );
}

function ScopeChip({
  icon: Icon,
  label,
  op,
  value,
  valueLeading,
  anchorRef,
  expanded,
  onOpen,
  onRemove,
  removeLabel,
}: {
  icon: LucideIcon;
  label: string;
  op: string;
  value: string;
  valueLeading?: ReactNode;
  anchorRef: (el: HTMLElement | null) => void;
  expanded: boolean;
  onOpen: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <div className="inline-flex h-[26px] max-w-full items-stretch divide-x divide-hairline overflow-hidden rounded-md border border-hairline bg-card text-[12.5px]">
      <span className="inline-flex shrink-0 items-center gap-1.5 px-2 text-ink-soft">
        <Icon size={13} strokeWidth={2} className="text-ink-muted" />
        {label}
      </span>
      <span className="inline-flex shrink-0 items-center px-1.5 text-ink-muted">{op}</span>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className={`inline-flex min-w-0 max-w-[280px] items-center gap-1.5 px-2 font-medium text-ink transition-colors hover:bg-[var(--row-hover)] ${
          expanded ? "bg-[var(--row-hover)]" : ""
        }`}
      >
        {valueLeading}
        <span className="truncate">{value || <span className="font-normal text-ink-muted">Choose…</span>}</span>
      </button>
      {onRemove && <RemoveButton label={removeLabel} onClick={onRemove} />}
    </div>
  );
}

function ConditionChip({
  row,
  hint,
  autoFocus,
  onFocused,
  onChange,
  onRemove,
  opRef,
  opOpen,
  onOpenOp,
  onNudge,
  lifted,
  drag,
}: {
  row: CalcRow;
  hint: string;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<CalcRow>) => void;
  onRemove: () => void;
  opRef: (el: HTMLElement | null) => void;
  opOpen: boolean;
  onOpenOp: () => void;
  onNudge: (delta: -1 | 1) => void;
  lifted: boolean;
  /** The label is the handle: pick the chip up by its name. */
  drag: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  const flag = FLAG_KEYS.has(row.stat);
  const label = statLabel(row.stat);
  const blank = !flag && row.value.trim() === "";
  const shown = row.value || hint;

  return (
    <div
      data-row-id={row.id}
      title={blank ? `${label} has no value, so it is a column in the table and filters nothing` : undefined}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        e.stopPropagation();
        onNudge(e.key === "ArrowLeft" ? -1 : 1);
      }}
      className={`group inline-flex h-[26px] max-w-full items-stretch divide-x divide-hairline overflow-hidden rounded-md border bg-card text-[12.5px] ${
        blank ? "border-dashed border-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]" : "border-hairline"
      } ${lifted ? "relative z-10 shadow-lg ring-1 ring-[color-mix(in_oklab,var(--accent)_45%,transparent)]" : ""}`}
    >
      <span
        {...drag}
        title="Drag to reorder, or Alt+← → from the value"
        className="inline-flex shrink-0 cursor-grab touch-none select-none items-center px-2 text-ink-soft active:cursor-grabbing"
      >
        {label}
      </span>
      {flag ? (
        <>
          <span className="inline-flex shrink-0 items-center px-1.5 text-ink-muted">is</span>
          <button
            type="button"
            title="Switch between yes and no"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange({ value: row.value === "0" ? "1" : "0" })}
            className="inline-flex items-center px-2 font-medium text-ink transition-colors hover:bg-[var(--row-hover)]"
          >
            {row.value === "0" ? "No" : "Yes"}
          </button>
        </>
      ) : (
        <>
          <button
            ref={opRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={opOpen}
            aria-label={`${label}: ${OP_ITEMS.find((o) => o.key === row.op)?.label ?? row.op}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpenOp}
            className={`inline-flex min-w-[26px] shrink-0 items-center justify-center px-1.5 text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink ${
              opOpen ? "bg-[var(--row-hover)]" : ""
            }`}
          >
            {OP_SYMBOL[row.op]}
          </button>
          <label className="inline-flex shrink-0 cursor-text items-center gap-0.5 px-2 transition-colors focus-within:bg-[var(--accent-wash)]">
            <input
              autoFocus={autoFocus}
              onFocus={onFocused}
              value={row.value}
              inputMode="decimal"
              spellCheck={false}
              aria-label={`${label} value`}
              placeholder={hint}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (VALUE_PATTERN.test(v)) onChange({ value: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                } else if (e.key === "Backspace" && row.value === "") {
                  e.preventDefault();
                  onRemove();
                }
              }}
              className="bg-transparent font-medium text-ink outline-none tabular placeholder:font-normal placeholder:text-ink-muted"
              style={{ width: `${Math.max(1, shown.length) + 0.8}ch` }}
            />
            {isPctKey(row.stat) && <span className="text-ink-muted">%</span>}
          </label>
        </>
      )}
      <RemoveButton label={`Remove ${label}`} onClick={onRemove} />
    </div>
  );
}
