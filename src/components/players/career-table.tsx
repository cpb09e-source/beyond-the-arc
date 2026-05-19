"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { SeasonGamesModal } from "@/components/players/season-games-modal";

type Season = {
  year: number;
  team_name: string;
  team_conference: string | null;
  class: string | null;
  raw_row: Array<string | number | null> | null;
  games: number | null;
  notes: string | null;
  projection: number | null;
};

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fromEnd(row: Array<string | number | null> | null, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function pctFromIdx(row: Array<string | number | null> | null, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function CareerTable({
  seasons,
  bartPlayerId,
  playerName,
}: {
  seasons: Season[];
  bartPlayerId: number;
  playerName: string;
}) {
  const [openFor, setOpenFor] = useState<{ year: number; teamName: string } | null>(null);

  return (
    <>
      <div className="bg-card border border-hairline rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline text-left">
            <tr>
              <Th>Season</Th><Th>Team</Th>
              <Th hideUntil="sm">Cl</Th>
              <Th align="right">GP</Th>
              <Th align="right">PPG</Th>
              <Th align="right">RPG</Th>
              <Th align="right" hideUntil="sm">APG</Th>
              <Th align="right" hideUntil="md">3P%</Th>
              <Th align="right" hideUntil="md">2P%</Th>
              <Th align="right" hideUntil="md">FT%</Th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.year} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
                <Td className="font-medium">
                  <button
                    type="button"
                    onClick={() => setOpenFor({ year: s.year, teamName: s.team_name })}
                    className="text-ink hover:text-coral transition-colors underline decoration-dotted underline-offset-4"
                    title={`Open ${seasonLabel(s.year)} game log`}
                  >
                    {seasonLabel(s.year)}
                  </button>
                </Td>
                <Td>
                  <Link href={`/teams/${teamSlug(s.team_name)}`} className="inline-flex items-center gap-2 hover:text-coral transition-colors">
                    <TeamLogo name={s.team_name} size={20} />
                    <span className="text-ink-soft">{s.team_name}</span>
                  </Link>
                </Td>
                <Td className="text-ink-muted" hideUntil="sm">{s.class ?? "—"}</Td>
                <Td align="right" className="tabular">{s.games ?? "—"}</Td>
                <Td align="right" className="tabular">{fmtNum(fromEnd(s.raw_row, 3), 1)}</Td>
                <Td align="right" className="tabular">{fmtNum(fromEnd(s.raw_row, 7), 1)}</Td>
                <Td align="right" className="tabular" hideUntil="sm">{fmtNum(fromEnd(s.raw_row, 6), 1)}</Td>
                <Td align="right" className="tabular" hideUntil="md">{fmtPct(pctFromIdx(s.raw_row, 21))}</Td>
                <Td align="right" className="tabular" hideUntil="md">{fmtPct(pctFromIdx(s.raw_row, 18))}</Td>
                <Td align="right" className="tabular" hideUntil="md">{fmtPct(pctFromIdx(s.raw_row, 15))}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openFor && (
        <SeasonGamesModal
          bartPlayerId={bartPlayerId}
          playerName={playerName}
          teamName={openFor.teamName}
          year={openFor.year}
          onClose={() => setOpenFor(null)}
        />
      )}
    </>
  );
}

function Th({
  children, align = "left", hideUntil,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hideUntil?: "sm" | "md";
}) {
  const hideClass = hideUntil === "md" ? "hidden md:table-cell" : hideUntil === "sm" ? "hidden sm:table-cell" : "";
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""} ${hideClass}`}>{children}</th>;
}
function Td({
  children, align = "left", className = "", hideUntil,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  hideUntil?: "sm" | "md";
}) {
  const hideClass = hideUntil === "md" ? "hidden md:table-cell" : hideUntil === "sm" ? "hidden sm:table-cell" : "";
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${hideClass} ${className}`}>{children}</td>;
}
