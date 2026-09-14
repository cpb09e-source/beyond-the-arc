"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { CAREER_COLUMNS, careerLine, formatCareer, seasonLine, type CareerSeason, type CareerView } from "@/lib/career-line";
import { cn } from "@/lib/utils";

/**
 * The player page's career ledger. The numbers are src/lib/career-line.ts, which
 * the desktop app's Career tab reads too; this file is only how the site draws them.
 */

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CareerTable({ seasons }: { seasons: CareerSeason[] }) {
  // Guarded: an empty season list would make Math.max return -Infinity, which
  // matches nothing and would quietly highlight no row at all.
  const latestYear = seasons.length ? Math.max(...seasons.map((s) => s.year)) : null;
  const [view, setView] = useState<CareerView>("per_game");

  return (
    <>
      {/* ONE BAND, NOT TWO. The heading used to sit in its own tinted block
          above a second band of controls, under a 4px accent strip — three
          horizontal rules of chrome before a single number. The heading, its
          view picker and the season count share a line now. Roughly 60px
          shorter on a phone, where the card has to earn every one of them. */}
      <div className="px-5 lg:px-7 py-4 border-b border-hairline flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-xl sm:text-2xl text-ink leading-none tracking-tight">Career</h2>
          {/* Stock at every width except a phone. Below md a site-wide rule
              floors every select at 16px so iOS Safari does not zoom the page
              on tap — which left this one reading LARGER on a phone than the
              14px it sets on a desktop. `field-sm-phone` is the sanctioned
              opt-out; see the note beside that rule in globals.css. */}
          <Select value={view} onChange={(v) => setView(v as CareerView)} ariaLabel="Career stats view" className="field-sm-phone">
            <option value="per_game">Per game</option>
            <option value="totals">Totals</option>
          </Select>
        </div>
        <span className="text-xs text-ink-muted whitespace-nowrap">
          <span className="tabular text-ink font-semibold">{seasons.length}</span> {seasons.length === 1 ? "season" : "seasons"}
        </span>
      </div>
      {/* Horizontal scroll on narrow viewports — the full stat line stays intact
          and swipes left/right with touch momentum instead of dropping columns. */}
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch] overscroll-x-contain">
        <table className="w-full min-w-[46rem] sm:min-w-[58rem] text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <Th>Season</Th>
              <Th>Team</Th>
              <Th>CL</Th>
              {CAREER_COLUMNS.map((c) => (
                <Th key={c.key} align="right">
                  {c.label(view)}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {seasons.map((s, i) => {
              // The season the player page is about. Found by MAX YEAR rather
              // than by array position: the file is written newest-first today,
              // but a highlight on the wrong row would be indistinguishable
              // from a correct one.
              const isLatest = s.year === latestYear;
              const line = seasonLine(s, view);
              return (
                <tr key={s.year} className={cn("transition-colors hover:bg-coral/[0.06]", i % 2 === 0 ? "bg-paper/70" : "bg-transparent")}>
                  {/* THE CURRENT SEASON IS MARKED BY A RULE, NOT A TINT. A tint
                      has to sit under the 0.06 the hover uses or pointing at any
                      other row would make it look current — and at 0.04 it was
                      invisible on the dark theme. A rule reads the same on both
                      grounds and leaves the zebra and the hover to do their own
                      jobs. An inset shadow rather than a border-left: a border on
                      one row of a collapsed table shifts that row's first cell
                      out of the column the others sit in. */}
                  <Td className={cn("font-medium", isLatest && "shadow-[inset_3px_0_0_var(--coral)]")}>
                    <span className={cn(isLatest && "font-semibold")}>{seasonLabel(s.year)}</span>
                  </Td>
                  <Td>
                    {/* The SEASON's team page, not the team's default one. A
                        career row is a statement about one year. Every (team,
                        year) pair a career row can name has a generated page. */}
                    <Link
                      href={`/teams/${teamSlug(s.team_name)}/${s.year}/`}
                      className="inline-flex items-center gap-2 hover:text-coral transition-colors"
                      prefetch={false}
                      title={`${s.team_name} — ${seasonLabel(s.year)}`}
                    >
                      <TeamLogo name={s.team_name} size={20} />
                      {/* Capped: every other column is a number three or four
                          characters wide, so the school name alone decides
                          whether the ledger fits on a 1366px screen. The link's
                          title carries the full name for anything that clips. */}
                      <span className="text-ink-soft hidden sm:inline whitespace-nowrap truncate max-w-32">{s.team_name}</span>
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">{s.class ?? "—"}</Td>
                  {CAREER_COLUMNS.map((c) => (
                    <Td key={c.key} align="right" className={cn("tabular", c.key === "pts" && "font-medium")}>
                      {formatCareer(line[c.key], c.kind, view)}
                    </Td>
                  ))}
                </tr>
              );
            })}
            {seasons.length > 1 && <CareerRow seasons={seasons} view={view} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  // px-2 rather than px-3, and tracking-wider rather than widest. Twenty-one
  // columns turn every per-column pixel into twenty-one, and this table is
  // meant to be read whole: at 1366px the card is 1072px wide. Colin, 2026-09-09.
  return <th className={`px-1.5 sm:px-2 py-2 text-xs uppercase tracking-wider text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-1.5 sm:px-2 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}

/** The career line, under the seasons it sums (careerLine: every rate is totals over totals). */
function CareerRow({ seasons, view }: { seasons: CareerSeason[]; view: CareerView }) {
  const line = careerLine(seasons, view);
  return (
    <tr className="border-t-2 border-ink/15 bg-paper-deep/40 font-medium">
      <Td className="font-semibold text-ink">Career</Td>
      <Td className="text-ink-muted">—</Td>
      <Td className="text-ink-muted">—</Td>
      {CAREER_COLUMNS.map((c) => (
        <Td key={c.key} align="right" className={cn("tabular", c.key === "pts" && "font-semibold text-ink")}>
          {formatCareer(line[c.key], c.kind, view)}
        </Td>
      ))}
    </tr>
  );
}
