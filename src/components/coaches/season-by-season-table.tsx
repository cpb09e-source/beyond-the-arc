"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { TeamName } from "@/components/team-name";
import { SeedChip } from "@/components/coaches/seed-chip";
import { confDisplay } from "@/lib/conf-display";
import type { CoachSeason, TourneyRound } from "@/lib/coaches";

type SortKey =
  | "year"
  | "school"
  | "conf"
  | "record"
  | "bta_rtg"
  | "adj_net"
  | "adj_oe"
  | "adj_de"
  | "awards";

type SortDir = "asc" | "desc";

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * Sortable Season-by-season table. Click any column header to sort by that
 * column (clicking the active column toggles asc/desc). Defaults to newest
 * year first.
 *
 * Numeric columns: numeric compare. String columns: locale compare.
 * Stat columns where higher-is-better (BTA RTG, Adj Net, Adj ORTG) default to
 * descending on first click; lower-is-better (Adj DRTG) defaults to ascending.
 */
export function SeasonBySeasonTable({ seasons }: { seasons: CoachSeason[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("year");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const arr = [...seasons];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const get = (s: CoachSeason): number | string | null => {
        switch (sortBy) {
          case "year": return s.year;
          case "school": return s.team;
          case "conf": return s.conference ?? "";
          case "record":
            // Sort by wins primarily; null records sort last.
            if (s.wins == null) return -Infinity;
            return s.wins;
          case "bta_rtg":
            // We display BTA rank (lower = better); for sort purposes we use
            // the rank value but flip the comparator below so "asc" on this
            // column = best-ranked first.
            return s.bta_rank ?? Infinity;
          case "adj_net": return s.adj_net ?? -Infinity;
          case "adj_oe": return s.adj_oe ?? -Infinity;
          case "adj_de": return s.adj_de ?? Infinity;
          case "awards":
            return awardsRank(s);
          default: return 0;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      const an = typeof av === "number" ? av : 0;
      const bn = typeof bv === "number" ? bv : 0;
      return (an - bn) * dir;
    });
    return arr;
  }, [seasons, sortBy, sortDir]);

  function clickHeader(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    // Sensible default direction per column.
    if (key === "year" || key === "adj_net" || key === "adj_oe" || key === "record" || key === "awards") {
      setSortDir("desc"); // higher = first
    } else if (key === "bta_rtg" || key === "adj_de") {
      setSortDir("asc"); // lower-is-better: BTA rank #1 first, lowest DRTG first
    } else {
      setSortDir("asc"); // alphabetical
    }
  }

  return (
    <table className="w-full text-sm table-fixed">
      <colgroup>
        <col style={{ width: "7%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "7%" }} />
        <col style={{ width: "8%" }} />
        <col style={{ width: "9%" }} />
        <col style={{ width: "9%" }} />
        <col style={{ width: "9%" }} />
        <col style={{ width: "9%" }} />
        <col style={{ width: "25%" }} />
      </colgroup>
      <thead>
        <tr className="border-b border-hairline text-left">
          <SortHeader label="SEASON" k="year" active={sortBy} dir={sortDir} onClick={clickHeader} className="px-5 lg:px-7" />
          <SortHeader label="SCHOOL" k="school" active={sortBy} dir={sortDir} onClick={clickHeader} />
          <SortHeader label="CONF" k="conf" active={sortBy} dir={sortDir} onClick={clickHeader} />
          <SortHeader label="RECORD" k="record" active={sortBy} dir={sortDir} onClick={clickHeader} align="center" />
          <SortHeader label="BTA RANK" k="bta_rtg" active={sortBy} dir={sortDir} onClick={clickHeader} align="center" />
          <SortHeader label="ADJ NET" k="adj_net" active={sortBy} dir={sortDir} onClick={clickHeader} align="center" />
          <SortHeader label="ADJ ORTG" k="adj_oe" active={sortBy} dir={sortDir} onClick={clickHeader} align="center" />
          <SortHeader label="ADJ DRTG" k="adj_de" active={sortBy} dir={sortDir} onClick={clickHeader} align="center" />
          <SortHeader label="AWARDS" k="awards" active={sortBy} dir={sortDir} onClick={clickHeader} className="px-5 lg:px-7" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((s, i) => (
          <tr key={`${s.year}-${s.team}-${i}`} className={`transition-colors hover:bg-[var(--accent-tint,rgba(237,90,79,0.08))] ${i % 2 === 0 ? "bg-paper/70" : "bg-transparent"}`}>
            <td className="px-5 lg:px-7 py-2.5 tabular text-ink-soft whitespace-nowrap">
              <Link
                href={`/teams/${teamSlug(s.team)}/${s.year}/`}
                className="hover:text-coral transition-colors"
                title={`${s.team} ${seasonLabel(s.year)}`}
              >
                {seasonLabel(s.year)}
              </Link>
            </td>
            <td className="px-3 py-2.5">
              <Link href={`/teams/${teamSlug(s.team)}/${s.year}/`} className="inline-flex items-center gap-2 group">
                <TeamLogo name={s.team} size={22} />
                <span className="text-ink group-hover:text-coral transition-colors truncate"><TeamName name={s.team} /></span>
                {/* Tournament seed chip — small, color-coded by tier. */}
                {s.seed !== null && <SeedChip seed={s.seed} size="sm" />}
                <SeasonPostseasonBadge season={s} />
              </Link>
            </td>
            <td className="px-3 py-2.5 text-ink-soft">{confDisplay(s.conference)}</td>
            <td className="px-3 py-2.5 text-center tabular text-ink">{s.wins != null && s.losses != null ? `${s.wins}-${s.losses}` : "—"}</td>
            <RatingCell value={s.bta_rank} pct={null} coral rankFormat />
            <RatingCell value={s.adj_net} pct={s.adj_net_pct} />
            <RatingCell value={s.adj_oe} pct={s.adj_oe_pct} />
            <RatingCell value={s.adj_de} pct={s.adj_de_pct} />
            <td className="px-5 lg:px-7 py-2.5">
              <SeasonAwards season={s} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function awardsRank(s: CoachSeason): number {
  // Higher value = more impressive achievement, so descending puts these on top.
  if (s.round === "Champion") return 10;
  if (s.round === "Runner-up") return 9;
  if (s.round === "Final Four") return 8;
  if (s.round === "Elite Eight") return 7;
  if (s.round === "Sweet 16") return 6;
  if (s.round === "R32") return 5;
  if (s.round === "R64") return 4;
  if (s.seed != null) return 3;
  if (s.reg_season_conf_champ) return 2;
  return 0;
}

function SortHeader({
  label, k, active, dir, onClick, align = "left", className = "",
}: {
  label: string;
  k: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const isActive = active === k;
  const alignText = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={`py-2 text-xs uppercase tracking-widest font-medium select-none ${alignText} ${className || "px-3"}`}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 uppercase ${align === "right" ? "flex-row-reverse" : ""} ${isActive ? "text-coral" : "text-ink-muted hover:text-ink"} transition-colors`}
      >
        <span>{label}</span>
        {isActive && (
          <span className="text-[0.6rem] -mb-0.5">{dir === "asc" ? "▲" : "▼"}</span>
        )}
      </button>
    </th>
  );
}

function RatingCell({ value, pct, coral, rankFormat }: { value: number | null | undefined; pct: number | null | undefined; coral?: boolean; rankFormat?: boolean }) {
  if (value == null) return <td className="px-3 py-2.5 text-center text-ink-muted/50 tabular">—</td>;
  let pillClass = "bg-paper-deep text-ink-muted";
  if (pct != null) {
    if (pct >= 90) pillClass = "bg-emerald-100 text-emerald-700";
    else if (pct >= 75) pillClass = "bg-emerald-50 text-emerald-700";
    else if (pct >= 50) pillClass = "bg-paper-deep text-ink-muted";
    else pillClass = "bg-paper-deep text-ink-muted/70";
  }
  const display = rankFormat ? `#${value}` : value.toFixed(1);
  return (
    <td className="px-3 py-2.5 tabular text-center">
      <span className="inline-flex items-center gap-1.5 leading-none">
        <span className={coral ? "text-coral font-medium" : "text-ink"}>{display}</span>
        {pct != null && (
          <span
            className={`inline-flex items-center justify-center text-[0.6rem] font-medium tabular leading-none rounded-full ${pillClass}`}
            style={{ minWidth: "1.75rem", height: "1.125rem", padding: "0 0.375rem" }}
          >
            {pct}
          </span>
        )}
      </span>
    </td>
  );
}

function SeasonAwards({ season }: { season: CoachSeason }) {
  const awards: { label: string; tone: "coral" | "muted" }[] = [];
  if (season.reg_season_conf_champ) {
    awards.push({ label: "Reg. season champ", tone: "coral" });
  }
  if (season.seed !== null) {
    const roundLabel =
      season.round === "Champion" ? "NCAA Champion"
      : season.round === "Runner-up" ? "NCAA Title runner-up"
      : season.round === "Final Four" ? "NCAA Final Four"
      : season.round === "Elite Eight" ? "NCAA Elite Eight"
      : season.round === "Sweet 16" ? "NCAA Sweet 16"
      : season.round === "R32" ? "NCAA Second Round"
      : season.round === "R64" ? "NCAA First Round"
      : season.round === "First Four" ? "NCAA First Four"
      : "NCAA Tournament";
    awards.push({ label: roundLabel, tone: "coral" });
  }
  if (awards.length === 0) return <span className="text-ink-muted/40">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {awards.map((a, i) => (
        <span
          key={i}
          className={`inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] tabular font-medium ${
            a.tone === "coral" ? "bg-coral/10 text-coral" : "border border-hairline text-ink-soft"
          }`}
        >
          {a.label}
        </span>
      ))}
    </span>
  );
}

function SeasonPostseasonBadge({ season }: { season: CoachSeason }) {
  if (season.seed === null) return null;
  const round = season.round;
  if (round === "Champion") {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white shadow-sm align-middle ml-1"
        style={{ width: 18, height: 18 }}
        title={`${season.year - 1}-${String(season.year).slice(-2)} National Champion · #${season.seed} seed`}
        aria-label="National champion"
      >
        <Trophy size={11} strokeWidth={2.5} fill="currentColor" fillOpacity={0.3} />
      </span>
    );
  }
  // Runner-up is the team that lost the national championship game — still a
  // Final Four team. Show the same F4 badge (with a "Runner-up" tooltip) so
  // these seasons aren't missed in the season-by-season view.
  if (round === "Final Four" || round === "Runner-up") {
    return (
      <span
        className="inline-flex items-center justify-center rounded px-1.5 py-0 bg-coral text-white text-[0.6rem] font-display font-bold leading-tight tabular tracking-wide shadow-sm ml-1"
        title={`${season.year - 1}-${String(season.year).slice(-2)} ${round === "Runner-up" ? "Runner-Up" : "Final Four"} · #${season.seed} seed`}
      >
        F4
      </span>
    );
  }
  return null;
}

// Suppress unused-import lint for the round type — we type-narrow against it.
void (null as unknown as TourneyRound);
