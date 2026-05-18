"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { PlayerFilterBar } from "@/components/players/player-filter-bar";
import { SortableTh } from "@/components/explorer/sortable-th";
import {
  DEFAULT_PLAYER_SPEC,
  PLAYER_COLS,
  parsePlayerSpec,
  type PlayerListSpec,
  type PlayerSummary,
} from "@/lib/players";

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

// BTA PRTG = mean of z-scored (PIR, PORPAG) × 20, computed within a season
// cohort so it ranks players against their actual peers. Non-power-conference
// players get a 15% strength-of-schedule penalty applied to the final score.
// Attached in place — mutates `bta_ind_ortg`.
const POWER_CONFS = new Set(["ACC", "B10", "B12", "SEC"]);
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
    if (typeof p.pir === "number" && pirM.sd > 0) zParts.push((p.pir - pirM.mean) / pirM.sd);
    if (typeof p.porpag === "number" && porM.sd > 0) zParts.push((p.porpag - porM.mean) / porM.sd);
    if (zParts.length === 0) { p.bta_ind_ortg = null; continue; }
    const avg = zParts.reduce((a, b) => a + b, 0) / zParts.length;
    const raw = avg * 20;
    const isPower = p.team_conference != null && POWER_CONFS.has(p.team_conference);
    p.bta_ind_ortg = isPower ? raw : raw * 0.85;
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
  if (spec.conference) out = out.filter((p) => p.team_conference === spec.conference);
  if (spec.cls) out = out.filter((p) => p.class === spec.cls);
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

function pctColor(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  return `hsl(${hue}, 38%, 38%)`;
}
function pctBg(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  return `hsl(${hue}, 38%, 92%)`;
}

export function PlayersClient({ confsByYear }: { confsByYear: Record<string, string[]> }) {
  const search = useSearchParams();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const spec = parsePlayerSpec(params);
  const conferences = confsByYear[String(spec.year)] ?? [];

  const [rawByYear, setRawByYear] = useState<Record<number, RawPlayer[]>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (rawByYear[spec.year]) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/data/players-by-year/${spec.year}.json`)
      .then((r) => r.json())
      .then((arr: RawPlayer[]) => {
        if (cancelled) return;
        setRawByYear((s) => ({ ...s, [spec.year]: arr }));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [spec.year, rawByYear]);

  const yearRaw = rawByYear[spec.year] ?? [];
  // Transform once, then attach the per-cohort composite + percentiles across
  // the eligible D-I pool (post-baseline, pre-filter).
  const transformed = useMemo(() => {
    const arr = yearRaw.map(transformPlayer);
    const eligible = arr.filter((p) => !isBelowBaseline(p));
    attachBtaIndOrtg(eligible);
    return arr;
  }, [yearRaw]);
  const pctMaps = useMemo(
    () => attachPercentiles(transformed.filter((p) => !isBelowBaseline(p))),
    [transformed],
  );
  const players = useMemo(() => {
    const list = applySpec(transformed, spec);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [transformed, spec, query]);

  return (
    <>
      <PlayerFilterBar conferences={conferences} />

      <div className="bg-card border border-hairline rounded-lg overflow-hidden mt-6">
        <div className="flex items-baseline justify-between gap-4 px-4 lg:px-5 py-3 border-b border-hairline">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl text-ink tabular">
              {loading ? "—" : players.length.toLocaleString()}
            </span>
            <span className="text-sm text-ink-muted">
              {loading ? "loading…" : (players.length === 1 ? "player" : "players")}
            </span>
          </div>
          <div className="relative flex-shrink-0">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              aria-label="Search players by name"
              className="h-9 w-56 sm:w-64 pl-3 pr-8 rounded border border-hairline bg-white text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <Th className="w-12">{""}</Th>
                <SortableTh statKey="name" label="Player" basePath="/players" defaultSort="bta_ind_ortg" defaultDir="asc" align="left" />
                <Th>Team</Th>
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
              {loading && yearRaw.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-16 text-center text-ink-muted">
                    Loading {spec.year - 1}-{String(spec.year).slice(-2)} players…
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-ink-muted">
                    No players match these filters.
                  </td>
                </tr>
              ) : (
                players.map((p, i) => (
                  <tr key={p.id} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
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
        <p className="px-4 lg:px-5 py-3 text-[0.65rem] text-ink-muted border-t border-hairline">
          BTA PRTG is a per-season z-composite of PIR (EuroLeague Performance Index Rating, per game minus turnovers) and Bart Torvik&apos;s PORPAG (Points Over Replacement Per Adjusted Game), scaled &times; 20. Non-power-conference players (outside ACC, Big Ten, Big 12, SEC) receive a 15% strength-of-schedule discount. Missing terms are skipped so partial-data players still get scored. Players with fewer than 8 games, 10 MPG, or 3 PPG are hidden.
        </p>
      </div>
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
        {pct !== null && (
          <span
            className="text-[0.6rem] font-medium tabular w-7 text-center py-px rounded leading-none"
            style={{ color: pctColor(pct), background: pctBg(pct) }}
            aria-label={`${pct}th percentile`}
          >
            {pct}
          </span>
        )}
      </span>
    </td>
  );
}
