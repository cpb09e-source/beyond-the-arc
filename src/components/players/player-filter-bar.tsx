"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { type RangeStat } from "@/components/filters/range-row";
import { PACK_STAT_COLUMNS, PACK_STAT_BY_KEY } from "@/lib/player-stat-pack";
import { type PickOption } from "@/components/filters/stat-picker";
import { playerStatBounds } from "@/lib/player-stat-bounds";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { ScopeCollapse, scopeSummary } from "@/components/filters/scope-collapse";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { type SearchableOption } from "@/components/explorer/searchable-select";
import {
  DEFAULT_PLAYER_SPEC,
  PLAYER_STAT_COLUMNS,
  parsePlayerSpec,
  playerSpecToParams,
  playerStatColumn,
  type PlayerListSpec,
  type PlayerStatFilter,
} from "@/lib/players";

const CLASS_OPTIONS: SearchableOption[] = [
  { value: "Fr", label: "Freshman" },
  { value: "So", label: "Sophomore" },
  { value: "Jr", label: "Junior" },
  { value: "Sr", label: "Senior" },
  { value: "Gr", label: "Graduate" },
];

const POSITION_OPTIONS: SearchableOption[] = [
  { value: "G", label: "G (Guard)" },
  { value: "F", label: "F (Forward)" },
  { value: "C", label: "C (Center)" },
];

const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;

type Draft = {
  years: number[];
  conf: string[];
  teams: string[];
  cls: string[];
  pos: ("G" | "F" | "C")[];
  filters: PlayerStatFilter[];
};

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.years.length !== b.years.length || a.years.some((y, i) => y !== b.years[i])) return false;
  if (a.conf.length !== b.conf.length  || a.conf.some((c, i) => c !== b.conf[i])) return false;
  if (a.teams.length !== b.teams.length || a.teams.some((t, i) => t !== b.teams[i])) return false;
  if (a.cls.length !== b.cls.length   || a.cls.some((c, i) => c !== b.cls[i])) return false;
  if (a.pos.length !== b.pos.length   || a.pos.some((c, i) => c !== b.pos[i])) return false;
  if (a.filters.length !== b.filters.length) return false;
  for (let i = 0; i < a.filters.length; i++) {
    const fa = a.filters[i]!, fb = b.filters[i]!;
    if (fa.stat !== fb.stat || fa.op !== fb.op || fa.value !== fb.value) return false;
  }
  return true;
}

export function PlayerFilterBar({
  conferences,
  teams,
}: {
  conferences: string[];
  teams: string[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: PlayerListSpec = parsePlayerSpec(params);

  // Working draft — edits happen here without re-running the leaderboard.
  // Only Submit pushes to the URL (mirrors /teams explorer pattern).
  const [draft, setDraft] = useState<Draft>({
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  // Re-sync draft when the URL changes from outside (browser nav, etc.).
  useEffect(() => {
    setDraft({
      years: urlSpec.years,
      conf: urlSpec.conf,
      teams: urlSpec.teams,
      cls: urlSpec.cls,
      pos: urlSpec.pos,
      filters: urlSpec.filters,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function submit() {
    // Preserve sort/limit/minGames from the URL; only overwrite the
    // draft-controlled fields.
    const next: PlayerListSpec = {
      ...urlSpec,
      years: draft.years,
      conf: draft.conf,
      teams: draft.teams,
      cls: draft.cls,
      pos: draft.pos,
      filters: draft.filters,
    };
    const p = playerSpecToParams(next).toString();
    startTransition(() =>
      router.replace(p ? `/players?${p}` : "/players", { scroll: false }),
    );
    // No jump to the leaderboard. Submitting used to scroll the page for you,
    // which is the same "it moved under me" complaint as the filter drawer's
    // old anchoring — and the rows it was scrolling to are already the next
    // thing on the screen.
  }
  function reset() {
    setDraft({
      years: DEFAULT_PLAYER_SPEC.years,
      conf: [],
      teams: [],
      cls: [],
      pos: [],
      filters: [],
    });
    startTransition(() => router.replace("/players", { scroll: false }));
  }

  const dirty = !sameDraft(draft, {
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  const teamOptions = useMemo<SearchableOption[]>(
    () => teams.map((t) => ({ value: t, label: t })),
    [teams],
  );
  const confOptions = useMemo<SearchableOption[]>(() => {
    const opts = conferences.map((c) => ({
      value: c,
      label: confDisplay(c),
      group: POWER_CONFS.has(c) ? "power" : "midmajor",
    }));
    return opts.sort((a, b) => {
      if (a.group !== b.group) return a.group === "power" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [conferences]);

  // Collapsed-state read of the current scope, same shape as the teams bar.
  const summary = scopeSummary([
    { label: "seasons", values: draft.years.map(seasonLabel) },
    { label: "teams", values: draft.teams },
    { label: "conferences", values: draft.conf.map(confDisplay) },
    { label: "classes", values: draft.cls },
    { label: "positions", values: draft.pos },
  ]);

  return (
    // Slim quick-filter bar — no card container. Quick scope selects on the
    // left, Reset/Submit on the right. Collapsed behind a toggle below `md`
    // (see ScopeCollapse). Stat filtering is not here at all: it lives in the
    // table toolbar as rows, via PlayerStatRows.
    <ScopeCollapse summary={summary} pending={pending}>
      {/* Quick scope selects — each labeled so a "3 selected" pill reads clearly */}
      <QuickField label="Seasons">
        <MultiYearSelect years={draft.years} onChange={(years) => patch({ years })} className="w-32" />
      </QuickField>
      <QuickField label="Team">
        <SearchableMultiSelect
          value={draft.teams} options={teamOptions} onChange={(t) => patch({ teams: t })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Teams" className="w-52"
        />
      </QuickField>
      <QuickField label="Conference">
        <SearchableMultiSelect
          value={draft.conf} options={confOptions} onChange={(c) => patch({ conf: c })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Conferences" groupLabels={CONF_GROUP_LABELS} className="w-44"
        />
      </QuickField>
      <QuickField label="Class">
        <SearchableMultiSelect
          value={draft.cls} options={CLASS_OPTIONS} onChange={(c) => patch({ cls: c })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Classes" className="w-36"
        />
      </QuickField>
      <QuickField label="Position">
        <SearchableMultiSelect
          value={draft.pos} options={POSITION_OPTIONS} onChange={(p) => patch({ pos: p as ("G" | "F" | "C")[] })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Positions" className="w-36"
        />
      </QuickField>

      {/* Submit / Reset — right after Position */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!dirty}
          className="h-9 text-sm font-medium bg-coral text-white px-5 rounded-md hover:bg-coral-soft disabled:opacity-40 transition-colors"
        >
          Submit
        </button>
        <button type="button" onClick={reset} className="h-9 px-3 text-sm text-ink-muted hover:text-ink">Reset</button>
      </div>
    </ScopeCollapse>
  );
}

// "25-26". Matches the teams filter bar's local copy so the two collapsed
// scope summaries read identically.
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

function QuickField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium pl-0.5">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Stat range drawer
// ---------------------------------------------------------------------------
// Each stat gets a slider bounded by realistic min/max (display units). A range
// with a moved low thumb emits a `gte` filter; a moved high thumb emits `lte`.
// Both thumbs at the extremes = no filter (the stat is "off"). `pct` stats are
// stored as fractions in the URL but shown/edited as whole percent here.
type RangeGroup = { label: string; stats: RangeStat[] };


/**
 * "Minutes per game" → "Minutes Per Game", without wrecking the acronyms.
 *
 * A word is only capitalised when it is ENTIRELY lowercase. Anything already
 * carrying a capital is left exactly as written, which is what protects PIR,
 * EPM, FG, 3PT, TS and — the one a naive title-case always ruins — eWins.
 */
function titleCase(label: string): string {
  return label
    .split(" ")
    .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * EVERY filterable stat, grouped, with MEASURED bounds.
 *
 * This drawer used to offer thirty stats with hand-written min/max — "rebounds
 * per game, 0 to 20" — chosen by eye. Two things made that untenable: the
 * catalogue is now 137 stats across two sources, and a guessed bound is not
 * neutral. It is the range the slider spans and the hint the reader is told a
 * normal value looks like, so a wrong one quietly misinforms.
 *
 * Bounds come from src/lib/player-stat-bounds.ts — the 1st and 99th percentile
 * of the real distribution across every player-season the site holds, generated
 * by scripts/build-player-stat-bounds.mts. Same method as the team explorer.
 */
const PCT_FRACTION_KEYS = new Set([
  "fg_pct", "fg3_pct", "fg2_pct", "ft_pct", "ts_pct", "efg_pct", "fta_rate",
  "tov_pct", "usg_pct", "win_pct", "pitp_share", "scp_share", "fbp_share",
  "pts2_share", "pts3_share", "ptsft_share", "ftm_rate", "blkd_fga", "rts_pct",
]);

/**
 * Step size from the SPAN, not the magnitude.
 *
 * A stat running 0 to 4 needs twentieths; one running 0 to 900 needs fives.
 * Deriving it from the measured range means a stat added later gets a usable
 * slider without anyone picking a number for it.
 */
function stepFor(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span <= 3) return 0.05;
  if (span <= 10) return 0.1;
  if (span <= 40) return 0.5;
  if (span <= 200) return 1;
  if (span <= 1000) return 5;
  return 10;
}

/**
 * Section headings, in the order the drawer shows them.
 *
 * The two catalogues group their stats on different principles — PlayerSummary
 * by concept, the pack by which file it ships in — so both are mapped onto one
 * set of headings a reader can scan. Anything unmapped lands in Other rather
 * than being dropped, so a stat can never go missing by being forgotten here.
 */
const SECTION_ORDER: string[] = [
  "Impact", "Playing Time", "Scoring", "Shooting", "Shot Profile",
  "Rebounding", "Playmaking", "Defense", "Fouls", "Scoring Context",
  "Milestones", "Game Leaders", "Player Info", "Other",
];

const SUMMARY_SECTION: Record<string, string> = {
  impact: "Impact", advanced: "Impact", offense: "Scoring",
  shooting: "Shooting", defense: "Defense", volume: "Playing Time",
};
const PACK_SECTION: Record<string, string> = {
  info: "Player Info", playtime: "Playing Time", box: "Scoring",
  shooting: "Shooting", context: "Scoring Context", advoff: "Playmaking",
  advdef: "Defense", fouls: "Fouls", doubles: "Milestones", leaders: "Game Leaders",
};

/** Stats that belong under a heading their catalogue group would not give them. */
const SECTION_OVERRIDE: Record<string, string> = {
  rim_pct: "Shot Profile", mid_pct: "Shot Profile", asst_pct: "Shot Profile",
  rim_rate: "Shot Profile", tp_rate: "Shot Profile",
  orpg: "Rebounding", drpg: "Rebounding", rpg: "Rebounding",
  orb: "Rebounding", drb: "Rebounding", reb: "Rebounding",
  orb_40: "Rebounding", drb_40: "Rebounding", reb_40: "Rebounding",
  orb_pct: "Rebounding", drb_pct: "Rebounding", reb_pct: "Rebounding",
  self_orb_pct: "Rebounding",
  apg: "Playmaking", ast: "Playmaking", ast_40: "Playmaking",
  tov_pg: "Playmaking", tov: "Playmaking", tov_40: "Playmaking",
  tov_pct: "Playmaking", ast_tov: "Playmaking",
  spg: "Defense", bpg: "Defense", stl: "Defense", blk: "Defense",
  stl_40: "Defense", blk_40: "Defense", hkm: "Defense",
  pf: "Fouls", pf_40: "Fouls", pf_pg: "Fouls", tech: "Fouls",
  fouled_out: "Fouls", pf_eff: "Fouls", blk_pf: "Fouls", stl_pf: "Fouls",
  gp: "Playing Time", mpg: "Playing Time", gs: "Playing Time", min: "Playing Time",
};

function buildRangeGroups(): RangeGroup[] {
  const bySection = new Map<string, RangeStat[]>();
  const seen = new Set<string>();
  const add = (key: string, label: string, group: string, fromPack: boolean) => {
    // The summary catalogue wins on a shared key (`gp` is in both), so a filter
    // always matches the column the table is already showing.
    if (seen.has(key)) return;
    seen.add(key);
    const measured = playerStatBounds(key);
    // A stat with no measured bound still gets offered — it just gets a wide
    // default rather than a fabricated tight one.
    const [min, max] = measured ?? [0, 100];
    const section = SECTION_OVERRIDE[key]
      ?? (fromPack ? PACK_SECTION[group] : SUMMARY_SECTION[group])
      ?? "Other";
    const stat: RangeStat = {
      key, label: titleCase(label), min, max,
      step: stepFor(min, max), pct: PCT_FRACTION_KEYS.has(key),
    };
    const list = bySection.get(section);
    if (list) list.push(stat); else bySection.set(section, [stat]);
  };

  for (const c of PLAYER_STAT_COLUMNS) add(c.key, c.label, c.group, false);
  for (const c of PACK_STAT_COLUMNS) add(c.key, c.label, c.group, true);

  return SECTION_ORDER
    .filter((g) => bySection.has(g))
    .map((g) => ({ label: g, stats: bySection.get(g)! }));
}

const RANGE_GROUPS: RangeGroup[] = buildRangeGroups();

/**
 * The same stats again, shaped for the shared stat picker.
 *
 * Built from RANGE_GROUPS rather than from the catalogues a second time, so the
 * picker and the drawer can never disagree about which stats exist or which
 * section a stat lives in — the failure that would show up as a stat you can
 * add from one door and cannot find in the other.
 */
export const PLAYER_PICK_OPTIONS: PickOption[] = RANGE_GROUPS.flatMap((g) =>
  g.stats.map((st) => ({
    key: st.key,
    label: st.label,
    desc: playerStatColumn(st.key)?.desc ?? PACK_STAT_BY_KEY.get(st.key)?.desc ?? "",
    group: g.label,
  })),
);

/** Section headings are already their own labels here, so this is the identity. */
export const PLAYER_PICK_GROUP_LABEL: Record<string, string> =
  Object.fromEntries(RANGE_GROUPS.map((g) => [g.label, g.label]));
