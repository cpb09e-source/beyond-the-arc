"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
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
  /**
   * CBBD aggregates. Games started and turnovers exist nowhere in Bart's season
   * CSV, so these two columns are the only ones on this table that depend on
   * the CBBD join — and the only ones that go blank for 2021, which has no
   * player box in the archive.
   */
  advanced_stats?: { gs?: number | null; tov?: number | null; tov_pg?: number | null } | null;
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
// Bart stores ft_pct/fg2_pct/fg3_pct as 0..1 decimals (0.851). Every percentage
// left on this table is one of those, so there is a single helper — the 0..100
// composites (eFG, TS) moved to the overview panel, which is where the shooting
// story belongs.
function fmtPctDecimal(x: number | null): string {
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

export function CareerTable({ seasons }: { seasons: Season[] }) {
  // Guarded: an empty season list would make Math.max return -Infinity, which
  // matches nothing and would quietly highlight no row at all.
  const latestYear = seasons.length ? Math.max(...seasons.map((s) => s.year)) : null;
  const [view, setView] = useState<View>("per_game");
  const isTotals = view === "totals";

  return (
    <>
      {/* Card header — kicker + display title with the View dropdown tucked
          alongside it. The season count sits on the right opposite the
          title row. */}
      {/* ONE BAND, NOT TWO. The heading used to sit in its own tinted block
          above a second band of controls, under a 4px accent strip — three
          horizontal rules of chrome before a single number. The heading, its
          view picker and the season count share a line now, and the caption
          runs under them. Roughly 60px shorter on a phone, where the card has
          to earn every one of them. */}
      <div className="px-5 lg:px-7 py-4 border-b border-hairline flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-xl sm:text-2xl text-ink leading-none tracking-tight">Career</h2>
          {/* Stock at every width except a phone. Below md a site-wide rule
              floors every select at 16px so iOS Safari does not zoom the page
              on tap — which left this one reading LARGER on a phone than the
              14px it sets on a desktop. `field-sm-phone` is the sanctioned
              opt-out; see the note beside that rule in globals.css. */}
          <Select
            value={view}
            onChange={(v) => setView(v as View)}
            ariaLabel="Career stats view"
            className="field-sm-phone"
          >
            <option value="per_game">Per game</option>
            <option value="totals">Totals</option>
          </Select>
        </div>
        <span className="text-xs text-ink-muted whitespace-nowrap">
          <span className="tabular text-ink font-semibold">{seasons.length}</span>{" "}
          {seasons.length === 1 ? "season" : "seasons"}
        </span>
      </div>
      {/* Horizontal scroll on narrow viewports — full stat line stays intact
          and swipes left/right with touch momentum instead of dropping columns. */}
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch] overscroll-x-contain">
        <table className="w-full min-w-[46rem] sm:min-w-[58rem] text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <Th>Season</Th>
              <Th>Team</Th>
              <Th hideUntil="sm">CL</Th>
              <Th align="right">GP</Th>
              <Th align="right">GS</Th>
              {/* Per-game everywhere else on this row switches to a total in
                  Totals view, and "MPG" would be a lie about a season minute
                  count — so this one header changes with the view. */}
              <Th align="right">{isTotals ? "MIN" : "MPG"}</Th>
              <Th align="right" hideUntil="md">FGM</Th>
              <Th align="right" hideUntil="md">FGA</Th>
              <Th align="right" hideUntil="sm">FG%</Th>
              <Th align="right" hideUntil="md">3PM</Th>
              <Th align="right" hideUntil="md">3PA</Th>
              <Th align="right" hideUntil="md">3P%</Th>
              <Th align="right" hideUntil="lg">FTA</Th>
              <Th align="right" hideUntil="md">FT%</Th>
              <Th align="right" hideUntil="lg">ORB</Th>
              <Th align="right">REB</Th>
              <Th align="right" hideUntil="sm">AST</Th>
              <Th align="right" hideUntil="sm">TOV</Th>
              <Th align="right" hideUntil="lg">STL</Th>
              <Th align="right" hideUntil="lg">BLK</Th>
              <Th align="right">PTS</Th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s, i) => {
              // The season the player page is about. Found by MAX YEAR rather
              // than by array position: the file is written newest-first today,
              // but a highlight on the wrong row would be indistinguishable
              // from a correct one.
              const isLatest = s.year === latestYear;
              const row = s.raw_row;
              const g = s.games;

              // Raw counts (season totals from Bart's CSV). Col 13 is FTM,
              // which this table has never shown — FT% carries it.
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

              const mpg = fromStart(row, 54);

              // Games started and turnovers come from the CBBD box aggregate,
              // not from Bart — his season CSV carries neither. `tov` is the
              // season total and `tov_pg` the rate; they use different game
              // counts (a game missing a turnover figure is out of the rate but
              // still in the total), so neither is derived from the other here.
              const adv = s.advanced_stats;
              const gs = adv?.gs ?? null;
              const tovTotal = adv?.tov ?? null;
              const tovPg = adv?.tov_pg ?? null;

              // Combined FG: 2P + 3P
              const fgAtt = fg2Att !== null && fg3Att !== null ? fg2Att + fg3Att : null;
              const fgMade = fg2Made !== null && fg3Made !== null ? fg2Made + fg3Made : null;
              const fgPctCalc = fgAtt !== null && fgMade !== null && fgAtt > 0 ? fgMade / fgAtt : null;

              // Volume cells switch shape between totals (raw counts) and
              // per-game (count / games). Rates (FG%, 3P%, eFG, TS, FT%) are
              // identical in both modes.
              const minCell = isTotals
                ? fmtInt(mpg !== null && g ? mpg * g : null)
                : fmtNum(mpg, 1);
              const fgmCell = isTotals
                ? fmtInt(fgMade)
                : fmtNum(fgMade !== null && g ? fgMade / g : null, 1);
              const fgaCell = isTotals
                ? fmtInt(fgAtt)
                : fmtNum(fgAtt !== null && g ? fgAtt / g : null, 1);
              const tpmCell = isTotals
                ? fmtInt(fg3Made)
                : fmtNum(fg3Made !== null && g ? fg3Made / g : null, 1);
              const tpaCell = isTotals
                ? fmtInt(fg3Att)
                : fmtNum(fg3Att !== null && g ? fg3Att / g : null, 1);
              const tovCell = isTotals ? fmtInt(tovTotal) : fmtNum(tovPg, 1);
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
                <tr
                  key={s.year}
                  className={cn(
                    "transition-colors hover:bg-coral/[0.06]",
                    i % 2 === 0 ? "bg-paper/70" : "bg-transparent",
                  )}
                >
                  {/* THE CURRENT SEASON IS MARKED BY A RULE, NOT A TINT. A tint
                      has to sit under the 0.06 the hover uses or pointing at any
                      other row would make it look current — and at 0.04 it was
                      invisible on the dark theme, where the ground is #1C1C1C
                      and four percent of anything is nothing. A rule reads the
                      same on both grounds and leaves the zebra and the hover to
                      do their own jobs.

                      An inset shadow rather than a border-left: a border on one
                      row of a collapsed table shifts that row's first cell out
                      of the column the others sit in. */}
                  <Td
                    className={cn(
                      "font-medium",
                      isLatest && "shadow-[inset_3px_0_0_var(--coral)]",
                    )}
                  >
                    {/* Plain text now. It opened a game-log modal until the
                        player page grew a Game Log tab that does the same job
                        with a season picker, room for three column groups and
                        national percentiles. Two ways into the same data, one
                        of them worse, is a choice a reader should not have to
                        make — and a dotted underline that no longer does
                        anything is a broken affordance. */}
                    <span className={cn(isLatest && "font-semibold")}>
                      {seasonLabel(s.year)}
                    </span>
                  </Td>
                  <Td>
                    {/* The SEASON's team page, not the team's default one.
                        A career row is a statement about one year — clicking
                        the crest on the 24-25 line and landing on Vanderbilt's
                        current roster answers a question nobody asked. Every
                        (team, year) pair a career row can name has a generated
                        page: generateStaticParams walks teams-all.json, and
                        all 63,128 player-season rows resolve against it. */}
                    <Link href={`/teams/${teamSlug(s.team_name)}/${s.year}/`} className="inline-flex items-center gap-2 hover:text-coral transition-colors" prefetch={false} title={`${s.team_name} — ${seasonLabel(s.year)}`}>
                      <TeamLogo name={s.team_name} size={20} />
                      {/* nowrap: the table already scrolls sideways, so there
                          is no width to save by breaking "Robert Morris" over
                          two lines — it only makes the row twice as tall. */}
                      <span className="text-ink-soft hidden sm:inline whitespace-nowrap">{s.team_name}</span>
                    </Link>
                  </Td>
                  <Td className="text-ink-muted" hideUntil="sm">{s.class ?? "—"}</Td>
                  <Td align="right" className="tabular">{g ?? "—"}</Td>
                  <Td align="right" className="tabular">{gs ?? "—"}</Td>
                  <Td align="right" className="tabular">{minCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fgmCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fgaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="sm">{fmtPctDecimal(fgPctCalc)}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{tpmCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{tpaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctDecimal(fg3Pct)}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{ftaCell}</Td>
                  <Td align="right" className="tabular" hideUntil="md">{fmtPctDecimal(ftPct)}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{orbCell}</Td>
                  <Td align="right" className="tabular">{rebCell}</Td>
                  <Td align="right" className="tabular" hideUntil="sm">{astCell}</Td>
                  <Td align="right" className="tabular" hideUntil="sm">{tovCell}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{stlCell}</Td>
                  <Td align="right" className="tabular" hideUntil="lg">{blkCell}</Td>
                  <Td align="right" className="tabular font-medium">{ptsCell}</Td>
                </tr>
              );
            })}
            {seasons.length > 1 && <CareerRow seasons={seasons} isTotals={isTotals} />}
          </tbody>
        </table>
      </div>

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
  return <th className={`px-1.5 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""} ${hideClass(hideUntil)}`}>{children}</th>;
}
function Td({
  children, align = "left", className = "", hideUntil,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  hideUntil?: "sm" | "md" | "lg";
}) {
  return <td className={`px-1.5 sm:px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${hideClass(hideUntil)} ${className}`}>{children}</td>;
}
// Mobile now swipes the full table horizontally (min-w on <table>), so every
// column renders at every width — no more column dropping on narrow screens.
// `hideUntil` is kept on the call sites as documentation of column priority but
// no longer hides anything.
function hideClass(_hideUntil?: "sm" | "md" | "lg"): string {
  return "";
}


/**
 * The career line, under the seasons it sums.
 *
 * EVERY RATE IS TOTALS OVER TOTALS, never a mean of the season rates. A player
 * who shot 3-for-4 as a freshman and 300-for-700 as a senior did not shoot 59%
 * for his career, which is what averaging the two percentages claims; he shot
 * 43%. The same applies to per-game figures, which are weighted by games here
 * rather than averaged across seasons of wildly different length.
 *
 * Totals mode sums the counts instead, so the row means the same thing the
 * rows above it mean in whichever mode the table is in.
 */
function CareerRow({ seasons, isTotals }: { seasons: Season[]; isTotals: boolean }) {
  let g = 0, gs = 0, min = 0, pts = 0, reb = 0, orb = 0, ast = 0, stl = 0, blk = 0, tov = 0;
  let ftm = 0, fta = 0, fgm = 0, fga = 0, fg3m = 0, fg3a = 0;
  let sawGs = false, sawTov = false;

  for (const s of seasons) {
    const r = s.raw_row;
    const n = s.games ?? 0;
    g += n;
    min += (fromStart(r, 54) ?? 0) * n;
    pts += (fromEnd(r, 3) ?? 0) * n;
    blk += (fromEnd(r, 4) ?? 0) * n;
    stl += (fromEnd(r, 5) ?? 0) * n;
    ast += (fromEnd(r, 6) ?? 0) * n;
    reb += (fromEnd(r, 7) ?? 0) * n;
    orb += (fromEnd(r, 9) ?? 0) * n;
    ftm += fromStart(r, 13) ?? 0;
    fta += fromStart(r, 14) ?? 0;
    fgm += (fromStart(r, 16) ?? 0) + (fromStart(r, 19) ?? 0);
    fga += (fromStart(r, 17) ?? 0) + (fromStart(r, 20) ?? 0);
    fg3m += fromStart(r, 19) ?? 0;
    fg3a += fromStart(r, 20) ?? 0;
    const adv = s.advanced_stats;
    if (adv?.gs != null) { gs += adv.gs; sawGs = true; }
    if (adv?.tov != null) { tov += adv.tov; sawTov = true; }
  }

  const perG = (total: number) => (g ? total / g : null);
  const rate = (made: number, att: number) => (att ? made / att : null);
  // A count column reads as the career total in totals mode and the career
  // per-game in per-game mode — the same rule the season rows follow.
  const count = (total: number) => (isTotals ? fmtInt(total) : fmtNum(perG(total), 1));

  return (
    <tr className="border-t-2 border-ink/15 bg-paper-deep/40 font-medium">
      <Td className="font-semibold text-ink">Career</Td>
      <Td className="text-ink-muted">—</Td>
      <Td className="text-ink-muted" hideUntil="sm">—</Td>
      <Td align="right" className="tabular">{g || "—"}</Td>
      <Td align="right" className="tabular">{sawGs ? fmtInt(gs) : "—"}</Td>
      <Td align="right" className="tabular">{isTotals ? fmtInt(min) : fmtNum(perG(min), 1)}</Td>
      <Td align="right" className="tabular" hideUntil="md">{count(fgm)}</Td>
      <Td align="right" className="tabular" hideUntil="md">{count(fga)}</Td>
      <Td align="right" className="tabular" hideUntil="sm">{fmtPctDecimal(rate(fgm, fga))}</Td>
      <Td align="right" className="tabular" hideUntil="md">{count(fg3m)}</Td>
      <Td align="right" className="tabular" hideUntil="md">{count(fg3a)}</Td>
      <Td align="right" className="tabular" hideUntil="sm">{fmtPctDecimal(rate(fg3m, fg3a))}</Td>
      <Td align="right" className="tabular" hideUntil="md">{count(fta)}</Td>
      <Td align="right" className="tabular" hideUntil="md">{fmtPctDecimal(rate(ftm, fta))}</Td>
      <Td align="right" className="tabular" hideUntil="lg">{count(orb)}</Td>
      <Td align="right" className="tabular">{count(reb)}</Td>
      <Td align="right" className="tabular" hideUntil="sm">{count(ast)}</Td>
      <Td align="right" className="tabular" hideUntil="sm">{sawTov ? count(tov) : "—"}</Td>
      <Td align="right" className="tabular" hideUntil="lg">{count(stl)}</Td>
      <Td align="right" className="tabular" hideUntil="lg">{count(blk)}</Td>
      <Td align="right" className="tabular font-semibold text-ink">{count(pts)}</Td>
    </tr>
  );
}
