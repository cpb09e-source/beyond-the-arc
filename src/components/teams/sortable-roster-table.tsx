"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NbaBadge } from "@/components/coaches/nba-badge";
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
  bta_portg: number | null;
};

type SortKey = "name" | "class" | "height" | "bta_portg" | "pir" | "pts" | "reb" | "ast" | "fg3_pct" | "ft_pct";

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
  // Default: BTA PRTG desc (best player first), preserving existing behavior.
  const [sortBy, setSortBy] = useState<SortKey>("bta_portg");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (p: RosterEntry): number | string | null => {
      switch (sortBy) {
        case "name":      return p.name.toLowerCase();
        case "class":     return CLASS_ORDER[p.class ?? ""] ?? 99;
        case "height":    return heightInches(p.height);
        case "bta_portg": return p.bta_portg;
        case "pir":       return p.pir;
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
    <div className="border border-hairline rounded-xl shadow-sm overflow-hidden bg-paper-deep/25">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <ThSort label="Player" active={sortBy==="name"} dir={sortDir} onClick={() => toggle("name","asc")} align="left" />
              <ThSort label="Cl"     active={sortBy==="class"} dir={sortDir} onClick={() => toggle("class","asc")} align="left" />
              <ThSort label="Ht"     active={sortBy==="height"} dir={sortDir} onClick={() => toggle("height","desc")} align="left" />
              <ThSort label="BTA PRTG" active={sortBy==="bta_portg"} dir={sortDir} onClick={() => toggle("bta_portg","desc")} />
              <ThSort label="PIR"    active={sortBy==="pir"} dir={sortDir} onClick={() => toggle("pir","desc")} />
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
                    <Link href={`/players/${p.bart_player_id}/`} className="font-medium text-ink hover:text-coral transition-colors">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{p.name}</span>
                  )}
                  {draftee && <NbaBadge year={draftee.year} pick={draftee.pick} team={draftee.team} />}
                </Td>
                <Td className="text-ink-muted">{p.class ?? "—"}</Td>
                <Td className="text-ink-muted whitespace-nowrap">{p.height ?? "—"}</Td>
                <Td align="right" className="tabular font-semibold text-ink">{fmtNum(p.bta_portg, 1)}</Td>
                <Td align="right" className="tabular">{fmtNum(p.pir, 1)}</Td>
                <Td align="right" className="tabular">{fmtNum(p.pts, 1)}</Td>
                <Td align="right" className="tabular">{fmtNum(p.reb, 1)}</Td>
                <Td align="right" className="tabular">{fmtNum(p.ast, 1)}</Td>
                <Td align="right" className="tabular">{fmtPct(p.fg3_pct)}</Td>
                <Td align="right" className="tabular">{fmtPct(p.ft_pct)}</Td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-2 sm:px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
function ThSort({
  label, active, dir, onClick, align = "right",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right";
}) {
  return (
    <th className={cn(
      "px-2 sm:px-3 py-2 text-xs uppercase tracking-widest font-medium whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/90 transition-colors",
      align === "right" && "text-right",
      active ? "text-ink" : "text-ink-muted",
    )}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1", align === "right" && "justify-end w-full")}>
        <span>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
