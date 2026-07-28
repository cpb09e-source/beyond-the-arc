"use client";

import { useEffect, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { loadPhotoIndex, lookupId, type PhotoIndex } from "@/lib/player-photo-index";
import { readableInk } from "@/lib/team-colors";
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

  // One fetch per season, shared by every panel that shows a face. Resolved
  // here rather than inside each card so the page makes one request, not four.
  const [photos, setPhotos] = useState<PhotoIndex>({});
  useEffect(() => {
    let live = true;
    void loadPhotoIndex(g.season).then((i) => { if (live) setPhotos(i); });
    return () => { live = false; };
  }, [g.season]);

  return (
    <div className="space-y-5">
      {/* Form and history lead: context you want BEFORE the box score. Flat on
          the page, no card — they are a strip of results, not a panel. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Form side={g.away} rows={b.form.away} />
        <Form side={g.home} rows={b.form.home} />
        <HeadToHead b={b} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3 items-start">
        <Leaders b={b} hc={hc} ac={ac} photos={photos} onOpenBox={onOpenBox} />
        <TeamStatsPanel b={b} hc={hc} ac={ac} />
        <Standings b={b} hc={hc} ac={ac} />
      </div>

      <GameInfo b={b} />
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
function Leaders({
  b, hc, ac, photos, onOpenBox,
}: {
  b: GameBundle; hc: string; ac: string; photos: PhotoIndex; onOpenBox?: () => void;
}) {
  const rows: [string, (p: BoxPlayer) => number | null, (p: BoxPlayer) => string][] = [
    ["Points", (p) => p.points,
      (p) => `${p.fieldGoals.made}/${p.fieldGoals.attempted} FG, ${p.freeThrows.made}/${p.freeThrows.attempted} FT`],
    ["Rebounds", (p) => p.rebounds.total,
      (p) => `${p.rebounds.defensive} DREB, ${p.rebounds.offensive} OREB`],
    ["Assists", (p) => p.assists,
      (p) => `${p.turnovers} TO, ${p.minutes} MIN`],
  ];
  return (
    <Panel title="Game leaders">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <TeamLogo name={b.game.away.team} size={24} />
          <span className="text-[0.68rem] uppercase tracking-[0.1em] font-bold text-ink truncate">{b.game.away.team}</span>
        </div>
        <span className="w-24" aria-hidden />
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[0.68rem] uppercase tracking-[0.1em] font-bold text-ink truncate">{b.game.home.team}</span>
          <TeamLogo name={b.game.home.team} size={24} />
        </div>
      </div>
      <div className="divide-y divide-hairline/60">
        {rows.map(([label, pick, detail]) => (
          <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 py-3.5">
            <LeaderSide p={best(b.players.away, pick)} pick={pick} detail={detail} color={ac} photos={photos} align="left" />
            <span className="w-24 pt-4 text-center text-[0.68rem] font-bold text-ink leading-tight">{label}</span>
            <LeaderSide p={best(b.players.home, pick)} pick={pick} detail={detail} color={hc} photos={photos} align="right" />
          </div>
        ))}
      </div>
      {onOpenBox && (
        <button
          type="button"
          onClick={onOpenBox}
          className="mt-3 pt-3 border-t border-hairline w-full text-center text-[0.72rem] font-medium text-coral hover:underline"
        >
          Full box score
        </button>
      )}
    </Panel>
  );
}

/**
 * One side of a leader row: headshot, the number, then name and detail beneath.
 *
 * The photo resolves through the season's name index — CBBD gives us a name
 * and its own athlete id, neither of which is the id our images are keyed by
 * (see src/lib/player-photo-index.ts). A miss falls back to the monogram
 * PlayerPhoto already draws, so a player we cannot resolve degrades quietly.
 */
function LeaderSide({
  p, pick, detail, color, photos, align,
}: {
  p: BoxPlayer | null;
  pick: (p: BoxPlayer) => number | null;
  detail: (p: BoxPlayer) => string;
  color: string;
  photos: PhotoIndex;
  align: "left" | "right";
}) {
  if (!p) return <span className={cn("text-sm text-ink-muted", align === "right" && "text-right block")}>—</span>;
  const bartId = lookupId(photos, p.name);
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <div className={cn("flex items-center gap-2.5", align === "right" && "flex-row-reverse")}>
        <PlayerPhoto bartPlayerId={bartId} name={p.name} size={44} className="rounded-full shrink-0" />
        <span className="text-3xl font-semibold tabular leading-none" style={{ color: readableInk(color) }}>{pick(p)}</span>
      </div>
      <p className="mt-1.5 text-[0.78rem] text-ink font-medium truncate leading-tight">
        {shortName(p.name)}
        {p.position && <span className="text-ink-muted font-normal ml-1.5">{p.position}</span>}
      </p>
      <p className="text-[0.65rem] tabular text-ink-muted leading-tight">{detail(p)}</p>
    </div>
  );
}

/** "Cameron Boozer" → "C. Boozer". Keeps a long name on one line beside a
 *  44px photo without an ellipsis eating the surname, which is the half that
 *  identifies the player. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
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
    ["Total", ou !== null ? `${ou} · ${total > ou ? "over" : "under"} at ${total}` : null],
    ["Pace", b.teamStats.pace !== null ? `${b.teamStats.pace} poss` : null],
  ];
  // Laid out as an inline strip rather than a label/value table: as a table it
  // was a narrow column of text beside an empty half-page.
  return (
    <Panel title="Game info">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[0.55rem] uppercase tracking-[0.14em] font-bold text-ink-muted">{k}</dt>
            <dd className="text-[0.82rem] text-ink-soft leading-snug mt-0.5">{v}</dd>
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
    { label: "Field Goal %", a: a.fieldGoals.pct, h: h.fieldGoals.pct, unit: "%",
      aNote: `${a.fieldGoals.made}-${a.fieldGoals.attempted}`, hNote: `${h.fieldGoals.made}-${h.fieldGoals.attempted}` },
    { label: "Three Point %", a: a.threePointFieldGoals.pct, h: h.threePointFieldGoals.pct, unit: "%",
      aNote: `${a.threePointFieldGoals.made}-${a.threePointFieldGoals.attempted}`, hNote: `${h.threePointFieldGoals.made}-${h.threePointFieldGoals.attempted}` },
    { label: "Free Throw %", a: a.freeThrows.pct, h: h.freeThrows.pct, unit: "%",
      aNote: `${a.freeThrows.made}-${a.freeThrows.attempted}`, hNote: `${h.freeThrows.made}-${h.freeThrows.attempted}` },
    { label: "Rebounds", a: a.rebounds.total, h: h.rebounds.total,
      aNote: `${a.rebounds.offensive} off`, hNote: `${h.rebounds.offensive} off` },
    { label: "Assists", a: a.assists, h: h.assists },
    { label: "Turnovers", a: a.turnovers.total, h: h.turnovers.total },
    { label: "Points in the Paint", a: a.points.inPaint, h: h.points.inPaint },
    { label: "Effective FG%", a: a.fourFactors.effectiveFieldGoalPct, h: h.fourFactors.effectiveFieldGoalPct, unit: "%" },
    { label: "Largest Lead", a: a.points.largestLead, h: h.points.largestLead },
  ];
  if (led) rows.push({ label: "Percent Led", a: led.away, h: led.home, unit: "%" });

  return (
    <Panel title="Team stats">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <TeamLogo name={b.game.away.team} size={24} />
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: ac }} aria-hidden />
          <span className="text-[0.68rem] uppercase tracking-[0.1em] font-bold text-ink truncate">{b.game.away.team}</span>
        </div>
        <span className="w-24" aria-hidden />
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[0.68rem] uppercase tracking-[0.1em] font-bold text-ink truncate">{b.game.home.team}</span>
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: hc }} aria-hidden />
          <TeamLogo name={b.game.home.team} size={24} />
        </div>
      </div>
      <div className="divide-y divide-hairline/50">
        {rows.map((r) => <StatRowView key={r.label} r={r} hc={hc} ac={ac} />)}
      </div>
    </Panel>
  );
}

type StatRow = {
  label: string; a: number; h: number; unit?: string;
  aNote?: string; hNote?: string;
};

/**
 * One stat, both sides.
 *
 * Each team gets its own track, filled in ITS OWN COLOUR and anchored at the
 * outer edge so both bars grow toward the centre label. Anchoring outward
 * would put the two lengths at opposite ends of the row and make the
 * comparison a measurement rather than a glance.
 *
 * Bars are scaled to the pair, not to a fixed maximum, so a row where the two
 * teams are close reads as close and a blowout row reads as a blowout.
 */
function StatRowView({ r, hc, ac }: { r: StatRow; hc: string; ac: string }) {
  const tot = r.a + r.h;
  // A 0-0 row (a game with no free throws attempted) would divide by zero;
  // show two empty tracks rather than two full ones.
  const aw = tot > 0 ? (r.a / tot) * 100 : 0;
  const hw = tot > 0 ? (r.h / tot) * 100 : 0;
  const lead = r.a === r.h ? null : r.a > r.h ? "a" : "h";
  return (
    <div className="py-2.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
        <div className="min-w-0">
          {/* The number wears its school's colour and the trailing side is
              dimmed rather than greyed, so the row still reads as two teams
              instead of one winner and one neutral figure. */}
          <span className="text-lg tabular font-bold" style={{ color: readableInk(ac), opacity: lead === "h" ? 0.5 : 1 }}>
            {n1(r.a)}{r.unit}
          </span>
          {r.aNote && <span className="text-[0.62rem] tabular text-ink-muted ml-1.5">({r.aNote})</span>}
        </div>
        <span className="w-24 text-center text-[0.68rem] font-bold text-ink leading-tight">{r.label}</span>
        <div className="min-w-0 text-right">
          {r.hNote && <span className="text-[0.62rem] tabular text-ink-muted mr-1.5">({r.hNote})</span>}
          <span className="text-lg tabular font-bold" style={{ color: readableInk(hc), opacity: lead === "a" ? 0.5 : 1 }}>
            {n1(r.h)}{r.unit}
          </span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="h-2 rounded-full bg-paper-deep overflow-hidden flex">
          <span className="h-full rounded-full" style={{ width: `${aw}%`, background: ac }} />
        </span>
        <span className="w-24" aria-hidden />
        <span className="h-2 rounded-full bg-paper-deep overflow-hidden flex justify-end">
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
 * Flat strips, not cards. These are a row of results, and wrapping each in its
 * own white panel gave three boxes competing with the two that carry the
 * actual analysis below them.
 */
function Strip({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-[0.6rem] uppercase tracking-[0.18em] font-bold text-ink">{title}</h2>
        {note && <span className="text-[0.6rem] text-ink-muted ml-auto">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * A résumé strip, borrowed from the March-résumé ticker on the coach pages:
 * one cell per game, washed green for a win and red for a loss, with a mark
 * and the score inside it.
 *
 * It beats a bare W/L/W/W/L chip row because a letter says a team went 4-1
 * without saying whether the win came by 30 at home or by 1 in overtime on the
 * road. Opponent and score in the cell make "hot" and "flattered by the
 * schedule" distinguishable at the same glance.
 */
function ResumeStrip({
  rows, emptyLabel, markFor, tone,
}: {
  rows: ScheduleRow[];
  emptyLabel: string;
  /** Which school's mark the cell wears. Defaults to the opponent. */
  markFor?: (r: ScheduleRow) => string;
  tone?: "result" | "neutral";
}) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  return (
    <div className="flex gap-1.5">
      {rows.map((r) => (
        <ResumeCell key={r.id} r={r} mark={markFor ? markFor(r) : r.opponent} tone={tone} />
      ))}
    </div>
  );
}

function ResumeCell({
  r, mark, tone = "result",
}: {
  r: ScheduleRow; mark: string;
  /** "result" washes the cell green or red for a win or loss. "neutral" does
   *  not — used where the badge itself already says who won. */
  tone?: "result" | "neutral";
}) {
  const won = r.won;
  const where = r.neutral ? "vs" : r.isHome ? "vs" : "at";
  const plain = tone === "neutral";
  return (
    <div
      title={`${shortDate(r.date)} ${where} ${r.opponent} · ${won ? "W" : "L"} ${r.us}-${r.them}`}
      className={cn(
        "flex-1 min-w-0 flex flex-col items-center gap-1 rounded-lg px-1.5 pt-1.5 pb-1 ring-1",
        plain && "bg-paper-deep/50 ring-hairline",
        !plain && won === true && "bg-emerald-100/60 ring-emerald-300/60",
        !plain && won === false && "bg-rose-100/50 ring-rose-300/50",
        !plain && won === null && "bg-paper-deep ring-hairline",
      )}
    >
      {plain ? (
        <span className="text-[0.5rem] uppercase tracking-[0.1em] font-bold text-ink-muted leading-none">Won</span>
      ) : (
        <span className={cn(
          "text-[0.55rem] uppercase tracking-[0.1em] font-bold leading-none",
          won === true ? "text-emerald-700" : won === false ? "text-rose-700" : "text-ink-muted",
        )}>
          {won === null ? "–" : won ? "W" : "L"}
        </span>
      )}
      <TeamLogo name={mark} size={22} />
      <span className="text-[0.62rem] tabular font-semibold text-ink leading-none">{r.us}-{r.them}</span>
      <span className="text-[0.5rem] tabular text-ink-muted leading-none">
        {where === "at" ? "@" : ""}{shortDate(r.date)}
      </span>
    </div>
  );
}

function Form({ side, rows }: { side: GameSide; rows: ScheduleRow[] }) {
  return (
    <Strip title={`${side.team} form`}>
      <ResumeStrip rows={rows} emptyLabel="No completed games before this one." />
    </Strip>
  );
}

function HeadToHead({ b }: { b: GameBundle }) {
  const g = b.game;
  const w = b.h2h.filter((r) => r.won).length;
  return (
    <Strip title="Head to head" note={b.h2h.length ? `${g.home.team} ${w}-${b.h2h.length - w}` : undefined}>
      {/* Each cell wears the WINNER's mark and nothing else — no green/red
          wash and no W/L letter. Both were stated from the home team's side,
          which made a red cell under the visiting school's badge ambiguous
          about whose result it was. The winning badge says it once. */}
      <ResumeStrip
        rows={b.h2h}
        emptyLabel="First meeting in our records."
        markFor={(r) => (r.won ? g.home.team : r.opponent)}
        tone="neutral"
      />
    </Strip>
  );
}

/* ------------------------------- standings ------------------------------- */

function Standings({
  b, hc, ac, className,
}: { b: GameBundle; hc: string; ac: string; className?: string }) {
  const g = b.game;
  const confs = Object.keys(b.standings);
  if (confs.length === 0) return null;
  // An in-conference game has ONE table, and it is the table both teams are
  // actually racing in — so it runs at full length rather than through a
  // scrolling window. A non-conference game shows two, and those stay capped
  // so one panel doesn't run to forty rows.
  const single = confs.length === 1;
  const colorOf = (team: string) =>
    team === g.home.team ? hc : team === g.away.team ? ac : null;

  return (
    <Panel
      title={single ? `${confs[0]} standings` : "Standings"}
      note="Entering this game"
      className={className}
    >
      <div className="space-y-4">
        {confs.map((c) => (
          <div key={c}>
            {!single && (
              <p className="text-[0.58rem] uppercase tracking-[0.12em] font-bold text-ink-muted mb-1">{c}</p>
            )}
            <StandingsTable rows={b.standings[c]!} colorOf={colorOf} capped={!single} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StandingsTable({
  rows, colorOf, capped,
}: {
  rows: StandingRow[];
  colorOf: (team: string) => string | null;
  capped: boolean;
}) {
  return (
    <div className={cn("-mx-1 px-1", capped && "max-h-64 overflow-y-auto")}>
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
            // The two teams in this game are tinted in their OWN colours
            // rather than a shared accent, so which row is which reads without
            // going back to the name.
            const c = colorOf(r.team);
            return (
              <tr
                key={r.team}
                className="border-t border-hairline/50"
                style={c ? { background: `${c}14` } : undefined}
              >
                <td className="py-1 pr-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="w-4 text-right text-ink-muted shrink-0">{i + 1}</span>
                    <TeamLogo name={r.team} size={16} />
                    <span className={cn("truncate", c ? "font-semibold" : "text-ink-soft")}
                      style={c ? { color: readableInk(c) } : undefined}>
                      {r.team}
                    </span>
                  </span>
                </td>
                <td className={cn("text-right", !c && "text-ink-soft")}
                  style={c ? { color: readableInk(c), fontWeight: 600 } : undefined}>
                  {r.cw}-{r.cl}
                </td>
                <td className="text-right text-ink-muted">{r.w}-{r.l}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
