"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { Select } from "@/components/select";

// ---------- types matching game_logs JSON shape ----------
type GameLog = {
  cbba_game_id: string;
  year: number;
  game_date: string | null;
  team_id: number;
  team_name: string;
  team_conference: string | null;
  opp_team_market: string | null;
  is_home: boolean | null;
  is_neutral: boolean | null;
  won: boolean;
  pts_scored: number | null;
  pts_against: number | null;
  pts_diff: number | null;
  poss: number | null;
  pace: number | null;
  fg3_made_diff: number | null;
  fg3_att_diff: number | null;
  fg2_made_diff: number | null;
  fg_made_diff: number | null;
  ft_made_diff: number | null;
  reb_diff: number | null;
  orb_diff: number | null;
  drb_diff: number | null;
  tov_diff: number | null;
  ast_diff: number | null;
  stl_diff: number | null;
  blk_diff: number | null;
  fbpts_diff: number | null;
  pitp_diff: number | null;
  scp_diff: number | null;
  fg3_pct: number | null;
  fg2_pct: number | null;
  ft_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
};

type Op = "gt" | "gte" | "lt" | "lte" | "eq";
type Filter = { id: string; stat: keyof GameLog; op: Op; value: number };

// ---------- filter stat catalog (count diffs + shooting %s) ----------
const STAT_OPTIONS: Array<{ key: keyof GameLog; label: string; group: string; defaultDir?: "gt" | "lt" }> = [
  // Scoring margin
  { key: "pts_diff",        label: "Pts Diff",        group: "Margin" },
  // Diff stats
  { key: "fg3_made_diff",   label: "3PM Diff",        group: "Differentials" },
  { key: "fg3_att_diff",    label: "3PA Diff",        group: "Differentials" },
  { key: "fg2_made_diff",   label: "2PM Diff",        group: "Differentials" },
  { key: "ft_made_diff",    label: "FTM Diff",        group: "Differentials" },
  { key: "reb_diff",        label: "REB Diff",        group: "Differentials" },
  { key: "orb_diff",        label: "OREB Diff",       group: "Differentials" },
  { key: "drb_diff",        label: "DREB Diff",       group: "Differentials" },
  { key: "tov_diff",        label: "TOV Diff",        group: "Differentials", defaultDir: "lt" },
  { key: "ast_diff",        label: "AST Diff",        group: "Differentials" },
  { key: "stl_diff",        label: "STL Diff",        group: "Differentials" },
  { key: "blk_diff",        label: "BLK Diff",        group: "Differentials" },
  { key: "fbpts_diff",      label: "FB Pts Diff",     group: "Differentials" },
  { key: "pitp_diff",       label: "Paint Pts Diff",  group: "Differentials" },
  { key: "scp_diff",        label: "2nd-Chance Diff", group: "Differentials" },
  // Shooting (offense)
  { key: "fg3_pct",         label: "3P%",   group: "Shooting (off)" },
  { key: "fg2_pct",         label: "2P%",   group: "Shooting (off)" },
  { key: "ft_pct",          label: "FT%",   group: "Shooting (off)" },
  { key: "efg_pct",         label: "eFG%",  group: "Shooting (off)" },
  { key: "ts_pct",          label: "TS%",   group: "Shooting (off)" },
  // Pace
  { key: "poss",            label: "Possessions", group: "Pace" },
  { key: "pace",            label: "Pace",        group: "Pace" },
];

const OPS: Array<{ value: Op; label: string }> = [
  { value: "gt",  label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt",  label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq",  label: "=" },
];

function makeFilter(stat: keyof GameLog = "tov_diff"): Filter {
  const def = STAT_OPTIONS.find((s) => s.key === stat);
  return {
    id: Math.random().toString(36).slice(2, 9),
    stat,
    op: def?.defaultDir === "lt" ? "lt" : "gt",
    value: 0,
  };
}

function matches(g: GameLog, f: Filter): boolean {
  const v = g[f.stat];
  if (typeof v !== "number") return false;
  switch (f.op) {
    case "gt":  return v >  f.value;
    case "gte": return v >= f.value;
    case "lt":  return v <  f.value;
    case "lte": return v <= f.value;
    case "eq":  return v === f.value;
  }
}

export function CalcClient() {
  const [years, setYears] = useState<number[]>([2026]);
  const [conference, setConference] = useState<string>("__all__");
  const [yearData, setYearData] = useState<Record<number, GameLog[]>>({});
  const [filters, setFilters] = useState<Filter[]>([makeFilter("tov_diff"), makeFilter("fg3_made_diff"), makeFilter("fbpts_diff")]);
  const [submitted, setSubmitted] = useState<{ filters: Filter[]; conference: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Fetch every selected year that isn't already cached. Parallel fetches.
  useEffect(() => {
    const missing = years.filter((y) => !yearData[y]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    Promise.all(
      missing.map((y) =>
        fetch(`/data/game-logs-by-year/${y}.json`)
          .then((r) => {
            if (!r.ok) throw new Error(`${y}: HTTP ${r.status}`);
            return r.json();
          })
          .then((arr: GameLog[]) => ({ y, arr }))
      )
    )
      .then((results) => {
        if (cancelled) return;
        setYearData((s) => {
          const next = { ...s };
          for (const { y, arr } of results) next[y] = arr;
          return next;
        });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [years, yearData]);

  // Concat across selected years
  const games = useMemo(() => {
    const out: GameLog[] = [];
    for (const y of years) {
      const arr = yearData[y];
      if (arr) out.push(...arr);
    }
    return out;
  }, [years, yearData]);

  // Conference list derived from loaded games — stays in sync with years.
  const allConferences = useMemo(() => {
    const s = new Set<string>();
    for (const g of games) if (g.team_conference) s.add(g.team_conference);
    return [...s].sort();
  }, [games]);

  const results = useMemo(() => {
    if (!submitted || games.length === 0) return null;
    const conf = submitted.conference;
    const matching = games.filter((g) => {
      if (conf !== "__all__" && g.team_conference !== conf) return false;
      return submitted.filters.every((f) => matches(g, f));
    });
    const wins = matching.filter((g) => g.won).length;
    const losses = matching.length - wins;
    return {
      total: matching.length,
      wins,
      losses,
      winPct: matching.length === 0 ? 0 : wins / matching.length,
      sample: matching.slice(0, 8),
    };
  }, [submitted, games]);

  function addFilter() {
    if (filters.length >= 8) return;
    setFilters((f) => [...f, makeFilter()]);
  }
  function removeFilter(id: string) {
    setFilters((f) => f.filter((x) => x.id !== id));
  }
  function patchFilter(id: string, patch: Partial<Filter>) {
    setFilters((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  return (
    <div className="space-y-6">
      {/* Year + filters */}
      <div className="bg-card border border-hairline rounded-lg">
        <div className="flex flex-wrap items-end gap-3 p-4 lg:p-5 border-b border-hairline">
          <Field label="Seasons">
            <MultiYearSelect years={years} onChange={setYears} />
          </Field>
          <Field label="Conference">
            <Select
              value={conference}
              onChange={setConference}
              className="min-w-44"
            >
              <option value="__all__">All conferences</option>
              {allConferences.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <div className="ml-auto text-xs text-ink-muted">
            {loading
              ? `Loading game logs…`
              : games.length > 0
              ? `${games.length.toLocaleString()} game records loaded`
              : loadErr
              ? `Game-log data not exported yet — run sync + re-export`
              : ""}
          </div>
        </div>

        <div className="p-4 lg:p-5 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Conditions</span>
            <span className="text-xs text-ink-muted">(all must be true; perspective = the team in the row)</span>
          </div>

          {filters.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-ink-muted w-10">{i === 0 ? "Where" : "And"}</span>
              <Select
                value={f.stat as string}
                onChange={(v) => patchFilter(f.id, { stat: v as keyof GameLog })}
                className="min-w-44"
              >
                {Object.entries(groupedOptions()).map(([g, opts]) => (
                  <optgroup key={g} label={g}>
                    {opts.map((o) => (
                      <option key={o.key as string} value={o.key as string}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <Select value={f.op} onChange={(v) => patchFilter(f.id, { op: v as Op })} className="w-16">
                {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <input
                type="number"
                step="any"
                value={f.value}
                onChange={(e) => patchFilter(f.id, { value: Number(e.target.value) })}
                className="h-9 w-28 px-2 rounded border border-hairline bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
              />
              {filters.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeFilter(f.id)}
                  className="text-sm text-ink-muted hover:text-coral px-2 py-1"
                  aria-label="Remove filter"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-3 border-t border-hairline mt-3">
            <button
              type="button"
              onClick={addFilter}
              disabled={filters.length >= 8}
              className="text-sm font-medium text-coral hover:text-ink disabled:opacity-40"
            >
              + Add condition
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setFilters([makeFilter("tov_diff")]); setConference("__all__"); setSubmitted(null); }}
                className="text-sm text-ink-muted hover:text-ink px-3 py-2"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setSubmitted({ filters: [...filters], conference })}
                disabled={loading || games.length === 0}
                className="text-sm font-medium bg-coral text-white px-5 py-2 rounded hover:bg-coral-soft disabled:opacity-40 transition-colors"
              >
                Calculate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {submitted && results && (
        <div className="bg-card border border-hairline rounded-lg overflow-hidden">
          <div className="p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-hairline">
            <div>
              <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-2">Chance of winning</div>
              <div className="font-display text-7xl text-coral tabular leading-none">
                {(results.winPct * 100).toFixed(1)}<span className="text-3xl text-coral/80">%</span>
              </div>
              <div className="mt-3 text-sm text-ink-muted">
                across {results.total.toLocaleString()} matching game-team perspectives
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-2">Record</div>
              <div className="font-display text-7xl text-ink tabular leading-none">
                {results.wins}-{results.losses}
              </div>
              <div className="mt-3 text-sm text-ink-muted">
                {results.total === 0
                  ? "No games matched these conditions."
                  : `${results.wins} wins, ${results.losses} losses`}
              </div>
            </div>
          </div>

          <div>
            <div className="px-4 lg:px-5 py-3 border-b border-hairline flex items-center flex-wrap gap-2">
              <span className="text-xs uppercase tracking-widest text-ink-muted font-medium mr-1">
                Conditions
              </span>
              {submitted.conference !== "__all__" && (
                <ConditionChip>Conference = {submitted.conference}</ConditionChip>
              )}
              {submitted.filters.map((f) => (
                <ConditionChip key={f.id}>{labelFor(f)}</ConditionChip>
              ))}
            </div>

            {results.sample.length > 0 && (
              <>
                <div className="px-4 lg:px-5 py-3 border-b border-hairline">
                  <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
                    Sample of matching games
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-hairline text-left">
                      <tr>
                        <Th>Date</Th><Th>Team</Th><Th>Opp</Th><Th>Result</Th>
                        {submitted.filters.map((f) => (
                          <Th key={f.id} align="right">{STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? String(f.stat)}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.sample.map((g) => (
                        <tr key={g.cbba_game_id + "-" + g.team_id} className="border-b border-hairline/60">
                          <Td className="text-ink-muted tabular">{g.game_date ?? "—"}</Td>
                          <Td>
                            <span className="inline-flex items-center gap-2">
                              <TeamLogo name={g.team_name} size={20} />
                              <span className="font-medium text-ink">{g.team_name}</span>
                            </span>
                          </Td>
                          <Td className="text-ink-soft">
                            {g.opp_team_market ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="text-ink-muted">vs</span>
                                <TeamLogo name={g.opp_team_market} size={20} />
                                <span>{g.opp_team_market}</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td className={g.won ? "text-coral font-medium" : "text-ink-muted"}>
                            {g.won ? "W" : "L"} {g.pts_scored ?? "—"}-{g.pts_against ?? "—"}
                          </Td>
                          {submitted.filters.map((f) => (
                            <Td key={f.id} align="right" className="tabular">
                              {formatStat(g[f.stat], f.stat as string)}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!submitted && games.length === 0 && !loading && (
        <div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">
          <p>Game-log data isn&apos;t exported yet for the selected season(s).</p>
          <p className="mt-2 text-xs">
            Run migrations 003 + 004, <code className="bg-paper-deep px-1 rounded">npm run sync:cbb-game-logs</code>,
            then <code className="bg-paper-deep px-1 rounded">npm run export:data &amp;&amp; npm run build</code>.
          </p>
        </div>
      )}
    </div>
  );
}

// Format a game-log stat value for display. Percentages → "55.5%", diff stats
// → signed integers ("+8" / "-5"), pace/poss → 1 decimal, anything else → 1 decimal.
function formatStat(v: number | string | boolean | null, key: string): string {
  if (typeof v !== "number") return "—";
  if (key.endsWith("_pct")) return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  if (key.endsWith("_diff")) return v > 0 ? `+${v}` : String(v);
  if (key === "poss" || key === "pace") return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function labelFor(f: Filter): string {
  const stat = STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? String(f.stat);
  const op = OPS.find((o) => o.value === f.op)?.label ?? f.op;
  return `${stat} ${op} ${f.value}`;
}

function ConditionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded border border-hairline bg-paper-deep/60 text-xs text-ink-soft tabular">
      {children}
    </span>
  );
}

function groupedOptions() {
  const groups: Record<string, typeof STAT_OPTIONS> = {};
  for (const o of STAT_OPTIONS) {
    if (!groups[o.group]) groups[o.group] = [];
    groups[o.group]!.push(o);
  }
  return groups;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
