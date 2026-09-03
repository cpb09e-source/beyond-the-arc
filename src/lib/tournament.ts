/**
 * Shared types, client and standings maths for the coach tournament pages
 * under /t/.
 *
 * The wire shape is produced by netlify/functions/tournament.mts and is
 * duplicated here rather than imported, for the same reason scoreboard.ts
 * duplicates its slate: Netlify Functions bundle separately from the Next app
 * and cannot resolve the "@/" alias. Keep the two in step.
 *
 * STANDINGS FOLLOW THE NAIG BASKETBALL RULEBOOK (v080823), as Colin's own 4D
 * app already encodes them: rank by win %, then by point differential, and a
 * game's margin counts at most ±30 toward that differential — the blowout rule,
 * so a 60-point win over a short-handed side is not worth more than a 30-point
 * one. A forfeit is recorded 30–0.
 */

export type Side = {
  teamId: string | null;
  applicantId: string | null;
  name: string;
  /** True for "Winner 4 of Group A" / "Winner of Match 1" slots. */
  placeholder: boolean;
};

export type Game = {
  id: string;
  name: string;
  stage: "group" | "playoff";
  round: string;
  matchNum: number | null;
  /** YYYY-MM-DD, venue-local. */
  date: string;
  /** "08:00 AM", as published. */
  time: string;
  startMs: number | null;
  court: string | null;
  a: Side;
  b: Side;
  status: "scheduled" | "live" | "final";
  scoreA: number | null;
  scoreB: number | null;
  winnerTeamId: string | null;
  nextMatchId: string | null;
  raw: Record<string, string | number | boolean | null>;
};

export type Team = {
  id: string;
  applicantId: string;
  name: string;
  short: string;
  color: string | null;
  players: { name: string; captain: boolean }[];
};

export type Tournament = {
  slug: string;
  event: {
    name: string;
    division: string;
    group: string;
    venue: { name: string; address: string | null; tz: string | null };
  };
  ourTeam: string;
  teams: Team[];
  games: Game[];
  fetchedAt: string;
  error?: string;
};

/** Blowout rule: the most a single game's margin counts toward the tiebreak. */
export const DIFF_CAP = 30;

/** Poll interval while anything can still change. */
export const POLL_MS = 30_000;

export async function fetchTournament(slug: string, signal?: AbortSignal): Promise<Tournament> {
  // ?sim=sat|live|sun on the PAGE is forwarded to the function, which honours
  // it only under the Netlify CLI (see simulate() there). In production the
  // parameter reaches the function and is ignored, so a shared link carrying
  // it still shows the real feed.
  let sim = "";
  if (typeof window !== "undefined") {
    const s = new URLSearchParams(window.location.search).get("sim");
    if (s && /^[a-z]+$/.test(s)) sim = `&sim=${s}`;
  }
  const res = await fetch(`/api/tournament?event=${encodeURIComponent(slug)}${sim}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`tournament feed ${res.status}`);
  const body = (await res.json()) as Tournament;
  if (body.error || !Array.isArray(body.games)) throw new Error(body.error ?? "malformed feed");
  return body;
}

/** Nothing left to poll for: every game has gone final. */
export function tournamentIsSettled(t: Tournament): boolean {
  return t.games.length > 0 && t.games.every((g) => g.status === "final");
}

/** Longest the page will sleep before checking the feed again. */
const IDLE_RECHECK_MS = 60 * 60 * 1000;

/**
 * How long to wait before the next fetch, or null to stop.
 *
 * NOTHING CHANGES BEFORE THE FIRST TIP, so there is no reason to ask every
 * thirty seconds through the days before the tournament — the page sleeps
 * until the earliest unplayed game is due, and re-checks hourly in the
 * meantime in case the organiser moves one. Once a game is live, or is past
 * its tip and not yet scored (scorers start late), it is back to POLL_MS.
 */
export function nextPollDelay(t: Tournament, now = Date.now()): number | null {
  if (tournamentIsSettled(t)) return null;
  if (t.games.some(isLive)) return POLL_MS;
  const pending = t.games.filter((g) => g.status !== "final" && g.startMs !== null);
  if (pending.length === 0) return POLL_MS;
  const earliest = Math.min(...pending.map((g) => g.startMs!));
  const untilTip = earliest - now;
  if (untilTip <= POLL_MS) return POLL_MS;
  return Math.min(untilTip, IDLE_RECHECK_MS);
}

export const isLive = (g: Game) => g.status === "live";
export const isFinal = (g: Game) => g.status === "final";

/** Either side is the named team. Compared by id when it has one, else by name. */
export function involves(g: Game, team: Team | string): boolean {
  const id = typeof team === "string" ? null : team.id;
  const name = typeof team === "string" ? team : team.name;
  const hit = (s: Side) => (id && s.teamId === id) || (!s.placeholder && s.name === name);
  return hit(g.a) || hit(g.b);
}

/* ---------------------------------------------------------------- standings */

export type TeamRow = {
  team: Team;
  gp: number;
  w: number;
  l: number;
  pf: number;
  pa: number;
  /** Tiebreak differential — each game's margin capped at ±DIFF_CAP. */
  diff: number;
  /** Uncapped, for the eye. */
  rawDiff: number;
};

const clamp = (m: number) => Math.max(-DIFF_CAP, Math.min(DIFF_CAP, m));
const winPct = (r: TeamRow) => (r.gp ? r.w / r.gp : 0);

/**
 * Group standings from the finals so far. Rank: win % → capped differential →
 * points for → name, which is the rulebook order with a deterministic tail so
 * two 0–0 teams never swap places between polls.
 *
 * Only GROUP games count. A playoff result is not a group result, and the
 * bracket has already been seeded by the time one exists.
 */
export function standings(t: Tournament): TeamRow[] {
  const rows = new Map<string, TeamRow>(
    t.teams.map((team) => [team.id, { team, gp: 0, w: 0, l: 0, pf: 0, pa: 0, diff: 0, rawDiff: 0 }]),
  );
  for (const g of t.games) {
    if (g.stage !== "group" || g.status !== "final" || g.scoreA === null || g.scoreB === null) continue;
    const a = g.a.teamId ? rows.get(g.a.teamId) : undefined;
    const b = g.b.teamId ? rows.get(g.b.teamId) : undefined;
    if (!a || !b) continue;
    a.gp++; b.gp++;
    a.pf += g.scoreA; a.pa += g.scoreB;
    b.pf += g.scoreB; b.pa += g.scoreA;
    const m = g.scoreA - g.scoreB;
    a.diff += clamp(m); b.diff -= clamp(m);
    a.rawDiff += m; b.rawDiff -= m;
    if (m > 0) { a.w++; b.l++; } else if (m < 0) { b.w++; a.l++; }
  }
  return [...rows.values()].sort(
    (x, y) => winPct(y) - winPct(x) || y.diff - x.diff || y.pf - x.pf || x.team.name.localeCompare(y.team.name),
  );
}

/** "W2" / "L1" from a team's finals in schedule order, or "·" before any. */
export function streak(t: Tournament, team: Team): { text: string; kind: "" | "w" | "l" } {
  const results: ("W" | "L")[] = [];
  for (const g of t.games) {
    if (g.stage !== "group" || g.status !== "final" || g.scoreA === null || g.scoreB === null) continue;
    if (g.a.teamId === team.id) results.push(g.scoreA > g.scoreB ? "W" : "L");
    else if (g.b.teamId === team.id) results.push(g.scoreB > g.scoreA ? "W" : "L");
  }
  if (!results.length) return { text: "·", kind: "" };
  const last = results[results.length - 1]!;
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return { text: `${last}${n}`, kind: last === "W" ? "w" : "l" };
}

/* ------------------------------------------------------------ the bracket */

/**
 * What a bracket slot currently means.
 *
 *   settled    — the organiser has filled it, or the feeder game is final
 *   projected  — inferred from the standings as they stand right now
 *   open       — nothing to infer from yet
 */
export type Resolved = {
  name: string;
  team: Team | null;
  state: "settled" | "projected" | "open";
  /** The slot's own label, e.g. "Winner 4 of Group A", kept for the small print. */
  slot: string;
};

/**
 * Resolve one side of a playoff game against the current standings and the
 * games played so far.
 *
 * SEED SLOTS ("Winner 4 of Group A") project from the table — the point of a
 * live playoff picture is that a coach can see who they are on course to
 * play. It is marked projected until the group is complete, because a table
 * with two games left is a forecast.
 *
 * FEEDER SLOTS ("Winner of Match 1") settle from that game's result, and
 * before it is played they project one level: if both of that game's own
 * sides are known, the slot reads "M1: Titans / LIQ" rather than a blank.
 */
export function resolveSide(s: Side, t: Tournament, table: TeamRow[], groupComplete: boolean): Resolved {
  if (!s.placeholder && s.teamId) {
    const team = t.teams.find((x) => x.id === s.teamId) ?? null;
    return { name: s.name, team, state: "settled", slot: s.name };
  }
  const seed = /winner\s+(\d+)\s+of/i.exec(s.name);
  if (seed) {
    const row = table[Number(seed[1]) - 1];
    if (!row || row.gp === 0) return { name: `Seed ${seed[1]}`, team: null, state: "open", slot: s.name };
    return { name: row.team.name, team: row.team, state: groupComplete ? "settled" : "projected", slot: s.name };
  }
  const feeder = /winner\s+of\s+(.+)$/i.exec(s.name);
  if (feeder) {
    const label = feeder[1]!.trim().toLowerCase();
    const game = t.games.find((g) => g.name.toLowerCase() === label);
    if (game) {
      if (game.status === "final" && game.winnerTeamId) {
        const team = t.teams.find((x) => x.id === game.winnerTeamId) ?? null;
        return { name: team?.name ?? s.name, team, state: "settled", slot: s.name };
      }
      const a = resolveSide(game.a, t, table, groupComplete);
      const b = resolveSide(game.b, t, table, groupComplete);
      // ONE LEVEL ONLY. "Titans / Team Supreme / 4-D" for a final whose
      // semi-finals are themselves projections is three names for a slot that
      // might hold any of them, and it stops reading as a pair. A feeder
      // collapses to "A / B" only when both of its own sides are single teams;
      // beyond that the slot keeps its label until the round below settles.
      const single = (r: Resolved) => r.state !== "open" && !r.name.includes(" / ");
      if (single(a) && single(b)) {
        return { name: `${a.name} / ${b.name}`, team: null, state: "projected", slot: s.name };
      }
    }
  }
  return { name: s.name, team: null, state: "open", slot: s.name };
}

/** Every group game is final. */
export function groupIsComplete(t: Tournament): boolean {
  const group = t.games.filter((g) => g.stage === "group");
  return group.length > 0 && group.every((g) => g.status === "final");
}

/* ------------------------------------------------------------- formatting */

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-09-05" → "Sat, Sep 5". Read as UTC so the calendar date never shifts. */
export function dayLabel(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) ? DAY.format(new Date(t)) : date;
}

/** "08:00 AM" → "8:00 AM". */
export function timeLabel(time: string): string {
  return time.replace(/^0/, "");
}

export function diffLabel(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}


/* ------------------------------------------------------------- what if? */

/**
 * One hypothetical result: who wins, and by how much.
 *
 * MARGIN 0 IS ALLOWED AND MEANS "I DON'T KNOW YET". Basketball has no draws,
 * so a zero-point win is not a result — but "we win this one, no idea by how
 * much" is a real thing a coach wants to say, and forcing a number would make
 * them invent one that then moves the seeding. A 0 counts as a win in the
 * record and contributes nothing to the differential.
 */
export type Pick = { winnerId: string; margin: number };

/** Picks by game id. */
export type Picks = Record<string, Pick>;

/** The most a hypothetical margin may be, matching the blowout cap. */
export const MAX_MARGIN = DIFF_CAP;

export type ProjRow = {
  team: Team;
  gp: number;
  w: number;
  l: number;
  /** Capped differential — real finals and picks together. */
  diff: number;
  /** How many of this team's counted games are hypothetical. */
  projected: number;
  /**
   * True when another team has the same win % AND the same differential, so
   * the order between them here is arbitrary. The rulebook goes to further
   * tiebreaks that this cannot know; saying so beats implying a seed.
   */
  tied: boolean;
};

/**
 * The group table as it would stand if the picked games finished that way.
 *
 * REAL RESULTS ARE NOT OVERRIDABLE. A game that has already gone final counts
 * with its real margin whatever the picks say — the point of the tool is to
 * play the rest of the weekend forward from where it actually is, and a
 * calculator that lets you un-lose a game answers a question nobody has.
 *
 * Ranked the way the NAIG rulebook ranks: win %, then point differential with
 * each game's margin capped at ±30. Where those both tie the row is flagged
 * rather than ordered by something invented.
 */
export function projectStandings(t: Tournament, picks: Picks): ProjRow[] {
  const rows = new Map<string, ProjRow>(
    t.teams.map((team) => [team.id, { team, gp: 0, w: 0, l: 0, diff: 0, projected: 0, tied: false }]),
  );
  const clamp = (m: number) => Math.max(-DIFF_CAP, Math.min(DIFF_CAP, m));

  for (const g of t.games) {
    if (g.stage !== "group") continue;
    const a = g.a.teamId ? rows.get(g.a.teamId) : undefined;
    const b = g.b.teamId ? rows.get(g.b.teamId) : undefined;
    if (!a || !b) continue;

    // A real final always wins over a pick.
    if (g.status === "final" && g.scoreA !== null && g.scoreB !== null) {
      const m = clamp(g.scoreA - g.scoreB);
      a.gp++; b.gp++;
      a.diff += m; b.diff -= m;
      if (m > 0) { a.w++; b.l++; } else if (m < 0) { b.w++; a.l++; }
      continue;
    }

    const pick = picks[g.id];
    if (!pick) continue;
    const winner = pick.winnerId === a.team.id ? a : pick.winnerId === b.team.id ? b : null;
    if (!winner) continue;
    const loser = winner === a ? b : a;
    const m = clamp(Math.abs(pick.margin));
    winner.gp++; loser.gp++;
    winner.w++; loser.l++;
    winner.diff += m; loser.diff -= m;
    winner.projected++; loser.projected++;
  }

  const winPct = (r: ProjRow) => (r.gp ? r.w / r.gp : 0);
  const out = [...rows.values()].sort(
    (x, y) => winPct(y) - winPct(x) || y.diff - x.diff || x.team.name.localeCompare(y.team.name),
  );
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1], next = out[i + 1], r = out[i]!;
    const same = (o?: ProjRow) => o !== undefined && winPct(o) === winPct(r) && o.diff === r.diff;
    r.tied = same(prev) || same(next);
  }
  return out;
}

/** Group games still open to a pick — anything not already final. */
export function pickableGames(t: Tournament): Game[] {
  return t.games.filter((g) => g.stage === "group" && g.status !== "final" && g.a.teamId !== null && g.b.teamId !== null);
}
