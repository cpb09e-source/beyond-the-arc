/**
 * The single-game page's pure half: every figure, ranking and verdict the game
 * view derives from a bundle, without the markup that draws it.
 *
 * NOTHING HERE MAY NEED A PAGE OR A BUILD. No fetch, no next/*, no React, no
 * `process`, no `window`. The site's components under src/components/game (and
 * the static game page's metadata) import these; the desktop app's renderer
 * imports this file directly. Each function takes plain data — a GameBundle,
 * its plays, its box — and returns plain data. The JSX stays in the components.
 */

import { orebBaseline } from "./league-averages";
import {
  isFinal, lineLabel, longDate, periodLabel, tipLabel,
  type BoxPlayer, type GameBundle, type GameHead, type Play,
} from "../components/game/types";

/** One decimal place as a string, or an em dash for anything not a finite number. */
export const n1 = (v: number | null | undefined): string =>
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
    // Either count can be missing from the feed. A missing one is left out
    // rather than printed as "null TO", and a line with neither is a dash.
    detail: (p) => [
      p.turnovers != null ? `${p.turnovers} TO` : null,
      p.minutes != null ? `${p.minutes} MIN` : null,
    ].filter(Boolean).join(", ") || "–",
  },
];

/** One side's leader in one category. */
export type LeaderLine = {
  player: BoxPlayer;
  /** The category figure: points, rebounds or assists. */
  value: number;
  /** The supporting line — "9/15 FG, 4/5 FT", "7 DREB, 3 OREB", "2 TO, 31 MIN". */
  detail: string;
  /** Led the game in this category, or tied for it. Tints the row. */
  won: boolean;
};

export type LeaderCategory = {
  /** "Points" | "Rebounds" | "Assists", in that order. */
  label: string;
  /** Null when nobody on that side recorded more than zero. */
  away: LeaderLine | null;
  home: LeaderLine | null;
};

/** Each side's points, rebounds and assists leader, and which side led each. */
export function gameLeaders(b: GameBundle): LeaderCategory[] {
  return LEADER_CATS.map((c) => {
    const a = best(b.players.away, c.pick);
    const h = best(b.players.home, c.pick);
    const av = a ? c.pick(a) ?? 0 : 0;
    const hv = h ? c.pick(h) ?? 0 : 0;
    // A tie tints BOTH rows: 11 rebounds each is two players who led
    // the game, and picking one of them on a tiebreak would be
    // inventing a result the game didn't produce.
    return {
      label: c.label,
      away: a ? { player: a, value: av, detail: c.detail(a), won: av >= hv } : null,
      home: h ? { player: h, value: hv, detail: c.detail(h), won: hv >= av } : null,
    };
  });
}

/* ------------------------------- game info ------------------------------- */

export type GameInfoLabel = "Arena" | "Location" | "Tip-off" | "Attendance" | "Television" | "Line" | "Total";
export type GameInfoRow = { label: GameInfoLabel; value: string };

/**
 * The Game info panel's facts, in display order. A fact the bundle does not
 * carry is left out rather than returned empty.
 */
export function gameInfoRows(b: GameBundle): GameInfoRow[] {
  const g = b.game;
  const tv = b.broadcasts.filter((x) => x.broadcastType === "TV").map((x) => x.broadcastName).join(", ");
  const line = lineLabel(b);
  const ou = (b.line.find((l) => l.provider === "Draft Kings") ?? b.line[0])?.overUnder ?? null;

  const rows: Array<[GameInfoLabel, string | null]> = [
    ["Arena", g.venue],
    ["Location", [g.city, g.state].filter(Boolean).join(", ") || null],
    // A fixture whose slot nobody has chosen has no tip time, only a placeholder hour.
    ["Tip-off", g.tbd ? "TBD" : tipLabel(g.startDate)],
    ["Attendance", g.attendance ? g.attendance.toLocaleString() : null],
    ["Television", tv || null],
    ["Line", line],
    ["Total", ou !== null ? totalLabel(g, ou) : null],
  ];
  return rows
    .filter((r): r is [GameInfoLabel, string] => Boolean(r[1]))
    .map(([label, value]) => ({ label, value }));
}

/**
 * The Total row's value: the over/under, then where the game stands against it.
 *
 * ONLY A FINAL GAME IS CALLED. A running total is still moving, so a live game
 * shows it beside the line with no verdict, and a game that has not started
 * shows the line alone. A final total exactly on the number is a push, which
 * is neither over nor under.
 */
function totalLabel(g: GameHead, ou: number): string {
  if (!gameStarted(g)) return String(ou);
  const total = (g.home.points ?? 0) + (g.away.points ?? 0);
  if (!isFinal(g)) return `${ou} · ${total} so far`;
  const call = total > ou ? "over" : total < ou ? "under" : "push";
  return `${ou} · ${call} at ${total}`;
}

/* ------------------------------- team stats ------------------------------ */

export type StatRow = {
  label: string; a: number; h: number; unit?: string;
  aNote?: string; hNote?: string;
  /** Turnovers and defensive rating are won by the SMALLER number. */
  lowerIsBetter?: boolean;
};

/** A percentage of attempts, e.g. 3PA rate. Guards the zero-attempt game. */
function rate(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * The Team stats panel's rows, `a` away and `h` home. Null when either side's
 * team stats are missing, which is when the panel is not drawn.
 */
export function teamStatRows(b: GameBundle): StatRow[] | null {
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
    //
    // SPELLED OUT, like every other row here. "3PAR" and "FTAR" were the only
    // acronyms in a list that otherwise reads "Points in the Paint" and
    // "Fast-break Points", and they are the two rows a reader is least likely
    // to already know.
    //
    // Both say ATTEMPT RATE, which is what the R in each acronym stands for
    // and what the stat actually is: attempts over field-goal attempts, not a
    // make rate. Naming them in parallel is also the point — they are the same
    // measurement pointed at two different shots.
    { label: "3-Point Attempt Rate", a: rate(a.threePointFieldGoals.attempted, a.fieldGoals.attempted),
      h: rate(h.threePointFieldGoals.attempted, h.fieldGoals.attempted), unit: "%" },
    { label: "Free Throw Attempt Rate", a: a.fourFactors.freeThrowRate, h: h.fourFactors.freeThrowRate, unit: "%" },
    { label: "Largest Lead", a: a.points.largestLead, h: h.points.largestLead },
  ];
  if (led) rows.push({ label: "Percent Led", a: led.away, h: led.home, unit: "%" });
  return rows;
}

export type StatSplit = {
  /** The side that took the row — "a" away, "h" home — or null when level. */
  lead: "a" | "h" | null;
  /**
   * How much of the single track the AWAY segment takes, 0-100. Inverted on a
   * lowerIsBetter row, so the seam always leans toward the better team.
   */
  awayShare: number;
};

/**
 * Where one stat row's seam sits and who took it.
 *
 * THE SEAM ALWAYS LEANS TOWARD THE BETTER TEAM, which is not the same as
 * leaning toward the bigger number. Turnovers and defensive rating are won by
 * the SMALLER figure, and a plain share-of-total split put the longer segment
 * under the side that turned it over more while the +N underneath credited the
 * other — the bar and the verdict pointing opposite ways in the same row. Those
 * rows invert, so one rule holds down the whole column: further from center
 * toward a team means that team did better.
 */
export function statSplit(r: StatRow): StatSplit {
  const better = r.lowerIsBetter ? (x: number, y: number) => x < y : (x: number, y: number) => x > y;
  const lead = r.a === r.h ? null : better(r.a, r.h) ? "a" : "h";

  // Share of the pair, inverted for the lower-is-better rows so the seam and
  // the verdict never disagree. A 0-0 row (a game with no free throws) has no
  // ratio at all and sits dead center rather than dividing by zero.
  const tot = Math.abs(r.a) + Math.abs(r.h);
  const raw = tot > 0 ? (Math.abs(r.a) / tot) * 100 : 50;
  const aw = r.lowerIsBetter ? 100 - raw : raw;

  return { lead, awayShare: aw };
}

/**
 * Share of game clock each side spent in front, as whole percents.
 *
 * Derived from the play-by-play rather than reported: it is the stat that says
 * whether a three-point win was a lead held all night or a rescue in the last
 * minute, and the two read identically in every other number on this panel.
 * Time tied belongs to neither side, so the two figures need not sum to 100.
 */
export function percentLed(b: GameBundle): { home: number; away: number } | null {
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

/**
 * One side's season pace against this game's, to one decimal: positive when
 * the game ran faster than the side usually plays. Says whether a team played
 * its own game or got dragged into someone else's.
 */
export function paceDelta(game: number, seasonAvg: number): number {
  return Math.round((game - seasonAvg) * 10) / 10;
}

/* ------------------------------ four factors ------------------------------ */

export type Factor = {
  key: string; label: string; sub: string;
  a: number; h: number; unit?: string;
  /** A differential: one side's figure is the negative of the other's. */
  diff?: boolean;
  /** Scored against this league value instead of against the opponent. */
  baseline?: number;
};

/** A factor with who took it. On the baseline row that can be both, or neither. */
export type FactorLine = Factor & { aWon: boolean; hWon: boolean };

export type FourFactorsResult = {
  /** REB Diff, OREB %, FBP Diff, 3PM Diff, in that order. */
  factors: FactorLine[];
  /** Factors each side took, out of four. Not complementary — 3-2 and 1-1 happen. */
  aWins: number;
  hWins: number;
  /** Each side's FTA rate, the tiebreak. */
  ftaA: number;
  ftaH: number;
  /** The four factors alone were level, so FTA rate decided (or did not). */
  level: boolean;
  /** Who took the four factors, tiebreak included; null when dead even. */
  winner: "a" | "h" | null;
  /** That side's team name. */
  name: string | null;
  /** Whether that side won the game; null with no factor winner or no result. */
  won: boolean | null;
};

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
 *
 * Null when either side's team stats are missing.
 */
export function fourFactors(b: GameBundle): FourFactorsResult | null {
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

  return {
    factors: factors.map((f) => ({ ...f, aWon: winsFactor(f, "a"), hWon: winsFactor(f, "h") })),
    aWins, hWins, ftaA, ftaH, level, winner, name, won,
  };
}

/** Did this side take the factor? Against the baseline where there is one,
 *  against the opponent otherwise. */
function winsFactor(f: Factor, side: "a" | "h"): boolean {
  const mine = side === "a" ? f.a : f.h;
  const theirs = side === "a" ? f.h : f.a;
  return f.baseline !== undefined ? mine > f.baseline : mine > theirs;
}

/* ------------------------------ head to head ------------------------------ */

export type H2hTally = {
  /** Meetings the HOME team won. */
  wins: number;
  /** Meetings the home team lost. A meeting with no recorded winner is neither. */
  losses: number;
  /** "Duke 3-2", from the home team's side; null when they have never met. */
  note: string | null;
  /**
   * Each meeting's winning school, parallel to b.h2h (oldest first). "" for a
   * meeting with no recorded winner: an empty string rather than null, so a
   * caller reading this as a school name gets no name instead of a crash.
   */
  winners: string[];
};

/**
 * The head-to-head record, from the home team's side.
 *
 * Each meeting is marked with its WINNER rather than a W/L: the rows are stated
 * from the home team's side, which made a loss under the visiting school's
 * badge ambiguous about whose result it was. The winning school says it once.
 */
export function h2hTally(b: GameBundle): H2hTally {
  const g = b.game;
  // `won` is null where the feed has no result for a meeting. That is not a
  // home loss, so it counts for neither side and names no winner.
  const w = b.h2h.filter((r) => r.won === true).length;
  const l = b.h2h.filter((r) => r.won === false).length;
  return {
    wins: w,
    losses: l,
    note: b.h2h.length ? `${g.home.team} ${w}-${l}` : null,
    winners: b.h2h.map((r) => (r.won === true ? g.home.team : r.won === false ? r.opponent : "")),
  };
}

/* ------------------------------- box score -------------------------------- */

/** The box score's sortable columns. */
export type BoxSortKey = "min" | "pts" | "reb" | "ast" | "ts" | "usg" | "pm";

/**
 * athleteId → plus-minus, in HOME terms (home margin gained while on court).
 * The away side negates it.
 *
 * Returns an empty map when the feed carries no on-floor data, which is how
 * the column knows to render an em dash rather than a wrong zero.
 */
export function plusMinus(plays: Play[]): Map<number, number> {
  const out = new Map<number, number>();
  let prevH = 0, prevA = 0;
  for (const p of plays) {
    if (!p.sc) continue;
    const swing = (p.hs - prevH) - (p.as - prevA);
    prevH = p.hs; prevA = p.as;
    if (!p.on?.length || swing === 0) continue;
    for (const id of p.on) out.set(id, (out.get(id) ?? 0) + swing);
  }
  return out;
}

/**
 * One player's plus-minus from his own side: `pm` is plusMinus(), `pmSign` 1
 * for the home side and -1 for the away side. Null when the feed carries no
 * on-floor data at all.
 */
export function playerPlusMinus(p: BoxPlayer, pm: Map<number, number>, pmSign: 1 | -1): number | null {
  const hasPm = pm.size > 0;
  // A player who appeared but was never on the floor for a scoring play really
  // is 0, so a missing id is only unknown when the whole feed is missing.
  return !hasPm ? null : (pm.get(p.athleteId) ?? 0) * pmSign;
}

/**
 * One side's box, sorted descending on a column. A missing figure sorts
 * last. Stable, so players level on the column keep the feed's order.
 */
export function sortBoxPlayers(players: BoxPlayer[], sort: BoxSortKey, pm: Map<number, number>, pmSign: 1 | -1): BoxPlayer[] {
  const val = (p: BoxPlayer, k: BoxSortKey): number => {
    switch (k) {
      case "min": return p.minutes ?? -1;
      case "pts": return p.points ?? -1;
      case "reb": return p.rebounds.total ?? -1;
      case "ast": return p.assists ?? -1;
      case "ts": return p.trueShootingPct ?? -1;
      case "usg": return p.usage ?? -1;
      case "pm": return playerPlusMinus(p, pm, pmSign) ?? -999;
    }
  };
  return [...players].sort((a, c) => val(c, sort) - val(a, sort));
}

/* ------------------------------ play by play ------------------------------ */

export type PlaySide = "all" | "home" | "away";
export type PlayKind = "all" | "scoring" | "shots" | "turnovers";

/** The play log under the team and play-type filters, in feed order. */
export function filterPlays(plays: Play[], side: PlaySide, kind: PlayKind): Play[] {
  return plays.filter((p) => {
    if (side === "home" && !p.h) return false;
    if (side === "away" && p.h) return false;
    if (kind === "scoring") return p.sc;
    if (kind === "shots") return p.sh;
    if (kind === "turnovers") return /turnover|steal/i.test(p.t);
    return true;
  });
}

/** Periods in play order, each with its own rows. */
export function groupPlaysByPeriod(plays: Play[]): Array<[number, Play[]]> {
  const m = new Map<number, Play[]>();
  for (const p of plays) {
    if (!m.has(p.per)) m.set(p.per, []);
    m.get(p.per)!.push(p);
  }
  return [...m.entries()].sort((a, c) => a[0] - c[0]);
}

/**
 * A period's heading in the play log: "1st half", "2nd half", then "OT",
 * "2OT". Overtimes are not halves, so they carry no "half".
 */
export function periodHeading(per: number): string {
  return per <= 2 ? `${periodLabel(per)} half` : periodLabel(per);
}

/**
 * The team a play belongs to, for its logo slot — or null for a row that
 * belongs to no team (end of period, official timeouts), which keeps the slot
 * empty. `home` and `away` are the bundle's team names, the fallback when the
 * play carries no team of its own.
 */
export function playActor(p: Play, home: string, away: string): string | null {
  const team = p.tm || (p.h ? home : away);
  const neutral = /end period|end game|official|tv timeout/i.test(p.t);
  return neutral || !team ? null : team;
}

/* --------------------------------- header --------------------------------- */

/**
 * Nothing has happened yet. `status` is what the feed says; the points
 * check catches a stale "scheduled" on a game that has plainly started.
 */
export function gameNotStarted(g: GameHead): boolean {
  return g.status === "scheduled"
    && g.home.points === null && g.away.points === null;
}

/** Either side has a score, so the header draws the numbers. */
export function gameStarted(g: GameHead): boolean {
  return g.away.points != null || g.home.points != null;
}

/**
 * Season records entering the game, read off the standings tables, as "W-L" —
 * "" for a team no table lists. Taken from there rather than counted from
 * `form`, which only holds five games — a "5-0" beside a team that is 21-1 is
 * worse than no record at all.
 */
export function recordsFromStandings(b: GameBundle): { home: string; away: string } {
  const find = (team: string) => {
    for (const rows of Object.values(b.standings)) {
      const hit = rows.find((r) => r.team === team);
      if (hit) return `${hit.w}-${hit.l}`;
    }
    return "";
  };
  return { home: find(b.game.home.team), away: find(b.game.away.team) };
}

/**
 * The line over the scoreline: the home conference for a conference game,
 * else "Neutral site" or "Non-conference", then the long Eastern date —
 * "ACC · Saturday, March 7, 2026".
 */
export function gameEyebrow(g: GameHead): string {
  return `${g.conferenceGame && g.home.conference
    ? g.home.conference
    : g.neutralSite ? "Neutral site" : "Non-conference"} · ${longDate(g.startDate)}`;
}

/* ------------------------------ archive page ------------------------------ */

/** The fields resultLine and halvesLine read. The archive index's ArchiveSide fits it. */
export type ResultSide = { team: string; pts: number | null; winner: boolean | null; periods: number[] };
export type ResultGame = { home: ResultSide; away: ResultSide };

/** "North Carolina 71, Duke 68" — winner first, the way a result is spoken. */
export function resultLine(g: ResultGame): string {
  const h = g.home, a = g.away;
  if (h.pts === null || a.pts === null) return `${a.team} at ${h.team}`;
  const [w, l] = h.winner ? [h, a] : [a, h];
  return `${w.team} ${w.pts}, ${l.team} ${l.pts}`;
}

/**
 * " Halves: 38-33, 40-35." — each period away-home, with a leading space and
 * a closing period so it drops straight into a sentence. "" unless both sides
 * have at least two periods.
 */
export function halvesLine(g: ResultGame): string {
  return g.home.periods.length >= 2 && g.away.periods.length >= 2
    ? ` Halves: ${g.away.periods.map((p, i) => `${p}-${g.home.periods[i]}`).join(", ")}.`
    : "";
}
