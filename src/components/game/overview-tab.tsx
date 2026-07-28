"use client";

import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import {
  shortDate, tipLabel, lineLabel,
  type BoxPlayer, type GameBundle, type GameSide, type ScheduleRow, type StandingRow,
} from "./types";

/**
 * Overview — everything you would want before deciding whether to read further.
 *
 * Deliberately shallow. The full player lines are one tab away and the full
 * play log is two, so this page's job is orientation: who led it, how the two
 * teams shot, where each sits in its league, and whether either arrived hot.
 */
export function OverviewTab({ b, hc, ac }: { b: GameBundle; hc: string; ac: string }) {
  const g = b.game;
  return (
    <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {/* Form and history lead: they are the context you want BEFORE the box
          score, not a footnote under it. */}
      <Form side={g.away} rows={b.form.away} />
      <Form side={g.home} rows={b.form.home} />
      <HeadToHead b={b} />
      <Leaders side={g.away} players={b.players.away} color={ac} />
      <Leaders side={g.home} players={b.players.home} color={hc} />
      <GameInfo b={b} />
      <TeamStatsPanel b={b} hc={hc} ac={ac} className="lg:col-span-2" />
      <Standings b={b} />
    </div>
  );
}

/* --------------------------------- shell --------------------------------- */

function Panel({
  title, note, children, className,
}: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-hairline bg-card overflow-hidden flex flex-col", className)}>
      <div className="px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-baseline gap-2">
        <h2 className="text-[0.6rem] uppercase tracking-[0.18em] font-bold text-ink">{title}</h2>
        {note && <span className="text-[0.6rem] text-ink-muted ml-auto">{note}</span>}
      </div>
      <div className="p-4 flex-1">{children}</div>
    </section>
  );
}

const n1 = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "—";

/* -------------------------------- leaders -------------------------------- */

/**
 * Points, rebounds and assists leaders. Ties break on minutes played, so the
 * name shown is the one who did it in fewer minutes rather than whichever the
 * source happened to list first.
 */
function best(players: BoxPlayer[], pick: (p: BoxPlayer) => number | null): BoxPlayer | null {
  let top: BoxPlayer | null = null;
  let topV = -1;
  for (const p of players) {
    const v = pick(p);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v > topV || (v === topV && top && (p.minutes ?? 0) < (top.minutes ?? 0))) { top = p; topV = v; }
  }
  return topV <= 0 ? null : top;
}

function Leaders({ side, players, color }: { side: GameSide; players: BoxPlayer[]; color: string }) {
  const rows: [string, BoxPlayer | null, (p: BoxPlayer) => string][] = [
    ["Points", best(players, (p) => p.points), (p) => `${p.points} pts · ${p.fieldGoals.made}-${p.fieldGoals.attempted} FG`],
    ["Rebounds", best(players, (p) => p.rebounds.total), (p) => `${p.rebounds.total} reb · ${p.rebounds.offensive} off`],
    ["Assists", best(players, (p) => p.assists), (p) => `${p.assists} ast · ${p.turnovers} TO`],
  ];
  return (
    <Panel title={`${side.team} leaders`}>
      <div className="space-y-3">
        {rows.map(([label, p, fmt]) => (
          <div key={label} className="flex items-baseline gap-3">
            <span className="w-16 shrink-0 text-[0.58rem] uppercase tracking-[0.12em] font-bold text-ink-muted">{label}</span>
            {p ? (
              <span className="min-w-0">
                <span className="text-sm text-ink font-medium">{p.name}</span>
                {p.position && <span className="text-[0.6rem] text-ink-muted ml-1.5">{p.position}</span>}
                <span className="block text-[0.7rem] tabular text-ink-soft">{fmt(p)}</span>
              </span>
            ) : (
              <span className="text-sm text-ink-muted">—</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-hairline flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden />
        <TeamLogo name={side.team} size={16} />
        <span className="text-[0.65rem] text-ink-muted">
          {players.length} played{side.elo && ` · Elo ${side.elo[1]} (${side.elo[1] >= side.elo[0] ? "+" : ""}${side.elo[1] - side.elo[0]})`}
        </span>
      </div>
    </Panel>
  );
}

/* ------------------------------- game info ------------------------------- */

function GameInfo({ b }: { b: GameBundle }) {
  const g = b.game;
  const tv = b.broadcasts.filter((x) => x.broadcastType === "TV").map((x) => x.broadcastName).join(", ");
  const line = lineLabel(b);
  const ou = (b.line.find((l) => l.provider === "Draft Kings") ?? b.line[0])?.overUnder ?? null;
  const total = (g.home.points ?? 0) + (g.away.points ?? 0);

  const rows: [string, string | null][] = [
    ["Arena", g.venue],
    ["Location", [g.city, g.state].filter(Boolean).join(", ") || null],
    ["Tip-off", tipLabel(g.startDate)],
    ["Attendance", g.attendance ? g.attendance.toLocaleString() : null],
    ["Television", tv || null],
    ["Line", line],
    ["Total", ou !== null ? `${ou} · game went ${total > ou ? "over" : "under"} at ${total}` : null],
    ["Pace", b.teamStats.pace !== null ? `${b.teamStats.pace} possessions` : null],
  ];
  return (
    <Panel title="Game info">
      <dl className="space-y-0">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[5.5rem_1fr] gap-3 py-1.5 border-b border-hairline/60 last:border-b-0">
            <dt className="text-[0.58rem] uppercase tracking-[0.12em] font-bold text-ink-muted pt-0.5">{k}</dt>
            <dd className="text-[0.78rem] text-ink-soft leading-snug">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ------------------------------- team stats ------------------------------ */

function TeamStatsPanel({
  b, hc, ac, className,
}: { b: GameBundle; hc: string; ac: string; className?: string }) {
  const h = b.teamStats.home, a = b.teamStats.away;
  if (!h || !a) return null;
  const shooting: [string, string, string][] = [
    ["Field goals", pctLine(a.fieldGoals), pctLine(h.fieldGoals)],
    ["Three-pointers", pctLine(a.threePointFieldGoals), pctLine(h.threePointFieldGoals)],
    ["Free throws", pctLine(a.freeThrows), pctLine(h.freeThrows)],
  ];
  const bars: [string, number, number, string][] = [
    ["Rebounds", a.rebounds.total, h.rebounds.total, ""],
    ["Offensive boards", a.rebounds.offensive, h.rebounds.offensive, ""],
    ["Assists", a.assists, h.assists, ""],
    ["Turnovers", a.turnovers.total, h.turnovers.total, ""],
    ["Points in the paint", a.points.inPaint, h.points.inPaint, ""],
    ["Fast-break points", a.points.fastBreak, h.points.fastBreak, ""],
    ["Effective FG%", a.fourFactors.effectiveFieldGoalPct, h.fourFactors.effectiveFieldGoalPct, "%"],
    ["True shooting", a.trueShooting, h.trueShooting, "%"],
    ["Offensive rating", a.rating, h.rating, ""],
  ];
  return (
    <Panel title="Team stats" note={`${b.game.away.team} · ${b.game.home.team}`} className={className}>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
        <div>
          {shooting.map(([label, av, hv]) => (
            <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 py-2 border-b border-hairline/60">
              <span className="text-right text-[0.78rem] tabular font-semibold" style={{ color: ac }}>{av}</span>
              <span className="text-[0.58rem] uppercase tracking-[0.1em] text-ink-muted text-center">{label}</span>
              <span className="text-[0.78rem] tabular font-semibold" style={{ color: hc }}>{hv}</span>
            </div>
          ))}
        </div>
        <div>
          {bars.slice(0, 3).map((r) => <StatBar key={r[0]} row={r} hc={hc} ac={ac} />)}
        </div>
        <div>
          {bars.slice(3, 6).map((r) => <StatBar key={r[0]} row={r} hc={hc} ac={ac} />)}
        </div>
        <div>
          {bars.slice(6).map((r) => <StatBar key={r[0]} row={r} hc={hc} ac={ac} />)}
        </div>
      </div>
    </Panel>
  );
}

function pctLine(p: { made: number; attempted: number; pct: number }): string {
  return `${p.made}-${p.attempted} · ${n1(p.pct)}%`;
}

/**
 * One bar per row, split at the true ratio, rather than two bars with separate
 * baselines. A single divided bar puts the comparison at one point the eye can
 * find; two bars ask it to measure twice and subtract.
 */
function StatBar({ row, hc, ac }: { row: [string, number, number, string]; hc: string; ac: string }) {
  const [label, av, hv, unit] = row;
  const tot = av + hv || 1;
  return (
    <div className="py-2 border-b border-hairline/60 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 text-[0.72rem] tabular">
        <span className="font-semibold" style={{ color: ac }}>{n1(av)}{unit}</span>
        <span className="text-[0.58rem] uppercase tracking-[0.1em] text-ink-muted truncate">{label}</span>
        <span className="font-semibold" style={{ color: hc }}>{n1(hv)}{unit}</span>
      </div>
      <div className="mt-1 h-1 w-full flex rounded-full overflow-hidden bg-paper-deep">
        <span style={{ width: `${(av / tot) * 100}%`, background: ac }} />
        <span style={{ width: `${(hv / tot) * 100}%`, background: hc }} />
      </div>
    </div>
  );
}

/* ------------------------- form + head to head ---------------------------- */

/**
 * A résumé strip, borrowed from the March-resume ticker on the coach pages:
 * one cell per game, washed green for a win and red for a loss, with the
 * opponent's mark and the score inside it.
 *
 * The reason it beats a W/L/W/W/L chip row is that a bare letter says a team
 * went 4-1 without saying whether the win was by 30 at home or by 1 in
 * overtime on the road. Putting the opponent and the score in the cell makes
 * "hot" and "flattered by the schedule" distinguishable at the same glance.
 */
function ResumeStrip({ rows, emptyLabel }: { rows: ScheduleRow[]; emptyLabel: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  return (
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1">
      {rows.map((r) => <ResumeCell key={r.id} r={r} />)}
    </div>
  );
}

function ResumeCell({ r }: { r: ScheduleRow }) {
  const won = r.won;
  const where = r.neutral ? "vs" : r.isHome ? "vs" : "at";
  return (
    <div
      title={`${shortDate(r.date)} ${where} ${r.opponent} · ${won ? "W" : "L"} ${r.us}-${r.them}`}
      className={cn(
        "shrink-0 basis-0 grow flex flex-col items-center gap-1 rounded-lg px-1.5 pt-1.5 pb-1 ring-1 min-w-14",
        won === true && "bg-emerald-100/60 ring-emerald-300/60",
        won === false && "bg-rose-100/50 ring-rose-300/50",
        won === null && "bg-paper-deep ring-hairline",
      )}
    >
      <span className={cn(
        "text-[0.55rem] uppercase tracking-[0.1em] font-bold leading-none",
        won === true ? "text-emerald-700" : won === false ? "text-rose-700" : "text-ink-muted",
      )}>
        {won === null ? "–" : won ? "W" : "L"}
      </span>
      <TeamLogo name={r.opponent} size={22} />
      <span className="text-[0.62rem] tabular font-semibold text-ink leading-none">{r.us}-{r.them}</span>
      <span className="text-[0.5rem] tabular text-ink-muted leading-none">
        {where === "at" ? "@" : ""}{shortDate(r.date)}
      </span>
    </div>
  );
}

function Form({ side, rows }: { side: GameSide; rows: ScheduleRow[] }) {
  const w = rows.filter((r) => r.won).length;
  return (
    <Panel
      title={`${side.team} form`}
      note={rows.length ? `${w}-${rows.length - w} in the last ${rows.length}` : undefined}
    >
      <ResumeStrip rows={rows} emptyLabel="No completed games before this one." />
    </Panel>
  );
}

function HeadToHead({ b }: { b: GameBundle }) {
  const g = b.game;
  const w = b.h2h.filter((r) => r.won).length;
  return (
    <Panel
      title="Head to head"
      note={b.h2h.length ? `${g.home.team} ${w}-${b.h2h.length - w}` : undefined}
    >
      {/* Rows are stored from the HOME team's side, so the panel says whose
          record it is — a bare W/L strip between two teams is ambiguous. */}
      <ResumeStrip rows={b.h2h} emptyLabel="First meeting in our records." />
    </Panel>
  );
}

/* ------------------------------- standings ------------------------------- */

function Standings({ b }: { b: GameBundle }) {
  const g = b.game;
  const confs = Object.keys(b.standings);
  if (confs.length === 0) return null;
  const highlight = new Set([g.home.team, g.away.team]);
  return (
    <Panel title={confs.length === 1 ? `${confs[0]} standings` : "Standings"} note="Entering this game">
      <div className="space-y-4">
        {confs.map((c) => (
          <div key={c}>
            {confs.length > 1 && (
              <p className="text-[0.58rem] uppercase tracking-[0.12em] font-bold text-ink-muted mb-1">{c}</p>
            )}
            <StandingsTable rows={b.standings[c]!} highlight={highlight} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StandingsTable({ rows, highlight }: { rows: StandingRow[]; highlight: Set<string> }) {
  return (
    <div className="max-h-64 overflow-y-auto -mx-1 px-1">
      <table className="w-full text-[0.72rem] tabular">
        <thead className="sticky top-0 bg-card">
          <tr className="text-[0.52rem] uppercase tracking-[0.1em] text-ink-muted">
            <th className="text-left font-bold pb-1">Team</th>
            <th className="w-12 text-right font-bold pb-1">Conf</th>
            <th className="w-12 text-right font-bold pb-1">All</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const on = highlight.has(r.team);
            return (
              <tr key={r.team} className={cn("border-t border-hairline/50", on && "bg-coral/8")}>
                <td className="py-1 pr-2">
                  <span className="text-ink-muted mr-1.5">{i + 1}</span>
                  <span className={on ? "text-ink font-semibold" : "text-ink-soft"}>{r.team}</span>
                </td>
                <td className={cn("text-right", on ? "text-ink font-semibold" : "text-ink-soft")}>{r.cw}-{r.cl}</td>
                <td className="text-right text-ink-muted">{r.w}-{r.l}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
