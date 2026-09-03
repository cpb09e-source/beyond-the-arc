import type { Context } from "@netlify/functions";

import { setDefaultResultOrder } from "node:dns";

// Same reason as scoreboard.mts: Google's DNS answers list AAAA first and the
// Netlify dev sandbox has no IPv6 egress, so without this every upstream call
// dies locally with a bare AggregateError. Ordering preference only.
setDefaultResultOrder("ipv4first");

/**
 * tournament — a live feed for one Playinga-hosted tournament, for the coach
 * pages under /t/.
 *
 * WHERE THE DATA LIVES. Playinga (the platform behind app.naismailigames.com)
 * is an Angular app over Firestore, project `ismaili-hq`. The public schedule
 * page signs in ANONYMOUSLY with Firebase's identity toolkit and then reads
 * Firestore directly — there is no REST API of Playinga's own. That anonymous
 * sign-in is the whole authorisation model: the web API key is restricted by
 * HTTP referer, and the Firestore rules allow reads to any signed-in user of
 * documents queried BY DIVISION. Both were established by watching the page's
 * own network traffic, and this function makes exactly the requests the page
 * makes, with the page's referer.
 *
 * WHY A FUNCTION AND NOT THE BROWSER. The referer restriction means a fetch
 * from btacbb.xyz is refused at the key, so the request has to be made from
 * somewhere that can set the header. It also puts the edge cache in front of
 * Firestore: a coach and a bench full of parents refreshing on a Saturday
 * morning is one Firestore round-trip per REFRESH_SECONDS, not one each.
 *
 * WHAT IT WILL NOT DO. Only events listed in EVENTS are reachable, by slug —
 * this is not a general proxy into someone else's database, and the ids are
 * not accepted from the request. Reads only.
 *
 * THE SCORE SHAPE IS INFERRED, NOT DOCUMENTED. At the time of writing no match
 * in the event had been played, so the fields Playinga writes on scoring were
 * not observable. readScore() therefore checks several plausible shapes and
 * the response carries a `raw` bag of every scalar field on the match, so the
 * first scored game on the day tells us which shape is real and the client
 * can be corrected without guessing twice. `status` 2 is the only value seen
 * so far and means scheduled.
 */

/** Tournaments this endpoint knows. Add a slug here to publish another. */
const EVENTS: Record<string, {
  event: string;
  division: string;
  group: string;
  /** The team's name AS THE ORGANISER REGISTERED IT — the key we match on. */
  ourTeam: string;
  /**
   * What the page calls it. The registration says "4-D"; the team says 4D.
   * Applied to the team and to every game side that carries its id, so the
   * organiser's spelling appears nowhere on the page.
   */
  displayName?: string;
  /** Fallback UTC offset in seconds when the venue does not carry one. */
  utcOffsetSeconds: number;
}> = {
  cig: {
    event: "iTN7O3AgJ9FzQyb43m3Y",
    division: "bnx49XKB5vfHPYedfLsa",
    group: "dndl2gnz",
    ourTeam: "4-D",
    displayName: "4D",
    // America/Chicago in September is CDT, UTC−5.
    utcOffsetSeconds: -5 * 3600,
  },
};

/**
 * Playinga's PUBLIC Firebase web key — it ships in the HTML of every page on
 * app.naismailigames.com and is restricted by referer, not by secrecy. It is
 * not one of ours and it is not a secret; it is here so the anonymous sign-in
 * the page performs can be performed from this function.
 */
const FIREBASE_WEB_KEY = "AIzaSyCuOWqoc0ATREc5NvVMJnRyiUjFJuXTSeo";
const REFERER = "https://app.naismailigames.com/";
const FIRESTORE = "https://firestore.googleapis.com/v1/projects/ismaili-hq/databases/(default)/documents";

/** Edge cache lifetime. Scores move every few minutes on a game day, not faster. */
const REFRESH_SECONDS = 30;
/** How long the edge may serve a stale answer while refetching behind it. */
const STALE_SECONDS = 300;

/* ------------------------------------------------------------ wire types */

type Side = {
  teamId: string | null;
  applicantId: string | null;
  name: string;
  /** True for "Winner 4 of Group A" / "Winner of Match 1" slots. */
  placeholder: boolean;
};

type Game = {
  id: string;
  /** "GA Match 9", "Semi-Final 1", "Final" — the organiser's own label. */
  name: string;
  stage: "group" | "playoff";
  /** Group A, or the playoff round name. */
  round: string;
  matchNum: number | null;
  /** YYYY-MM-DD in the venue's local time. */
  date: string;
  /** "08:00 AM", as published. */
  time: string;
  /** Epoch ms of the scheduled tip, or null if the time did not parse. */
  startMs: number | null;
  court: string | null;
  a: Side;
  b: Side;
  status: "scheduled" | "live" | "final";
  scoreA: number | null;
  scoreB: number | null;
  winnerTeamId: string | null;
  nextMatchId: string | null;
  /** Every scalar field on matchInfo, for diagnosing the score shape on the day. */
  raw: Record<string, string | number | boolean | null>;
};

type Team = {
  id: string;
  applicantId: string;
  name: string;
  short: string;
  color: string | null;
  players: { name: string; captain: boolean }[];
};

type Payload = {
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

/* ------------------------------------------------------ firestore client */

/**
 * Anonymous Firebase token, cached for the life of the container.
 *
 * The identity toolkit issues one-hour tokens. Every cold start signs in once
 * and every warm invocation reuses the token until ten minutes before expiry,
 * so the sign-in call is a rounding error against the Firestore reads.
 */
let tokenCache: { token: string; expiresAt: number } | null = null;

async function anonToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_WEB_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json", referer: REFERER, origin: "https://app.naismailigames.com" },
    body: JSON.stringify({ returnSecureToken: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`anonymous sign-in ${res.status}`);
  const body = (await res.json()) as { idToken?: string; expiresIn?: string };
  if (!body.idToken) throw new Error("anonymous sign-in returned no token");
  const ttl = (Number(body.expiresIn) || 3600) * 1000;
  tokenCache = { token: body.idToken, expiresAt: Date.now() + ttl - 10 * 60 * 1000 };
  return body.idToken;
}

/** Firestore's typed-value envelope, flattened to plain JSON. */
type FsValue = Record<string, unknown>;
function unwrap(v: FsValue | undefined): unknown {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("mapValue" in v) {
    const out: Record<string, unknown> = {};
    const fields = ((v.mapValue as { fields?: Record<string, FsValue> }).fields) ?? {};
    for (const [k, x] of Object.entries(fields)) out[k] = unwrap(x);
    return out;
  }
  if ("arrayValue" in v) {
    const values = ((v.arrayValue as { values?: FsValue[] }).values) ?? [];
    return values.map(unwrap);
  }
  return null;
}

type Doc = Record<string, unknown> & { __id: string };
function toDoc(d: { name?: string; fields?: Record<string, FsValue> }): Doc {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.fields ?? {})) out[k] = unwrap(v);
  return { ...out, __id: (d.name ?? "").split("/").pop() ?? "" };
}

async function fsFetch(path: string, init: RequestInit, token: string): Promise<unknown> {
  const res = await fetch(`${FIRESTORE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      referer: REFERER,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`firestore ${res.status} on ${path}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

async function getDoc(path: string, token: string): Promise<Doc> {
  return toDoc((await fsFetch(`/${path}`, { method: "GET" }, token)) as { name?: string; fields?: Record<string, FsValue> });
}

type Filter = { fieldFilter: { field: { fieldPath: string }; op: "EQUAL"; value: FsValue } };
const eq = (fieldPath: string, value: string | boolean): Filter => ({
  fieldFilter: {
    field: { fieldPath },
    op: "EQUAL",
    value: typeof value === "boolean" ? { booleanValue: value } : { stringValue: value },
  },
});

async function runQuery(parent: string, collectionId: string, filters: Filter[], token: string): Promise<Doc[]> {
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: { compositeFilter: { op: "AND", filters } },
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: 500,
    },
  };
  const rows = (await fsFetch(`${parent}:runQuery`, { method: "POST", body: JSON.stringify(body) }, token)) as Array<{
    document?: { name?: string; fields?: Record<string, FsValue> };
    error?: { message?: string };
  }>;
  if (!Array.isArray(rows)) return [];
  const err = rows.find((r) => r.error);
  if (err?.error) throw new Error(`firestore query ${collectionId}: ${err.error.message}`);
  return rows.filter((r) => r.document).map((r) => toDoc(r.document!));
}

/* --------------------------------------------------------- normalisation */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function side(x: unknown): Side {
  const o = obj(x);
  if (!o) return { teamId: null, applicantId: null, name: str(x) ?? "TBD", placeholder: true };
  const ti = obj(o.teamInfo);
  const name = str(ti?.name) ?? str(o.name) ?? str(o.placeholder) ?? str(o.plcHldr) ?? "TBD";
  const teamId = str(ti?.teamId) ?? str(o.id);
  // A seed slot ("Winner 4 of Group A") is written by Playinga with a teamInfo
  // and a synthetic id of its own, so the presence of an id does not mean a
  // team. The name is the reliable tell; build() also drops any id that is not
  // one of the division's applicants, as a second net.
  const placeholder = !ti || !teamId || /^winner\b/i.test(name) || /\bof group\b/i.test(name);
  return { teamId: placeholder ? null : teamId, applicantId: placeholder ? null : str(o.applicantId), name, placeholder };
}

/**
 * The result, from Playinga's scorecard.
 *
 * OBSERVED ON THE ORGANISER'S OWN EARLIER EVENTS (July 2026), not documented:
 *
 *   matchInfo.scoreCard.scoreResult = {
 *     creatorTeamScore, opponentTeamScore,   // final totals, sides as in the match
 *     winningTeamId, losingTeamId, scoreTied,
 *     scoreStatus: 2, scoredType: 4, pubBy: {…}
 *   }
 *   matchInfo.scoreCard.score = [ { player1Point, player2Point }, … ]  // per period
 *
 * `matchInfo.status` STAYS 2 AFTER A GAME IS SCORED — every scored match seen
 * still carried it — so it says nothing about finality and is ignored here. A
 * scoreResult with a winner (or an explicit tie) is final. Period points with
 * no scoreResult yet is the in-progress state: the scorer enters periods as
 * they happen and the result is written at the end, so the running total is
 * the sum of the periods entered so far.
 */
function readResult(mi: Record<string, unknown>): { a: number | null; b: number | null; winner: string | null; status: Game["status"] } {
  const card = obj(mi.scoreCard);
  const result = obj(card?.scoreResult);
  if (result) {
    const a = num(result.creatorTeamScore);
    const b = num(result.opponentTeamScore);
    const winner = str(result.winningTeamId);
    if (winner || result.scoreTied === true || (a !== null && b !== null)) {
      return { a, b, winner, status: "final" };
    }
  }
  const periods = Array.isArray(card?.score) ? (card!.score as unknown[]) : [];
  let a = 0, b = 0, any = false;
  for (const p of periods) {
    const o = obj(p);
    const pa = num(o?.player1Point), pb = num(o?.player2Point);
    if (pa === null || pb === null) continue;
    if (pa > 0 || pb > 0) any = true;
    a += pa; b += pb;
  }
  if (any) return { a, b, winner: null, status: "live" };
  return { a: null, b: null, winner: null, status: "scheduled" };
}

/**
 * mDate IS THE SOURCE OF TRUTH FOR WHEN A GAME IS PLAYED, not `time`.
 *
 * FOUND THE HARD WAY, 2026-09-03. The organiser rewrote the whole schedule —
 * every group game onto the Saturday, the bracket onto the Sunday — and their
 * tool updated `matchInfo.mDate` (epoch ms) on all twenty matches but left
 * `matchInfo.time`, a display string, at its old value on ten of them. Six of
 * those ten read "12:00 AM", which is not midnight: it is the string the tool
 * writes when it has nothing to say. The page showed a bracket starting at
 * midnight and four group games on the wrong day.
 *
 * So the time and the calendar date are both DERIVED from mDate against the
 * venue's own offset, and `date`/`time` are consulted only when mDate is
 * missing. Anything the organiser reschedules is then correct here the moment
 * the feed is re-read, whether or not their display string caught up.
 */
function localParts(ms: number, offsetSeconds: number): { date: string; time: string } {
  const d = new Date(ms + offsetSeconds * 1000);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const h24 = d.getUTCHours();
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { date, time: `${String(h12).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${suffix}` };
}

/** "08:00 AM" + {year, month, day} + a UTC offset → epoch ms. The fallback. */
function tipMs(date: Record<string, unknown> | null, time: string | null, offsetSeconds: number): number | null {
  if (!date || !time) return null;
  const y = num(date.year), m = num(date.month), d = num(date.day);
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (y === null || m === null || d === null || !t) return null;
  let hh = Number(t[1]) % 12;
  if (t[3]!.toUpperCase() === "PM") hh += 12;
  const utc = Date.UTC(y, m - 1, d, hh, Number(t[2]));
  return utc - offsetSeconds * 1000;
}

function isoDate(date: Record<string, unknown> | null): string {
  const y = num(date?.year), m = num(date?.month), d = num(date?.day);
  if (y === null || m === null || d === null) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "Basketball 3" → "Court 3". Anything else passes through. */
function courtLabel(name: string | null): string | null {
  if (!name) return null;
  const m = /^basketball\s+(\d+)$/i.exec(name.trim());
  return m ? `Court ${m[1]}` : name;
}

function classify(name: string, roundNum: number | null): { stage: Game["stage"]; round: string } {
  if (/^GA\b|group/i.test(name)) return { stage: "group", round: "Group A" };
  if (/^final/i.test(name)) return { stage: "playoff", round: "Final" };
  if (/semi/i.test(name)) return { stage: "playoff", round: "Semi-Finals" };
  if (/quarter/i.test(name)) return { stage: "playoff", round: "Quarter-Finals" };
  if (/^match\s+\d+/i.test(name)) return { stage: "playoff", round: "Round 1" };
  return roundNum && roundNum > 1 ? { stage: "playoff", round: `Round ${roundNum}` } : { stage: "group", round: "Group A" };
}

function normaliseGame(d: Doc, offsetSeconds: number): Game | null {
  const mi = obj(d.matchInfo);
  if (!mi) return null;
  const a = side(mi.creator_team);
  const b = side(mi.opponent_team);
  const name = str(mi.name) ?? `Match ${num(mi.matchNumId) ?? ""}`.trim();
  const { stage, round } = classify(name, num(mi.roundNum));
  const date = obj(mi.date);
  const venue = obj(mi.venue);
  const offset = (num(venue?.UTCOffset) ?? offsetSeconds - (num(venue?.dstOffset) ?? 0)) + (num(venue?.dstOffset) ?? 0);
  const time = str(mi.time);
  // See localParts: mDate wins, the strings are the fallback.
  const mDate = num(mi.mDate);
  const off = Number.isFinite(offset) ? offset : offsetSeconds;
  const local = mDate !== null ? localParts(mDate, off) : null;
  const { a: scoreA, b: scoreB, winner, status } = readResult(mi);
  const hasScore = scoreA !== null && scoreB !== null;
  // A final with scores but no explicit winner id: the higher score won.
  const winnerTeamId = winner ?? (status === "final" && hasScore && scoreA !== scoreB ? (scoreA! > scoreB! ? a.teamId : b.teamId) : null);

  const raw: Game["raw"] = {};
  for (const [k, v] of Object.entries(mi)) {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") raw[k] = v;
  }

  return {
    id: d.__id,
    name,
    stage,
    round,
    matchNum: num(mi.matchNumId),
    date: local?.date ?? isoDate(date),
    time: local?.time ?? time ?? "",
    startMs: mDate ?? tipMs(date, time, off),
    court: courtLabel(str(obj(venue?.court)?.name)),
    a, b,
    status,
    scoreA, scoreB,
    winnerTeamId,
    nextMatchId: str(mi.nextMatchID) ?? str(mi.nextMatchId),
    raw,
  };
}

function normaliseTeam(d: Doc): Team | null {
  const ai = obj(d.applicantInfo);
  const td = obj(ai?.teamDetails);
  const name = str(td?.name);
  const id = str(td?.teamId);
  if (!ai || !td || !name || !id) return null;
  const players: Team["players"] = [];
  for (const p of Object.values(obj(ai.playerDetails) ?? {})) {
    const u = str(obj(p)?.username);
    if (!u) continue;
    const captain = /\(cap\)/i.test(u);
    players.push({ name: u.replace(/\s*\(cap\)\s*/i, "").trim(), captain });
  }
  players.sort((x, y) => Number(y.captain) - Number(x.captain) || x.name.localeCompare(y.name));
  return {
    id,
    applicantId: d.__id,
    name,
    short: str(td.srtName) ?? name.slice(0, 3).toUpperCase(),
    color: str(td.pColor),
    players,
  };
}

/* ---------------------------------------------------------------- build */

async function build(slug: string): Promise<Payload> {
  const cfg = EVENTS[slug]!;
  const token = await anonToken();
  const [matches, applicants, group] = await Promise.all([
    runQuery("", "matches", [eq("matchInfo.divisionId", cfg.division), eq("matchInfo.isSubMatch", false)], token),
    runQuery(`/events/${cfg.event}`, "applicants", [eq("divInfo.id", cfg.division)], token),
    getDoc(`events/${cfg.event}/divisions/${cfg.division}/groups/${cfg.group}`, token).catch(() => null),
  ]);

  const teamsById = new Map<string, Team>();
  for (const d of applicants) {
    const t = normaliseTeam(d);
    if (t) teamsById.set(t.applicantId, t);
  }
  // The group document lists its members in the organiser's order; keep it
  // where it exists so the Teams tab matches the official page.
  const order: string[] = [];
  const gi = obj(obj(group?.groupInfo)?.["0"]);
  for (const v of Object.values(obj(gi?.members) ?? {})) if (str(v)) order.push(v as string);
  const teams = [
    ...order.map((id) => teamsById.get(id)).filter((t): t is Team => Boolean(t)),
    ...[...teamsById.values()].filter((t) => !order.includes(t.applicantId)),
  ];

  // Our team, spelled the way we spell it — see displayName in EVENTS.
  const ours = teams.find((t) => t.name === cfg.ourTeam);
  const ourName = cfg.displayName ?? cfg.ourTeam;
  if (ours && cfg.displayName) {
    ours.name = cfg.displayName;
    ours.short = cfg.displayName.slice(0, 3).toUpperCase();
  }

  const knownTeamIds = new Set(teams.map((t) => t.id));
  // Second net for seed slots — see side(). An id that is not one of the
  // division's applicants is a slot, whatever it looked like.
  const demote = (s: Side): Side =>
    s.teamId && !knownTeamIds.has(s.teamId) ? { ...s, teamId: null, applicantId: null, placeholder: true } : s;
  const respell = (s: Side): Side => (ours && s.teamId === ours.id ? { ...s, name: ours.name } : s);

  const games = matches
    .map((d) => normaliseGame(d, cfg.utcOffsetSeconds))
    .filter((g): g is Game => g !== null)
    .map((g) => ({ ...g, a: respell(demote(g.a)), b: respell(demote(g.b)) }))
    .sort((x, y) => (x.startMs ?? 0) - (y.startMs ?? 0) || (x.matchNum ?? 0) - (y.matchNum ?? 0));

  const first = matches[0] ? obj(matches[0].matchInfo) : null;
  const venue = obj(first?.venue);
  const tournName = str(obj(first?.tournInfo)?.name) ?? str(obj(applicants[0]?.eventInfo)?.name) ?? "Tournament";
  const division = str(first?.divName) ?? str(obj(applicants[0]?.divInfo)?.name) ?? "";

  return {
    slug,
    event: {
      // "Indoor - CIG - Central Ismaili Games" reads better without the venue type.
      name: tournName.replace(/^indoor\s*-\s*/i, ""),
      division,
      group: str(gi?.grpName) ?? "Group A",
      venue: {
        name: str(venue?.name) ?? str(venue?.venue) ?? "",
        address: str(venue?.address),
        tz: str(venue?.tmZoneId),
      },
    },
    ourTeam: ourName,
    teams,
    games,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * DEV ONLY — invent results so the scored states can be looked at before the
 * tournament has happened. Same gate as scoreboard.mts: NETLIFY_DEV is set by
 * the CLI for local runs and never in a deployed function, so a production
 * request carrying ?sim= gets the real feed.
 *
 *   sat   — every Saturday game final
 *   live  — Saturday final, the first two Sunday group games in progress
 *   sun   — every group game final; the bracket then fills from the table
 *
 * Margins are a deterministic hash of the game id, so a reload does not
 * reshuffle the standings.
 */
function simulate(p: Payload, mode: string): Payload {
  const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const games = p.games.map((g) => {
    if (g.stage !== "group" || !g.a.teamId || !g.b.teamId) return g;
    const sat = g.date === "2026-09-05";
    const h = hash(g.id);
    const base = 48 + (h % 21);
    const margin = 1 + ((h >>> 5) % 34);
    const aWins = (h >>> 9) % 2 === 0;
    const scoreA = aWins ? base + margin : base;
    const scoreB = aWins ? base : base + margin;
    const final = (): Game => ({ ...g, status: "final", scoreA, scoreB, winnerTeamId: aWins ? g.a.teamId : g.b.teamId });
    if (mode === "sun") return final();
    if (sat) return final();
    if (mode === "live" && (g.matchNum === 11 || g.matchNum === 12)) {
      const inPlay: Game = { ...g, status: "live", scoreA: Math.round(scoreA / 2), scoreB: Math.round(scoreB / 2), winnerTeamId: null };
      return inPlay;
    }
    return g;
  });
  return { ...p, games };
}

export default async (req: Request, _context: Context) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "public, max-age=10",
    "netlify-cdn-cache-control": `public, s-maxage=${REFRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
  };
  const params = new URL(req.url).searchParams;
  const slug = params.get("event") ?? "";
  if (!EVENTS[slug]) {
    return new Response(JSON.stringify({ error: "unknown event" }), { status: 404, headers: { ...headers, "netlify-cdn-cache-control": "public, s-maxage=600" } });
  }
  try {
    let payload = await build(slug);
    const sim = params.get("sim");
    if (sim && process.env.NETLIFY_DEV === "true") payload = simulate(payload, sim);
    return new Response(JSON.stringify(payload), { status: 200, headers });
  } catch (err) {
    // Never 5xx at the reader: the client keeps its last good payload (or the
    // baked snapshot) and says the feed is down. Short edge cache so a blip
    // does not pin an error for the full window.
    const empty: Payload = {
      slug,
      event: { name: "", division: "", group: "", venue: { name: "", address: null, tz: null } },
      ourTeam: EVENTS[slug]!.displayName ?? EVENTS[slug]!.ourTeam,
      teams: [], games: [],
      fetchedAt: new Date().toISOString(),
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
    };
    return new Response(JSON.stringify(empty), { status: 200, headers: { ...headers, "netlify-cdn-cache-control": "public, s-maxage=15" } });
  }
};

export const config = { path: "/api/tournament" };
