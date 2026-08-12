"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { abbrevName } from "@/lib/player-name";
import { NbaBadge } from "@/components/coaches/nba-badge";
import { PercentileChip } from "@/components/percentile-chip";
import { TeamLogo } from "@/components/team-logo";
import { loadNbaDraftees, normNbaName, type NbaDraftee } from "@/lib/nba-draftees";

type RosterEntry = {
  id: number;
  bart_player_id: number | null;
  name: string;
  class: string | null;
  height: string | null;
  hometown: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  pir: number | null;
  epm: number | null;
  // Optional: the preview season has no fit at all, and only the play-by-play
  // fit produces these two, so absent is a normal state rather than an error.
  ewins?: number | null;
  on_off?: number | null;
  ts_pct: number | null;
  usg_pct: number | null;
  // Preview-only — roster status shown as an inline badge next to the name
  // (transfers also show the logo of the school they came from).
  status?: "returning" | "transfer" | "newcomer";
  from?: string | null;
  // Preview-only — RSCI national recruit rank for incoming freshmen (top-100);
  // null on a newcomer = unranked ("UR"). Undefined for non-newcomers.
  rsci?: number | null;
  pcts?: {
    pir?: number | null;
    pts?: number | null;
    reb?: number | null;
    ast?: number | null;
    fg3_pct?: number | null;
    ft_pct?: number | null;
    epm?: number | null;
    ewins?: number | null;
    on_off?: number | null;
    ts_pct?: number | null;
    usg_pct?: number | null;
  };
};

type SortKey = "name" | "class" | "height" | "epm" | "ewins" | "on_off" | "ts_pct" | "usg_pct" | "pts" | "reb" | "ast" | "fg3_pct" | "ft_pct";

// Class ordering Fr → So → Jr → Sr → Gr; unknowns last.
const CLASS_ORDER: Record<string, number> = { Fr: 1, So: 2, Jr: 3, Sr: 4, Gr: 5 };

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
}
// "6-9" → 81 inches, for sort purposes only.
function heightInches(h: string | null): number | null {
  if (!h) return null;
  const m = h.match(/^(\d+)-(\d+)/);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 12 + parseInt(m[2]!, 10);
}

export function SortableRosterTable({
  roster,
  rankedPlayerIds,
}: {
  roster: RosterEntry[];
  rankedPlayerIds: Set<number>;
}) {
  // Default: EPM desc (best player first).
  const [sortBy, setSortBy] = useState<SortKey>("epm");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (p: RosterEntry): number | string | null => {
      switch (sortBy) {
        case "name":      return p.name.toLowerCase();
        case "class":     return CLASS_ORDER[p.class ?? ""] ?? 99;
        case "height":    return heightInches(p.height);
        case "epm":       return p.epm;
        case "ewins":     return p.ewins ?? null;
        case "on_off":    return p.on_off ?? null;
        case "ts_pct":    return p.ts_pct;
        case "usg_pct":   return p.usg_pct;
        case "pts":       return p.pts;
        case "reb":       return p.reb;
        case "ast":       return p.ast;
        case "fg3_pct":   return p.fg3_pct;
        case "ft_pct":    return p.ft_pct;
      }
    };
    return [...roster].sort((a, b) => {
      const av = key(a), bv = key(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [roster, sortBy, sortDir]);

  function toggle(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }

  // Lazy-load the NBA-players lookup so we can drop a small "NBA" pill next
  // to any roster player who was drafted or has logged an NBA game. Module-
  // level cache means this fetch happens once per page session.
  const [draftees, setDraftees] = useState<Record<string, NbaDraftee>>({});
  useEffect(() => {
    let cancelled = false;
    loadNbaDraftees().then((d) => { if (!cancelled) setDraftees(d); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden bg-paper-deep/25 -mx-4 lg:mx-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <ThSort label="Player" active={sortBy==="name"} dir={sortDir} onClick={() => toggle("name","asc")} align="left" />
              <ThSort label="Cl"     active={sortBy==="class"} dir={sortDir} onClick={() => toggle("class","asc")} align="left" />
              <ThSort label="Ht"     active={sortBy==="height"} dir={sortDir} onClick={() => toggle("height","desc")} align="left" />
              <ThSort label="EPM"    active={sortBy==="epm"} dir={sortDir} onClick={() => toggle("epm","desc")} />
              <ThSort label="eWINS"  active={sortBy==="ewins"} dir={sortDir} onClick={() => toggle("ewins","desc")} />
              <ThSort label="ON/OFF" active={sortBy==="on_off"} dir={sortDir} onClick={() => toggle("on_off","desc")} />
              <ThSort label="TS%"    active={sortBy==="ts_pct"} dir={sortDir} onClick={() => toggle("ts_pct","desc")} />
              <ThSort label="USG%"   active={sortBy==="usg_pct"} dir={sortDir} onClick={() => toggle("usg_pct","desc")} />
              <ThSort label="PPG"    active={sortBy==="pts"} dir={sortDir} onClick={() => toggle("pts","desc")} />
              <ThSort label="RPG"    active={sortBy==="reb"} dir={sortDir} onClick={() => toggle("reb","desc")} />
              <ThSort label="APG"    active={sortBy==="ast"} dir={sortDir} onClick={() => toggle("ast","desc")} />
              <ThSort label="3P%"    active={sortBy==="fg3_pct"} dir={sortDir} onClick={() => toggle("fg3_pct","desc")} />
              <ThSort label="FT%"    active={sortBy==="ft_pct"} dir={sortDir} onClick={() => toggle("ft_pct","desc")} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const draftee = draftees[normNbaName(p.name)];
              return (
              <tr
                key={p.id}
                className={cn(
                  "transition-colors hover:bg-[var(--accent-tint)]",
                  i % 2 === 0 ? "bg-paper/70" : "bg-transparent",
                )}
              >
                <Td>
                  {p.bart_player_id && rankedPlayerIds.has(p.bart_player_id) ? (
                    <Link href={`/players/${p.bart_player_id}/`} title={p.name} className="font-medium text-ink hover:text-coral transition-colors">
                      {abbrevName(p.name)}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink" title={p.name}>{abbrevName(p.name)}</span>
                  )}
                  {draftee && <NbaBadge year={draftee.year} pick={draftee.pick} team={draftee.team} />}
                  {p.status && <StatusBadge status={p.status} from={p.from} />}
                  {p.status === "newcomer" && p.rsci !== undefined && <RsciBadge rank={p.rsci} />}
                </Td>
                <Td className="text-ink-muted">{p.class ?? "—"}</Td>
                <Td className="text-ink-muted whitespace-nowrap">{p.height ?? "—"}</Td>
                <StatCell value={p.epm != null ? (p.epm >= 0 ? "+" : "") + fmtNum(p.epm, 1) : "—"} pct={p.pcts?.epm ?? null} emphasized />
                {/* Both come from the play-by-play fit only, so a box-estimate
                    player shows "—" here while still carrying an EPM. */}
                <StatCell value={fmtNum(p.ewins ?? null, 1)} pct={p.pcts?.ewins ?? null} />
                <StatCell value={p.on_off != null ? (p.on_off >= 0 ? "+" : "") + fmtNum(p.on_off, 1) : "—"} pct={p.pcts?.on_off ?? null} />
                <StatCell value={fmtPct(p.ts_pct)}       pct={p.pcts?.ts_pct    ?? null} />
                <StatCell value={fmtPct(p.usg_pct)}      pct={p.pcts?.usg_pct   ?? null} />
                <StatCell value={fmtNum(p.pts, 1)}       pct={p.pcts?.pts       ?? null} />
                <StatCell value={fmtNum(p.reb, 1)}       pct={p.pcts?.reb       ?? null} />
                <StatCell value={fmtNum(p.ast, 1)}       pct={p.pcts?.ast       ?? null} />
                <StatCell value={fmtPct(p.fg3_pct)}      pct={p.pcts?.fg3_pct   ?? null} />
                <StatCell value={fmtPct(p.ft_pct)}       pct={p.pcts?.ft_pct    ?? null} />
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, from }: { status: "returning" | "transfer" | "newcomer"; from?: string | null }) {
  if (status === "returning") {
    return <span className="ml-2 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-600">Ret</span>;
  }
  if (status === "newcomer") {
    return <span className="ml-2 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500">New</span>;
  }
  return (
    <>
      <span className="ml-2 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-coral/15 text-coral">
        Xfer
      </span>
      {from && <TeamLogo name={from} size={18} className="ml-1.5 inline-block align-middle rounded-[2px]" />}
    </>
  );
}

// RSCI recruit-rank chip for incoming freshmen. Ranked (top-100) → amber "#13";
// unranked → muted "UR". title carries the source for hover context.
function RsciBadge({ rank }: { rank?: number | null }) {
  if (rank == null) {
    return (
      <span
        title="Outside the RSCI top 100"
        className="ml-1.5 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-ink/8 text-ink-muted"
      >
        UR
      </span>
    );
  }
  return (
    <span
      title={`RSCI national recruit rank #${rank}`}
      className="ml-1.5 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600"
    >
      #{rank}
    </span>
  );
}

function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-1 sm:px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
function StatCell({ value, pct, emphasized = false }: { value: string; pct: number | null; emphasized?: boolean }) {
  return (
    <Td align="right" className={cn("tabular", emphasized && "font-semibold text-ink")}>
      <span className="inline-flex items-baseline justify-end gap-1.5">
        <span>{value}</span>
        <PercentileChip pct={pct} />
      </span>
    </Td>
  );
}
function ThSort({
  label, active, dir, onClick, align = "right", wrap = false,
}: {
  label: React.ReactNode; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right"; wrap?: boolean;
}) {
  return (
    <th className={cn(
      "p-0 text-xs uppercase tracking-wide sm:tracking-widest font-medium select-none cursor-pointer hover:bg-paper-deep/90 transition-colors",
      wrap ? "whitespace-normal" : "whitespace-nowrap",
      align === "right" && "text-right",
      active ? "text-ink" : "text-ink-muted",
    )}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 w-full px-1.5 sm:px-3 py-3 sm:py-2", align === "right" && "justify-end")}>
        <span className={wrap ? "leading-tight text-center" : undefined}>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
