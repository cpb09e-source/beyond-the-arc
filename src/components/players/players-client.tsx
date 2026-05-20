"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { PercentileChip } from "@/components/percentile-chip";
import { PlayerFilterBar } from "@/components/players/player-filter-bar";
import { SortableTh } from "@/components/explorer/sortable-th";
import {
  DEFAULT_PLAYER_SPEC,
  PLAYER_COLS,
  parsePlayerSpec,
  type PlayerListSpec,
  type PlayerSummary,
} from "@/lib/players";
import { confMultiplier, topTeamMultiplier, top5Tier1Multiplier, top3InConfMultiplier } from "@/lib/conf-tiers";

// Sort labels mirror PlayerFilterBar's SORTS but kept short for the kicker.
const SORT_LABEL: Record<PlayerListSpec["sortBy"], string> = {
  bta_ind_ortg: "BTA PRTG",
  pir: "PIR",
  pts: "PPG",
  fg_pct: "FG%",
  fg3_pct: "3P%",
  ts_pct: "TS%",
  reb: "RPG",
  ast: "APG",
  games: "GP",
  name: "name",
};
const CLASS_LABEL: Record<string, string> = {
  Fr: "Freshmen", So: "Sophomores", Jr: "Juniors", Sr: "Seniors", Gr: "Graduates",
};
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
    pir,
    porpag: asNum(fromStart(row, PLAYER_COLS.porpag)),
    bta_ind_ortg: null,   // attached per cohort below
    fg3_made,
    fg3_att,
  };
}

// BTA PRTG = avg(0.69 × z(PIR), z(PORPAG)) × 20 × confMultiplier × topTeamMultiplier,
// computed within a season cohort so it ranks players against their actual
// peers. PIR is weighted at 69% to dampen raw PIR's bias toward high-usage
// scorers. Conference multiplier ranges from +19 % (Tier 1) to −23 % (Tier 5);
// players on a top-32 D-I team for 2025-26 get an additional +8 %. See
// src/lib/conf-tiers.ts. Attached in place — mutates `bta_ind_ortg`.
function attachBtaIndOrtg(players: PlayerSummary[]): void {
  function moments(vals: number[]) {
    if (vals.length === 0) return { mean: 0, sd: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return { mean, sd: Math.sqrt(variance) };
  }
  const pirVals = players.map((p) => p.pir).filter((v): v is number => typeof v === "number");
  const porVals = players.map((p) => p.porpag).filter((v): v is number => typeof v === "number");
  const pirM = moments(pirVals);
  const porM = moments(porVals);
  for (const p of players) {
    const zParts: number[] = [];
    if (typeof p.pir === "number" && pirM.sd > 0) zParts.push(((p.pir - pirM.mean) / pirM.sd) * 0.69);
    if (typeof p.porpag === "number" && porM.sd > 0) zParts.push((p.porpag - porM.mean) / porM.sd);
    if (zParts.length === 0) { p.bta_ind_ortg = null; continue; }
    const avg = zParts.reduce((a, b) => a + b, 0) / zParts.length;
    p.bta_ind_ortg =
      avg * 20
      * confMultiplier(p.team_conference)
      * topTeamMultiplier(p.team_name)
      * top5Tier1Multiplier(p.team_name)
      * top3InConfMultiplier(p.team_name);
  }
}

// Excluded if a player's year line is below ALL three: <8 GP, <10 MPG, <3 PPG.
// Keeps part-time contributors but trims deep-bench rows that clutter the list.
function isBelowBaseline(p: PlayerSummary): boolean {
  const gp = p.games ?? 0;
  const mpg = p.min_pg ?? 0;
  const ppg = p.pts_pg ?? 0;
  return gp < 8 && mpg < 10 && ppg < 3;
}

function applySpec(players: PlayerSummary[], spec: PlayerListSpec): PlayerSummary[] {
  let out = players.filter((p) => !isBelowBaseline(p));
  if (spec.conf.length) {
    const confSet = new Set(spec.conf);
    out = out.filter((p) => p.team_conference !== null && confSet.has(p.team_conference));
  }
  if (spec.teams.length) {
    const teamSet = new Set(spec.teams);
    out = out.filter((p) => teamSet.has(p.team_name));
  }
  if (spec.cls.length) {
    const clsSet = new Set(spec.cls);
    out = out.filter((p) => p.class !== null && clsSet.has(p.class));
  }
  out = out.filter((p) => (p.games ?? 0) >= spec.minGames);

  const sortKeyMap: Record<PlayerListSpec["sortBy"], keyof PlayerSummary> = {
    bta_ind_ortg: "bta_ind_ortg",
    pir: "pir",
    pts: "pts_pg", reb: "reb_pg", ast: "ast_pg",
    fg_pct: "fg_pct", fg3_pct: "fg3_pct", ts_pct: "ts_pct",
    games: "games",
    name: "name",
  };
  const key = sortKeyMap[spec.sortBy];
  const dir = spec.sortDir === "asc" ? 1 : -1;
  out = [...out].sort((a, b) => {
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

type PctMaps = {
  bta_ind_ortg: Map<number, number>;
  pir: Map<number, number>;
  fg_pct: Map<number, number>;
  fg3_pct: Map<number, number>;
  ts_pct: Map<number, number>;
};

// Per-season percentile rank for each chip-bearing stat. Computed across the
// eligible D-I pool (post-baseline, pre-filter) so chips remain meaningful
// when filters narrow the visible list. Higher value = higher percentile.
function attachPercentiles(players: PlayerSummary[]): PctMaps {
  const keys = ["bta_ind_ortg", "pir", "fg_pct", "fg3_pct", "ts_pct"] as const;
  const out = {
    bta_ind_ortg: new Map<number, number>(),
    pir: new Map<number, number>(),
    fg_pct: new Map<number, number>(),
    fg3_pct: new Map<number, number>(),
    ts_pct: new Map<number, number>(),
  };
  for (const key of keys) {
    const ranked = players
      .filter((p) => typeof p[key] === "number")
      .sort((a, b) => (a[key] as number) - (b[key] as number));
    const n = ranked.length;
    if (n < 2) continue;
    ranked.forEach((p, i) => {
      out[key].set(p.id, Math.round((i / (n - 1)) * 100));
    });
  }
  return out;
}


export function PlayersClient({ confsByYear }: { confsByYear: Record<string, string[]> }) {
  const search = useSearchParams();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const spec = parsePlayerSpec(params);
  // Union conferences across every year we have data for; matches the Team
  // Explorer's behavior so the picker offers every historical conference.
  const conferences = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(confsByYear)) for (const c of list) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [confsByYear]);

  const [rawByYear, setRawByYear] = useState<Record<number, RawPlayer[]>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

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
      const eligible = arr.filter((p) => !isBelowBaseline(p));
      attachBtaIndOrtg(eligible);
      const pctMaps = attachPercentiles(eligible);
      out[y] = { players: arr, pctMaps };
    }
    return out;
  }, [rawByYear, spec.years]);

  const transformed = useMemo(
    () => spec.years.flatMap((y) => processedByYear[y]?.players ?? []),
    [processedByYear, spec.years],
  );

  // Per-stat percentile lookup that picks the right year's cohort for the
  // player being chip'd. Player id is per-season-unique so no collisions.
  const pctMaps: PctMaps = useMemo(() => {
    const merged: PctMaps = {
      bta_ind_ortg: new Map(), pir: new Map(),
      fg_pct: new Map(), fg3_pct: new Map(), ts_pct: new Map(),
    };
    for (const y of spec.years) {
      const yearPct = processedByYear[y]?.pctMaps;
      if (!yearPct) continue;
      for (const k of Object.keys(merged) as (keyof PctMaps)[]) {
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

  const players = useMemo(() => {
    const list = applySpec(transformed, spec);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [transformed, spec, query]);
  const multiYear = spec.years.length > 1;

  return (
    <>
      <PlayerFilterBar conferences={conferences} teams={teamOptions} />

      {/* Headline ledger — coral accent rule, ring + shadow, big display
          title. Mirrors /coaches "Head coaches" and /teams "By season" cards
          so the look reads consistently across the site. */}
      <div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 mt-8">
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />
              <span>{seasonsKicker(spec.years)} · sorted by {SORT_LABEL[spec.sortBy]}</span>
            </div>
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
              Leaderboard
            </h2>
            <div className="mt-2 text-sm text-ink-muted">
              <span className="font-display text-xl text-ink tabular leading-none">
                {loading ? "—" : players.length.toLocaleString()}
              </span>{" "}
              {loading ? "loading…" : players.length === 1 ? "player" : "players"}
              {!loading && spec.conf.length > 0 && <> · {spec.conf.length === 1 ? spec.conf[0] : `${spec.conf.length} conferences`}</>}
              {!loading && spec.cls.length > 0 && <> · {spec.cls.length === 1 ? (CLASS_LABEL[spec.cls[0]!] ?? spec.cls[0]) : `${spec.cls.length} classes`}</>}
            </div>
          </div>
          <div className="relative shrink-0">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx={11} cy={11} r={7} />
              <line x1={20} y1={20} x2={16.65} y2={16.65} />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              aria-label="Search players by name"
              className="h-10 w-56 sm:w-72 pl-9 pr-9 rounded-md border border-ink/15 bg-white text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70">
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <Th className="w-12">{""}</Th>
                <SortableTh statKey="name" label="Player" basePath="/players" defaultSort="bta_ind_ortg" defaultDir="asc" align="left" />
                <Th>Team</Th>
                {multiYear && <Th className="w-16">Season</Th>}
                <Th className="w-10">Cl</Th>
                <Th className="w-12">Ht</Th>
                <SortableTh statKey="games" label="GP" basePath="/players" defaultSort="bta_ind_ortg" className="w-12" />
                <SortableTh statKey="bta_ind_ortg" label="BTA PRTG" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="pir" label="PIR" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="pts" label="PPG" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="fg_pct" label="FG%" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="fg3_pct" label="3P%" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="ts_pct" label="TS%" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="reb" label="RPG" basePath="/players" defaultSort="bta_ind_ortg" />
                <SortableTh statKey="ast" label="APG" basePath="/players" defaultSort="bta_ind_ortg" />
              </tr>
            </thead>
            <tbody>
              {loading && transformed.length === 0 ? (
                <tr>
                  <td colSpan={multiYear ? 15 : 14} className="px-4 py-16 text-center text-ink-muted">
                    Loading {seasonsKicker(spec.years).toLowerCase()}…
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={multiYear ? 15 : 14} className="px-4 py-12 text-center text-ink-muted">
                    No players match these filters.
                  </td>
                </tr>
              ) : (
                players.map((p, i) => (
                  <tr key={p.id} className={`transition-colors hover:bg-[var(--accent-tint,rgba(237,90,79,0.08))] ${i % 2 === 0 ? "bg-paper/70" : "bg-transparent"}`}>
                    <Td className="text-center text-ink-muted tabular">{i + 1}</Td>
                    <Td className="text-center">
                      <PlayerPhoto bartPlayerId={p.bart_player_id} name={p.name} size={28} />
                    </Td>
                    <Td>
                      {p.bart_player_id ? (
                        <Link href={`/players/${p.bart_player_id}`} className="font-medium text-ink hover:text-coral transition-colors">
                          {p.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{p.name}</span>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/teams/${teamSlug(p.team_name)}`} className="inline-flex items-center gap-2 hover:text-coral transition-colors">
                        <TeamLogo name={p.team_name} size={20} />
                        <span className="text-ink-soft text-sm">{p.team_name}</span>
                      </Link>
                    </Td>
                    {multiYear && <Td className="text-ink-muted tabular">{seasonLabel(p.year)}</Td>}
                    <Td className="text-ink-muted">{p.class ?? "—"}</Td>
                    <Td className="text-ink-muted whitespace-nowrap">{p.height ?? "—"}</Td>
                    <Td className="text-right tabular">{p.games ?? "—"}</Td>
                    <ValuePctCell value={p.bta_ind_ortg} pct={pctMaps.bta_ind_ortg.get(p.id) ?? null} format="num1" emphasized />
                    <ValuePctCell value={p.pir} pct={pctMaps.pir.get(p.id) ?? null} format="num1" />
                    <Td className="text-right tabular">{fmtNum(p.pts_pg, 1)}</Td>
                    <ValuePctCell value={p.fg_pct} pct={pctMaps.fg_pct.get(p.id) ?? null} format="pct1" />
                    <ValuePctCell value={p.fg3_pct} pct={pctMaps.fg3_pct.get(p.id) ?? null} format="pct1" />
                    <ValuePctCell value={p.ts_pct} pct={pctMaps.ts_pct.get(p.id) ?? null} format="pct1" />
                    <Td className="text-right tabular">{fmtNum(p.reb_pg, 1)}</Td>
                    <Td className="text-right tabular">{fmtNum(p.ast_pg, 1)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology — demoted out of the headline card so the leaderboard
          reads clean. Lives below as a quiet caption block where curious
          readers can find it without it dominating the page. */}
      <details className="mt-6 group">
        <summary className="cursor-pointer inline-flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted font-medium hover:text-ink transition-colors">
          <span className="h-px w-6 bg-ink-muted/40 group-hover:bg-coral transition-colors" />
          How BTA PRTG is calculated
          <span aria-hidden className="text-[0.6rem] text-ink-muted/60 group-open:rotate-90 transition-transform">▸</span>
        </summary>
        <p className="mt-3 text-xs text-ink-muted leading-relaxed max-w-3xl">
          BTA PRTG is a per-season z-composite of PIR (EuroLeague Performance
          Index Rating, per game minus turnovers, weighted 69% to dampen
          high-usage scorer bias) and Bart Torvik&apos;s PORPAG (Points Over
          Replacement Per Adjusted Game), scaled &times; 20. A conference
          multiplier adjusts for strength of schedule: top-tier conferences
          (SEC, Big 12, Big Ten, ACC, Big East) get a +19% boost, with
          progressively larger reductions for weaker leagues. Players on a
          top-32 D-I team for 2025-26 receive an additional +8% bump, and
          players on a top-5 record team within a Tier 1 conference receive
          an extra +6% on top of that. Missing terms are skipped so
          partial-data players still get scored. Players with fewer than 8
          games, 10 MPG, or 3 PPG are hidden.
        </p>
      </details>
    </>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
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
