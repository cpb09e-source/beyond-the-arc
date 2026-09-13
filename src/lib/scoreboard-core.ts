/**
 * The scoreboard's pure half: the wire types, and every helper that turns a
 * slate into what the scoreboard page, the date picker and the ticker draw.
 *
 * NOTHING HERE MAY NEED A PAGE OR A BUILD. No fetch, no next/*, no `process`,
 * no `window`, no data URLs, no flags. The site reaches these through
 * src/lib/scoreboard.ts, which re-exports the types and the original helpers
 * beside the fetch client; the desktop app's renderer imports this file
 * directly, where there is neither a `process` global nor a page URL.
 *
 * The wire shape is produced by netlify/functions/scoreboard.mts. It is
 * duplicated here rather than imported because Netlify Functions bundle
 * separately from the Next app and cannot resolve the "@/" alias (same reason
 * parse-query.mts inlines its stat list). Keep the two in step.
 */

import { periodLabel } from "../components/game/types";
import { confDisplay } from "./conf-display";
import { isPowerConference } from "./conf-tiers";

export type ScoreTeam = {
  team: string;
  conference: string | null;
  points: number | null;
  winner: boolean | null;
  seed: number | null;
  /** AP Top 25 position in the poll current as of the slate, else null. */
  rank: number | null;
  /** Points by period: [1H, 2H, OT, 2OT…]. Empty when not reported. */
  periods: number[];
  /** W-L from completed games before this slate. Null when unknown. */
  record: { w: number; l: number } | null;
};

export type ScoreGame = {
  id: number;
  startDate: string;
  /** "scheduled" | "in_progress" | "final" — lowercased by the function. */
  status: string;
  home: ScoreTeam;
  away: ScoreTeam;
  neutralSite: boolean;
  conferenceGame: boolean;
  venue: string | null;
  period: number | null;
  clock: string | null;
  /** Closing betting line, HOME perspective (negative = home favored). */
  line: { spread: number | null; overUnder: number | null; provider: string } | null;
  /** The tip time has not been set — a fixture whose slot nobody has chosen. */
  tbd?: boolean;
  /** "NCAA" / "NIT" / a conference tournament name, else null. */
  tournament?: string | null;
};

export type Slate = {
  /**
   * "live"     — CBBD's live feed, games in progress now
   * "recent"   — a completed day we fell back to (last night)
   * "upcoming" — the next day that has games, none of them played yet. The
   *              offseason and preseason state; in July it is opening night.
   */
  source: "live" | "recent" | "upcoming";
  date: string | null;
  games: ScoreGame[];
  fetchedAt: string;
  error?: string;
};

/**
 * A timestamp's calendar date in US Eastern, as YYYY-MM-DD — the day the sport
 * files a game under. Shared with gameHref in scoreboard.ts.
 */
export const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

/** A game with at least one AP Top 25 side — what leads both surfaces. */
/**
 * Is this a real tournament seed?
 *
 * CBBD SENDS 99 FOR "NO SEED", NOT null. Taken literally that drew a small
 * grey "99" beside both teams in every non-tournament game on the board —
 * spotted on the 2026-03-24 NIT slate, where Wichita State and Tulsa were both
 * badged 99. The normalizer in netlify/functions/scoreboard.mts rejects it at
 * the source now, but every slate baked before that fix still carries it, and
 * re-baking fourteen seasons to correct a decoration is not worth ninety
 * minutes of upload. So the renderers check too.
 *
 * A bracket has 16 seeds. Anything outside that is a sentinel, whatever value
 * the feed picks for it next.
 */
export function isSeed(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 16;
}

export function isRanked(g: ScoreGame): boolean {
  return g.home.rank !== null || g.away.rank !== null;
}

export function isLive(g: ScoreGame): boolean {
  return g.status === "in_progress";
}
export function isFinal(g: ScoreGame): boolean {
  return g.status === "final";
}

/** Today's date in US Eastern, the day the sport files its schedule under. */
export function todayEastern(): string {
  return ET_DAY.format(new Date());
}

/** "Nov 3" — compact enough for the ticker's label rail. */
export function shortDateLabel(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  }).format(new Date(t));
}

/**
 * "Duke -2.5 · O/U 148.5" — the pre-tip line, written the way it is quoted:
 * the FAVORITE named with its own number. The wire format is home-perspective
 * (see the function), so an away favorite has to be flipped, and a pick'em
 * (spread 0) is named rather than shown as "-0".
 */
export function lineLabel(g: ScoreGame): string {
  if (!g.line) return "";
  const parts: string[] = [];
  const s = g.line.spread;
  if (s !== null) {
    if (s === 0) parts.push("Pick'em");
    else {
      const fav = s < 0 ? g.home.team : g.away.team;
      parts.push(`${fav} ${(-Math.abs(s)).toFixed(1).replace(/\.0$/, "")}`);
    }
  }
  if (g.line.overUnder !== null) parts.push(`O/U ${g.line.overUnder}`);
  return parts.join(" · ");
}

/** "12-4", or "" when we have no record for the team. */
export function recordLabel(t: ScoreTeam): string {
  return t.record ? `${t.record.w}-${t.record.l}` : "";
}

/** Tip time in US Eastern, which is how the sport lists its schedule. */
export function tipLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t)).replace(":00", "") + " ET";
}

/** "Saturday, March 7" — a YYYY-MM-DD day, as the scoreboard page heads it. */
export function dateLabel(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(t));
}

/* ------------------------------ the week strip ----------------------------- */

/** Yesterday/today in US Eastern — the day the sport dates its schedule by. */
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** A YYYY-MM-DD day moved by `days` calendar days (negative goes back). */
export function shiftDay(d: string, days: number): string {
  return ET_DATE.format(new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000));
}

/**
 * Seven days with `anchor` in the middle, three either side — the week strip.
 *
 * Centered rather than trailing so both directions are always one tap: during
 * the season you move backwards to last night and forwards to check a
 * scheduled slate, and a strip that only looked back would make half of that a
 * trip through the date picker.
 */
export function weekDays(anchor: string): string[] {
  return [-3, -2, -1, 0, 1, 2, 3].map((n) => shiftDay(anchor, n));
}

const DOW = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
/** "Sat" for a YYYY-MM-DD day. */
export function dowLabel(d: string): string {
  return DOW.format(new Date(`${d}T12:00:00Z`));
}
/** "7" for 2026-03-07 — the day of the month, unpadded. */
export function dayNum(d: string): string {
  return String(Number(d.slice(8, 10)));
}

/* ------------------------- filtering and grouping -------------------------- */

/**
 * Tournaments actually being played on this date.
 *
 * Offered ONLY when the slate has them, which for most of the year is never
 * — a permanent "NCAA Tournament" entry in a December dropdown is a filter
 * that can only ever return nothing. In March it is the first question
 * anybody asks of a slate, so it leads the list.
 *
 * NCAA and NIT are pinned in that order because they are the two everyone
 * means; conference tournaments follow alphabetically.
 */
export function slateTournaments(games: ScoreGame[]): string[] {
  const set = new Set<string>();
  for (const g of games) if (g.tournament) set.add(g.tournament);
  const rank = (t: string) => (t === "NCAA" ? 0 : t === "NIT" ? 1 : 2);
  return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Every conference with a team on the slate, by display name, alphabetical. */
export function slateConferences(games: ScoreGame[]): string[] {
  const set = new Set<string>();
  for (const g of games) {
    if (g.home.conference) set.add(confDisplay(g.home.conference));
    if (g.away.conference) set.add(confDisplay(g.away.conference));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * The filter takes a GROUP token or a single conference's display name.
 *
 * Tokens are prefixed so they can never collide with a real conference name.
 * A night's slate is thirty-odd leagues deep and the question a reader
 * actually arrives with is nearly always one of four — everything, the
 * ranked games, the high-major games, or everyone else — and answering that
 * used to mean knowing which of thirty entries to pick.
 *
 * POWER AND MID ARE A PARTITION, not two overlapping filters. Power is any
 * game with a high-major team on either side; mid is every game with none.
 * Together they are the whole slate and nothing appears twice, so a reader
 * flipping between them sees each game exactly once. Defining mid as "any
 * game involving a mid-major" instead would put Duke at Vermont in both,
 * which reads as a bug.
 *
 * isPowerConference, NOT POWER_CONFS directly. The scoreboard feed spells
 * conferences its own way — "Big Ten", "Big 12", "Big East" — while
 * POWER_CONFS holds Bart's codes. Only ACC and SEC collide, so a direct
 * lookup half-worked and put Arizona under Mid Majors. See the long note in
 * conf-tiers.ts.
 */
export function isPowerGame(g: ScoreGame): boolean {
  return isPowerConference(g.home.conference) || isPowerConference(g.away.conference);
}

/**
 * Does a game pass the slate filter? `token` is "" (everything),
 * "@t:<tournament>", "@top25", "@power", "@mid", or a conference's display
 * name as slateConferences spells it.
 *
 * Matches on EITHER side for a named conference, so picking the Big Ten keeps
 * a Big Ten team's non-conference game — the thing a reader following that
 * league wants.
 */
export function matchesSlateFilter(g: ScoreGame, token: string): boolean {
  if (!token) return true;
  if (token.startsWith("@t:")) return g.tournament === token.slice(3);
  if (token === "@top25") return isRanked(g);
  if (token === "@power") return isPowerGame(g);
  if (token === "@mid") return !isPowerGame(g);
  return Boolean(
    (g.home.conference && confDisplay(g.home.conference) === token) ||
    (g.away.conference && confDisplay(g.away.conference) === token),
  );
}

export type SlateGroups = {
  /**
   * Games with an AP Top 25 side that pass the filter, in the order the
   * function ranked them (best matchup first).
   */
  ranked: ScoreGame[];
  /** [heading, games] — every other game that passes the filter, grouped. */
  groups: Array<[string, ScoreGame[]]>;
};

/**
 * The slate as the page lays it out, under one filter token.
 *
 * Conference games group under their own conference; everything else is
 * non-conference. Sorted by tip so the page reads down the evening.
 *
 * Ranked games are EXCLUDED here, because they already lead the page under
 * Top 25 and printing them twice made the ACC read as if Duke played North
 * Carolina in two different buildings. Top 25 is filtered by the same
 * conference selection, so choosing the ACC still shows its ranked games —
 * just once, at the top, where they belong.
 */
export function groupSlate(games: ScoreGame[], token: string): SlateGroups {
  const m = new Map<string, ScoreGame[]>();
  for (const g of games) {
    if (!matchesSlateFilter(g, token) || isRanked(g)) continue;
    // TOURNAMENT FIRST. An NIT or NCAA game is not a conference game, so it
    // used to fall through to "Non-conference" — which is technically true
    // and reads as nonsense next to a bracket. CBBD tags the tournament and
    // it has been carried through normalize() and the baked slates since
    // 2026-09-09; this is the first thing to use it for grouping.
    const key = g.tournament
      ? g.tournament
      : g.conferenceGame && g.home.conference
      ? confDisplay(g.home.conference)
      : "Non-conference";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(g);
  }
  for (const list of m.values()) list.sort((a, b) => a.startDate.localeCompare(b.startDate));
  // Tournaments lead (NCAA, then NIT, then anything else CBBD labels),
  // conferences in the middle alphabetically, non-conference last.
  const tours = new Set(games.map((g) => g.tournament).filter(Boolean) as string[]);
  const bucket = (k: string) =>
    k === "Non-conference" ? 3 : !tours.has(k) ? 2 : k === "NCAA" ? 0 : k === "NIT" ? 1 : 1.5;
  const groups = [...m.entries()].sort((a, b) => bucket(a[0]) - bucket(b[0]) || a[0].localeCompare(b[0]));

  // Games with an AP Top 25 side, in the order the function ranked them (best
  // matchup first). These are the ONLY place a ranked game appears; the
  // conference groups above skip them.
  const ranked = games.filter(isRanked).filter((g) => matchesSlateFilter(g, token));

  return { ranked, groups };
}

/**
 * A game card's status line: "12:41 · 2nd" while live ("Live" when the feed
 * has no clock), "Final", "Time TBD", or the tip time in Eastern.
 */
export function gameStatusLabel(g: ScoreGame): string {
  return isLive(g) ? `${g.clock ?? "Live"}${g.period != null ? ` · ${periodLabel(g.period)}` : ""}`
    : isFinal(g) ? "Final"
    // A fixture whose time nobody has set yet. Saying "TBD" is the
    // whole truth; printing the placeholder midnight would be a
    // confident wrong answer.
    : g.tbd ? "Time TBD"
    : tipLabel(g.startDate);
}

/* --------------------------------- ticker --------------------------------- */

export type TickerLabel = {
  /**
   * "live"   — games in progress: a pulsing marker, then `text` ("3 live")
   * "date"   — a named day ("Nov 3"), for a fixture list or a past night
   * "scores" — tonight's results, `text` is "Scores"
   */
  kind: "live" | "date" | "scores";
  text: string;
};

/** What the ticker's sticky label rail says for a slate. */
export function tickerLabel(slate: Slate): TickerLabel {
  const liveCount = slate.games.filter(isLive).length;
  if (liveCount > 0) return { kind: "live", text: `${liveCount} live` };
  // Out of season the rail carries a fixture list, not results, and
  // "Scores" over a row of tip times is a small lie. Naming the day
  // is also the answer to the only question anyone has in July.
  if (slate.source === "upcoming") return { kind: "date", text: shortDateLabel(slate.date) };
  // NAME THE DAY WHENEVER IT IS NOT TODAY. Out of season the rail
  // carries the last night the sport played, and a row of real
  // scores under the bare word "Scores" reads as tonight's — the one
  // thing a scoreboard must never be wrong about.
  if (slate.date && slate.date < todayEastern()) return { kind: "date", text: shortDateLabel(slate.date) };
  return { kind: "scores", text: "Scores" };
}

/* ------------------------------ date picker ------------------------------- */

// ---- date helpers, all UTC-noon anchored so DST can never shift a day ----

const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
/** "March 2026" for "2026-03". */
export function monthLabel(ym: string): string {
  return MONTH.format(new Date(`${ym}-01T12:00:00Z`));
}

const PRETTY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
/** "Mar 7, 2026" for "2026-03-07". */
export function prettyDate(d: string): string {
  return PRETTY.format(new Date(`${d}T12:00:00Z`));
}

/** A YYYY-MM month moved by `by` months, across year ends. */
export function shiftMonth(ym: string, by: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(y, m, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Leading blanks then each day of the month, as ISO strings. */
export function monthCells(ym: string): Array<string | null> {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(y, m, 1, 12));
  const days = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  const out: Array<string | null> = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}
