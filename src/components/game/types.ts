/**
 * Wire types for one game, as emitted by netlify/functions/game.mts.
 *
 * Duplicated on the function side rather than imported, for the same reason
 * src/lib/scoreboard.ts is: Netlify Functions bundle separately from the Next
 * app and cannot resolve the "@/" alias. Keep the two in step.
 */

export type Pct = { made: number; attempted: number; pct: number };

export type GameSide = {
  team: string;
  conference: string | null;
  points: number | null;
  /** [1H, 2H, OT…]. Empty until the first half ends. */
  periods: number[];
  winner: boolean | null;
  /** AP Top 25 position in the poll in effect that day, else null. */
  rank: number | null;
  /** Elo before and after. Null on a live game — it isn't settled yet. */
  elo: [number, number] | null;
};

export type GameHead = {
  id: number;
  startDate: string;
  /** "scheduled" | "in_progress" | "final" */
  status: string;
  season: number;
  venue: string | null;
  city: string | null;
  state: string | null;
  attendance: number | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  /** CBBD's own 0-10 competitiveness score. Null before the game ends. */
  excitement: number | null;
  /** Live only. */
  period?: number | null;
  clock?: string | null;
  home: GameSide;
  away: GameSide;
};

export type TeamStats = {
  possessions: number;
  assists: number; steals: number; blocks: number;
  trueShooting: number; rating: number;
  points: {
    total: number; byPeriod: number[]; largestLead: number;
    fastBreak: number; inPaint: number; offTurnovers: number;
  };
  fieldGoals: Pct; twoPointFieldGoals: Pct; threePointFieldGoals: Pct; freeThrows: Pct;
  turnovers: { total: number };
  rebounds: { offensive: number; defensive: number; total: number };
  fouls: { total: number };
  fourFactors: {
    effectiveFieldGoalPct: number; freeThrowRate: number;
    turnoverRatio: number; offensiveReboundPct: number;
  };
};

export type BoxPlayer = {
  athleteId: number;
  name: string;
  position: string | null;
  starter: boolean;
  ejected: boolean;
  minutes: number | null;
  points: number | null;
  turnovers: number | null; fouls: number | null;
  assists: number | null; steals: number | null; blocks: number | null;
  gameScore: number | null;
  offensiveRating: number | null; defensiveRating: number | null; netRating: number | null;
  usage: number | null;
  effectiveFieldGoalPct: number | null; trueShootingPct: number | null;
  offensiveReboundPct: number | null;
  fieldGoals: Pct; twoPointFieldGoals: Pct; threePointFieldGoals: Pct; freeThrows: Pct;
  rebounds: { offensive: number; defensive: number; total: number };
};

export type Play = {
  /** CBBD play id. */
  i: number;
  /** Play type, e.g. "JumpShot" / "Defensive Rebound" / "Substitution". */
  t: string;
  /** True when the acting team is the home side. */
  h: boolean;
  tm: string;
  hs: number; as: number;
  per: number; clk: string; sec: number;
  sc: boolean; sh: boolean;
  v: number | null;
  txt: string;
  /** Shot detail. x/y are HALF-COURT units, tenths of a foot, rim at (250, 52.5). */
  s: {
    m: boolean; r: string; a: boolean; by: string | null;
    x: number | null; y: number | null;
  } | null;
  /** Athlete ids on the floor. Present on scoring plays only — see the trim
   *  in netlify/functions/game.mts. Used to attribute plus-minus. */
  on?: number[];
};

/** One row of a team's schedule, from that team's own perspective. */
export type ScheduleRow = {
  id: number;
  date: string;
  season: number;
  opponent: string;
  isHome: boolean;
  neutral: boolean;
  us: number | null;
  them: number | null;
  won: boolean | null;
  venue: string | null;
};

export type StandingRow = {
  team: string;
  /** Overall and conference-only records entering this game. */
  w: number; l: number; cw: number; cl: number;
};

export type GameBundle = {
  game: GameHead;
  teamStats: {
    home: TeamStats | null; away: TeamStats | null;
    pace: number | null; gameMinutes: number | null;
    /** Each side's season average pace entering this game. */
    seasonPace?: { home: number | null; away: number | null };
  };
  players: { home: BoxPlayer[]; away: BoxPlayer[] };
  plays: Play[];
  broadcasts: { broadcastType: string; broadcastName: string }[];
  line: { provider: string; spread: number | null; overUnder: number | null }[];
  /** Last five completed games each side carried INTO this one. */
  form: { home: ScheduleRow[]; away: ScheduleRow[] };
  /** Their last five meetings before this one, from the HOME team's side. */
  h2h: ScheduleRow[];
  /** Conference name → table entering this game, best conference record first. */
  standings: Record<string, StandingRow[]>;
  fetchedAt: string;
};

export function isLive(g: GameHead): boolean { return g.status === "in_progress"; }
export function isFinal(g: GameHead): boolean { return g.status === "final"; }

/** "2nd" / "OT" / "2OT" — the sport plays two halves, then overtimes. */
export function periodLabel(p: number): string {
  if (p <= 1) return "1st";
  if (p === 2) return "2nd";
  return p === 3 ? "OT" : `${p - 2}OT`;
}

/** Column headings for the line score: 1H, 2H, then OT, 2OT… */
export function periodHeadings(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? "1H" : i === 1 ? "2H" : i === 2 ? "OT" : `${i - 1}OT`));
}

export function tipLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  }).format(new Date(t)).replace(":00", "") + " ET";
}

export function longDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(t));
}

export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
  }).format(new Date(t));
}

/**
 * "Duke -6.5" — the pre-tip line written the way it is quoted, with the
 * FAVOURITE named beside its own number. The wire format is home-perspective
 * (negative = home favoured), so an away favourite has to be flipped.
 */
export function lineLabel(b: GameBundle): string | null {
  const l = b.line.find((x) => x.provider === "Draft Kings") ?? b.line[0];
  if (!l || l.spread === null) return null;
  if (l.spread === 0) return "Pick'em";
  const fav = l.spread < 0 ? b.game.home.team : b.game.away.team;
  return `${fav} ${(-Math.abs(l.spread)).toFixed(1).replace(/\.0$/, "")}`;
}
