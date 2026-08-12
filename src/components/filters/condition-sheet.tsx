"use client";

import { useMemo, useState } from "react";
import { OPS, type Filter, type Op, type StatOption } from "@/lib/game-filters";

/**
 * The condition sheet — every stat laid out as a compact tile row, grouped and
 * searchable. Engage a tile and it becomes a filter; clear it and the tile goes
 * dormant again.
 *
 * SHARED ON PURPOSE. This began as /calc's builder while the team and coach
 * "Find a game" modals used a stack of Where/And dropdown rows — two different
 * ways to express the same `Filter[]` over the same stat model, so the same
 * question looked like a different product depending on where you started. The
 * sheet won because it SHOWS what is available; the dropdown builder required
 * you to already know the stat you wanted before it would show you anything.
 *
 * The caller owns the filter array. This only reports intent.
 */

/** 0/1 flags — rendered as a Yes/No toggle, not a slider + comparator. */
export const FLAG_KEYS = new Set(["conf_game", "tourney", "postseason"]);

/** Rate-shaped keys (0–1 decimals shown as %). `_pct` also catches efg_pct_def. */
export function isPctKey(key: string): boolean {
  return key.includes("_pct") || key.startsWith("ff_");
}

/**
 * ONE ACCENT FOR EVERY GROUP — the site's own azure.
 *
 * These were nine different hues, one per group: gold for Differentials, olive
 * for Box, teal for Pace, muted red for Defense. Nothing read them as a key,
 * because the group is already named in the heading directly above the rows;
 * the colour was decoration that made a sheet of otherwise identical rows look
 * like it was signalling something it wasn't, and a gold slider beside a blue
 * one just looked unfinished.
 *
 * Kept as a map rather than collapsed to a constant so per-group hues can come
 * back behind a real meaning, and so nothing downstream has to change shape.
 * `var(--coral)` is the accent (azure, #0c6bd6) and is theme-aware — it lifts
 * on dark, which a hardcoded hex would not.
 */
const GROUP_ACCENT = "var(--coral)";
const GROUP_HUES: Record<string, string> = {
  "Context":       GROUP_ACCENT,
  "Scoring":       GROUP_ACCENT,
  "Differentials": GROUP_ACCENT,
  "Defense":       GROUP_ACCENT,
  "Efficiency":    GROUP_ACCENT,
  "Box":           GROUP_ACCENT,
  "Game Shape":    GROUP_ACCENT,
  "Pace":          GROUP_ACCENT,
  "Opponent":      GROUP_ACCENT,
};

/**
 * The sheet's own grouping — a display concern, deliberately NOT the shared
 * `group` strings in game-filters/game-box (those still feed the team/coach
 * "Find a game" modal). The rate-stat groups are dissolved into the
 * sections each stat actually belongs to, and offensive shooting lives under
 * Scoring; the defensive rates get a section of their own.
 */
const GROUP_ORDER = [
  "Context", "Scoring", "Differentials", "Defense",
  "Efficiency", "Box", "Game Shape", "Pace", "Opponent",
] as const;

function displayGroup(o: StatOption): string {
  const byKey: Record<string, string> = {
    ff_efg: "Scoring", ff_ftr: "Scoring",
    ff_tov: "Efficiency", ff_orb: "Efficiency",
    ff_efg_def: "Defense", ff_ftr_def: "Defense", ff_tov_def: "Defense", ff_orb_def: "Defense",
  };
  const key = o.key as string;
  if (byKey[key]) return byKey[key];
  if (o.group === "Shooting (off)") return "Scoring";
  if (o.group === "Shooting (def)") return "Defense";
  return o.group;
}

/**
 * Group a caller's stat list for display. Derived from the options passed in
 * rather than a module constant, because /calc runs on CALC_STAT_OPTIONS while
 * the team / coach "Find a game" modal runs on the smaller STAT_OPTIONS.
 */
export function conditionGroups(options: StatOption[]): Array<[string, StatOption[]]> {
  const seen = new Map<string, StatOption[]>();
  for (const o of options) {
    const g = displayGroup(o);
    const arr = seen.get(g);
    if (arr) arr.push(o);
    else seen.set(g, [o]);
  }
  return GROUP_ORDER.filter((g) => seen.has(g)).map((g) => [g, seen.get(g)!] as [string, StatOption[]]);
}

/**
 * Slider bounds per stat. These are DISPLAY ranges tuned to where real games
 * live, not data extremes — the number input still accepts anything, so an
 * outlier query ("won by 60") is typed, not dragged.
 */
export function rangeFor(key: string): { min: number; max: number; step: number } {
  if (isPctKey(key)) return { min: 0, max: 1, step: 0.005 };
  switch (key) {
    case "opp_rank":         return { min: 1, max: 364, step: 1 };
    case "pts_scored":
    case "pts_against":      return { min: 30, max: 140, step: 1 };
    case "pts_diff":         return { min: -50, max: 50, step: 1 };
    case "poss":
    case "pace":             return { min: 55, max: 90, step: 0.5 };
    case "ortg":
    case "drtg":             return { min: 60, max: 150, step: 1 };
    case "largest_lead":
    case "largest_lead_opp": return { min: 0, max: 50, step: 1 };
    case "h1_margin":
    case "h2_margin":        return { min: -40, max: 40, step: 1 };
    case "ast":              return { min: 0, max: 40, step: 1 };
    case "stl":              return { min: 0, max: 25, step: 1 };
    case "blk":              return { min: 0, max: 20, step: 1 };
    case "fouls":            return { min: 0, max: 40, step: 1 };
  }
  if (key.endsWith("_diff")) return { min: -30, max: 30, step: 1 };
  return { min: -50, max: 50, step: 1 };
}

/**
 * Starting value when a tile is first engaged. A slider that lands on a
 * plausible threshold ("3P% > 40%", "Opp Rank ≤ 25") invites dragging;
 * landing on 0 for a percentage reads as broken.
 */
const PICK_DEFAULTS: Record<string, number> = {
  fg3_pct: 0.4, fg2_pct: 0.5, ft_pct: 0.75, efg_pct: 0.5, ts_pct: 0.55, efg_pct_def: 0.45,
  ff_efg: 0.5, ff_efg_def: 0.45, ff_ftr: 0.3, ff_ftr_def: 0.25, ff_tov: 0.15, ff_tov_def: 0.18, ff_orb: 0.3, ff_orb_def: 0.25,
  opp_rank: 25, pts_scored: 80, pts_against: 70, ortg: 110, drtg: 100,
  poss: 70, pace: 70, largest_lead: 10, largest_lead_opp: 10,
  ast: 15, stl: 8, blk: 5, fouls: 20,
};
export function defaultValueFor(key: string): number {
  if (FLAG_KEYS.has(key)) return 1;
  return PICK_DEFAULTS[key] ?? 0;
}

/** Strip the "(1=yes)" hack from flag labels — the toggle says it better. */
export function cleanLabel(label: string): string {
  return label.replace(/\s*\(1=yes\)/, "");
}


function StatTile({
  opt,
  hue,
  filter,
  onPatch,
  onClear,
}: {
  opt: StatOption;
  hue: string;
  /** The live condition for this stat, or undefined while dormant. */
  filter: Filter | undefined;
  onPatch: (patch: Partial<Filter>) => void;
  onClear: () => void;
}) {
  const key = opt.key as string;
  const active = !!filter;
  const label = cleanLabel(opt.label);
  const r = rangeFor(key);
  const pct = isPctKey(key);
  const value = filter?.value ?? defaultValueFor(key);
  const shown = pct ? Math.round(value * 1000) / 10 : value;
  const frac = Math.min(1, Math.max(0, (value - r.min) / (r.max - r.min)));
  const [opOpen, setOpOpen] = useState(false);

  if (FLAG_KEYS.has(key)) {
    const flagState = !filter ? "any" : filter.value === 1 ? "yes" : "no";
    return (
      <div className="flex flex-col items-stretch gap-1 py-2 border-b border-hairline/60 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:min-h-13">
        {/* Same switch as the slider rows. "Yes" is the sensible on-state for a
            flag — nobody sets a Quad-1 filter meaning "and it must NOT be". */}
        <button
          type="button"
          onClick={() => (active ? onClear() : onPatch({ op: "eq", value: 1 }))}
          aria-pressed={active}
          title={active ? `Turn off ${label}` : `Filter on ${label}`}
          className={`shrink min-w-0 text-left text-sm leading-tight sm:truncate rounded-md px-1.5 py-0.5 -ml-1.5 border transition-colors ${
            active
              ? "text-ink font-medium bg-card"
              : "text-ink-soft border-hairline bg-paper-deep/40 hover:bg-paper-deep hover:border-ink/25 hover:text-ink"
          }`}
          style={active ? { borderColor: hue } : undefined}
        >
          {label}
        </button>
        <div className="inline-flex rounded-md border border-hairline overflow-hidden shrink-0">
          {(["any", "yes", "no"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => (s === "any" ? onClear() : onPatch({ op: "eq", value: s === "yes" ? 1 : 0 }))}
              aria-pressed={flagState === s}
              className={`px-2 h-6 text-[11px] font-medium transition-colors ${
                flagState === s ? "text-white" : "text-ink-muted hover:text-ink"
              }`}
              style={flagState === s ? { background: hue } : undefined}
            >
              {s === "any" ? "Any" : s === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const op: Op = filter?.op ?? (opt.defaultDir === "lt" ? "lt" : "gt");
  const opLabel = OPS.find((o) => o.value === op)?.label ?? ">";

  return (
    <div className="py-2 border-b border-hairline/60">
      {/* Stacked below sm. In a two-column grid each tile is ~176px, and with
          the label, comparator and value all on one line the label was left
          ~60px — "eFG%" came out as "eF…". Giving it its own line costs one
          line of height and makes every condition readable again. */}
      <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-1.5">
        {/* The NAME IS THE SWITCH. Waking a condition used to mean nudging a
            hairline slider or hitting a 24px comparator glyph — discoverable
            only by poking at it. The label is the biggest, most obvious target
            in the row and the thing you are actually looking for, so it turns
            the condition on, and turns it off again. The × still clears, for
            anyone who has already learned it. */}
        <button
          type="button"
          onClick={() => (active ? onClear() : onPatch({ op, value }))}
          aria-pressed={active}
          title={active ? `Turn off ${label}` : `Filter on ${label}`}
          className={`shrink min-w-0 text-left text-sm leading-tight sm:truncate rounded-md px-1.5 py-0.5 -ml-1.5 border transition-colors ${
            active
              ? "text-ink font-medium bg-card"
              : "text-ink-soft border-hairline bg-paper-deep/40 hover:bg-paper-deep hover:border-ink/25 hover:text-ink"
          }`}
          style={active ? { borderColor: hue } : undefined}
        >
          {label}
        </button>
        <div className="flex items-center gap-1 shrink-0 sm:ml-auto">
          <div className="relative">
            <button
              type="button"
              title="Change comparator"
              aria-label={`${label} comparator: ${opLabel}`}
              aria-expanded={opOpen}
              onClick={() => setOpOpen((o) => !o)}
              className={`w-6 h-6 rounded border text-xs font-semibold transition-colors ${
                active ? "bg-card" : "border-hairline text-ink-muted hover:text-ink hover:border-ink/30"
              }`}
              style={active ? { borderColor: hue, color: hue } : undefined}
            >
              {opLabel}
            </button>
            {opOpen && (
              <>
                {/* Invisible backdrop — one click anywhere else closes. */}
                <div className="fixed inset-0 z-20" onClick={() => setOpOpen(false)} aria-hidden />
                <div className="bta-pop-in absolute right-0 top-7 z-30 rounded-md border border-hairline bg-popover shadow-md overflow-hidden">
                  {OPS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        // Choosing a comparator wakes a dormant tile too.
                        onPatch({ op: o.value });
                        setOpOpen(false);
                      }}
                      aria-pressed={o.value === op}
                      className={`block w-9 px-2 py-1.5 text-sm text-center transition-colors ${
                        o.value === op ? "bg-coral/10 text-coral font-semibold" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <input
            type="number"
            step={pct ? 0.5 : r.step}
            value={shown}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isNaN(n)) return;
              onPatch({ value: pct ? n / 100 : n });
            }}
            aria-label={`${label} value`}
            className={`w-16 h-8 sm:w-14 sm:h-6 px-1 rounded border text-right text-base sm:text-sm tabular bg-transparent focus:outline-none focus:ring-1 focus:ring-coral/40 transition-colors ${
              active ? "border-hairline bg-card text-ink" : "border-transparent hover:border-hairline text-ink-muted"
            }`}
          />
          {pct && <span className="text-[11px] text-ink-muted w-3">%</span>}
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label} condition`}
            className={`w-5 h-5 inline-flex items-center justify-center rounded-full text-sm font-semibold leading-none transition-all ${
              active
                ? "text-coral bg-coral/10 border border-coral/40 hover:bg-coral hover:text-white"
                : "opacity-0 pointer-events-none"
            }`}
          >
            ×
          </button>
        </div>
      </div>
      <div className="relative h-4 mt-0.5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-hairline" aria-hidden />
        {active && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-l-full"
            style={{ width: `${frac * 100}%`, background: hue, opacity: 0.75 }}
            aria-hidden
          />
        )}
        <input
          type="range"
          className="bta-range"
          min={r.min}
          max={r.max}
          step={r.step}
          value={Math.min(r.max, Math.max(r.min, value))}
          onChange={(e) => onPatch({ value: Number(e.target.value) })}
          aria-label={`${label} threshold`}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The sheet itself.
 * ------------------------------------------------------------------ */

export function ConditionSheet({
  options,
  filters,
  onPatch,
  onClear,
  collapsedByDefault = false,
}: {
  options: StatOption[];
  filters: Filter[];
  /** Patch (or wake) the condition for this stat key. */
  onPatch: (key: string, patch: Partial<Filter>) => void;
  onClear: (key: string) => void;
  /** Start every group folded. The modal wants this; the full page does not. */
  collapsedByDefault?: boolean;
}) {
  const groups = useMemo(() => conditionGroups(options), [options]);
  const [statQ, setStatQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    collapsedByDefault ? new Set(groups.map(([g]) => g)) : new Set<string>(),
  );
  const q = statQ.trim().toLowerCase();

  const matchCount = useMemo(() => {
    if (q === "") return -1;
    return groups.reduce(
      (n, [group, opts]) =>
        n + (group.toLowerCase().includes(q)
          ? opts.length
          : opts.filter((o) => cleanLabel(o.label).toLowerCase().includes(q)).length),
      0,
    );
  }, [groups, q]);

  return (
    <div>
      {/* Find a stat. Nine groups and 160-odd conditions is too many to scroll,
          and scrolling assumes the reader knows which group a stat was filed
          under — "FT Rate" is under Shooting, not Differentials. Same control at
          every width: this is a long-list problem, not a small-screen one. */}
      <div className="relative mb-3 max-w-80">
        <svg viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={statQ}
          onChange={(e) => setStatQ(e.target.value)}
          placeholder="Find a stat…"
          aria-label="Find a condition by stat name"
          className="w-full h-9 pl-8 pr-8 rounded-md border border-hairline bg-card text-ink text-base sm:text-sm placeholder:text-ink-muted/70 placeholder:text-xs sm:placeholder:text-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
        />
        {statQ && (
          <button
            type="button"
            onClick={() => setStatQ("")}
            aria-label="Clear stat search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep"
          >
            &times;
          </button>
        )}
      </div>

      <div className="space-y-4">
        {matchCount === 0 && (
          <p className="text-sm text-ink-muted py-2">
            No stat matches <span className="text-ink font-medium">{statQ}</span>.
          </p>
        )}
        {groups.map(([group, allOpts]) => {
          const groupHit = q !== "" && group.toLowerCase().includes(q);
          const opts = q === "" || groupHit
            ? allOpts
            : allOpts.filter((o) => cleanLabel(o.label).toLowerCase().includes(q));
          if (opts.length === 0) return null;
          const hue = GROUP_HUES[group] ?? "var(--coral)";
          const activeInGroup = opts.filter((o) => filters.some((f) => f.stat === o.key)).length;
          // While a search is live every surviving group is open — collapsing a
          // result you just searched for would be perverse.
          const isFolded = q === "" && collapsed.has(group);
          return (
            <section key={group} className="[contain:layout_style]">
              <button
                type="button"
                aria-expanded={!isFolded}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
                className="group/hd w-full flex items-center gap-2 mb-3 min-h-5 text-left"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`w-3 h-3 text-ink-muted transition-transform ${isFolded ? "-rotate-90" : ""}`}
                  fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden
                >
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-xs uppercase tracking-widest text-ink font-bold group-hover/hd:text-coral transition-colors">{group}</span>
                {activeInGroup > 0 && (
                  <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral text-white text-[0.58rem] font-bold tabular">
                    {activeInGroup}
                  </span>
                )}
              </button>
              {/* Two up on phones — StatTile stacks its own label to fit. */}
              {!isFolded && (
                <div className="grid grid-cols-2 gap-x-3 sm:gap-x-8 lg:grid-cols-3 xl:grid-cols-4">
                  {opts.map((o) => (
                    <StatTile
                      key={o.key as string}
                      opt={o}
                      hue={hue}
                      filter={filters.find((f) => f.stat === o.key)}
                      onPatch={(patch) => onPatch(o.key as string, patch)}
                      onClear={() => onClear(o.key as string)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
