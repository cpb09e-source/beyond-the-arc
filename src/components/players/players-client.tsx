"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { PercentileChip } from "@/components/percentile-chip";
import { PlayerFilterBar, PlayerStatFilters } from "@/components/players/player-filter-bar";
import { ComparePlayersModal } from "@/components/players/compare-players-modal";
import { SortableTh } from "@/components/explorer/sortable-th";
import { Select } from "@/components/select";
import {
  DEFAULT_PLAYER_SPEC,
  PLAYER_COLS,
  PLAYER_STAT_COLUMNS,
  parsePlayerSpec,
  passesPlayerFilter,
  playerSpecToParams,
  type PlayerListSpec,
  type PlayerStatFilter,
  type PlayerSummary,
} from "@/lib/players";
import { confMultiplier, topTeamMultiplier, top5Tier1Multiplier, top3InConfMultiplier, teamStrengthMultiplier, powerConfSub500Multiplier, BTA_DEF_WEIGHT, btaDefScore } from "@/lib/conf-tiers";

const LIMIT_OPTIONS = [50, 100, 250, 500];

const CLASS_LABEL: Record<string, string> = {
  Fr: "Freshmen", So: "Sophomores", Jr: "Juniors", Sr: "Seniors", Gr: "Graduates",
};

// ---- Grouped stat-band grid (see docs/players-grid-rebuild-spec.md) ----
// One entry per data column. `pct` names the percentile map feeding the chip
// (null = no chip, e.g. MPG). `band` marks the EPM trio for the coral wash.
type GridFmt = "num1" | "pct1" | "pct100" | "int" | "epm";
type GridCol = {
  label: string;
  field: keyof PlayerSummary;
  fmt: GridFmt;
  pct: PctKey | null;
  sortKey?: PlayerListSpec["sortBy"];
  band?: boolean;
};
const GRID_COLS: GridCol[] = [
  { label: "MPG", field: "min_pg", fmt: "int", pct: null, sortKey: "min" },
  { label: "USG", field: "usage_pct", fmt: "pct1", pct: "usage_pct", sortKey: "usage" },
  { label: "Off", field: "off_epm", fmt: "epm", pct: "off_epm", sortKey: "off_epm", band: true },
  { label: "Def", field: "def_epm", fmt: "epm", pct: "def_epm", sortKey: "def_epm", band: true },
  { label: "EPM", field: "epm", fmt: "epm", pct: "epm", sortKey: "epm", band: true },
  { label: "PIR", field: "pir", fmt: "num1", pct: "pir", sortKey: "pir" },
  { label: "PPG", field: "pts_pg", fmt: "num1", pct: "pts_pg", sortKey: "pts" },
  { label: "TS%", field: "ts_pct", fmt: "pct1", pct: "ts_pct", sortKey: "ts_pct" },
  { label: "FG%", field: "fg_pct", fmt: "pct1", pct: "fg_pct", sortKey: "fg_pct" },
  { label: "3P%", field: "fg3_pct", fmt: "pct1", pct: "fg3_pct", sortKey: "fg3_pct" },
  { label: "ORB", field: "orb_pg", fmt: "num1", pct: "orb_pg", sortKey: "orb" },
  { label: "DRB", field: "drb_pg", fmt: "num1", pct: "drb_pg", sortKey: "drb" },
  { label: "RPG", field: "reb_pg", fmt: "num1", pct: "reb_pg", sortKey: "reb" },
  { label: "AST", field: "ast_pg", fmt: "num1", pct: "ast_pg", sortKey: "ast" },
  { label: "TOV%", field: "tov_pct", fmt: "pct1", pct: "tov_pct", sortKey: "tov_pct" },
  { label: "STL", field: "stl_pg", fmt: "num1", pct: "stl_pg", sortKey: "stl" },
  { label: "BLK", field: "blk_pg", fmt: "num1", pct: "blk_pg", sortKey: "blk" },
  { label: "HKM", field: "hkm_pct", fmt: "pct100", pct: "hkm_pct", sortKey: "hkm" },
];
// Band header row: label + how many GRID_COLS it spans (order must match).
const GRID_BANDS: Array<{ label: string; span: number; epm?: boolean }> = [
  { label: "Role", span: 2 },
  { label: "EPM", span: 3, epm: true },
  { label: "Scoring", span: 2 },
  { label: "Shooting", span: 3 },
  { label: "Rebounding", span: 3 },
  { label: "Handle", span: 2 },
  { label: "Defense", span: 3 },
];
const GRID_FIELDS = new Set(GRID_COLS.map((c) => c.field));

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
    default: return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
}
function seasonLabel(y: number): string {
  return `${y - 1}-${String(y).slice(-2)}`;
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

type RawPlayer = {
  id: number;
  bart_player_id: number | null;
  name: string;
  year: number;
  class: string | null;
  height: string | null;
  hometown: string | null;
  teams: { id: number; name: string; conference: string | null } | Array<{ id: number; name: string; conference: string | null }>;
  player_bart_stats: {
    raw_row: Array<string | number | null> | null;
    games: number | null;
    notes: string | null;
    projection: number | null;
  } | Array<{ raw_row: Array<string | number | null> | null; games: number | null; notes: string | null; projection: number | null }>;
};

function asNum(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function fromEnd(row: Array<string | number | null> | null, offset: number): unknown {
  if (!row || row.length <= offset) return null;
  return row[row.length - 1 - offset];
}
function fromStart(row: Array<string | number | null> | null, idx: number): unknown {
  if (!row || row.length <= idx) return null;
  return row[idx];
}

function transformPlayer(raw: RawPlayer): PlayerSummary {
  const team = Array.isArray(raw.teams) ? raw.teams[0]! : raw.teams;
  const stats = Array.isArray(raw.player_bart_stats) ? raw.player_bart_stats[0]! : raw.player_bart_stats;
  const row = stats?.raw_row ?? null;
  // Advanced aggregates from CBB Analytics player_game_stats — pre-baked
  // into the JSON by scripts/export-static-data.mts. Null when the player
  // has no game-log coverage for the season.
  const adv = (raw as RawPlayer & { advanced_stats?: { tov_pg: number | null; tov_pct: number | null; usage_pct: number | null; net_rtg: number | null } | null }).advanced_stats ?? null;

  const games = stats?.games ?? null;
  const pts_pg = asNum(fromEnd(row, PLAYER_COLS.pts_pg_offset));
  const reb_pg = asNum(fromEnd(row, PLAYER_COLS.reb_pg_offset));
  const ast_pg = asNum(fromEnd(row, PLAYER_COLS.ast_pg_offset));
  const stl_pg = asNum(fromEnd(row, PLAYER_COLS.stl_pg_offset));
  const blk_pg = asNum(fromEnd(row, PLAYER_COLS.blk_pg_offset));

  const fg2_made = asNum(fromStart(row, PLAYER_COLS.fg2_made));
  const fg2_att  = asNum(fromStart(row, PLAYER_COLS.fg2_att));
  const fg3_made = asNum(fromStart(row, PLAYER_COLS.fg3_made));
  const fg3_att  = asNum(fromStart(row, PLAYER_COLS.fg3_att));
  const ft_made  = asNum(fromStart(row, PLAYER_COLS.ft_made));
  const ft_att   = asNum(fromStart(row, PLAYER_COLS.ft_att));

  const fgm = fg2_made !== null && fg3_made !== null ? fg2_made + fg3_made : null;
  const fga = fg2_att  !== null && fg3_att  !== null ? fg2_att  + fg3_att  : null;
  const fg_pct = fgm !== null && fga !== null && fga > 0 ? fgm / fga : null;

  // TS% = PTS / (2 * (FGA + 0.44 * FTA))  — needs season totals + season pts
  let ts_pct: number | null = null;
  if (pts_pg !== null && games !== null && fga !== null && ft_att !== null) {
    const denom = 2 * (fga + 0.44 * ft_att);
    ts_pct = denom > 0 ? (pts_pg * games) / denom : null;
  }

  // eFG% = (FGM + 0.5 * 3PM) / FGA — credits 3PT shooting.
  const efg_pct = fgm !== null && fg3_made !== null && fga !== null && fga > 0
    ? (fgm + 0.5 * fg3_made) / fga
    : null;

  // FTA Rate = FTA / FGA — how often the player gets to the line per shot.
  const fta_rate = ft_att !== null && fga !== null && fga > 0 ? ft_att / fga : null;

  const orb_pg = asNum(fromEnd(row, PLAYER_COLS.orb_pg_offset));

  // PIR per game (EuroLeague Performance Index Rating).
  // Bart's player CSV doesn't expose per-game turnovers reliably, so we
  // compute the boxscore-positive minus missed-shot components and document
  // the omission in the UI footnote.
  const missed_fg_pg = asNum(fromStart(row, PLAYER_COLS.missed_fg_pg));
  const missed_ft_pg = asNum(fromStart(row, PLAYER_COLS.missed_ft_pg));
  let pir: number | null = null;
  if (pts_pg !== null && reb_pg !== null && ast_pg !== null && stl_pg !== null && blk_pg !== null) {
    const positives = pts_pg + reb_pg + ast_pg + stl_pg + blk_pg;
    const negatives = (missed_fg_pg ?? 0) + (missed_ft_pg ?? 0);
    pir = positives - negatives;
  }

  return {
    id: raw.id,
    bart_player_id: raw.bart_player_id,
    name: raw.name,
    team_name: team?.name ?? "—",
    team_conference: team?.conference ?? null,
    team_id: team?.id ?? 0,
    year: raw.year,
    class: raw.class,
    height: raw.height,
    hometown: raw.hometown,
    position_note: fromEnd(row, PLAYER_COLS.notes_offset) as string | null,
    games,
    min_pg: asNum(fromStart(row, PLAYER_COLS.min_pg)),
    pts_pg, reb_pg, ast_pg, stl_pg, blk_pg,
    fg_pct,
    fg3_pct: asNum(fromStart(row, PLAYER_COLS.fg3_pct)),
    fg2_pct: asNum(fromStart(row, PLAYER_COLS.fg2_pct)),
    ft_pct:  asNum(fromStart(row, PLAYER_COLS.ft_pct)),
    ts_pct,
    efg_pct,
    fta_rate,
    orb_pg,
    tov_pg: adv?.tov_pg ?? null,
    tov_pct: adv?.tov_pct ?? null,
    usage_pct: adv?.usage_pct ?? null,
    net_rtg: adv?.net_rtg ?? null,
    // AST/TOV ratio. Null when TOV is missing or zero (avoids inf/NaN).
    ast_to_tov: ast_pg !== null && adv?.tov_pg != null && adv.tov_pg > 0
      ? ast_pg / adv.tov_pg
      : null,
    drb_pg: reb_pg !== null && orb_pg !== null ? reb_pg - orb_pg : null,
    // HKM (Hakeem %) = BLK% + STL% — Bart raw cols 22/23 (verified: Bidunga 9 + 1.4).
    hkm_pct: (() => {
      const b = asNum(fromStart(row, 22)), s = asNum(fromStart(row, 23));
      return b !== null && s !== null ? b + s : null;
    })(),
    epm: null, off_epm: null, def_epm: null, epm_estimated: false, // attached from /data/epm-<year>.json (or box-epm-<year>.json)
    ewins: null, on_off: null, // EPM-extras (filter-only), from epm-<year>.json
    // Shooting profile — attached from /data/shooting-<year>.json (filter-only).
    rim_pct: null, mid_pct: null, assisted_pct: null, rim_rate: null, tp_rate: null,
    pir,
    porpag: asNum(fromStart(row, PLAYER_COLS.porpag)),
    bta_ind_ortg: null,   // attached per cohort below
    fg3_made,
    fg3_att,
  };
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

// Per-(year, position bucket) efficiency percentile lookup. For each player
// we compute their TS% percentile AND their FG% percentile within their
// position bucket, then take the WORST of the two. Catches both:
//   • low TS overall (the Tai'Reon Joseph archetype — bricks everything)
//   • good TS propped up by FT volume but awful field efficiency
//     (the Jahmir Young archetype — lives at the line, can't shoot)
//
// The ranking COHORT uses the stricter 18g / 20mpg / 5.3ppg floor (matches the
// SHOOTING percentile chips on the player profile via
// scripts/compute-player-ranks.mts), so a player whose profile chip says
// "25 pctile eFG" gets a penalty calibrated to that same 25th percentile.
// Non-strict players (above the leaderboard's 8/10/3 floor but below
// 18/18/5) are still scored — we look up their TS/FG values against the
// strict cohort's sorted distribution via binary search, so a 20-PPG
// scorer who only played 15 games still gets penalized.
// Returns 0–100 where 100 = most efficient at that position.
function effPctileByPositionMap(players: PlayerSummary[]): Map<number, number> {
  type Bucket = "G" | "F" | "C";
  const inStrictCohort = (p: PlayerSummary) =>
    (p.games ?? 0) >= 18 && (p.min_pg ?? 0) >= 20 && (p.pts_pg ?? 0) >= 5.3;
  const byBucket: Record<Bucket, PlayerSummary[]> = { G: [], F: [], C: [] };
  const strictByBucket: Record<Bucket, PlayerSummary[]> = { G: [], F: [], C: [] };
  for (const p of players) {
    const b = positionBucket(p.position_note);
    if (!b) continue;
    byBucket[b].push(p);
    if (inStrictCohort(p)) strictByBucket[b].push(p);
  }
  // Returns a function that maps any value to its percentile within the
  // strict cohort's distribution for the given key. Uses binary search so
  // every player (strict or not) gets a percentile against the same
  // calibrated distribution.
  function rankerFor(strictArr: PlayerSummary[], key: "ts_pct" | "fg_pct"): (v: number) => number | null {
    const sorted = strictArr
      .map((p) => p[key])
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    const n = sorted.length;
    if (n < 2) return () => null;
    return (v: number) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]! < v) lo = mid + 1;
        else hi = mid;
      }
      return Math.max(0, Math.min(100, Math.round((lo / (n - 1)) * 100)));
    };
  }
  const out = new Map<number, number>();
  for (const b of ["G", "F", "C"] as const) {
    const tsRanker = rankerFor(strictByBucket[b], "ts_pct");
    const fgRanker = rankerFor(strictByBucket[b], "fg_pct");
    for (const p of byBucket[b]) {
      const t = typeof p.ts_pct === "number" ? tsRanker(p.ts_pct) : null;
      const f = typeof p.fg_pct === "number" ? fgRanker(p.fg_pct) : null;
      if (t == null && f == null) continue;
      out.set(p.id, t == null ? f! : f == null ? t : Math.min(t, f));
    }
  }
  return out;
}

// Volume-shooter penalty — punish high-usage scorers who are inefficient
// relative to their position. Ramps in linearly:
//   ppgFactor: 0 at ≤12 PPG, 1 at ≥20 PPG
//   effFactor: 0 at ≥45th-percentile efficiency (worst-of TS / eFG vs position),
//              1 at ≤10th
// Max penalty: −10 BTA points. Applied as a flat add-on after the conference
// and top-team multipliers so a high-major's penalty isn't amplified by
// their schedule bonus. (Mirror of bta-prtg.mts :: volumeShooterPenalty.)
function volumeShooterPenalty(ppg: number | null, effPositionPctile: number | null): number {
  if (ppg == null || effPositionPctile == null) return 0;
  const ppgFactor = Math.max(0, Math.min(1, (ppg - 12) / 8));
  const effFactor = Math.max(0, Math.min(1, (45 - effPositionPctile) / 35));
  return -10 * ppgFactor * effFactor;
}

// BTA PRTG = avg(0.69 × z(PIR), z(PORPAG)) × 20 × confMultiplier × topTeamMultiplier
//   + volumeShooterPenalty(ppg, worst-of(TS pctile, eFG pctile within position))
// PIR is weighted at 69% to dampen its high-usage-scorer bias; the volume
// penalty closes that gap further for genuine bad-volume cases (including
// FT-line-inflated scorers whose TS looks fine but eFG is awful). Conference
// multiplier ranges from +19 % (Tier 1) to −23 % (Tier 5); top-32 D-I teams
// get an additional +8 %. See src/lib/conf-tiers.ts. Mutates `bta_ind_ortg`.
function attachBtaIndOrtg(players: PlayerSummary[]): void {
  function moments(vals: number[]) {
    if (vals.length === 0) return { mean: 0, sd: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return { mean, sd: Math.sqrt(variance) };
  }
  const pirVals = players.map((p) => p.pir).filter((v): v is number => typeof v === "number");
  const porVals = players.map((p) => p.porpag).filter((v): v is number => typeof v === "number");
  const defVals = players.map((p) => btaDefScore(p.blk_pg, p.stl_pg, p.reb_pg));
  const pirM = moments(pirVals);
  const porM = moments(porVals);
  const defM = moments(defVals);
  const effByPos = effPctileByPositionMap(players);
  for (const p of players) {
    const zParts: number[] = [];
    if (typeof p.pir === "number" && pirM.sd > 0) zParts.push(((p.pir - pirM.mean) / pirM.sd) * 0.69);
    if (typeof p.porpag === "number" && porM.sd > 0) zParts.push((p.porpag - porM.mean) / porM.sd);
    if (zParts.length === 0) { p.bta_ind_ortg = null; continue; }
    // Offensive blend + additive defensive tilt (see conf-tiers btaDefScore).
    const off = zParts.reduce((a, b) => a + b, 0) / zParts.length;
    const zDef = defM.sd > 0 ? (btaDefScore(p.blk_pg, p.stl_pg, p.reb_pg) - defM.mean) / defM.sd : 0;
    const avg = off + BTA_DEF_WEIGHT * zDef;
    const base =
      avg * 20
      * confMultiplier(p.team_conference)
      * topTeamMultiplier(p.team_name)
      * top5Tier1Multiplier(p.team_name)
      * top3InConfMultiplier(p.team_name)
      * teamStrengthMultiplier(p.team_name)
      * powerConfSub500Multiplier(p.team_name);
    p.bta_ind_ortg = base + volumeShooterPenalty(p.pts_pg, effByPos.get(p.id) ?? null);
  }
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
function filterSpec(players: PlayerSummary[], spec: PlayerListSpec): PlayerSummary[] {
  const confSet = spec.conf.length ? new Set(spec.conf) : null;
  const teamSet = spec.teams.length ? new Set(spec.teams) : null;
  const clsSet = spec.cls.length ? new Set(spec.cls) : null;
  const posSet = spec.pos.length ? new Set(spec.pos) : null;
  const out: PlayerSummary[] = [];
  for (const p of players) {
    if (isBelowBaseline(p)) continue;
    if (confSet && (p.team_conference === null || !confSet.has(p.team_conference))) continue;
    if (teamSet && !teamSet.has(p.team_name)) continue;
    if (clsSet && (p.class === null || !clsSet.has(p.class))) continue;
    if (posSet) {
      const bucket = positionBucket(p.position_note);
      if (bucket === null || !posSet.has(bucket)) continue;
    }
    if ((p.games ?? 0) < spec.minGames) continue;
    // Stat filters (AND-combined). gt/gte/lt/lte against a PlayerSummary field.
    let ok = true;
    for (const f of spec.filters) {
      if (!passesPlayerFilter(p, f)) { ok = false; break; }
    }
    if (!ok) continue;
    out.push(p);
  }
  return out;
}

function applySpec(players: PlayerSummary[], spec: PlayerListSpec): PlayerSummary[] {
  const out = filterSpec(players, spec);

  const sortKeyMap: Record<PlayerListSpec["sortBy"], keyof PlayerSummary> = {
    bta_ind_ortg: "bta_ind_ortg",
    pir: "pir",
    pts: "pts_pg", reb: "reb_pg", ast: "ast_pg",
    fg_pct: "fg_pct", fg3_pct: "fg3_pct", ts_pct: "ts_pct",
    games: "games",
    name: "name",
    epm: "epm", off_epm: "off_epm", def_epm: "def_epm",
    min: "min_pg", usage: "usage_pct", orb: "orb_pg", drb: "drb_pg",
    tov: "tov_pg", tov_pct: "tov_pct", stl: "stl_pg", blk: "blk_pg", hkm: "hkm_pct",
  };
  const key = sortKeyMap[spec.sortBy];
  const dir = spec.sortDir === "asc" ? 1 : -1;
  // `out` is already a fresh array from filterSpec, so sort in place.
  out.sort((a, b) => {
    const av = a[key] as number | string | null;
    const bv = b[key] as number | string | null;
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
  "bta_ind_ortg", "pir", "fg_pct", "fg3_pct", "ts_pct",
  "epm", "off_epm", "def_epm", "usage_pct", "pts_pg",
  "orb_pg", "drb_pg", "reb_pg", "ast_pg", "tov_pg", "tov_pct", "stl_pg", "blk_pg", "hkm_pct",
  // Filterable extras that can appear as dynamic columns:
  "efg_pct", "fg2_pct", "ft_pct", "fta_rate", "ast_to_tov", "porpag", "min_pg",
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
    const ranked = players
      .filter((p) => typeof p[key] === "number")
      .sort((a, b) => (a[key] as number) - (b[key] as number));
    const n = ranked.length;
    if (n < 2) continue;
    const inv = INVERTED_PCT.has(key);
    ranked.forEach((p, i) => {
      const pct = Math.round((i / (n - 1)) * 100);
      out[key].set(p.id, inv ? 100 - pct : pct);
    });
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

  const [rawByYear, setRawByYear] = useState<Record<number, RawPlayer[]>>({});
  // BTA EPM per season: bart_player_id -> {epm, off, def}. Fetched lazily per
  // selected year; 404 (no fit for that season) caches as an empty map.
  // Per-season impact map. `estimated` marks a season served by the box-score
  // Box-EPM model (pre-2024, no play-by-play) rather than the real RAPM fit.
  const [epmByYear, setEpmByYear] = useState<Record<number, { players: Record<string, { epm: number; off: number; def: number; ewins?: number | null; on_off?: number | null }>; estimated: boolean }>>({});
  // Shooting profile per season: bart_player_id -> {rim_pct,mid_pct,asst,rim_rate,tp_rate}. Filter-only.
  const [shootingByYear, setShootingByYear] = useState<Record<number, Record<string, { rim_pct: number | null; mid_pct: number | null; asst: number | null; rim_rate: number | null; tp_rate: number | null }>>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
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
  const rkThRef = useRef<HTMLTableCellElement>(null);
  const [rkW, setRkW] = useState(40);
  useEffect(() => {
    const measure = () => { const w = rkThRef.current?.getBoundingClientRect().width; if (w) setRkW(w); };
    measure();
    const ro = new ResizeObserver(measure);
    if (rkThRef.current) ro.observe(rkThRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const playerLeft = { left: `${rkW}px` };

  // Click-and-drag panning over the stat columns (MPG → HKM): grab anywhere in
  // the data area and drag left/right. A 4px threshold keeps plain clicks
  // (links, copy buttons, sort headers) working; interactive elements and the
  // sticky RK/Player cells never start a pan.
  const pan = useRef<{ x: number; left: number; active: boolean } | null>(null);
  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("a,button,input,select,[data-no-pan]")) return;
    pan.current = { x: e.clientX, left: gridScrollRef.current?.scrollLeft ?? 0, active: false };
  };
  const onGridPointerMove = (e: React.PointerEvent) => {
    const el = gridScrollRef.current;
    if (!pan.current || !el) return;
    const dx = e.clientX - pan.current.x;
    if (!pan.current.active && Math.abs(dx) < 4) return;
    if (!pan.current.active) {
      pan.current.active = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("select-none", "cursor-grabbing");
    }
    // Clamp to valid range so dragging past an edge can't push scrollLeft out of
    // bounds (which momentarily shifts the sticky RK/Player cells → the glitchy
    // truncation).
    const max = el.scrollWidth - el.clientWidth;
    // Round to whole pixels — a fractional scrollLeft leaves the sticky RK/Player
    // cells snapped to integers while the scrolled content sits sub-pixel, which
    // reads as a 1px shimmy on the frozen columns.
    el.scrollLeft = Math.round(Math.min(max, Math.max(0, pan.current.left - dx)));
  };
  const onGridPointerEnd = (e: React.PointerEvent) => {
    const el = gridScrollRef.current;
    if (pan.current?.active && el) {
      el.releasePointerCapture?.(e.pointerId);
      el.classList.remove("select-none", "cursor-grabbing");
    }
    pan.current = null;
  };
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
    Promise.all(
      toFetch.map((y) =>
        fetch(`/data/players-by-year/${y}.json`)
          .then((r) => r.json())
          .then((arr: RawPlayer[]) => [y, arr] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setRawByYear((s) => {
          const next = { ...s };
          for (const [y, arr] of entries) next[y] = arr;
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
      const arr = raw.map(transformPlayer);
      // Attach BTA EPM by bart id. Real RAPM fit where available, else the
      // estimated box-score model — `estimated` flags which for the UI marker.
      const epmEntry = epmByYear[y];
      if (epmEntry) {
        for (const p of arr) {
          const e = p.bart_player_id != null ? epmEntry.players[String(p.bart_player_id)] : undefined;
          if (e) { p.epm = e.epm; p.off_epm = e.off; p.def_epm = e.def; p.epm_estimated = epmEntry.estimated; p.ewins = e.ewins ?? null; p.on_off = e.on_off ?? null; }
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
      attachBtaIndOrtg(eligible);
      const pctMaps = attachPercentiles(eligible);
      out[y] = { players: arr, pctMaps };
    }
    return out;
  }, [rawByYear, spec.years, epmByYear, shootingByYear]);

  const transformed = useMemo(
    () => spec.years.flatMap((y) => processedByYear[y]?.players ?? []),
    [processedByYear, spec.years],
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
    () => applySpec(transformed, { ...spec, limit: Number.MAX_SAFE_INTEGER }),
    [transformed, spec],
  );

  // Live "how many players match" for the stat-filter popout. Runs the full
  // pipeline with a candidate filter set (keeping the active scope) so the
  // panel can show a running count as the user builds filters — before Apply.
  const previewCount = useMemo(
    () => (filters: PlayerStatFilter[]) =>
      filterSpec(transformed, { ...spec, filters }).length,
    [transformed, spec],
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
    const totalPages = Math.max(1, Math.ceil(total / spec.limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * spec.limit;
    return {
      players: matched.slice(start, start + spec.limit),
      count: total,
      totalPages,
      pageSafe,
    };
  }, [prefiltered, deferredQuery, spec.limit, page]);

  // Reset to page 1 whenever the result set changes (filters, sort, search, limit).
  useEffect(() => { setPage(1); }, [prefiltered, deferredQuery, spec.limit, spec.sortBy, spec.sortDir]);
  const multiYear = spec.years.length > 1;
  // Any visible row served by the estimated box-score model → show the legend.
  const anyEstimated = players.some((p) => p.epm_estimated && p.epm !== null);

  // Any stat the user filters on that ISN'T a default grid column gets
  // prepended as its own column (before MPG) so the numbers driving the
  // filter are visible. Label/format come from PLAYER_STAT_COLUMNS.
  const dynamicCols: GridCol[] = useMemo(() => {
    const seen = new Set<string>();
    const out: GridCol[] = [];
    for (const f of spec.filters) {
      const col = PLAYER_STAT_COLUMNS.find((c) => c.key === f.stat);
      // filterOnly stats (shooting profile) never become grid columns.
      if (!col || col.filterOnly || GRID_FIELDS.has(col.field) || seen.has(col.field as string)) continue;
      seen.add(col.field as string);
      out.push({
        label: col.label,
        field: col.field,
        // games + plus/minus display as whole numbers.
        fmt: col.field === "games" ? "int" : col.format === "pct1" ? "pct1" : "num1",
        pct: (PCT_KEYS as readonly string[]).includes(col.field as string) ? (col.field as PctKey) : null,
      });
    }
    return out;
  }, [spec.filters]);

  return (
    <>
      <PlayerFilterBar conferences={conferences} teams={teamOptions} />

      {/* Headline ledger — coral accent rule, ring + shadow, big display
          title. Mirrors /coaches "Head coaches" and /teams "By season" cards
          so the look reads consistently across the site. */}
      <div id="players-leaderboard" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 scroll-mt-6 -mx-6 lg:mx-0">
        {/* Compact D&3-style toolbar: search + count + compare on the left,
            sort/order/show on the right — one row, table starts below. */}
        <div className="px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
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
            {/* Filters button (stat builder) — between search and Compare. */}
            <div className="hidden lg:block"><PlayerStatFilters previewCount={previewCount} /></div>
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
            <span className="text-xs text-ink-muted tabular whitespace-nowrap">
              {loading ? "loading…" : count > players.length
                ? `${players.length.toLocaleString()} of ${count.toLocaleString()}`
                : `${count.toLocaleString()}`}
              {!loading && spec.conf.length > 0 && <> · {spec.conf.length === 1 ? spec.conf[0] : `${spec.conf.length} confs`}</>}
              {!loading && spec.cls.length > 0 && <> · {spec.cls.length === 1 ? (CLASS_LABEL[spec.cls[0]!] ?? spec.cls[0]) : `${spec.cls.length} classes`}</>}
            </span>
          </div>
          <div className="relative flex items-center gap-2 w-full sm:w-auto justify-end">
            {/* Sort/order live on the column headers; only the row-count select
                remains here. */}
            <span className="hidden sm:inline text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Show</span>
            <Select value={String(spec.limit)} onChange={(v) => updateSpec({ ...spec, limit: Number(v) })} ariaLabel="Result count" compact className="w-16 lg:w-18">
              {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {/* Mobile search icon */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search players"
              className="lg:hidden shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md border border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25 shadow-sm transition-colors"
            >
              <SearchGlass className="w-4 h-4" />
            </button>
            {/* Mobile sliding search — text-base (16px) avoids iOS zoom on focus */}
            <div
              ref={searchPanelRef}
              className={cn(
                "lg:hidden absolute inset-y-0 right-0 w-full flex items-center gap-2 bg-card transition-transform duration-200 ease-out",
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
                  className="h-9 w-full pl-9 pr-3 rounded-md border border-ink/15 bg-card text-ink text-base placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
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
        </div>
        {/* D&3-style internal scroll: the table scrolls inside its own viewport
            (both axes) while BOTH header rows stay frozen and the RK + Player
            columns pin left. Sticky cells carry opaque backgrounds. */}
        {/* ~24 rows tall before the internal scroll takes over. Custom vertical
            rail (starts at the player rows); native thin horizontal bar. */}
        <div className="relative">
        <div
          ref={gridScrollRef}
          className="overflow-auto overscroll-x-contain max-h-[calc(100vh-1.5rem)] players-scroll cursor-grab"
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerEnd}
          onPointerCancel={onGridPointerEnd}
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
                    Filtered
                  </th>
                )}
                {GRID_BANDS.map((b) => (
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
              </tr>
              {/* Column row — search lives in the Player cell (D&3-style). */}
              <tr>
                <th ref={rkThRef} className="sticky top-6 left-0 z-40 bg-paper-deep border-b border-hairline px-2 pb-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">RK</th>
                <th style={playerLeft} className="sticky top-6 z-40 bg-paper-deep border-b border-hairline px-3 pb-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Player</th>
                {[...dynamicCols, ...GRID_COLS].map((c) =>
                  c.sortKey ? (
                    <SortableTh key={c.label} statKey={c.sortKey} label={c.label} basePath="/players" defaultSort="epm" idleArrows className="sticky top-6 z-30 bg-paper-deep border-b border-hairline" />
                  ) : (
                    <th key={c.label} className="sticky top-6 z-30 bg-paper-deep border-b border-hairline px-2 pb-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right whitespace-nowrap align-middle">
                      {c.label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading && transformed.length === 0 ? (
                <tr>
                  <td colSpan={dynamicCols.length + GRID_COLS.length + 2} className="px-4 py-16 text-center text-ink-muted">
                    Loading {seasonsKicker(spec.years).toLowerCase()}…
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={dynamicCols.length + GRID_COLS.length + 2} className="px-4 py-12 text-center">
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
                    <td className={cn("sticky left-0 z-20 px-2 py-1 text-center text-ink-muted tabular text-xs font-semibold transition-colors cursor-default", zebra, ROW_HOVER)}>
                      {(pageSafe - 1) * spec.limit + i + 1}
                    </td>
                    {/* Player — photo + name + team/class/height meta */}
                    <td style={playerLeft} className={cn("sticky z-20 px-3 py-1 transition-colors", zebra, ROW_HOVER)}>
                      <span className="flex items-center gap-2.5 min-w-44">
                        <PlayerPhoto bartPlayerId={p.bart_player_id} name={p.name} size={28} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            {p.bart_player_id ? (
                              <Link href={`/players/${p.bart_player_id}`} className="font-medium text-ink hover:text-coral transition-colors whitespace-nowrap block leading-tight">
                                {p.name}
                              </Link>
                            ) : (
                              <span className="font-medium text-ink whitespace-nowrap block leading-tight">{p.name}</span>
                            )}
                            <CopyName name={p.name} />
                          </span>
                          <span className="flex items-center gap-1.5 text-[0.66rem] text-ink-muted whitespace-nowrap leading-tight">
                            <Link href={`/teams/${teamSlug(p.team_name)}`} className="inline-flex items-center gap-1 hover:text-coral transition-colors">
                              <TeamLogo name={p.team_name} size={12} />
                              {p.team_name}
                            </Link>
                            <span>· {p.class ?? "—"}{p.height ? ` · ${p.height.replace(/^(\d+)-(\d+)$/, "$1'$2\"")}` : ""}{multiYear ? ` · ${seasonLabel(p.year)}` : ""}</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    {[...dynamicCols, ...GRID_COLS].map((c) => {
                      const v = p[c.field] as number | null;
                      return (
                        <td
                          key={c.label}
                          className={cn(
                            "px-2 py-1 text-right tabular whitespace-nowrap transition-colors",
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
                            {c.pct
                              ? <PercentileChip pct={pctMaps[c.pct].get(p.id) ?? null} />
                              : <span className="h-5" aria-hidden="true" /> /* chip-height spacer keeps values row-aligned */}
                          </span>
                        </td>
                      );
                    })}
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
            <span>Estimated EPM — box-score model for seasons before play-by-play tracking (pre-2024). Real EPM resumes for 2024 onward.</span>
          </div>
        )}
        {!loading && totalPages > 1 && (
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

      <ComparePlayersModal open={compareOpen} onClose={() => setCompareOpen(false)} />
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
    setThumb({ top, h });
  };

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // Content height changes (rows load/filter) without a resize of the box:
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); mo.disconnect(); };
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
    setState({ vw: clientWidth, left, w, x: 0, bottomOff: 0 });
  };

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); mo.disconnect(); };
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
        "shrink-0 inline-flex items-center justify-center w-4.5 h-4.5 rounded cursor-pointer text-ink-muted/60 hover:text-coral transition-colors",
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
