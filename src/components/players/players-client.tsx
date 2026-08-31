"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { midrankPercentileMap } from "@/lib/percentile";
import { formatHeight } from "@/lib/height";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { PercentileChip } from "@/components/percentile-chip";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import {
  PlayerFilterBar,
} from "@/components/players/player-filter-bar";
import { PlayerStatRows } from "@/components/players/player-stat-rows";
import { ComparePlayersModal } from "@/components/players/compare-players-modal";
import { SavedFiltersMenu } from "@/components/explorer/saved-filters-menu";
import { DownloadMenu } from "@/components/explorer/download-menu";
import {
  playerEntity, type ExportCol, type ExportInput, type MultiExportInput,
} from "@/lib/table-export";
import { suggestPlayerName } from "@/lib/saved-filters";
import { SortableTh, StatLabel } from "@/components/explorer/sortable-th";
import { Select } from "@/components/select";
import {
  DEFAULT_PLAYER_SPEC,
  // PLAYER_COLS is gone from here: the raw_row offsets it names are now read
  // only by scripts/build-players-explorer.mjs, at build time.
  PLAYER_STAT_COLUMNS,
  parsePlayerSpec,
  playerStatColumn,
  EWINS_FIRST_YEAR,
  passesPlayerFilter,
  playerSpecToParams,
  type PlayerListSpec,
  type PlayerSummary,
} from "@/lib/players";
import {
  PLAYER_VIEWS, playerViewByKey, playerViewGroups, playerViewPackGroups,
  type PlayerView,
} from "@/lib/player-views";
import {
  PACK_STAT_BY_KEY, groupsFor, loadStatPack, type IndexedPack, type PackGroup,
} from "@/lib/player-stat-pack";
import { useDragPan } from "@/lib/use-drag-pan";
import { clampToFreeTier, effectivePlayerViewAccess, playerViewAccess, FREE_LIMITS } from "@/lib/access";
import { useEntitlement } from "@/lib/use-entitlement";
import { loadSeason, type SeasonDenial } from "@/lib/season-data";
import { GateBar } from "@/components/explorer/gate-bar";
import { Lock } from "lucide-react";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import { PlayerName } from "@/components/player-name";

const LIMIT_OPTIONS = [50, 100, 250, 500];

/**
 * Compare, off for now — same switch and same reason as the team explorer's
 * SHOW_COMPARE. The modal and its data path are untouched behind it, so this
 * is one boolean away from coming back.
 */
const SHOW_COMPARE = false;


const CLASS_LABEL: Record<string, string> = {
  Fr: "Freshmen", So: "Sophomores", Jr: "Juniors", Sr: "Seniors", Gr: "Graduates",
};

// ---- Grouped stat-band grid (see docs/players-grid-rebuild-spec.md) ----
// One entry per data column. `pct` names the percentile map feeding the chip
// (null = no chip, e.g. MPG). `band` marks the EPM trio for the coral wash.
type GridFmt = "num1" | "num2" | "pct1" | "pct100" | "int" | "epm";
type GridCol = {
  label: string;
  /**
   * Where the number comes from. Exactly one of these is set.
   *
   * `field` reads PlayerSummary, which is what every column did before the
   * stat pack existed. `packKey` reads a lazily-fetched group file — see
   * src/lib/player-stat-pack.ts — and those columns carry their percentile
   * with them rather than having one computed here, because the pack's cohort
   * is not the same as the table's (per-40 stats rank only over players past a
   * minutes floor).
   */
  field?: keyof PlayerSummary;
  packKey?: string;
  fmt: GridFmt;
  pct: PctKey | null;
  sortKey?: string;
  band?: boolean;
  /** Raw count, no chip — milestone counts and technicals. */
  noPct?: boolean;
  /** Tooltip on the column header. */
  desc?: string;
};
// GRID_COLS, GRID_BANDS and GRID_FIELDS used to live here: one hardcoded
// seventeen-column table, with a parallel list of band spans that had to be
// kept in step by hand.
//
// Both are now derived from a view — the default table is PLAYER_VIEWS's
// "overview", declared column for column as it shipped — so the spans cannot
// drift from the columns beneath them, and adding a view costs no changes in
// this file. See viewGrid() below.

/**
 * A view's stat keys, flattened into export columns.
 *
 * Mirrors viewGrid below — same walk, same two catalogues, same precedence —
 * but produces the spreadsheet's column model rather than the table's. Kept as
 * a separate function rather than a second use of viewGrid because the file
 * wants a percentile column beside every value, which the table does not.
 */
function exportColsFor(v: PlayerView): ExportCol[] {
  return v.bands.flatMap((band) => band.keys.flatMap((key): ExportCol[] => {
    const summary = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
    if (summary && !summary.filterOnly) {
      return [{
        label: summary.label, total: summary.field as string, pct: summary.field as string,
        fmt: summary.format === "pct1" ? "pct1" : "num1", band: band.label,
      }];
    }
    const pack = PACK_STAT_BY_KEY.get(key);
    if (!pack) return [];
    return [{
      // A milestone count has no percentile, so it gets no Pctl column — an
      // empty one would read as data we failed to compute.
      label: pack.label, total: pack.key, pct: pack.noPct ? "" : pack.key,
      fmt: pack.format === "pct1" ? "pct1" : pack.format === "int" ? "int" : "num1",
      band: band.label,
    }];
  }));
}

/**
 * A view's stat keys, turned into grid columns and band spans.
 *
 * Keys may name EITHER catalogue, and which one decides where the value comes
 * from: PLAYER_STAT_COLUMNS resolves to a PlayerSummary field, PACK_STAT_COLUMNS
 * to a key in a fetched group file. The reader is not shown the difference.
 *
 * BANDS ARE BUILT FROM THE SAME WALK as the columns, so a band's span can never
 * drift out of step with the columns under it — the failure the hardcoded
 * GRID_BANDS list was one edit away from at all times.
 */
function viewGrid(view: PlayerView): { cols: GridCol[]; bands: Array<{ label: string; span: number; epm?: boolean }> } {
  const cols: GridCol[] = [];
  const bands: Array<{ label: string; span: number; epm?: boolean }> = [];
  for (const band of view.bands) {
    let span = 0;
    for (const key of band.keys) {
      const summary = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
      if (summary && !summary.filterOnly) {
        cols.push({
          label: summary.label,
          field: summary.field,
          fmt: summary.field === "games" ? "int"
            : band.accent && summary.group === "impact" ? "epm"
            : summary.format === "pct1" ? "pct1" : summary.format === "num2" ? "num2" : "num1",
          pct: (PCT_KEYS as readonly string[]).includes(summary.field as string)
            ? (summary.field as PctKey) : null,
          sortKey: SORT_KEY_BY_FIELD.get(summary.field as string) ?? summary.key,
          band: band.accent,
          desc: summary.desc,
        });
        span++;
        continue;
      }
      const pack = PACK_STAT_BY_KEY.get(key);
      if (!pack) continue;
      cols.push({
        label: pack.label,
        packKey: pack.key,
        fmt: pack.format,
        pct: null,
        sortKey: pack.key,
        band: band.accent,
        noPct: pack.noPct,
        desc: pack.desc,
      });
      span++;
    }
    if (span > 0) bands.push({ label: band.label, span, epm: band.accent });
  }
  return { cols, bands };
}

// One opaque hover fill for the WHOLE row — sticky (RK/Player) and scrolling
// cells share it so the row reads as a single band, not two colors. Opaque
// (mixed into --card) so the frozen columns still hide the scrolled content.
const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
// EPM band resting tint — marks the headline metric group. This used to be a
// hardcoded dusty rose, picked to sit apart from a warm coral accent; with the
// accent now azure that reason is gone and the rose just clashed. It reads off
// the accent token now, same as FF_BAND_TINT on the teams table, so the two
// leaderboards mark their headline group the same way and neither can drift
// when the accent changes again. A little heavier than the teams table's 3%
// because EPM is three columns, not seven, and needs the extra weight to read.
const EPM_BAND_TINT = "bg-[color-mix(in_oklab,var(--coral)_5%,transparent)]";

function fmtGrid(v: number | null, fmt: GridFmt): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "int": return String(Math.round(v));
    case "pct1": return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    case "pct100": return v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    case "epm": return (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    // eWins runs about 0 to 6 across a season, so one decimal collapses the
    // middle of the board into ties.
    case "num2": return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
}
function seasonLabel(y: number): string {
  return `${y - 1}-${String(y).slice(-2)}`;
}

/**
 * Compact season for the row badge — "24/25". The long form stays in the page
 * kicker, where it is read as prose rather than scanned in a dense cell.
 */
/**
 * Class badge colours — one per eligibility year.
 *
 * Deliberately OFF the red-to-green axis the percentile ramp owns. A freshman
 * badge in ramp-red would read as "bad at being a freshman", which is not a
 * thing; these are a category, not a rank. Nor the site's link blue, which
 * would read as interactive, nor body ink, which would read as text.
 *
 * Teal, violet, amber, magenta. They separate by HUE rather than lightness —
 * the closest two fills differ by a contrast ratio of 1.02 — which is what
 * keeps them reading as four categories instead of a light-to-dark scale.
 *
 * Contrast on their own fills: 6.83, 7.57, 6.49, 7.05 — all clear AA for small
 * text, which matters at this size.
 *
 * THE VALUES LIVE IN globals.css. They were fixed hex here, which meant the
 * pastel fills stayed pastel on the dark theme and each badge read as a small
 * headlight — the same failure the percentile ramp documents. They are tokens
 * now, with a deep-fill dark set, and the player page's hero renders the same
 * four so a junior is the same amber wherever it appears.
 */
const CLASS_BADGE: Record<string, { bg: string; fg: string }> = {
  Fr: { bg: "var(--cls-fr-bg)", fg: "var(--cls-fr-fg)" },   // teal
  So: { bg: "var(--cls-so-bg)", fg: "var(--cls-so-fg)" },   // violet
  Jr: { bg: "var(--cls-jr-bg)", fg: "var(--cls-jr-fg)" },   // amber
  Sr: { bg: "var(--cls-sr-bg)", fg: "var(--cls-sr-fg)" },   // magenta
};

function seasonBadge(y: number): string {
  return `${String(y - 1).slice(-2)}/${String(y).slice(-2)}`;
}
// Header kicker text for the chosen seasons. Single year → "2024-25 season";
// 2 years → "2023-24, 2024-25 seasons"; ≥3 → "3 seasons" to keep it short.
function seasonsKicker(years: number[]): string {
  if (years.length === 1) return `${seasonLabel(years[0]!)} season`;
  if (years.length === 2) return `${seasonLabel(years[1]!)}, ${seasonLabel(years[0]!)} seasons`;
  return `${years.length} seasons`;
}

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}
function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * What /data/players-explorer/<year>.json ships: a field header and one array
 * per player, already transformed by scripts/build-players-explorer.mjs.
 *
 * The explorer used to fetch players-by-year, the Supabase row shipped whole —
 * 1.14 MB gzipped for 2025, of which Bart's 67-column `raw_row` was 73% and the
 * page read 22 of those columns. Doing the transform at build time and dropping
 * the JSON keys took the same season to 504 KB.
 *
 * `fields` is read from the file rather than assumed, so the builder owns the
 * column order and the two cannot drift apart silently.
 */
type ExplorerPayload = {
  fields: string[];
  rows: Array<Array<string | number | null>>;
};

/**
 * Possessions a player needs before their raw on-off is worth printing.
 *
 * Matches MIN_POSS in export-epm-json.mjs, which already treats 300 as the
 * point below which "the RAPM is mostly shrinkage". Unregularized on-off is
 * noisier still, so the same floor is the least it should carry.
 */
const MIN_ON_OFF_POSS = 300;

/** Fields attached after load, from the EPM and shooting files. */
const LATE_FIELDS = {
  epm: null, off_epm: null, def_epm: null, epm_estimated: false, epm_covered: false,
  box_epm: null, poss: null,
  ewins: null, on_off: null,
  rim_pct: null, mid_pct: null, assisted_pct: null, rim_rate: null, tp_rate: null,
} as const;

/**
 * Payload rows -> PlayerSummary objects.
 *
 * Called from the per-year memo rather than at fetch time, and deliberately:
 * the cohort pass below mutates what it is given (EPM, shooting and percentiles
 * are attached in place), so it needs a fresh object every run. Expanding here
 * keeps the state holding immutable payloads, exactly as the old transform did.
 */
function expandRows(payload: ExplorerPayload): PlayerSummary[] {
  const { fields, rows } = payload;
  return rows.map((row) => {
    const o: Record<string, unknown> = { ...LATE_FIELDS };
    for (let i = 0; i < fields.length; i++) o[fields[i]!] = row[i] ?? null;
    return o as unknown as PlayerSummary;
  });
}

// Position bucket from Bart's position note. Mirrors the mapping in
// scripts/compute-player-ranks.mts so the volume-shooter penalty's
// "compared to their position" cohort matches the player-profile rank
// section. Keep these in sync.
const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  // Height-derived dual-eligibility notes for 2008-09 (see derive-positions.mts).
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};
function positionBucket(note: string | null | undefined): "G" | "F" | "C" | null {
  return note ? (BUCKET_BY_NOTE[note] ?? null) : null;
}


// Leaderboard visibility floor: hide players with <8 games OR <3.5 PPG.
// Stricter than the previous AND-style filter — keeps deep-bench cameos
// off the leaderboard entirely. Players above this floor but below the
// strict 18g / 20mpg / 5.3ppg cohort still appear and are ranked against
// the cohort's distribution via binary search.
function isBelowBaseline(p: PlayerSummary): boolean {
  const gp = p.games ?? 0;
  const ppg = p.pts_pg ?? 0;
  return gp < 8 || ppg < 3.5;
}

// Filter-only pass (no sort/slice). Single loop, zero intermediate arrays — so
// the live filter-count in the drawer (which only needs `.length`) doesn't pay
// for a full O(n log n) sort of the pool on every slider tick.
function filterSpec(
  players: PlayerSummary[],
  spec: PlayerListSpec,
  packValue?: (p: PlayerSummary, key: string) => number | null,
): PlayerSummary[] {
  const confSet = spec.conf.length ? new Set(spec.conf) : null;
  const teamSet = spec.teams.length ? new Set(spec.teams) : null;
  const clsSet = spec.cls.length ? new Set(spec.cls) : null;
  const posSet = spec.pos.length ? new Set(spec.pos) : null;
  const out: PlayerSummary[] = [];
  for (const p of players) {
    if (isBelowBaseline(p)) continue;
    // No EPM, no row — but only for seasons that HAVE EPM. Players under the
    // 13 mpg floor are deliberately absent from the fit, and a leaderboard
    // built around impact should not list players it cannot rate. They stay
    // everywhere else: search, team pages, rosters, and their own profile.
    if (p.epm_covered && p.epm === null) continue;
    if (confSet && (p.team_conference === null || !confSet.has(p.team_conference))) continue;
    if (teamSet && !teamSet.has(p.team_name)) continue;
    if (clsSet && (p.class === null || !clsSet.has(p.class))) continue;
    if (posSet) {
      const bucket = positionBucket(p.position_note);
      if (bucket === null || !posSet.has(bucket)) continue;
    }
    if ((p.games ?? 0) < spec.minGames) continue;
    // Stat filters, AND-combined.
    //
    // A stat lives on PlayerSummary or in a pack, and a filter must work on
    // either. passesPlayerFilter returns TRUE for a key it does not recognise —
    // a deliberate "unknown filter does not narrow" — which for a pack stat
    // meant the filter silently did nothing at all. So pack keys are resolved
    // here, against the same values the table shows.
    let ok = true;
    for (const f of spec.filters) {
      const pack = PACK_STAT_BY_KEY.has(f.stat) && !playerStatColumn(f.stat);
      if (pack) {
        const v = packValue ? packValue(p, f.stat) : null;
        // Null fails, matching passesPlayerFilter: a filter is a claim about a
        // number, and a row with no number cannot support it.
        if (v === null) { ok = false; break; }
        const pass = f.op === "gt" ? v > f.value
          : f.op === "gte" ? v >= f.value
          : f.op === "lt" ? v < f.value
          : v <= f.value;
        if (!pass) { ok = false; break; }
        continue;
      }
      if (!passesPlayerFilter(p, f)) { ok = false; break; }
    }
    if (!ok) continue;
    out.push(p);
  }
  return out;
}

/**
 * Sort key → the PlayerSummary field it orders on.
 *
 * Module-level because two places need the same answer: applySpec, which does
 * the sorting, and the header, which has to decide whether a pinned column can
 * be sorted at all.
 */
const SORT_FIELD: Partial<Record<string, keyof PlayerSummary>> = {
  pir: "pir",
  bta_porpag: "bta_porpag",
  pts: "pts_pg", reb: "reb_pg", ast: "ast_pg",
  fg_pct: "fg_pct", fg3_pct: "fg3_pct", ts_pct: "ts_pct",
  games: "games",
  name: "name",
  epm: "epm", off_epm: "off_epm", def_epm: "def_epm", ewins: "ewins", ppp: "ppp",
  min: "min_pg", usage: "usage_pct", orb: "orb_pg", drb: "drb_pg",
  tov: "tov_pg", tov_pct: "tov_pct", stl: "stl_pg", blk: "blk_pg", hkm: "hkm_pct",
  on_off: "on_off", box_epm: "box_epm", net_rtg: "net_rtg", ast_tov: "ast_to_tov",
  fg2_pct: "fg2_pct", ft_pct: "ft_pct", efg_pct: "efg_pct", fta_rate: "fta_rate",
};

/**
 * The same map read backwards: PlayerSummary field → the sort key that orders
 * it.
 *
 * A pinned column used to be matched to a sort key by comparing the stat's own
 * key against VALID_SORTS, and the two lists do not share a vocabulary — the
 * sort layer says "pts", "min", "usage", "gp"; the column layer says "ppg",
 * "mpg", "usg_pct", "games". Nineteen columns therefore rendered as plain text
 * that could not be clicked, even though eleven of them were already fully
 * sortable under another name. Matching on the FIELD is what makes the two
 * vocabularies stop mattering: whatever a stat is called, it resolves to one
 * column of PlayerSummary, and that is what the sort actually reads.
 */
const SORT_KEY_BY_FIELD = new Map<string, string>(
  (Object.entries(SORT_FIELD) as Array<[string, keyof PlayerSummary]>)
    .map(([sortKey, field]) => [field as string, sortKey]),
);

function applySpec(
  players: PlayerSummary[],
  spec: PlayerListSpec,
  packValue?: (p: PlayerSummary, key: string) => number | null,
): PlayerSummary[] {
  const out = filterSpec(players, spec, packValue);

  /**
   * Resolve the sort key against all three vocabularies, in the order a key is
   * most likely to belong to one: the legacy sort names, then a stat's own key
   * on PlayerSummary, then the stat pack.
   *
   * Falling through to the pack LAST matters — `gp` exists in both catalogues,
   * and the summary's is the one the rest of the table shows.
   */
  const field: keyof PlayerSummary | undefined =
    SORT_FIELD[spec.sortBy] ??
    (PLAYER_STAT_COLUMNS.find((c) => c.key === spec.sortBy)?.field);
  const packKey = field ? null : (PACK_STAT_BY_KEY.has(spec.sortBy) ? spec.sortBy : null);

  const dir = spec.sortDir === "asc" ? 1 : -1;
  const read = (p: PlayerSummary): number | string | null => {
    if (field) return p[field] as number | string | null;
    if (packKey && packValue) return packValue(p, packKey);
    return null;
  };
  // `out` is already a fresh array from filterSpec, so sort in place.
  out.sort((a, b) => {
    const av = read(a);
    const bv = read(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return out.slice(0, spec.limit);
}

// Chip-bearing stats. TOV inverts (fewer turnovers = higher percentile).
const PCT_KEYS = [
  "pir", "fg_pct", "fg3_pct", "ts_pct",
  "epm", "off_epm", "def_epm", "usage_pct", "pts_pg",
  "orb_pg", "drb_pg", "reb_pg", "ast_pg", "tov_pg", "tov_pct", "stl_pg", "blk_pg", "hkm_pct",
  // Filterable extras that can appear as dynamic columns:
  "efg_pct", "fg2_pct", "ft_pct", "fta_rate", "ast_to_tov", "porpag", "bta_porpag", "min_pg", "ppp",
  "ewins",
] as const;
type PctKey = (typeof PCT_KEYS)[number];
type PctMaps = Record<PctKey, Map<number, number>>;
const INVERTED_PCT = new Set<PctKey>(["tov_pg", "tov_pct"]);

// Per-season percentile rank for each chip-bearing stat. Computed across the
// eligible D-I pool (post-baseline, pre-filter) so chips remain meaningful
// when filters narrow the visible list. Higher value = higher percentile.
function attachPercentiles(players: PlayerSummary[]): PctMaps {
  const out = Object.fromEntries(PCT_KEYS.map((k) => [k, new Map<number, number>()])) as PctMaps;
  for (const key of PCT_KEYS) {
    // Ties share a percentile — see src/lib/percentile.ts. Sorted position gave
    // two players with the same number different chips, which on a leaderboard
    // of thousands happens constantly.
    //
    // INVERSION IS PASSED IN rather than applied as 100 - pct afterwards. The
    // two are not the same once ties exist: flipping a midrank after the fact
    // is correct only when the block is symmetric about the middle, and the
    // ranker already knows how to sort the other way.
    out[key] = midrankPercentileMap(
      players.map((p) => [p.id, p[key] as number | null | undefined] as const),
      !INVERTED_PCT.has(key),
    );
  }
  return out;
}


export function PlayersClient({ confsByYear }: { confsByYear: Record<string, string[]> }) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  // Memoize the parsed spec — otherwise it's a brand-new object reference
  // every render, which busts the `[..., spec]` dep on downstream memos
  // (prefiltered, transformed) and causes the heavy sort to re-run on
  // every keystroke even though nothing in the URL changed.
  const spec = useMemo(() => parsePlayerSpec(params), [params]);

  // ── The active view, and the stat packs it needs ────────────────────────
  const view = useMemo(() => playerViewByKey(spec.view), [spec.view]);

  /**
   * What this view costs this reader — see §3b of src/lib/access.ts.
   *
   * Resolves to `free` for every subscriber, so every branch below is dead
   * code on a paid session. It is also optimistic while the profile is still
   * loading, which is deliberate: a subscriber must never watch their own
   * table lock itself and then unlock.
   */
  const { paid, signedIn } = useEntitlement();
  /**
   * Seasons the archive gate refused, by year.
   *
   * A different KIND of gate from the view gate below: that one hides the
   * presentation of rows the browser already holds, this one records bytes the
   * server would not send. Both can be in play at once.
   */
  const [deniedYears, setDeniedYears] = useState<Record<number, SeasonDenial>>({});
  const gate = effectivePlayerViewAccess(view.key, paid);
  /**
   * A gated view shows its top few rows and stops.
   *
   * Cut from the whole matched set rather than from the page, so the five are
   * the top five of what the reader actually asked for: every filter, the
   * conference and class pickers and the name search all still apply. The
   * tool visibly works and stops short of being a ranking.
   */
  const previewCapped = gate.kind === "preview";

  /**
   * What to say about a season the archive gate refused.
   *
   * Same wording and same precedence as the team explorer's seasonNotice —
   * signed-out beats not-subscribed, because signing in is the cheaper action
   * and may resolve the other by itself. Two bars that drifted apart in
   * wording, on the one control that handles money, is the drift that matters.
   */
  const seasonNotice = useMemo(() => {
    const years = Object.keys(deniedYears).map(Number).filter((y) => spec.years.includes(y));
    if (years.length === 0) return null;
    const reasons = new Set(years.map((y) => deniedYears[y]!));
    const label = years.length === 1
      ? `${seasonLabel(years[0]!)} is`
      : `${years.length} seasons are`;
    if (reasons.has("signed-out")) {
      return { text: `${label} part of the Season Pass.`, cta: "Sign in", href: "/account/login" };
    }
    if (reasons.has("not-subscribed")) {
      return { text: `${label} part of the Season Pass.`, cta: "See plans", href: "/pricing" };
    }
    return { text: `${label} unavailable right now.`, cta: "Retry", href: "/players" };
  }, [deniedYears, spec.years]);

  /**
   * The query this reader is actually entitled to RUN, as opposed to the one
   * they asked for. Same helper the team explorer uses, so the two tables
   * cannot drift on what a free plan includes.
   *
   * IT NARROWS THE COMPUTATION, NEVER THE URL. `spec` still carries every
   * column, filter and season the reader picked, so the controls keep showing
   * their real selection and subscribing restores the table instead of making
   * them rebuild it.
   *
   * This is also what gives "Select Your Own Columns" its teeth: the view
   * itself locks nothing (access.ts calls it `cols`), and the cap here is the
   * whole gate. Capping the picker alone would do nothing about a URL that
   * already carries five columns - a shared link, or an old saved view.
   */
  const scopedSpec = useMemo(() => clampToFreeTier(spec, paid), [spec, paid]);
  const colsLocked = scopedSpec.cols.length < spec.cols.length;
  const { cols: viewCols, bands: viewBands } = useMemo(() => viewGrid(view), [view]);

  /**
   * Fetched group files, keyed season → group.
   *
   * Loaded on demand rather than up front: the ten groups come to about a
   * megabyte gzipped a season and most readers open one view. loadStatPack
   * caches per (season, group), so switching back to a view costs nothing and
   * a season already fetched is never fetched twice.
   */
  const [packs, setPacks] = useState<Map<string, IndexedPack>>(new Map());
  /**
   * The pack files this render needs: the view's, plus any the reader has
   * PINNED or filtered on.
   *
   * Reading the view alone was not enough — a pinned stat from another group
   * rendered as a dash, and a filter on one silently matched nothing, because
   * the file holding its values had never been asked for.
   */
  const neededGroups = useMemo(() => {
    const out = new Set<PackGroup>(playerViewPackGroups(view));
    for (const g of groupsFor([...spec.cols, ...spec.filters.map((f) => f.stat)])) out.add(g);
    return [...out];
  }, [view, spec.cols, spec.filters]);

  useEffect(() => {
    const want: Array<[number, PackGroup]> = [];
    for (const y of spec.years) for (const g of neededGroups) {
      if (!packs.has(`${y}|${g}`)) want.push([y, g]);
    }
    if (!want.length) return;
    let alive = true;
    // setState only in the callback, never in the effect body: a synchronous
    // write here would cascade a render before the fetch had done anything.
    Promise.all(want.map(([y, g]) => loadStatPack(y, g).then((pk) => [`${y}|${g}`, pk] as const)))
      .then((got) => {
        if (!alive) return;
        setPacks((prev) => {
          const next = new Map(prev);
          for (const [k, pk] of got) if (pk) next.set(k, pk);
          return next;
        });
      });
    return () => { alive = false; };
    // `packs` is read to skip what is already held, but must not re-trigger the
    // effect — setPacks would then schedule another run of it forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.years, neededGroups]);

  /**
   * Pack values and percentiles, flattened for lookup by (season, column).
   *
   * Keyed by season because the same player appears once per season selected
   * and each season has its own file — and by bart id rather than the row id,
   * because that is what the build script keys on.
   */
  const packLook = useMemo(() => {
    const val = new Map<string, Map<number, number | null>>();
    const pct = new Map<string, Map<number, number | null>>();
    let anyPbpThin = false;
    for (const [key, pk] of packs) {
      const year = key.split("|")[0]!;
      for (const [col, m] of pk.value) val.set(`${year}|${col}`, m);
      for (const [col, m] of pk.pct) pct.set(`${year}|${col}`, m);
      if (pk.pbpCoverage < 0.9) anyPbpThin = true;
    }
    return { val, pct, anyPbpThin };
  }, [packs]);

  const packValue = useMemo(() => (p: PlayerSummary, key: string): number | null => (
    p.bart_player_id == null ? null
      : packLook.val.get(`${p.year}|${key}`)?.get(p.bart_player_id) ?? null
  ), [packLook]);
  const packPct = useMemo(() => (p: PlayerSummary, key: string): number | null => (
    p.bart_player_id == null ? null
      : packLook.pct.get(`${p.year}|${key}`)?.get(p.bart_player_id) ?? null
  ), [packLook]);
  // Mirrors the fallback in parsePlayerSpec: eWins needs the play-by-play fit,
  // so a selection reaching back before it defaults to EPM instead.
  const effectiveDefaultSort = useMemo(
    () => (spec.years.every((y) => y >= EWINS_FIRST_YEAR) ? "ewins" : "epm"),
    [spec.years],
  );

  // URL-state update for the sort/order/show controls now living in the
  // leaderboard header. Mirrors PlayerFilterBar's `update()` so the two
  // surfaces stay in sync.
  function updateSpec(next: PlayerListSpec) {
    const p = playerSpecToParams(next).toString();
    startTransition(() => {
      router.replace(p ? `/players?${p}` : "/players", { scroll: false });
    });
  }
  // Union conferences across every year we have data for; matches the Team
  // Explorer's behavior so the picker offers every historical conference.
  const conferences = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(confsByYear)) for (const c of list) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [confsByYear]);

  const [rawByYear, setRawByYear] = useState<Record<number, ExplorerPayload>>({});
  // BTA EPM per season: bart_player_id -> {epm, off, def}. Fetched lazily per
  // selected year; 404 (no fit for that season) caches as an empty map.
  // Per-season impact map. `estimated` marks a season served by the box-score
  // Box-EPM model (pre-2024, no play-by-play) rather than the real RAPM fit.
  const [epmByYear, setEpmByYear] = useState<Record<number, { players: Record<string, { epm: number; off: number; def: number; poss?: number | null; ewins?: number | null; on_off?: number | null; /** ARC-scaled copies, present only on ESTIMATED (box-score) seasons. */ epm_s?: number | null; off_s?: number | null; def_s?: number | null }>; estimated: boolean }>>({});
  // Box-EPM per season: bart_player_id -> {epm, off, def}. The box half of EPM.
  const [boxByYear, setBoxByYear] = useState<Record<number, Record<string, { epm: number; off: number; def: number }>>>({});
  // Shooting profile per season: bart_player_id -> {rim_pct,mid_pct,asst,rim_rate,tp_rate}. Filter-only.
  const [shootingByYear, setShootingByYear] = useState<Record<number, Record<string, { rim_pct: number | null; mid_pct: number | null; asst: number | null; rim_rate: number | null; tp_rate: number | null }>>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);

  // ── Saved filters ───────────────────────────────────────────────────────
  //
  // WHAT GETS SAVED IS THE QUERY STRING, not a record of every control, so
  // anything playerSpecToParams learns to carry a saved filter carries for
  // free. Canonicalised through the serialiser rather than taken from the
  // address bar, so two ways of reaching the same table save as one entry.
  const currentQuery = useMemo(() => playerSpecToParams(spec).toString(), [spec]);
  const savedNameSuggestion = useMemo(() => suggestPlayerName(spec), [spec]);
  const applySaved = (query: string) => {
    startTransition(() => router.replace(query ? `/players/?${query}` : "/players/", { scroll: false }));
  };


  const [page, setPage] = useState(1);
  // Mobile: the table search collapses to an icon that slides open on tap.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  // The RK column is sized purely by content (width utilities don't stick on
  // these table cells), so we measure its real width and drive the Player
  // column's sticky `left` off it — the pinned position then exactly equals the
  // natural flow position (no gap, no 1px shimmy when panning).
  // min-w-10 on the RK cells makes this 40px starting value true at first
  // paint. The column was previously sized purely by content, so the
  // server-rendered `left` on the sticky player column was wrong until
  // hydration measured it and painted a gap between the two frozen columns in
  // the meantime. A minimum floors the shrink; the measurement still handles
  // the grow case, such as a four-digit rank.
  const [rkThRef, rkW] = useMeasuredWidth<HTMLTableCellElement>(40);
  const playerLeft = { left: `${rkW}px` };

  // Click-and-drag panning over the stat columns (MPG → HKM): grab anywhere in
  // the data area and drag left/right.
  const panHandlers = useDragPan(gridScrollRef);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  useEffect(() => {
    if (!searchOpen) return;
    function onDown(e: PointerEvent) {
      if (searchPanelRef.current && !searchPanelRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  useEffect(() => {
    const toFetch = spec.years.filter((y) => !rawByYear[y]);
    if (toFetch.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // THROUGH THE GATE, not a bare fetch. A gated season is not a static file
    // — it comes from a function that wants to know who is asking — and this
    // was the hole that would have made narrowing FREE_SEASONS a paywall on
    // the team explorer only, with every season still pouring out of here.
    Promise.all(
      toFetch.map((y) =>
        loadSeason<ExplorerPayload>("players", y).then((res) => [y, res] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setRawByYear((s) => {
          const next = { ...s };
          for (const [y, res] of entries) {
            // A refusal leaves the season out of the table rather than
            // blanking it: the other selected seasons still render, and the
            // bar below says why this one is missing.
            if (res.ok) next[y] = res.data;
            else next[y] = { fields: [], rows: [] } as ExplorerPayload;
          }
          return next;
        });
        setDeniedYears((prev) => {
          const next = { ...prev };
          for (const [y, res] of entries) {
            if (res.ok) delete next[y];
            else next[y] = res.denial;
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [spec.years, rawByYear]);

  // Lazy-load impact per season: prefer the real play-by-play EPM fit; fall back
  // to the estimated box-score model (Box-EPM) for seasons without it. Missing
  // both → empty map.
  //
  // Box-EPM is now fetched EVERY season rather than only as a fallback, because
  // it is also published as its own column — the box half of EPM, beside the
  // on-off half. On a season with a real fit the two files are both used: one
  // for the blend, one for the component.
  useEffect(() => {
    const toFetch = spec.years.filter((y) => !epmByYear[y]);
    if (!toFetch.length) return;
    let cancelled = false;
    const loadYear = async (y: number): Promise<readonly [number, { players: Record<string, { epm: number; off: number; def: number }>; estimated: boolean }]> => {
      try {
        const r = await fetch(`/data/epm-${y}.json`);
        if (r.ok) {
          const j = await r.json();
          const players = j.players ?? {};
          if (Object.keys(players).length) return [y, { players, estimated: false }] as const;
        }
      } catch { /* fall through to estimate */ }
      try {
        const rb = await fetch(`/data/box-epm-${y}.json`);
        if (rb.ok) {
          const j = await rb.json();
          return [y, { players: j.players ?? {}, estimated: true }] as const;
        }
      } catch { /* no estimate either */ }
      return [y, { players: {}, estimated: false }] as const;
    };
    Promise.all(toFetch.map(loadYear)).then((entries) => {
      if (cancelled) return;
      setEpmByYear((s) => {
        const next = { ...s };
        for (const [y, m] of entries) next[y] = m;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [spec.years, epmByYear]);

  // Box-EPM per season, for the Box column. Separate from the impact fetch
  // above because that one falls back to this file and would otherwise leave
  // the component and the blend pointing at the same numbers.
  useEffect(() => {
    const toFetch = spec.years.filter((y) => !boxByYear[y]);
    if (!toFetch.length) return;
    let cancelled = false;
    Promise.all(
      toFetch.map((y) =>
        fetch(`/data/box-epm-${y}.json`)
          .then((r) => (r.ok ? r.json() : { players: {} }))
          .catch(() => ({ players: {} }))
          .then((j) => [y, j.players ?? {}] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setBoxByYear((s) => {
        const next = { ...s };
        for (const [y, m] of entries) next[y] = m;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [spec.years, boxByYear]);

  // Lazy-load the shooting profile per season (filter-only; 404 → empty map).
  useEffect(() => {
    const toFetch = spec.years.filter((y) => !shootingByYear[y]);
    if (!toFetch.length) return;
    let cancelled = false;
    Promise.all(
      toFetch.map((y) =>
        fetch(`/data/shooting-${y}.json`)
          .then((r) => (r.ok ? r.json() : { players: {} }))
          .catch(() => ({ players: {} }))
          .then((j) => [y, j.players ?? {}] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setShootingByYear((s) => {
        const next = { ...s };
        for (const [y, m] of entries) next[y] = m;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [spec.years, shootingByYear]);

  // Per-year cohort processing: each season's BTA composite + percentile
  // chips are computed against just that season's eligible D-I pool (matches
  // the Team Explorer's year-only cohort rule). Multi-year selections merge
  // the processed lists for display.
  const processedByYear = useMemo(() => {
    const out: Record<number, { players: PlayerSummary[]; pctMaps: PctMaps }> = {};
    for (const y of spec.years) {
      const raw = rawByYear[y];
      if (!raw) continue;
      const arr = expandRows(raw);
      // Attach BTA EPM by bart id. Real RAPM fit where available, else the
      // estimated box-score model — `estimated` flags which for the UI marker.
      const epmEntry = epmByYear[y];
      // Does this season have EPM at all? Below the 13 mpg floor the fit is
      // essentially the prior, so those players are omitted from the file
      // rather than published as a shrunk-to-zero number — and the explorer
      // hides them (see filterSpec). This flag is what keeps that from
      // emptying the table for a season whose EPM was never built: no
      // coverage, no hiding.
      const seasonHasEpm = !!epmEntry && Object.keys(epmEntry.players).length > 0;
      for (const p of arr) p.epm_covered = seasonHasEpm;
      if (epmEntry) {
        for (const p of arr) {
          const e = p.bart_player_id != null ? epmEntry.players[String(p.bart_player_id)] : undefined;
          if (e) {
            // On estimated seasons prefer the EPM-SCALED copy. Box-EPM is a
            // shrunk prediction of ARC and lives on roughly half its spread, so
            // showing it raw in the ARC column put two different units on one
            // axis — and no pre-play-by-play season could ever place on an
            // all-seasons board. export-box-epm-json.mjs fits the mapping on
            // the seasons where both exist. Real fits have no _s fields and
            // fall through unchanged.
            p.epm = e.epm_s ?? e.epm;
            p.off_epm = e.off_s ?? e.off;
            p.def_epm = e.def_s ?? e.def;
            p.epm_estimated = epmEntry.estimated;
            p.ewins = e.ewins ?? null;
            p.poss = e.poss ?? null;
            // On-off is raw and unregularized: Juan Reyna reads +89.5 on four
            // possessions. Published only above a floor, because a number that
            // wrong is worse than no number.
            p.on_off = typeof e.poss === "number" && e.poss >= MIN_ON_OFF_POSS ? e.on_off ?? null : null;
          }
        }
      }
      // Box half of EPM, from its own file so it stays distinct from the blend.
      const boxMap = boxByYear[y];
      if (boxMap) {
        for (const p of arr) {
          const b = p.bart_player_id != null ? boxMap[String(p.bart_player_id)] : undefined;
          if (b) p.box_epm = b.epm;
        }
      }
      // Shooting profile (filter-only fields).
      const shootMap = shootingByYear[y];
      if (shootMap) {
        for (const p of arr) {
          const s = p.bart_player_id != null ? shootMap[String(p.bart_player_id)] : undefined;
          if (s) { p.rim_pct = s.rim_pct; p.mid_pct = s.mid_pct; p.assisted_pct = s.asst; p.rim_rate = s.rim_rate; p.tp_rate = s.tp_rate; }
        }
      }
      const eligible = arr.filter((p) => !isBelowBaseline(p));
      const pctMaps = attachPercentiles(eligible);
      out[y] = { players: arr, pctMaps };
    }
    return out;
  }, [rawByYear, spec.years, epmByYear, shootingByYear]);

  const transformed = useMemo(
    () => scopedSpec.years.flatMap((y) => processedByYear[y]?.players ?? []),
    [processedByYear, scopedSpec.years],
  );

  // Per-stat percentile lookup that picks the right year's cohort for the
  // player being chip'd. Player id is per-season-unique so no collisions.
  const pctMaps: PctMaps = useMemo(() => {
    const merged = Object.fromEntries(PCT_KEYS.map((k) => [k, new Map<number, number>()])) as PctMaps;
    for (const y of spec.years) {
      const yearPct = processedByYear[y]?.pctMaps;
      if (!yearPct) continue;
      for (const k of PCT_KEYS) {
        for (const [id, v] of yearPct[k]) merged[k].set(id, v);
      }
    }
    return merged;
  }, [processedByYear, spec.years]);

  const teamOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of transformed) s.add(p.team_name);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [transformed]);

  // Search input is debounced via useDeferredValue so React keeps the
  // input field responsive while the heavy match runs at a lower priority.
  // With all 14 seasons loaded (~55k player-seasons), every keystroke
  // would otherwise re-render the entire pipeline before the next paint.
  const deferredQuery = useDeferredValue(query);

  // Pipeline split into two memos so typing only re-runs the cheap name
  // match — not the expensive filter+sort+rank.
  //   `prefiltered`: heavy. Runs full applySpec with the limit removed.
  //                  Cached on `transformed` and `spec` changes only.
  //   `players`:     cheap. Filters by name on the pre-sorted list and
  //                  re-applies `spec.limit` for the visible window.
  //                  Recomputes only when `deferredQuery` or limit changes.
  const prefiltered = useMemo(
    () => applySpec(transformed, { ...scopedSpec, limit: Number.MAX_SAFE_INTEGER }, packValue),
    // packValue is a dependency, not an afterthought: a table sorted by a pack
    // stat is ordered by nulls until its group file lands, and without this it
    // would stay that way.
    [transformed, scopedSpec, packValue],
  );

  // ── Download ────────────────────────────────────────────────────────────
  //
  // BUILT ON CLICK, NOT ON RENDER. Assembling an export walks every row in the
  // result set, and this toolbar re-renders on each keystroke in the search
  // box, so nothing is built until a format is actually chosen.
  /**
   * The two readers the entity needs, closing over the fetched packs.
   *
   * A stat is on PlayerSummary or in a pack, and the file must not care which —
   * so the lookup order here is the same one the table uses, summary first.
   */
  const exportEntity = useMemo(() => playerEntity<PlayerSummary>(
    (r, key) => {
      const v = (r as unknown as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return key ? packValue(r, key) : null;
    },
    (r, key) => {
      if (!key) return null;
      if ((PCT_KEYS as readonly string[]).includes(key)) return pctMaps[key as PctKey]?.get(r.id) ?? null;
      return packPct(r, key);
    },
  ), [packValue, packPct, pctMaps]);

  const buildExport = useCallback((): ExportInput<PlayerSummary> => ({
    cols: exportColsFor(view),
    rows: prefiltered,
    entity: exportEntity,
    meta: {
      viewLabel: view.label,
      seasons: spec.years.length === 1 ? seasonLabel(spec.years[0]!) : `${spec.years.length} seasons`,
      conference: spec.conf.length ? spec.conf.join(", ") : "All conferences",
      teams: spec.teams.length ? spec.teams.join(", ") : "All teams",
      filters: spec.filters.map((f) => {
        const OP: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
        const meta = playerStatColumn(f.stat) ?? PACK_STAT_BY_KEY.get(f.stat);
        const shown = meta?.format === "pct1" ? `${Math.round(f.value * 1000) / 10}%` : String(f.value);
        return `${meta?.label ?? f.stat} ${OP[f.op] ?? f.op} ${shown}`;
      }),
      sort: `${spec.sortBy} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
      search: deferredQuery.trim(),
      url: typeof window === "undefined" ? "" : window.location.href,
    },
  }), [view, prefiltered, exportEntity, spec, deferredQuery]);

  /**
   * The same rows, dressed once per chosen view. Tabs come out in REGISTRY
   * order rather than tick order, so the workbook matches the View dropdown.
   */
  const buildExportAll = useCallback((viewKeys: string[]): MultiExportInput<PlayerSummary> => {
    const single = buildExport();
    const wanted = new Set(viewKeys);
    return {
      sheets: PLAYER_VIEWS.filter((v) => wanted.has(v.key) && !v.custom)
        .map((v) => ({ name: v.label, cols: exportColsFor(v) })),
      rows: single.rows,
      entity: exportEntity,
      meta: single.meta,
      slug: wanted.size === PLAYER_VIEWS.filter((v) => !v.custom).length ? "all-views" : "views",
    };
  }, [buildExport, exportEntity]);

  const exportFieldCount = useMemo(
    // Value plus percentile per stat, plus the five identity columns.
    () => exportColsFor(view).length * 2 + 5,
    [view],
  );

  const { players, count, totalPages, pageSafe } = useMemo(() => {
    // 3-char minimum on search — single-letter "L" matches thousands and
    // burns time both filtering and re-rendering rows. The placeholder
    // calls this out; queries below 3 chars are ignored and the default
    // sorted view is shown.
    const q = deferredQuery.trim().toLowerCase();
    const matched = q.length >= 3
      ? prefiltered.filter((p) => p.name.toLowerCase().includes(q))
      : prefiltered;
    const total = matched.length;
    // A preview is one page of five, whatever the row-count select says.
    if (previewCapped) {
      return {
        players: matched.slice(0, FREE_LIMITS.previewRows),
        count: total,
        totalPages: 1,
        pageSafe: 1,
      };
    }
    const totalPages = Math.max(1, Math.ceil(total / spec.limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * spec.limit;
    return {
      players: matched.slice(start, start + spec.limit),
      count: total,
      totalPages,
      pageSafe,
    };
  }, [prefiltered, deferredQuery, spec.limit, page, previewCapped]);

  // Reset to page 1 whenever the result set changes (filters, sort, search, limit).
  useEffect(() => { setPage(1); }, [prefiltered, deferredQuery, spec.limit, spec.sortBy, spec.sortDir]);
  const multiYear = spec.years.length > 1;
  // Any visible row served by the estimated box-score model → show the legend.
  const anyEstimated = players.some((p) => p.epm_estimated && p.epm !== null);

  // Any stat the user filters on that ISN'T a default grid column gets
  // prepended as its own column (before MPG) so the numbers driving the
  // filter are visible. Label/format come from PLAYER_STAT_COLUMNS.
  /**
   * Leading columns the reader pinned in the filter drawer.
   *
   * This used to be inferred from `spec.filters` — narrowing a stat implicitly
   * added its column. That inference is now explicit state (`spec.cols`), which
   * the drawer also sets automatically whenever a range is applied, so the old
   * behaviour survives while a stat can additionally be shown WITHOUT being
   * filtered on. `spec.filters` is still read as a fallback so bookmarked URLs
   * from before the change keep their columns.
   */
  const viewFields = useMemo(
    () => new Set(viewCols.map((c) => (c.field ?? c.packKey) as string)),
    [viewCols],
  );
  const dynamicCols: GridCol[] = useMemo(() => {
    const seen = new Set<string>();
    const out: GridCol[] = [];
    const add = (key: string, allowDuplicate: boolean) => {
      const col = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
      if (!col) {
        // A PINNED STAT FROM THE PACK. Without this branch the picker could
        // commit ?cols=pitp_share and the table would show nothing for it —
        // the URL said one thing and the page another.
        const pack = PACK_STAT_BY_KEY.get(key);
        if (!pack || seen.has(pack.key)) return;
        if (!allowDuplicate && viewFields.has(pack.key)) return;
        seen.add(pack.key);
        out.push({
          label: pack.label,
          packKey: pack.key,
          fmt: pack.format,
          pct: null,
          noPct: pack.noPct,
          sortKey: pack.key,
          desc: pack.desc,
        });
        return;
      }
      // filterOnly stats (shooting profile) never become grid columns.
      if (col.filterOnly || seen.has(col.field as string)) return;
      // An EXPLICIT tick renders even when the stat is already a default
      // column — same rule as the team explorer, and without it ticking
      // something like PPG would appear to do nothing at all. The legacy
      // filter-inferred path keeps skipping duplicates so old bookmarks don't
      // suddenly grow a second copy of a column they already had.
      // Deduped against the ACTIVE view rather than a fixed default set: with
      // views, "already a column" depends on which view is showing.
      if (!allowDuplicate && viewFields.has(col.field as string)) return;
      seen.add(col.field as string);
      out.push({
        label: col.label,
        field: col.field,
        // games + plus/minus display as whole numbers.
        fmt: col.field === "games" ? "int" : col.format === "pct1" ? "pct1" : "num1",
        pct: (PCT_KEYS as readonly string[]).includes(col.field as string) ? (col.field as PctKey) : null,
        // Sortable when the FIELD this stat displays is one the sort can
        // order on, so a pinned column behaves like a built-in one rather than
        // being read-only. Resolved by field, not by key — see the note on
        // SORT_KEY_BY_FIELD for why the key comparison this replaced left most
        // pinned columns unclickable.
        sortKey: SORT_KEY_BY_FIELD.get(col.field as string),
      });
    };
    for (const key of scopedSpec.cols) add(key, true);
    for (const f of scopedSpec.filters) add(f.stat, false);
    return out;
  }, [scopedSpec.cols, scopedSpec.filters, viewFields]);

  return (
    <>
      <PlayerFilterBar conferences={conferences} teams={teamOptions} />

      {/* Headline ledger — coral accent rule, ring + shadow, big display
          title. Mirrors /coaches "Head coaches" and /teams "By season" cards
          so the look reads consistently across the site. */}
      <div id="players-leaderboard" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 scroll-mt-6 -mx-6 lg:mx-0">
        {/* Compact D&3-style toolbar: search + count + compare on the left,
            sort/order/show on the right — one row, table starts below. */}
        <div className="px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center flex-wrap gap-2.5 min-w-0">
            {/* Search */}
            <div className="relative hidden lg:block">
              <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search player"
                aria-label="Search players by name"
                className="h-8 w-56 pl-8 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep">×</button>
              )}
            </div>
            {/* VIEW PICKER. A native select with optgroups rather than a
                custom popover — twelve options in five sections is exactly
                what the element is for, it matches the controls beside it,
                and it costs no JavaScript to open. Same choice as the team
                explorer, for the same reasons. */}
            <label className="hidden sm:inline-flex items-center gap-1.5 min-w-0">
              <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">
                View
              </span>
              <select
                value={spec.view || PLAYER_VIEWS[0]!.key}
                onChange={(e) => {
                  const key = e.target.value;
                  const v = playerViewByKey(key);
                  updateSpec({
                    ...spec,
                    view: key === PLAYER_VIEWS[0]!.key ? "" : key,
                    // The view carries its own sort. Without this the table
                    // stays ordered by a column the new view may not show, and
                    // a reader who picks Foul Related gets foul columns ranked
                    // by eWins.
                    sortBy: v.sortBy,
                    sortDir: v.sortDir,
                  });
                }}
                aria-label="Table view"
                className="h-8 max-w-44 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 transition-colors"
              >
                {playerViewGroups().map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {/* A native <option> renders text and nothing else, hence
                        a word rather than a padlock. Shown only to readers it
                        applies to - a subscriber has no use for a list of
                        labels naming what they already bought. */}
                    {g.views.map((v) => {
                      const locked = !paid && playerViewAccess(v.key).kind === "preview";
                      return (
                        <option
                          key={v.key}
                          value={v.key}
                          title={locked ? `${v.desc} — part of the Season Pass` : v.desc}
                        >
                          {locked ? `${v.label} · Pass` : v.label}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </label>
            {SHOW_COMPARE && (
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                title="Compare players"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-coral/40 bg-coral/6 text-coral text-[0.6rem] uppercase tracking-widest font-bold hover:bg-coral/10 hover:border-coral/60 transition-colors whitespace-nowrap"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                </svg>
                Compare
              </button>
            )}
            <SavedFiltersMenu
              scope="players"
              currentQuery={currentQuery}
              suggestedName={savedNameSuggestion}
              onApply={applySaved}
            />
            {/* Beside Saved, and deliberately quieter: both act on the table
                rather than narrowing it. Same menu the team explorer uses —
                it takes the view registry as a prop, so there is one download
                implementation and not two that have to agree about
                formatting. */}
            <DownloadMenu
              views={PLAYER_VIEWS}
              noun="players"
              // GATED, same as the team side. Leaving the exports open while
              // ten of the twelve views preview would have made those gates
              // decorative: a free reader could read five rows of Scoring
              // Context on screen and download all 2,614 of them.
              build={buildExport}
              buildAll={buildExportAll}
              rowCount={prefiltered.length}
              colCount={exportFieldCount}
              disabled={loading || prefiltered.length === 0}
            />
            <span className="hidden sm:inline text-xs text-ink-muted tabular whitespace-nowrap">
              {loading ? "loading…" : count > players.length
                ? `${players.length.toLocaleString()} of ${count.toLocaleString()}`
                : `${count.toLocaleString()}`}
              {!loading && spec.conf.length > 0 && <> · {spec.conf.length === 1 ? spec.conf[0] : `${spec.conf.length} confs`}</>}
              {!loading && spec.cls.length > 0 && <> · {spec.cls.length === 1 ? (CLASS_LABEL[spec.cls[0]!] ?? spec.cls[0]) : `${spec.cls.length} classes`}</>}
            </span>

            {/* THE CEILING, SAID BEFORE IT IS REACHED on an empty custom
                table, and said plainly the moment it bites. Finding out you
                have hit a limit is a worse moment than being told the limit
                while you still have room inside it — and a table quietly
                showing three of your five columns reads as broken. */}
            {view.custom && spec.cols.length === 0 && !paid && (
              <span className="hidden sm:inline text-xs text-ink-muted whitespace-nowrap">
                {FREE_LIMITS.statCols} columns on the free plan
              </span>
            )}
            {/* The ARCHIVE gate, beside the view gates rather than instead of
                them: this one is about seasons the server refused, and it can
                be showing at the same time as the column and preview notices. */}
            {seasonNotice && (
              <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Lock size={11} className="text-coral shrink-0" />
                <span className="text-ink-soft">{seasonNotice.text}</span>
                <Link
                  href={seasonNotice.href}
                  className="text-coral hover:underline font-medium"
                >
                  {seasonNotice.cta}
                </Link>
              </span>
            )}
            {colsLocked && (
              <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Lock size={11} className="text-coral shrink-0" />
                <span className="text-ink-soft">
                  Showing {FREE_LIMITS.statCols} of your {spec.cols.length} columns.
                </span>
                <Link href="/pricing" className="text-coral hover:underline font-medium">
                  See plans
                </Link>
              </span>
            )}
            {/* NO CHIP STRIP. It existed to answer "what is applied?" back when
                the answer was hidden inside a drawer. The filter rows below now
                say it in full — stat, comparator, value, and an X on each — so a
                second removable read-out of the same selection was two controls
                for one job, and the shorter one had to be capped and truncated.
                The team explorer dropped its own strip for the same reason. */}
          </div>
          {/* `w-auto`, not `w-full sm:w-auto`: full width forced this group onto
              its own line under Filters and Compare. It now shares that line,
              and the count takes the line below — matching /teams, which is the
              layout this toolbar was built to mirror in the first place. */}
          <div className="relative flex items-center gap-2 w-auto justify-end">
            {/* Sort/order live on the column headers; only the row-count select
                remains here. Search is FIRST so the phone reads left-to-right as
                "find one / show many". */}
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                // Inside the gesture — see the note on the teams explorer.
                searchInputRef.current?.focus({ preventScroll: true });
              }}
              aria-label="Search players"
              className="lg:hidden shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25 shadow-sm transition-colors"
            >
              <SearchGlass className="w-4 h-4" />
            </button>
            <span className="hidden sm:inline text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Show</span>
            <Select value={String(spec.limit)} onChange={(v) => updateSpec({ ...spec, limit: Number(v) })} ariaLabel="Result count" compact className="w-16 lg:w-18">
              {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {/* Mobile sliding search. text-sm by request; iOS zooms the page on
                focus below 16px, which text-base was there to prevent. */}
            <div
              ref={searchPanelRef}
              className={cn(
                "lg:hidden absolute inset-y-0 left-0 right-0 flex items-center gap-2 bg-card px-3 transform-gpu transition-transform duration-200 ease-out",
                searchOpen ? "translate-x-0" : "translate-x-[105%] pointer-events-none",
              )}
            >
              <div className="relative flex-1">
                <SearchGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search players…"
                  aria-label="Search players by name"
                  className="h-9 w-full pl-9 pr-3 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
                />
              </div>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setQuery(""); }}
                aria-label="Close search"
                className="shrink-0 h-9 px-2.5 text-sm font-medium text-coral hover:text-ink"
              >
                Done
              </button>
            </div>
          </div>
          {/* PHONE ONLY: the count, on its own line under the controls. */}
          <span className="sm:hidden basis-full text-xs text-ink-muted tabular whitespace-nowrap">
            {loading ? "loading…" : count > players.length
              ? `${players.length.toLocaleString()} of ${count.toLocaleString()}`
              : `${count.toLocaleString()}`}
            {!loading && spec.conf.length > 0 && <> · {spec.conf.length === 1 ? spec.conf[0] : `${spec.conf.length} confs`}</>}
            {!loading && spec.cls.length > 0 && <> · {spec.cls.length === 1 ? (CLASS_LABEL[spec.cls[0]!] ?? spec.cls[0]) : `${spec.cls.length} classes`}</>}
          </span>
        </div>
        {/* THE FILTER ROWS, on their own line under the toolbar — the same
            place and the same shape as the team explorer. This is where the
            "Filters" drawer used to be reached from; the rows are in the open
            now, so there is nothing to open. */}
        <PlayerStatRows spec={spec} onChange={updateSpec} />
        {/* D&3-style internal scroll: the table scrolls inside its own viewport
            (both axes) while BOTH header rows stay frozen and the RK + Player
            columns pin left. Sticky cells carry opaque backgrounds. */}
        {/* ~24 rows tall before the internal scroll takes over. Custom vertical
            rail (starts at the player rows); native thin horizontal bar. */}
        <div className="relative">
        <div
          ref={gridScrollRef}
          
          // WINDOWED AT EVERY WIDTH, so a real sticky <th> has a scrollport
          // to pin against on phones exactly as on desktop. This reverses the
          // md-only cap that used to sit here, under which phones got a cloned
          // header bar drawn outside the table by a component in
          // components/table/sticky-header-clone.tsx, deleted with this change.
          // Git history has it if it is ever wanted back.
          //
          // 80svh, MEASURED FROM dunksandthrees.com/epm, which solves this the
          // same way: one `overflow: auto` box at `h-[80vh]`, sticky `top-0`
          // band cells over sticky column cells, `left-0` on the frozen column,
          // and an opaque custom property behind every sticky cell. Their box
          // is 675px of an 844px phone.
          //
          // THE 20% IS THE POINT, not a rounding choice. A viewport-tall window
          // fills the screen, so every touch lands inside the table and the
          // page has no exposed surface left to scroll from. At 80svh there is
          // always page above or below the box, which is what keeps the table
          // a component on a page rather than a second scrolling application.
          //
          // svh rather than their vh: vh resolves to the LARGEST viewport, so
          // on iOS the box is sized as though the URL bar were hidden and
          // overhangs the screen while it is showing. svh is the smallest, so
          // the window always fits and never resizes mid-scroll.
          //
          // WHY THE HEADER STAYS PUT. A sticky cell pins to its scrollport's
          // top edge and shows only while that edge is on screen — which sounds
          // fragile, since the box starts below the fold. It holds because a
          // gesture landing on a scrollable box scrolls THAT box: a finger on
          // the table moves the table, the box's own top never moves, and the
          // header stays pinned. The page scrolls from the margins instead.
          //
          // overscroll-behavior is `none` below md. Left to chain, hitting the
          // last row hands the gesture on to the page, which slides the box's
          // top off screen and takes the header with it. `contain` stops the
          // chaining but keeps iOS's local rubber-band — the "I can drag the
          // entire table" complaint from 2026-08-22. Only `none` stops both.
          // The old warning against `none` here was written for an UNCAPPED
          // box, which had no vertical scroll to absorb the gesture; this one
          // does.
          //
          // DO NOT ADD `touch-action: pan-x` HERE. It looks like the tidy way
          // to say "horizontal is mine, vertical is the page's", but
          // touch-action RESTRICTS rather than delegates: the effective value
          // is the intersection down the ancestor chain, so pan-x on this box
          // removes pan-y for the whole gesture and the page cannot scroll
          // from any finger that lands on the table. Shipped exactly that on
          // 2026-08-22 and had to pull it.
          className="overflow-auto overscroll-x-contain max-md:overscroll-none players-scroll cursor-grab max-h-[80svh] md:max-h-[calc(100vh-1.5rem)]"
          {...panHandlers}
        >
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              {/* Band row — fixed h-6 with zero vertical padding so the column
                  row (sticky top-6) sits FLUSH beneath it: no see-through gap. */}
              <tr>
                <th className="sticky top-0 left-0 z-40 bg-paper-deep h-6 p-0" />
                <th style={playerLeft} className="sticky top-0 z-40 bg-paper-deep h-6 p-0" />
                {dynamicCols.length > 0 && (
                  <th colSpan={dynamicCols.length} className="sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center border-l border-hairline align-middle">
                    Your columns
                  </th>
                )}
                {viewBands.map((b) => (
                  <th
                    key={b.label}
                    colSpan={b.span}
                    className={cn(
                      "sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-center border-l border-hairline align-middle",
                      b.epm ? "text-coral" : "text-ink-muted",
                    )}
                  >
                    {b.label}
                  </th>
                ))}
                {/* THE COLUMN THAT ABSORBS WHAT IS LEFT, and dressed like a
                    column while it does it: the header band, the rule and the
                    zebra all run through it. It was blank and opaque for a
                    while, so the table ended where its last column ended and
                    the rest of the card was empty paper. Restored by request -
                    the striping reads as one table that happens to have room
                    left, where the blank version read as the card ending early
                    and the table floating in it.

                    Now that the stat columns take an 8% share of the spare
                    width, this is usually zero wide on a full view; it only
                    shows up where a handful of columns genuinely cannot fill
                    the card. */}
                <th aria-hidden className="sticky top-0 z-30 bg-paper-deep h-6 p-0 w-full" />
              </tr>
              {/* Column row — search lives in the Player cell (D&3-style). */}
              <tr>
                <th ref={rkThRef} className="sticky top-6 left-0 z-40 w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">RK</th>
                <th style={playerLeft} className="sticky top-6 z-40 bg-paper-deep border-b border-hairline px-1.5 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Player</th>
                {[...dynamicCols, ...viewCols].map((c, i) =>
                  c.sortKey ? (
                    // Index-qualified: a pinned stat that is also a default
                    // column renders twice on purpose, so the label alone is
                    // not a unique key.
                    // defaultSort MUST match what parsePlayerSpec would choose
                    // for THESE years. It is how SortableTh knows which column
                    // is already sorted when the URL carries no ?sort=, and it
                    // was once left at "epm" after the board's default moved to
                    // eWins — so the grid arrived sorted by eWins with the
                    // active arrow drawn on EPM. It is a variable now for the
                    // same reason: pre-2024 seasons have no eWins, so the
                    // default falls back to EPM and the arrow has to follow.
                    // w-[8%] is a width PREFERENCE - see the note on the
                    // team explorer's header row. It lets the stat columns
                    // share the spare width on a wide screen instead of
                    // leaving a blank strip down the right, while still
                    // yielding to content minimums when the table is too
                    // narrow and still leaving the slack visible when only a
                    // couple of columns are picked.
                    <SortableTh
                      key={`${c.field}-${i}`}
                      statKey={c.sortKey}
                      label={c.label}
                      basePath="/players"
                      defaultSort={effectiveDefaultSort}
                      idleArrows
                      // A preview locks the WHOLE table - re-sorting five rows
                      // out of four thousand would hand over the ranking the
                      // preview exists to withhold, one column at a time.
                      locked={previewCapped}
                      className="sticky top-6 z-30 w-[8%] bg-paper-deep border-b border-hairline"
                    />
                  ) : (
                    <th key={`${c.field}-${i}`} className="sticky top-6 z-30 w-[8%] bg-paper-deep border-b border-hairline px-1 sm:px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right whitespace-nowrap align-middle">
                      <StatLabel label={c.label} />
                    </th>
                  ),
                )}
                <th aria-hidden className="sticky top-6 z-30 bg-paper-deep border-b border-hairline w-full p-0" />
              </tr>
            </thead>
            <tbody>
              {loading && transformed.length === 0 ? (
                <tr>
                  <td colSpan={dynamicCols.length + viewCols.length + 3} className="px-4 py-16 text-center text-ink-muted">
                    Loading {seasonsKicker(spec.years).toLowerCase()}…
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={dynamicCols.length + viewCols.length + 3} className="px-4 py-12 text-center">
                    <div className="text-ink-soft">No players match these filters.</div>
                    <div className="mt-1.5 text-xs text-ink-muted">
                      Try widening conference, class, or games played.
                    </div>
                  </td>
                </tr>
              ) : (
                players.map((p, i) => {
                  // Zebra striping (opaque so the frozen columns can share it) —
                  // matches the /teams + /coaches tables. No row borders.
                  const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                  return (
                  <tr key={p.id} className={cn("group", zebra)}>
                    {/* RK — rank within the CURRENT sort */}
                    <td className={cn("sticky left-0 z-20 w-10 min-w-10 px-1 sm:px-2 py-1 text-center text-ink-muted tabular text-xs font-semibold transition-colors cursor-default", zebra, ROW_HOVER)}>
                      {previewCapped ? i + 1 : (pageSafe - 1) * spec.limit + i + 1}
                    </td>
                    {/* Player — photo + name + team/class/height meta */}
                    <td style={playerLeft} className={cn("sticky z-20 px-1.5 sm:px-3 py-1 transition-colors", zebra, ROW_HOVER)}>
                      <span className="flex items-center gap-2 sm:gap-2.5 min-w-0 sm:min-w-44">
                        <PlayerPhoto bartPlayerId={p.bart_player_id} name={p.name} size={28} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            {/* Only link players who actually have a page.
                                Pages are generated for ranked players plus the
                                freshman pass; linking the rest sent 30% of rows
                                to a 404. The plain-text branch below is what
                                generateStaticParams always intended for them. */}
                            {p.bart_player_id && p.has_page ? (
                              <Link href={`/players/${p.bart_player_id}`} title={p.name} className="font-medium text-ink hover:text-coral transition-colors whitespace-nowrap block leading-tight" prefetch={false}>
                                <PlayerName name={p.name} />
                              </Link>
                            ) : (
                              <span className="font-medium text-ink whitespace-nowrap block leading-tight" title={p.name}><PlayerName name={p.name} /></span>
                            )}
                            {/* THE RANK SITS WITH THE NAME — above `sm`. It is a
                                fact about the player, so it belongs against his
                                name rather than out at the column edge where it
                                read as a column of its own.

                                On a phone this column is 194px wide and the name
                                is already abbreviated to "C. Boozer" to fit, so
                                the badge moves down to the meta line instead —
                                see below. */}
                            <span className="hidden sm:inline-flex">
                              <TopHundredMark rank={p.rank_overall} />
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-[0.66rem] text-ink-muted whitespace-nowrap leading-tight">
                            {/* Logo only — the school name was the widest thing
                                in this column and the mark identifies the team on
                                its own. Name still reaches assistive tech and
                                hover via title/aria-label. */}
                            <Link
                              href={`/teams/${teamSlug(p.team_name)}`}
                              title={p.team_name}
                              aria-label={p.team_name}
                              className="inline-flex items-center hover:text-coral transition-colors" prefetch={false}>
                              <TeamLogo name={p.team_name} size={14} />
                            </Link>
                            {p.height && (
                              <span>· {formatHeight(p.height)}</span>
                            )}
                            {/* Class and season are the two facts that identify WHICH
                                season of a player this row is, so they read as pills
                                rather than as more dot-separated meta text. */}
                            {p.class && (
                              <span
                                className="inline-flex items-center rounded px-1.5 py-px text-[0.6rem] font-semibold"
                                style={CLASS_BADGE[p.class]
                                  ? { background: CLASS_BADGE[p.class]!.bg, color: CLASS_BADGE[p.class]!.fg }
                                  : undefined}
                              >
                                {p.class}
                              </span>
                            )}
                            {multiYear && (
                              <span className="inline-flex items-center rounded px-1.5 py-px text-[0.6rem] font-semibold
                                               tabular-nums bg-paper-deep text-ink-muted border border-hairline/70">
                                {seasonBadge(p.year)}
                              </span>
                            )}
                            {/* The phone's home for the rank: this line already
                                holds pills, it is shorter than the name line, and
                                the badge is the same height as the class chip. */}
                            <span className="sm:hidden inline-flex">
                              <TopHundredMark rank={p.rank_overall} />
                            </span>
                          </span>
                        </span>
                        {/* The copy affordance takes the outside position: it is
                            an action rather than information, and it is hover-only
                            anyway, so it costs the name line nothing out here. */}
                        <span className="hidden sm:inline-flex"><CopyName name={p.name} /></span>
                      </span>
                    </td>
                    {[...dynamicCols, ...viewCols].map((c, ci) => {
                      // Summary column or pack column — resolved here so the
                      // cell below does not care which catalogue it came from.
                      const v = c.packKey
                        ? packValue(p, c.packKey)
                        : (p[c.field!] as number | null);
                      const chip = c.noPct ? null
                        : c.packKey ? packPct(p, c.packKey)
                        : c.pct ? (pctMaps[c.pct].get(p.id) ?? null)
                        : null;
                      const hasChip = !c.noPct && (c.packKey ? true : c.pct !== null);
                      return (
                        <td
                          key={`${c.field ?? c.packKey}-${ci}`}
                          className={cn(
                            "px-1 sm:px-2 py-1 text-right tabular whitespace-nowrap transition-colors",
                            c.band && EPM_BAND_TINT,
                            ROW_HOVER,
                          )}
                          title={c.band && p.epm_estimated ? "Estimated — box-score model (no play-by-play for this season)" : undefined}
                        >
                          <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                            <span className={cn(c.label === "EPM" && "font-semibold", c.band && p.epm_estimated && "text-ink-soft")}>
                              {c.band && p.epm_estimated && c.label === "EPM" && (
                                <span className="text-coral/70 font-normal mr-0.5" aria-label="estimated">≈</span>
                              )}
                              {fmtGrid(v, c.fmt)}
                            </span>
                            {hasChip
                              ? <PercentileChip pct={chip} />
                              : <span className="h-5" aria-hidden="true" /> /* chip-height spacer keeps values row-aligned */}
                          </span>
                        </td>
                      );
                    })}
                    {/* Transparent, so the row's own stripe and hover tint
                        carry across it. See the header. */}
                    <td aria-hidden className={cn("p-0 transition-colors", zebra, ROW_HOVER)} />
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <HScrollRail target={gridScrollRef} />
        </div>
        <VScrollRail target={gridScrollRef} />
        </div>
        {anyEstimated && (
          <div className="px-3 lg:px-4 py-2 border-t border-hairline bg-paper-deep/20 flex items-center gap-1.5 text-[0.68rem] text-ink-muted">
            <span className="text-coral/70">≈</span>
            <span>Estimated EPM — the box-score half alone, for seasons with no play-by-play lineups to fit. Real EPM resumes in 2024, where lineup data begins.</span>
          </div>
        )}
        {/* Where the pagination would be, because that is what it
            replaces. Under the rows, never over them: the argument for
            subscribing IS the five real rows above it. */}
        {previewCapped && !loading && (
          <GateBar
            signedIn={signedIn}
            lead={`Showing the top ${Math.min(FREE_LIMITS.previewRows, count).toLocaleString()} of ${count.toLocaleString()}.`}
            tail={`${view.label} is part of the Season Pass. Your filters and search still narrow these rows — the full table and column sorting are what a Pass unlocks.`}
          />
        )}
        {!previewCapped && !loading && totalPages > 1 && (
          <PlayerPagination
            firstShown={(pageSafe - 1) * spec.limit + 1}
            lastShown={Math.min(pageSafe * spec.limit, count)}
            total={count}
            page={pageSafe}
            totalPages={totalPages}
            onPage={(p) => {
              setPage(p);
              document.getElementById("players-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}
      </div>

      {SHOW_COMPARE && (
        <ComparePlayersModal open={compareOpen} onClose={() => setCompareOpen(false)} />
      )}
    </>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
function HeaderField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * Coalesce a scroll-driven callback to at most one call per frame.
 *
 * Both rails setState from a scroll listener, and scroll fires faster than the
 * screen repaints — so the rails were queueing more React renders than there
 * were frames to show them in, on the main thread, during the one gesture that
 * most needs it free. A touch scroll runs on the compositor; work like this is
 * what drags it back.
 *
 * It also covers the MutationObserver below, which watches a subtree of ~1,000
 * cells and fired a full sync per mutation.
 */
function rafCoalesce(fn: () => void) {
  let queued = 0;
  const run = () => { queued = 0; fn(); };
  return {
    call: () => { if (!queued) queued = requestAnimationFrame(run); },
    cancel: () => { if (queued) cancelAnimationFrame(queued); queued = 0; },
  };
}

// Custom vertical scrollbar for the players grid. The native bar can't start
// its rail below the frozen header rows, so we hide it (globals.css) and render
// our own: up arrow, track, draggable thumb, down arrow — positioned to begin
// exactly at the first player row and end above the horizontal bar.
function VScrollRail({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; h: number } | null>(null);
  const drag = useRef<{ startY: number; startTop: number } | null>(null);

  const sync = () => {
    const el = target.current, rail = railRef.current;
    if (!el || !rail) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) { setThumb(null); return; }
    const railH = rail.clientHeight;
    const h = Math.max(36, (clientHeight / scrollHeight) * railH);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (railH - h);
    // Sub-pixel changes can't be seen, so they aren't worth a render.
    setThumb((prev) =>
      prev && Math.round(prev.top) === Math.round(top) && Math.round(prev.h) === Math.round(h)
        ? prev
        : { top, h });
  };

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const q = rafCoalesce(sync);
    sync();
    el.addEventListener("scroll", q.call, { passive: true });
    const ro = new ResizeObserver(q.call);
    ro.observe(el);
    // Content height changes (rows load/filter) without a resize of the box:
    const mo = new MutationObserver(q.call);
    mo.observe(el, { childList: true, subtree: true });
    return () => { q.cancel(); el.removeEventListener("scroll", q.call); ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const step = (dir: 1 | -1) => {
    target.current?.scrollBy({ top: dir * 160, behavior: "smooth" });
  };
  const onThumbDown = (e: React.PointerEvent) => {
    if (!thumb) return;
    drag.current = { startY: e.clientY, startTop: thumb.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onThumbMove = (e: React.PointerEvent) => {
    const el = target.current, rail = railRef.current;
    if (!drag.current || !el || !rail || !thumb) return;
    const railH = rail.clientHeight;
    const maxTop = railH - thumb.h;
    const next = Math.min(maxTop, Math.max(0, drag.current.startTop + (e.clientY - drag.current.startY)));
    el.scrollTop = (next / maxTop) * (el.scrollHeight - el.clientHeight);
  };
  const onThumbUp = () => { drag.current = null; };
  const onTrackClick = (e: React.MouseEvent) => {
    const el = target.current, rail = railRef.current;
    if (!el || !rail || !thumb) return;
    const y = e.clientY - rail.getBoundingClientRect().top;
    if (y < thumb.top || y > thumb.top + thumb.h) {
      el.scrollBy({ top: (y < thumb.top ? -1 : 1) * el.clientHeight * 0.9, behavior: "smooth" });
    }
  };

  if (!thumb) return null;
  const arrowCls = "flex items-center justify-center w-3.5 h-3.5 text-ink-muted hover:text-coral cursor-pointer transition-colors";
  return (
    <div className="absolute right-0.5 top-14 bottom-4 z-30 flex flex-col items-center gap-0.5 w-3.5" aria-hidden>
      <button type="button" tabIndex={-1} className={arrowCls} onClick={() => step(-1)}>
        <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 6.8 5 3.2l3.5 3.6" /></svg>
      </button>
      <div ref={railRef} onClick={onTrackClick} className="relative flex-1 w-2 rounded-full bg-ink/6 cursor-default">
        <div
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          className="absolute left-0 right-0 rounded-full bg-ink/30 hover:bg-ink/50 transition-colors cursor-grab active:cursor-grabbing"
          style={{ top: thumb.top, height: thumb.h }}
        />
      </div>
      <button type="button" tabIndex={-1} className={arrowCls} onClick={() => step(1)}>
        <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 3.2 5 6.8l3.5-3.6" /></svg>
      </button>
    </div>
  );
}

// Horizontal companion to VScrollRail — pinned to the visible bottom of the
// grid via position:sticky INSIDE the scroll container, so it's always on
// screen (the native bar would sit at the container's true bottom, ~1,200px
// down). Left/right arrows + draggable thumb; width tracks the viewport.
function HScrollRail({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ vw: number; left: number; w: number; x: number; bottomOff: number } | null>(null);
  const drag = useRef<{ startX: number; startLeft: number } | null>(null);

  const sync = () => {
    const el = target.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (scrollWidth <= clientWidth + 1) { setState(null); return; }
    const railW = clientWidth - 56; // room for the two arrows
    const w = Math.max(48, (clientWidth / scrollWidth) * railW);
    const left = (scrollLeft / (scrollWidth - clientWidth)) * (railW - w);
    setState((prev) =>
      prev && prev.vw === clientWidth &&
      Math.round(prev.left) === Math.round(left) && Math.round(prev.w) === Math.round(w)
        ? prev
        : { vw: clientWidth, left, w, x: 0, bottomOff: 0 });
  };

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const q = rafCoalesce(sync);
    sync();
    el.addEventListener("scroll", q.call, { passive: true });
    const ro = new ResizeObserver(q.call);
    ro.observe(el);
    const mo = new MutationObserver(q.call);
    mo.observe(el, { childList: true, subtree: true });
    return () => { q.cancel(); el.removeEventListener("scroll", q.call); ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const step = (dir: 1 | -1) => target.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
  const onDown = (e: React.PointerEvent) => {
    if (!state) return;
    drag.current = { startX: e.clientX, startLeft: state.left };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const el = target.current;
    if (!drag.current || !el || !state) return;
    const railW = state.vw - 56;
    const maxLeft = railW - state.w;
    const next = Math.min(maxLeft, Math.max(0, drag.current.startLeft + (e.clientX - drag.current.startX)));
    el.scrollLeft = (next / maxLeft) * (el.scrollWidth - el.clientWidth);
  };
  const onUp = () => { drag.current = null; };

  if (!state) return null;
  const arrowCls = "flex items-center justify-center w-4 h-3.5 text-ink-muted hover:text-coral cursor-pointer transition-colors shrink-0";
  return (
    // Sticky to the container's bottom edge; left-0 keeps it from drifting on
    // horizontal scroll.
    <div className="sticky bottom-0 left-0 z-40 h-4 bg-card/95" style={{ width: state.vw }} aria-hidden>
      <div className="flex items-center h-full px-1.5 gap-1">
        <button type="button" tabIndex={-1} className={arrowCls} onClick={() => step(-1)}>
          <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.8 1.5 3.2 5l3.6 3.5" /></svg>
        </button>
        <div ref={railRef} className="relative flex-1 h-2 rounded-full bg-ink/6">
          <div
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            className="absolute top-0 bottom-0 rounded-full bg-ink/30 hover:bg-ink/50 transition-colors cursor-grab active:cursor-grabbing"
            style={{ left: state.left, width: state.w }}
          />
        </div>
        <button type="button" tabIndex={-1} className={arrowCls} onClick={() => step(1)}>
          <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.2 1.5 6.8 5 3.2 8.5" /></svg>
        </button>
      </div>
    </div>
  );
}

// Copy-name button — appears on row hover next to the player name; flashes a
// check for a beat after copying.
/**
 * Top-100 mark for the explorer's name column.
 *
 * A rectangular chip stacking TOP over 100. Two rows rather than one keeps it
 * narrow — the name column is the widest frozen column in the table and the one
 * a phone can least afford to grow. Membership, not position — it carries no
 * numeral. The RK column beside it
 * already holds a number, and that number is the row's place in whatever sort
 * and filter is currently applied, which is a different quantity from the
 * board rank. Two numerals that agree on the default view and diverge the
 * moment you filter to one conference would read as a bug. The exact rank is
 * on the tooltip.
 *
 * Only the overall board gets a mark here. The mid-major board still exists and
 * still shows on the player page, but two marks in a table cell is more chrome
 * than a name column can carry.
 */
/**
 * The board mark on a grid row.
 *
 * WAS A GOLD "TOP 100" PLATE, which said the same thing about #1 and #100
 * and spent two lines of a tight row saying it. The rank itself is both
 * shorter and more informative, and it is the same mark the transfer portal
 * wears — one badge for one fact, everywhere it appears.
 */
function TopHundredMark({ rank }: { rank: number | null }) {
  if (rank === null || rank > 100) return null;
  return <TopHundredPill rank={rank} />;
}

function CopyName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy "${name}"`}
      aria-label={`Copy ${name} to clipboard`}
      onClick={() => {
        navigator.clipboard?.writeText(name).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "relative shrink-0 inline-flex items-center justify-center w-4.5 h-4.5 rounded cursor-pointer text-ink-muted/60 hover:text-coral transition-colors before:absolute before:-inset-3 before:content-['']",
        copied && "text-coral",
      )}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function SearchGlass({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

function PlayerPagination({
  firstShown, lastShown, total, page, totalPages, onPage,
}: {
  firstShown: number; lastShown: number; total: number; page: number; totalPages: number; onPage: (p: number) => void;
}) {
  const items = paginationItems(page, totalPages);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-hairline text-xs text-ink-muted">
      <span>
        Showing <span className="text-ink tabular">{firstShown.toLocaleString()}</span>–
        <span className="text-ink tabular">{lastShown.toLocaleString()}</span> of{" "}
        <span className="text-ink tabular">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Previous page"
        >‹ Prev</button>
        {items.map((it, i) =>
          it === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-ink-muted hidden sm:inline">…</span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onPage(it)}
              aria-current={it === page ? "page" : undefined}
              className={cn(
                "min-w-8 px-2 py-1 rounded tabular transition-colors hidden sm:inline-block",
                it === page ? "bg-coral text-white font-medium" : "hover:bg-paper-deep/60",
              )}
            >{it}</button>
          ),
        )}
        <span className="sm:hidden tabular px-1">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Next page"
        >Next ›</button>
      </div>
    </div>
  );
}

function paginationItems(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const want = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const visible = [...want].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const n of visible) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

function ValuePctCell({
  value, pct, format, emphasized = false,
}: {
  value: number | null;
  pct: number | null;
  format: "num1" | "pct1";
  emphasized?: boolean;
}) {
  const display =
    value === null || value === undefined
      ? "—"
      : format === "pct1"
      ? (value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%"
      : value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <td className={`px-3 py-2.5 text-right tabular ${emphasized ? "font-medium" : ""}`}>
      <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
        <span>{display}</span>
        <PercentileChip pct={pct} />
      </span>
    </td>
  );
}
