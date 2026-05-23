"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { SeasonGamesModal } from "@/components/players/season-games-modal";
import { Select } from "@/components/select";
import { cn } from "@/lib/utils";

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

type View = "per_game" | "totals";

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtInt(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return Math.round(x).toLocaleString("en-US");
}
// Bart stores ft_pct/fg2_pct/fg3_pct as 0..1 decimals (0.851); eFG and TS are
// already on a 0..100 scale (43.9). Two helpers so callers don't accidentally
// double-scale.
function fmtPctDecimal(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}
function fmtPctScaled(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
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
function fromStart(row: Array<string | number | null> | null, idx: number): number | null {
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
  const [view, setView] = useState<View>("per_game");
  const isTotals = view === "totals";

  return (
    <>
      {/* Card header — kicker + display title with the View dropdown tucked
          alongside it. The season count sits on the right opposite the
          title row. */}
      <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />
            Year by year
          </div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Career</h2>
            <Select value={view} onChange={(v) => setView(v as View)} ariaLabel="Career stats view">
              <option value="per_game">Per game</option>
              <option value="totals">Totals</option>
            </Select>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Click a season to open the player&apos;s game log.
          </p>
        </div>
        <span className="text-xs tabular text-ink-muted whitespace-nowrap">
          <span className="font-display text-2xl text-ink tabular leading-none">{seasons.length}</span>{" "}
          {seasons.length === 1 ? "season" : "seasons"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <Th>Season</Th>
              <Th>Team</Th>
              <Th hideUntil="sm">CL</Th>
              <Th align="right">GP</Th>
              <Th align="right" hideUntil="md">FGA</Th>
              <Th align="right" hideUntil="sm">FG%</Th>
              <Th align="right" hideUntil="md">3PA</Th>
              <Th align="right" hideUntil="md">3P%</Th>
              <Th align="right" hideUntil="md">eFG</Th>
              <Th align="right" hideUntil="md">TS</Th>
              <Th align="right" hideUntil="lg">FTA</Th>
              <Th align="right" hideUntil="md">FT%</Th>
              <Th align="right" hideUntil="lg">ORB</Th>
              <Th align="right">REB</Th>
              <Th align="right" hideUntil="sm">AST</Th>
              <Th align="right" hideUntil="lg">STL</Th>
              <Th align="right" hideUntil="lg">BLK</Th>
              <Th align="right">PTS</Th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s, i) => {
              const row = s.raw_row;
              const g = s.games;

              // Raw counts (season totals from Bart's CSV)
              const ftMade = fromStart(row, 13);
              const ftAtt = fromStart(row, 14);
              const ftPct = fromStart(row, 15);
              const fg2Made = fromStart(row, 16);
              const fg2Att = fromStart(row, 17);
              const fg3Made = fromStart(row, 19);
              const fg3Att = fromStart(row, 20);
              const fg3Pct = fromStart(row, 21);

              // Per-game rates (Bart's pre-computed per-game stats from end)
              const ppg = fromEnd(row, 3);
              const bpg = fromEnd(row, 4);
              const spg = fromEnd(row, 5);
              const apg = fromEnd(row, 6);
              const rpg = fromEnd(row, 7);
              const orpg = fromEnd(row, 9);

              // Composite shooting metrics from Bart's CSV (already 0..100)
              const eFg = fromStart(row, 7);
              const ts = fromStart(row, 8);

              // Combined FG: 2P + 3P
              const fgAtt = fg2Att !== null && fg3Att !== null ? fg2Att + fg3Att : null;
              const fgMade = fg2Made !== null && fg3Made !== null ? fg2Made + fg3Made : null;
              const fgPctCalc = fgAtt !== null && fgMade !== null && fgAtt > 0 ? fgMade / fgAtt : null;

              // Volume cells switch shape between totals (raw counts) and
              // per-game (count / games). Rates (FG%, 3P%, eFG, TS, FT%) are
              // identical in both modes.
              const fgaCell = isTotals
                ? fmtInt(fgAtt)
                : fmtNum(fgAtt !== null && g ? fgAtt / g : null, 1);
              const tpaCell = isTotals
                ? fmtInt(fg3Att)
                : fmtNum(fg3Att !== null && g ? fg3Att / g : null, 1);
              const ftaCell = isTotals
                ? fmtInt(ftAtt)
                : fmtNum(ftAtt !== null && g ? ftAtt / g : null, 1);
              const orbCell = isTotals
                ? fmtInt(orpg !== null && g ? orpg * g : null)
                : fmtNum(orpg, 1);
              const rebCell = isTotals
                ? fmtInt(rpg !== null && g ? rpg * g : null)
                : fmtNum(rpg, 1);
              const astCell = isTotals
                ? fmtInt(apg !== null && g ? apg * g : null)
                : fmtNum(apg, 1);
              const stlCell = isTotals
                ? fmtInt(spg !== null && g ? spg * g : null)
                : fmtNum(spg, 1);
              const blkCell = isTotals
                ? fmtInt(bpg !== null && g ? bpg * g : null)
                : fmtNum(bpg, 1);
              const ptsCell = isTotals
                ? fmtInt(ppg !== null && g ? ppg * g : null)
                : fmtNum(ppg, 1);

              return (
                <tr key={s.year} className={cn("transition-colors hover:bg-coral/[0.06]", i % 2 === 0 ? "bg-paper/70" : "bg-transparent")}>
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
                  <Td align="right" className="tabular">{g ?? "—"}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fgaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="sm">{fmtPctDecimal(fgPctCalc)}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{tpaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctDecimal(fg3Pct)}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctScaled(eFg)}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctScaled(ts)}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{ftaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctDecimal(ftPct)}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{orbCell}</Td>
                  <Td align="right" className="tabular">{rebCell}</Td>
                  <Td align="right" className="tabular" hideUntil="sm">{astCell}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{stlCell}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{blkCell}</Td>
                  <Td align="right" className="tabular font-medium">{ptsCell}</Td>
                </tr>
              );
            })}
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
  hideUntil?: "sm" | "md" | "lg";
}) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""} ${hideClass(hideUntil)}`}>{children}</th>;
}
function Td({
  children, align = "left", className = "", hideUntil,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  hideUntil?: "sm" | "md" | "lg";
}) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${hideClass(hideUntil)} ${className}`}>{children}</td>;
}
function hideClass(hideUntil?: "sm" | "md" | "lg"): string {
  if (hideUntil === "lg") return "hidden lg:table-cell";
  if (hideUntil === "md") return "hidden md:table-cell";
  if (hideUntil === "sm") return "hidden sm:table-cell";
  return "";
}
