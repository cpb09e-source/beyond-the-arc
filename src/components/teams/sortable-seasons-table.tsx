"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { SeedChip } from "@/components/coaches/seed-chip";
import type { StaticTeamSeasonRow, ConfRecord } from "@/lib/static-data";
import { confDisplay } from "@/lib/conf-display";
import { cn } from "@/lib/utils";

type SortKey = "year" | "conference" | "wins" | "conf_wins" | "coach" | "bta_rank" | "adjoe" | "adjde" | "tourney";

// Pretty-print the normalized tourney-round code from ConfRecord. Codes come
// from normalizeRound() in static-data: Champion / Runner-Up / F4 / E8 /
// S16 / R32 / R64 / First Four (or any other-as-is string).
function roundLabel(round: string | null): string {
  if (!round) return "";
  switch (round) {
    case "Champion":    return "National Champion";
    case "Runner-Up":   return "Title runner-up";
    case "F4":          return "Final Four";
    case "E8":          return "Elite Eight";
    case "S16":         return "Sweet 16";
    case "R32":         return "Second Round";
    case "R64":         return "First Round";
    case "First Four":  return "First Four";
    default:            return round;
  }
}
// Sort rank — deeper round = higher number. Lets the column sort by
// tournament success descending.
function roundDepth(round: string | null): number {
  switch (round) {
    case "Champion":    return 8;
    case "Runner-Up":   return 7;
    case "F4":          return 6;
    case "E8":          return 5;
    case "S16":         return 4;
    case "R32":         return 3;
    case "R64":         return 2;
    case "First Four":  return 1;
    default:            return 0;
  }
}

function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export function SortableSeasonsTable({
  seasons,
  currentYear,
  slug,
  confRecords,
  accentColor,
}: {
  seasons: StaticTeamSeasonRow[];
  currentYear: number;
  slug: string;
  // year → conf record; missing entries render as "—".
  confRecords: Map<number, ConfRecord>;
  // Optional team color for the current-season row tint.
  accentColor?: string | null;
}) {
  // Default: newest year first.
  const [sortBy, setSortBy] = useState<SortKey>("year");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (s: StaticTeamSeasonRow): number | string | null => {
      const t = s.team_trank_stats;
      const cr = confRecords.get(s.year);
      switch (sortBy) {
        case "year":       return s.year;
        case "conference": return confDisplay(s.conference).toLowerCase();
        case "wins":       return t?.wins ?? -1;
        case "conf_wins":  return cr?.wins ?? -1;
        case "coach":      return cr?.coachName?.toLowerCase() ?? "zzz";
        case "bta_rank":   return s.bta_rank ?? Number.POSITIVE_INFINITY;
        case "adjoe":      return t?.adjoe ?? null;
        case "adjde":      return t?.adjde ?? null;
        case "tourney":    return roundDepth(cr?.tourneyRound ?? null);
      }
    };
    return [...seasons].sort((a, b) => {
      const av = key(a), bv = key(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [seasons, sortBy, sortDir, confRecords]);

  function toggle(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }

  return (
    <div className="border border-hairline rounded-xl shadow-sm overflow-hidden bg-paper-deep/25">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <ThSort label="Season"     active={sortBy==="year"} dir={sortDir} onClick={() => toggle("year","desc")} align="left" />
              <ThSort label="Conf"       active={sortBy==="conference"} dir={sortDir} onClick={() => toggle("conference","asc")} align="left" />
              <ThSort label="Record"     active={sortBy==="wins"} dir={sortDir} onClick={() => toggle("wins","desc")} align="left" />
              <ThSort label="Conf Rec"   active={sortBy==="conf_wins"} dir={sortDir} onClick={() => toggle("conf_wins","desc")} align="left" />
              <ThSort label="Tournament" active={sortBy==="tourney"} dir={sortDir} onClick={() => toggle("tourney","desc")} align="left" />
              <ThSort label="Coach"      active={sortBy==="coach"} dir={sortDir} onClick={() => toggle("coach","asc")} align="left" />
              <ThSort label="BTA Rank"   active={sortBy==="bta_rank"} dir={sortDir} onClick={() => toggle("bta_rank","asc")} />
              <ThSort label="Adj ORtg"   active={sortBy==="adjoe"} dir={sortDir} onClick={() => toggle("adjoe","desc")} />
              <ThSort label="Adj DRtg"   active={sortBy==="adjde"} dir={sortDir} onClick={() => toggle("adjde","asc")} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const t = s.team_trank_stats;
              const cr = confRecords.get(s.year);
              const isCurrent = s.year === currentYear;
              return (
                <tr
                  key={s.year}
                  className={cn(
                    "transition-colors hover:bg-[var(--accent-tint)]",
                    !isCurrent && (i % 2 === 0 ? "bg-paper/70" : "bg-transparent"),
                    isCurrent && !accentColor && "bg-coral/10",
                  )}
                  style={isCurrent && accentColor ? { backgroundColor: `${accentColor}1a` } : undefined}
                >
                  <Td>
                    <Link
                      href={`/teams/${slug}/${s.year}/`}
                      className="group inline-flex items-center gap-2.5 transition-colors"
                    >
                      <TeamLogo name={s.name} size={20} />
                      <span className="font-medium text-ink group-hover:text-coral transition-colors">{seasonLabel(s.year)}</span>
                      {/* NCAA tournament seed (tier-colored). Pairs naturally
                          with the F4/Champion badge that follows when present. */}
                      {cr?.tourneySeed != null && <SeedChip seed={cr.tourneySeed} size="sm" />}
                      <TourneyBadge teamName={s.name} year={s.year} />
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">{confDisplay(s.conference)}</Td>
                  <Td className="tabular font-semibold text-ink">{t?.record ?? "—"}</Td>
                  <Td className="tabular text-ink-soft">
                    {cr && cr.wins !== null && cr.losses !== null ? `${cr.wins}-${cr.losses}` : "—"}
                  </Td>
                  <Td className="text-ink-soft">
                    {cr?.tourneyRound ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-coral/10 text-coral text-[0.7rem] font-medium tabular whitespace-nowrap">
                        {roundLabel(cr.tourneyRound)}
                      </span>
                    ) : (
                      <span className="text-ink-muted/50">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {cr?.coachName ? (
                      cr.coachSlug ? (
                        <Link href={`/coaches/${cr.coachSlug}/`} className="text-ink hover:text-coral transition-colors">
                          {cr.coachName}
                        </Link>
                      ) : (
                        <span className="text-ink">{cr.coachName}</span>
                      )
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </Td>
                  <Td align="right" className="tabular text-coral font-medium">{s.bta_rank !== null ? `#${s.bta_rank}` : "—"}</Td>
                  <Td align="right" className="tabular">{fmtNum(t?.adjoe ?? null, 1)}</Td>
                  <Td align="right" className="tabular">{fmtNum(t?.adjde ?? null, 1)}</Td>
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
