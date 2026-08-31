"use client";

import { useEffect, useState } from "react";
import { ArrowUpDown, CircleDollarSign, Clock, Landmark, MapPin, Tv, Users } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { loadPhotoIndex, lookupId, type PhotoIndex } from "@/lib/player-photo-index";
import { readableInk } from "@/lib/team-colors";
import { orebBaseline, FACTOR_WIN_RATE, seasonLabel } from "@/lib/league-averages";
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
        <div className="space-y-5">
          <Leaders b={b} hc={hc} ac={ac} photos={photos} onOpenBox={onOpenBox} />
          <GameInfo b={b} />
        </div>
        <TeamStatsPanel b={b} hc={hc} ac={ac} />
        <div className="space-y-5">
          <FourFactors b={b} hc={hc} ac={ac} />
          <Standings b={b} hc={hc} ac={ac} />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- shell --------------------------------- */

function Panel({
  title, note, children, className, flush,
}: {
  title: string; note?: string; children: React.ReactNode; className?: string;
  /** Drop the body padding, for panels whose rows carry their own and need to
   *  run edge to edge — a tinted row inset by 16px reads as a chip. */
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-hairline bg-card overflow-hidden flex flex-col", className)}>
      <div className="px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-baseline gap-2">
        <h2 className="text-[0.6rem] uppercase tracking-[0.18em] font-bold text-ink">{title}</h2>
        {note && <span className="text-[0.6rem] text-ink-muted ml-auto">{note}</span>}
      </div>
      <div className={cn("flex-1", !flush && "p-4")}>{children}</div>
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

const LEADER_CATS: {
  label: string;
  pick: (p: BoxPlayer) => number | null;
  detail: (p: BoxPlayer) => string;
}[] = [
  {
    label: "Points",
    pick: (p) => p.points,
    detail: (p) => `${p.fieldGoals.made}/${p.fieldGoals.attempted} FG, ${p.freeThrows.made}/${p.freeThrows.attempted} FT`,
  },
  {
    label: "Rebounds",
    pick: (p) => p.rebounds.total,
    detail: (p) => `${p.rebounds.defensive} DREB, ${p.rebounds.offensive} OREB`,
  },
  {
    label: "Assists",
    pick: (p) => p.assists,
    detail: (p) => `${p.turnovers} TO, ${p.minutes} MIN`,
  },
];

/**
 * Game leaders as a ledger: six rows, read top to bottom, grouped under a stat
 * heading. The shape of every box score ever printed.
 *
 * This replaced a MIRRORED layout — the two teams facing each other across a
 * centre label — and the mirror turned out to cost more than it bought. Two
 * photos, two names and two stat lines had to fit either side of a 96px label
 * column inside a 27rem panel, so both names ran as "C. Boozer" and both detail
 * lines sat at 0.65rem. Stacked, each player gets the panel's full width, the
 * names are spelled out, and the three numbers land in one column the eye can
 * run straight down.
 *
 * The category winner carries a wash of its own team's colour rather than a
 * badge or a bold weight, so which side won each of the three is a glance at
 * the left edge instead of a comparison across a gap.
 */
function Leaders({
  b, hc, ac, photos, onOpenBox,
}: {
  b: GameBundle; hc: string; ac: string; photos: PhotoIndex; onOpenBox?: () => void;
}) {
  return (
    <Panel title="Game leaders" flush>
      <div>
        {LEADER_CATS.map((c) => {
          const a = best(b.players.away, c.pick);
          const h = best(b.players.home, c.pick);
          const av = a ? c.pick(a) ?? 0 : 0;
          const hv = h ? c.pick(h) ?? 0 : 0;
          return (
            <div key={c.label}>
              <p className="px-4 pt-3 pb-1 text-[0.6rem] uppercase tracking-widest font-bold text-ink">
                {c.label}
              </p>
              {/* A tie tints BOTH rows: 11 rebounds each is two players who led
                  the game, and picking one of them on a tiebreak would be
                  inventing a result the game didn't produce. */}
              <LeaderRow p={a} c={c} team={b.game.away.team} color={ac} photos={photos} won={av >= hv} />
              <LeaderRow p={h} c={c} team={b.game.home.team} color={hc} photos={photos} won={hv >= av} />
            </div>
          );
        })}
      </div>
      {onOpenBox && (
        <div className="px-4 py-3 border-t border-hairline">
          <button
            type="button"
            onClick={onOpenBox}
            className="w-full text-center text-[0.72rem] font-medium text-coral hover:underline"
          >
            Full box score
          </button>
        </div>
      )}
    </Panel>
  );
}

/**
 * One leader: headshot, team mark, name, the supporting line, then the number.
 *
 * The photo resolves through the season's name index — CBBD gives us a name
 * and its own athlete id, neither of which is the id our images are keyed by
 * (see src/lib/player-photo-index.ts). A miss falls back to the monogram
 * PlayerPhoto already draws, so a player we cannot resolve degrades quietly.
 */
function LeaderRow({
  p, c, team, color, photos, won,
}: {
  p: BoxPlayer | null;
  c: (typeof LEADER_CATS)[number];
  team: string;
  color: string;
  photos: PhotoIndex;
  won: boolean;
}) {
  if (!p) return null;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-t border-hairline/50"
      style={won ? { background: `${color}12` } : undefined}
    >
      <PlayerPhoto bartPlayerId={lookupId(photos, p.name)} name={p.name} size={38} className="rounded-full shrink-0" />
      <TeamLogo name={team} size={18} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[0.82rem] truncate leading-tight", won ? "text-ink font-semibold" : "text-ink-soft")}>
          {p.name}
          {p.position && <span className="text-ink-muted font-normal ml-1.5 text-[0.7rem]">{p.position}</span>}
        </p>
        <p className="text-[0.65rem] tabular text-ink-muted leading-tight">{c.detail(p)}</p>
      </div>
      <span
        className="text-2xl font-bold tabular leading-none shrink-0"
        style={{ color: won ? readableInk(color) : "var(--ink-muted)" }}
      >
        {c.pick(p)}
      </span>
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

  // Every row carries an icon rather than only some of them: a two-column grid
  // with half its cells indented and half not reads as a rendering fault.
  const rows: Array<[string, string | null, typeof Landmark]> = [
    ["Arena", g.venue, Landmark],
    ["Location", [g.city, g.state].filter(Boolean).join(", ") || null, MapPin],
    ["Tip-off", tipLabel(g.startDate), Clock],
    ["Attendance", g.attendance ? g.attendance.toLocaleString() : null, Users],
    ["Television", tv || null, Tv],
    ["Line", line, CircleDollarSign],
    // Over/under is literally a direction, which is what the glyph says.
    ["Total", ou !== null ? `${ou} · ${total > ou ? "over" : "under"} at ${total}` : null, ArrowUpDown],
  ];
  // Two per row in a column: a single full-width strip left most of the line
  // empty here, and a label/value table wasted half the width on labels.
  return (
    <Panel title="Game info">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.filter(([, v]) => v).map(([k, v, Icon]) => (
          <div key={k} className="min-w-0 flex gap-2">
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-muted" aria-hidden strokeWidth={1.75} />
            <div className="min-w-0">
              <dt className="text-[0.55rem] uppercase tracking-[0.14em] font-bold text-ink-muted">{k}</dt>
              <dd className="text-[0.8rem] text-ink-soft leading-snug mt-0.5">{v}</dd>
            </div>
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
    // Efficiency leads. Everything below it is the how; these two are the what,
    // and they are the pair that actually decides who was better per
    // possession once pace is taken out.
    { label: "Offensive Rating", a: a.rating, h: h.rating },
    { label: "Defensive Rating", a: h.rating, h: a.rating, lowerIsBetter: true },
    { label: "Field Goal %", a: a.fieldGoals.pct, h: h.fieldGoals.pct, unit: "%",
      aNote: `${a.fieldGoals.made}-${a.fieldGoals.attempted}`, hNote: `${h.fieldGoals.made}-${h.fieldGoals.attempted}` },
    { label: "Three Point %", a: a.threePointFieldGoals.pct, h: h.threePointFieldGoals.pct, unit: "%",
      aNote: `${a.threePointFieldGoals.made}-${a.threePointFieldGoals.attempted}`, hNote: `${h.threePointFieldGoals.made}-${h.threePointFieldGoals.attempted}` },
    { label: "Free Throw %", a: a.freeThrows.pct, h: h.freeThrows.pct, unit: "%",
      aNote: `${a.freeThrows.made}-${a.freeThrows.attempted}`, hNote: `${h.freeThrows.made}-${h.freeThrows.attempted}` },
    { label: "Rebounds", a: a.rebounds.total, h: h.rebounds.total },
    { label: "Offensive Rebounds", a: a.rebounds.offensive, h: h.rebounds.offensive },
    { label: "Assists", a: a.assists, h: h.assists },
    { label: "Turnovers", a: a.turnovers.total, h: h.turnovers.total, lowerIsBetter: true },
    { label: "Points in the Paint", a: a.points.inPaint, h: h.points.inPaint },
    { label: "Fast-break Points", a: a.points.fastBreak, h: h.points.fastBreak },
    { label: "Effective FG%", a: a.fourFactors.effectiveFieldGoalPct, h: h.fourFactors.effectiveFieldGoalPct, unit: "%" },
    // Rate stats, both denominated in field-goal attempts, which is what makes
    // them comparable between teams that played at different speeds.
    { label: "3PAR", a: rate(a.threePointFieldGoals.attempted, a.fieldGoals.attempted),
      h: rate(h.threePointFieldGoals.attempted, h.fieldGoals.attempted), unit: "%" },
    { label: "FTAR", a: a.fourFactors.freeThrowRate, h: h.fourFactors.freeThrowRate, unit: "%" },
    { label: "Largest Lead", a: a.points.largestLead, h: h.points.largestLead },
  ];
  if (led) rows.push({ label: "Percent Led", a: led.away, h: led.home, unit: "%" });

  return (
    <Panel title="Team stats" flush>
      <div className="px-4 pt-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-3 border-b border-hairline">
          <div className="flex items-center gap-2">
            <TeamLogo name={b.game.away.team} size={24} />
            <span className="text-[0.68rem] uppercase tracking-widest font-bold text-ink truncate">{b.game.away.team}</span>
          </div>
          <span className="w-16" aria-hidden />
          <div className="flex items-center gap-2 justify-end">
            <span className="text-[0.68rem] uppercase tracking-widest font-bold text-ink truncate">{b.game.home.team}</span>
            <TeamLogo name={b.game.home.team} size={24} />
          </div>
        </div>
      </div>
      <div>
        {rows.map((r) => <StatRowView key={r.label} r={r} hc={hc} ac={ac} />)}
      </div>
      {/* Pace belongs to the game, not to a team — both sides face the same
          number of possessions — so the figure sits in the middle rather than
          being staged as a contest with itself.

          Each side's season average flanks it, because the number only means
          something against how these teams usually play: 64 is a grind for one
          pair and a track meet for another. */}
      {b.teamStats.pace !== null && (
        <div className="px-4 py-3 border-t border-hairline grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <SeasonPace value={b.teamStats.seasonPace?.away ?? null} game={b.teamStats.pace} color={ac} align="left" />
          <div className="text-center">
            <p className="text-[0.55rem] uppercase tracking-[0.14em] font-bold text-ink-muted">Pace</p>
            <p className="text-xl tabular font-bold text-ink leading-none mt-0.5">{n1(b.teamStats.pace)}</p>
            <p className="text-[0.55rem] text-ink-muted mt-0.5">possessions each</p>
          </div>
          <SeasonPace value={b.teamStats.seasonPace?.home ?? null} game={b.teamStats.pace} color={hc} align="right" />
        </div>
      )}
    </Panel>
  );
}

/**
 * One side's season pace beside the game's, with the gap called out. Says
 * whether a team played its own game or got dragged into someone else's.
 */
function SeasonPace({
  value, game, color, align,
}: { value: number | null; game: number; color: string; align: "left" | "right" }) {
  if (value === null) return <span />;
  const delta = Math.round((game - value) * 10) / 10;
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="text-sm tabular font-semibold" style={{ color: readableInk(color) }}>{n1(value)}</p>
      <p className="text-[0.55rem] text-ink-muted leading-tight">
        season avg
        {delta !== 0 && (
          <span className="tabular"> · {delta > 0 ? "+" : ""}{n1(delta)} here</span>
        )}
      </p>
    </div>
  );
}

type StatRow = {
  label: string; a: number; h: number; unit?: string;
  aNote?: string; hNote?: string;
  /** Turnovers and defensive rating are won by the SMALLER number. */
  lowerIsBetter?: boolean;
};

/**
 * Marks the side that took a category.
 *
 * A wash of green behind the figure rather than a colour change to the figure
 * itself: the numbers are already carrying team identity, and overloading them
 * to also carry won/lost left neither reading cleanly. Green is the only
 * semantic colour on the panel, so it cannot be mistaken for a team.
 *
 * Renders a plain wrapper when it did not win, so the number does not shift.
 */
function Won({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <span className="inline-block px-1.5 py-0.5">{children}</span>;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded-md bg-good/12 ring-1 ring-good/35">
      {children}
    </span>
  );
}

/** A percentage of attempts, e.g. 3PA rate. Guards the zero-attempt game. */
function rate(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * One stat, both sides, as a SINGLE track split at a moving seam.
 *
 * This replaced a pair of mirrored tracks growing inward from either edge. Two
 * bars means two lengths starting in different places and running in opposite
 * directions, which is a measurement rather than a glance, and each row left
 * two stretches of empty track that read as missing data. One continuous bar
 * has a single thing to look at — where the seam sits — and the tick at dead
 * centre gives it a fixed reference, so the margin is a distance rather than a
 * subtraction. The explicit +N states it outright for anyone who wants the
 * number.
 *
 * THE SEAM ALWAYS LEANS TOWARD THE BETTER TEAM, which is not the same as
 * leaning toward the bigger number. Turnovers and defensive rating are won by
 * the SMALLER figure, and a plain share-of-total split put the longer segment
 * under the side that turned it over more while the +N underneath credited the
 * other — the bar and the verdict pointing opposite ways in the same row. Those
 * rows invert, so one rule holds down the whole column: further from centre
 * toward a team means that team did better. The figures themselves are printed
 * either side, so nothing is hidden by the flip.
 *
 * The green winner chip is gone with the mirrored bars. It was a third colour
 * system laid over two team colours to say what the seam now says by shape.
 */
function StatRowView({ r, hc, ac }: { r: StatRow; hc: string; ac: string }) {
  const better = r.lowerIsBetter ? (x: number, y: number) => x < y : (x: number, y: number) => x > y;
  const lead = r.a === r.h ? null : better(r.a, r.h) ? "a" : "h";

  // Share of the pair, inverted for the lower-is-better rows so the seam and
  // the verdict never disagree. A 0-0 row (a game with no free throws) has no
  // ratio at all and sits dead centre rather than dividing by zero.
  const tot = Math.abs(r.a) + Math.abs(r.h);
  const raw = tot > 0 ? (Math.abs(r.a) / tot) * 100 : 50;
  const aw = r.lowerIsBetter ? 100 - raw : raw;

  return (
    <div className="px-4 py-2.5 border-t border-hairline/50">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.82rem] tabular font-bold" style={{ color: readableInk(ac) }}>
          {n1(r.a)}{r.unit}
          {r.aNote && <span className="ml-1 text-[0.58rem] font-normal text-ink-muted">({r.aNote})</span>}
        </span>
        <span className="text-[0.6rem] uppercase tracking-wide font-bold text-ink text-center leading-tight">
          {r.label}
        </span>
        <span className="text-[0.82rem] tabular font-bold text-right" style={{ color: readableInk(hc) }}>
          {r.hNote && <span className="mr-1 text-[0.58rem] font-normal text-ink-muted">({r.hNote})</span>}
          {n1(r.h)}{r.unit}
        </span>
      </div>

      <div className="relative mt-1.5 h-2.5 rounded-full overflow-hidden flex bg-paper-deep">
        <span style={{ width: `${aw}%`, background: ac }} />
        <span className="flex-1" style={{ background: hc }} />
        {/* A paper hairline at the seam. This sport pits blue against blue
            constantly, and two close colours meeting with no break read as one
            continuous block that says nothing. */}
        <span className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `${aw}%` }} aria-hidden />
        {/* Even. How far the seam sits from this is the margin. */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/25" aria-hidden />
      </div>

      {lead && (
        <p
          className="mt-1 text-[0.55rem] uppercase tracking-widest font-bold"
          style={{
            color: lead === "a" ? readableInk(ac) : readableInk(hc),
            textAlign: lead === "a" ? "left" : "right",
          }}
        >
          +{n1(Math.abs(r.a - r.h))}{r.unit}
        </p>
      )}
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

/* ------------------------------ four factors ------------------------------ */

/**
 * The four factors, as this site defines them — the same set the team pages
 * rank against D-I: rebound differential, offensive rebound rate, fast-break
 * differential, and three-point differential. NOT Dean Oliver's four; ours are
 * the ones our own model leans on.
 *
 * THREE OF THEM ARE DIFFERENTIALS, so one team's figure is the negative of the
 * other's and each is won outright. Offensive rebound rate is the exception:
 * both teams have their own, and a 34% and a 33% night is two teams crashing
 * the glass, not one winning a category. It is scored against the D-I season
 * average instead, so BOTH sides can take it or neither can.
 *
 * That means the tallies are not complementary — 3-2 and 1-1 are both possible
 * — and the panel counts each team out of four rather than splitting four.
 *
 * THE TIEBREAK. Level on the four and the game goes to FTA rate, which is
 * deliberately not one of them. Getting to the line is the closest thing to a
 * fifth factor, and leaving a draw unresolved would waste the verdict.
 */
function FourFactors({ b, hc, ac }: { b: GameBundle; hc: string; ac: string }) {
  const h = b.teamStats.home, a = b.teamStats.away;
  if (!h || !a) return null;

  const rebDiff = a.rebounds.total - h.rebounds.total;
  const fbpDiff = a.points.fastBreak - h.points.fastBreak;
  const tpmDiff = a.threePointFieldGoals.made - h.threePointFieldGoals.made;
  const base = orebBaseline(b.game.season);

  const factors: Factor[] = [
    { key: "reb", label: "REB Diff", sub: "total rebounds vs allowed", a: rebDiff, h: -rebDiff, diff: true },
    { key: "orb", label: "OREB %", sub: `offensive rebound rate vs ${n1(base)}% D-I average`,
      a: a.fourFactors.offensiveReboundPct, h: h.fourFactors.offensiveReboundPct, unit: "%", baseline: base },
    { key: "fbp", label: "FBP Diff", sub: "fast-break points vs allowed", a: fbpDiff, h: -fbpDiff, diff: true },
    { key: "tpm", label: "3PM Diff", sub: "3-pointers made vs allowed", a: tpmDiff, h: -tpmDiff, diff: true },
  ];

  const aWins = factors.filter((f) => winsFactor(f, "a")).length;
  const hWins = factors.filter((f) => winsFactor(f, "h")).length;
  const ftaA = a.fourFactors.freeThrowRate, ftaH = h.fourFactors.freeThrowRate;
  const level = aWins === hWins;
  const winner = !level
    ? (aWins > hWins ? "a" : "h")
    : ftaA === ftaH ? null : ftaA > ftaH ? "a" : "h";

  const name = winner === "a" ? b.game.away.team : winner === "h" ? b.game.home.team : null;
  const won = winner === "a" ? b.game.away.winner : winner === "h" ? b.game.home.winner : null;

  return (
    <Panel title="Four factors" note="This game">
      <div className="divide-y divide-hairline/50">
        {factors.map((f) => <FactorRow key={f.key} f={f} b={b} hc={hc} ac={ac} />)}
      </div>

      <div className="mt-3 pt-3 border-t border-hairline">
        {name ? (
          <div className="flex items-center gap-2.5">
            <TeamLogo name={name} size={26} />
            <div className="min-w-0">
              <p className="text-[0.82rem] text-ink leading-tight">
                <span className="font-semibold" style={{ color: readableInk(winner === "a" ? ac : hc) }}>{name}</span>
                {level ? " took the four factors " : " won the four factors "}
                <span className="tabular font-semibold">{Math.max(aWins, hWins)}–{Math.min(aWins, hWins)}</span>
              </p>
              <p className="text-[0.65rem] text-ink-muted leading-tight mt-0.5">
                {level
                  ? `Level at ${aWins}; FTA rate broke it, ${n1(Math.max(ftaA, ftaH))}% to ${n1(Math.min(ftaA, ftaH))}%.`
                  : won === false
                  ? "And lost the game."
                  : won === true
                  ? "And won the game."
                  : ""}
              </p>
              {/* One benchmark, and it is the strong one: sweeping all four.
                  The rate for merely taking more of them is a weaker claim and
                  having both on screen invited comparing two numbers that
                  answer different questions. */}
              <p className="text-[0.62rem] text-ink-muted leading-tight mt-1">
                Teams winning all four won{" "}
                <span className="tabular font-semibold text-good">{n1(FACTOR_WIN_RATE.sweep)}%</span>
                {" "}of the time in {seasonLabel(FACTOR_WIN_RATE.season)}.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[0.82rem] text-ink-muted">Dead even, FTA rate included.</p>
        )}
      </div>
    </Panel>
  );
}

type Factor = {
  key: string; label: string; sub: string;
  a: number; h: number; unit?: string;
  /** A differential: one side's figure is the negative of the other's. */
  diff?: boolean;
  /** Scored against this league value instead of against the opponent. */
  baseline?: number;
};

/** Did this side take the factor? Against the baseline where there is one,
 *  against the opponent otherwise. */
function winsFactor(f: Factor, side: "a" | "h"): boolean {
  const mine = side === "a" ? f.a : f.h;
  const theirs = side === "a" ? f.h : f.a;
  return f.baseline !== undefined ? mine > f.baseline : mine > theirs;
}

function FactorRow({ f, b, hc, ac }: { f: Factor; b: GameBundle; hc: string; ac: string }) {
  const aWon = winsFactor(f, "a"), hWon = winsFactor(f, "h");
  const show = (v: number) => (f.diff && v > 0 ? `+${n1(v)}` : `${n1(v)}${f.unit ?? ""}`);
  return (
    // The definition rides on the row's title rather than under every label:
    // it is worth having for the OREB row, where the baseline explains how a
    // category can end up with no winner at all, but not worth four lines of
    // permanent explanatory text.
    <div className="flex items-center gap-3 py-2.5" title={f.sub}>
      <div className="min-w-0 flex-1">
        <p className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink leading-tight">{f.label}</p>
      </div>
      <div className="flex items-baseline gap-1.5 tabular shrink-0">
        <Won on={aWon}>
          <span className="text-[0.82rem] font-semibold" style={{ color: readableInk(ac) }}>{show(f.a)}</span>
        </Won>
        <span className="text-ink-muted/40 text-[0.7rem]">/</span>
        <Won on={hWon}>
          <span className="text-[0.82rem] font-semibold" style={{ color: readableInk(hc) }}>{show(f.h)}</span>
        </Won>
      </div>
      {/* Marks rather than a tick: they say WHO took it, and on the baseline
          row there can be two of them or none. */}
      <span className="w-12 flex justify-end gap-1 shrink-0">
        {aWon && <TeamLogo name={b.game.away.team} size={20} />}
        {hWon && <TeamLogo name={b.game.home.team} size={20} />}
        {!aWon && !hWon && <span className="text-ink-muted/40 text-xs">–</span>}
      </span>
    </div>
  );
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
  // MOST RECENT FIRST. The rows arrive oldest-to-newest, which is how a season
  // is stored but not how form is read: "what have they done lately" is a
  // question about the left-hand end of the strip, where the eye starts.
  return (
    <div className="flex gap-1.5">
      {[...rows].reverse().map((r) => (
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
        !plain && won === true && "bg-good/12 ring-good/35",
        !plain && won === false && "bg-bad/12 ring-bad/35",
        !plain && won === null && "bg-paper-deep ring-hairline",
      )}
    >
      {plain ? (
        <span className="text-[0.5rem] uppercase tracking-[0.1em] font-bold text-ink-muted leading-none">Won</span>
      ) : (
        <span className={cn(
          "text-[0.55rem] uppercase tracking-[0.1em] font-bold leading-none",
          won === true ? "text-good" : won === false ? "text-bad" : "text-ink-muted",
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
    <div className={cn("-mx-1 px-1", capped && "max-h-80 overflow-y-auto")}>
      {/* Sized to be READ, not skimmed past. At 0.72rem this ran a full
          conference of eighteen rows in type smaller than the footnotes beside
          it, which is the wrong way round: the table is the panel. */}
      <table className="w-full text-sm tabular">
        <thead className="sticky top-0 bg-card">
          <tr className="text-[0.58rem] uppercase tracking-widest text-ink-muted">
            <th className="text-left font-bold pb-1">Team</th>
            <th className="w-14 text-right font-bold pb-1">Conf</th>
            <th className="w-14 text-right font-bold pb-1">All</th>
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
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="w-5 text-right text-ink-muted shrink-0">{i + 1}</span>
                    <TeamLogo name={r.team} size={20} />
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
