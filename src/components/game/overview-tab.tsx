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
export function OverviewTab({ b, hc, ac, onOpenBox }: { b: GameBundle; hc: string; ac: string; onOpenBox?: () => void }) {
  const g = b.game;
  return (
    <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {/* Form and history lead: they are the context you want BEFORE the box
          score, not a footnote under it. */}
      <Form side={g.away} rows={b.form.away} />
      <Form side={g.home} rows={b.form.home} />
      <HeadToHead b={b} />
      <Leaders b={b} hc={hc} ac={ac} onOpenBox={onOpenBox} />
      <TeamStatsPanel b={b} hc={hc} ac={ac} />
      <GameInfo b={b} />
      <Standings b={b} className="xl:col-span-3" />
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

/**
 * Game leaders, both sides in ONE card.
 *
 * Two separate leader panels spent a full column each to say the same three
 * things, and the comparison they exist to support — who was the best player
 * in this game — was left for the reader to make across a gap. Facing the two
 * teams across a shared stat label makes it one glance and costs one panel
 * instead of two.
 */
function Leaders({ b, hc, ac, onOpenBox }: { b: GameBundle; hc: string; ac: string; onOpenBox?: () => void }) {
  const rows: [string, (p: BoxPlayer) => number | null, (p: BoxPlayer) => string][] = [
    ["Points", (p) => p.points, (p) => `${p.fieldGoals.made}-${p.fieldGoals.attempted} FG · ${p.freeThrows.made}-${p.freeThrows.attempted} FT`],
    ["Rebounds", (p) => p.rebounds.total, (p) => `${p.rebounds.defensive} def · ${p.rebounds.offensive} off`],
    ["Assists", (p) => p.assists, (p) => `${p.turnovers} TO · ${p.minutes} min`],
  ];
  return (
    <Panel title="Game leaders">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[0.62rem] uppercase tracking-[0.12em] font-bold text-ink truncate">{b.game.away.team}</span>
          <TeamLogo name={b.game.away.team} size={22} />
        </div>
        <span className="w-14" aria-hidden />
        <div className="flex items-center gap-2">
          <TeamLogo name={b.game.home.team} size={22} />
          <span className="text-[0.62rem] uppercase tracking-[0.12em] font-bold text-ink truncate">{b.game.home.team}</span>
        </div>
      </div>
      <div className="divide-y divide-hairline/60">
        {rows.map(([label, pick, detail]) => (
          <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3">
            <LeaderSide p={best(b.players.away, pick)} pick={pick} detail={detail} color={ac} align="right" />
            <span className="w-14 text-center text-[0.55rem] uppercase tracking-[0.1em] font-bold text-ink-muted">{label}</span>
            <LeaderSide p={best(b.players.home, pick)} pick={pick} detail={detail} color={hc} align="left" />
          </div>
        ))}
      </div>
      {onOpenBox && (
        <button
          type="button"
          onClick={onOpenBox}
          className="mt-3 pt-3 border-t border-hairline w-full text-center text-[0.7rem] font-medium text-coral hover:underline"
        >
          Full box score
        </button>
      )}
    </Panel>
  );
}

function LeaderSide({
  p, pick, detail, color, align,
}: {
  p: BoxPlayer | null;
  pick: (p: BoxPlayer) => number | null;
  detail: (p: BoxPlayer) => string;
  color: string;
  align: "left" | "right";
}) {
  if (!p) return <span className={cn("text-sm text-ink-muted", align === "right" && "text-right block")}>—</span>;
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", align === "right" && "flex-row-reverse")}>
      {/* Sans, not the display face: its "1" is a bare stem, so a two-digit
          11 reads as "||" at this size. The scoreline can carry it because
          those numbers are large; these cannot. */}
      <span className="text-2xl font-semibold tabular leading-none shrink-0" style={{ color }}>{pick(p)}</span>
      <div className={cn("min-w-0", align === "right" && "text-right")}>
        <p className="text-[0.78rem] text-ink font-medium truncate leading-tight">{p.name}</p>
        <p className="text-[0.62rem] tabular text-ink-muted leading-tight">{detail(p)}</p>
      </div>
    </div>
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

/**
 * Team stats, two-sided.
 *
 * Each row is a value, the label, a value — and a pair of bars that grow
 * OUTWARD from the centre. Growing from a shared middle means the two lengths
 * start at the same place, so "who was bigger" is a single comparison rather
 * than two measurements against different baselines. Bars are scaled to the
 * pair, so a row where the teams are close reads as close.
 */
function TeamStatsPanel({ b, hc, ac }: { b: GameBundle; hc: string; ac: string }) {
  const h = b.teamStats.home, a = b.teamStats.away;
  if (!h || !a) return null;

  const led = percentLed(b);

  const rows: StatRow[] = [
    { label: "Field goal %", a: a.fieldGoals.pct, h: h.fieldGoals.pct, unit: "%",
      aNote: `${a.fieldGoals.made}-${a.fieldGoals.attempted}`, hNote: `${h.fieldGoals.made}-${h.fieldGoals.attempted}` },
    { label: "Three point %", a: a.threePointFieldGoals.pct, h: h.threePointFieldGoals.pct, unit: "%",
      aNote: `${a.threePointFieldGoals.made}-${a.threePointFieldGoals.attempted}`, hNote: `${h.threePointFieldGoals.made}-${h.threePointFieldGoals.attempted}` },
    { label: "Free throw %", a: a.freeThrows.pct, h: h.freeThrows.pct, unit: "%",
      aNote: `${a.freeThrows.made}-${a.freeThrows.attempted}`, hNote: `${h.freeThrows.made}-${h.freeThrows.attempted}` },
    { label: "Rebounds", a: a.rebounds.total, h: h.rebounds.total,
      aNote: `${a.rebounds.offensive} off`, hNote: `${h.rebounds.offensive} off` },
    { label: "Assists", a: a.assists, h: h.assists },
    { label: "Turnovers", a: a.turnovers.total, h: h.turnovers.total },
    { label: "Points in the paint", a: a.points.inPaint, h: h.points.inPaint },
    { label: "Effective FG%", a: a.fourFactors.effectiveFieldGoalPct, h: h.fourFactors.effectiveFieldGoalPct, unit: "%" },
    { label: "Largest lead", a: a.points.largestLead, h: h.points.largestLead },
  ];
  if (led) rows.push({ label: "Percent led", a: led.away, h: led.home, unit: "%" });

  return (
    <Panel title="Team stats">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[0.62rem] uppercase tracking-[0.12em] font-bold text-ink truncate">{b.game.away.team}</span>
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ac }} aria-hidden />
        </div>
        <span className="w-20" aria-hidden />
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: hc }} aria-hidden />
          <span className="text-[0.62rem] uppercase tracking-[0.12em] font-bold text-ink truncate">{b.game.home.team}</span>
        </div>
      </div>
      <div className="pt-1">
        {rows.map((r) => <StatRowView key={r.label} r={r} hc={hc} ac={ac} />)}
      </div>
    </Panel>
  );
}

type StatRow = {
  label: string; a: number; h: number; unit?: string;
  aNote?: string; hNote?: string;
};

function StatRowView({ r, hc, ac }: { r: StatRow; hc: string; ac: string }) {
  const tot = r.a + r.h;
  // A 0-0 row (a game with no free throws) would divide by zero; show two
  // empty tracks rather than two full ones.
  const aw = tot > 0 ? (r.a / tot) * 100 : 0;
  const hw = tot > 0 ? (r.h / tot) * 100 : 0;
  const lead = r.a === r.h ? null : r.a > r.h ? "a" : "h";
  return (
    <div className="py-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2">
        <div className="text-right min-w-0">
          <span className={cn("text-sm tabular font-semibold", lead === "a" ? "text-ink" : "text-ink-muted")}>
            {n1(r.a)}{r.unit}
          </span>
          {r.aNote && <span className="text-[0.6rem] tabular text-ink-muted ml-1.5">({r.aNote})</span>}
        </div>
        <span className="w-20 text-center text-[0.55rem] uppercase tracking-[0.1em] font-bold text-ink-muted leading-tight">
          {r.label}
        </span>
        <div className="min-w-0">
          {r.hNote && <span className="text-[0.6rem] tabular text-ink-muted mr-1.5">({r.hNote})</span>}
          <span className={cn("text-sm tabular font-semibold", lead === "h" ? "text-ink" : "text-ink-muted")}>
            {n1(r.h)}{r.unit}
          </span>
        </div>
      </div>
      {/* Two tracks, each filling from the centre outward. */}
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="h-1.5 rounded-full bg-paper-deep overflow-hidden flex justify-end">
          <span className="h-full rounded-full" style={{ width: `${aw}%`, background: ac }} />
        </span>
        <span className="w-20" aria-hidden />
        <span className="h-1.5 rounded-full bg-paper-deep overflow-hidden flex justify-start">
          <span className="h-full rounded-full" style={{ width: `${hw}%`, background: hc }} />
        </span>
      </div>
    </div>
  );
}

/**
 * Share of game clock each side spent in front, as whole percents.
 *
 * Derived from the play-by-play rather than reported: it is the stat that says
 * whether a three-point win was a lead held all night or a rescue in the last
 * minute, and the two read identically in every other number on this panel.
 * Time tied belongs to neither side, so the two figures need not sum to 100.
 */
function percentLed(b: GameBundle): { home: number; away: number } | null {
  const plays = b.plays;
  if (plays.length < 2) return null;
  const elapsed = (p: (typeof plays)[number]) => {
    const before = p.per <= 2 ? (p.per - 1) * 1200 : 2400 + (p.per - 3) * 300;
    const len = p.per <= 2 ? 1200 : 300;
    return before + (len - p.sec);
  };
  let home = 0, away = 0, total = 0;
  for (let i = 1; i < plays.length; i++) {
    const prev = plays[i - 1]!, cur = plays[i]!;
    const dt = elapsed(cur) - elapsed(prev);
    if (dt <= 0) continue;
    total += dt;
    // The score BEFORE the gap is who was ahead during it.
    if (prev.hs > prev.as) home += dt;
    else if (prev.as > prev.hs) away += dt;
  }
  if (total <= 0) return null;
  return { home: Math.round((home / total) * 100), away: Math.round((away / total) * 100) };
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

function Standings({ b, className }: { b: GameBundle; className?: string }) {
  const g = b.game;
  const confs = Object.keys(b.standings);
  if (confs.length === 0) return null;
  const highlight = new Set([g.home.team, g.away.team]);
  return (
    <Panel title={confs.length === 1 ? `${confs[0]} standings` : "Standings"} note="Entering this game" className={className}>
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
