import { app } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { LIVE_SEASON } from "../../../src/lib/seasons";
import { SITE } from "./auth";

/**
 * Data files for the renderer, from wherever the nearest copy is.
 *
 * EVERY SEASON THROUGH 2025-26 IS FROZEN, and will never change again. So once
 * a copy exists on this machine it is trusted forever: no revalidation, no
 * version probe, no network after the first read.
 *
 * THE LIVE SEASON IS THE EXCEPTION, while there is one (LIVE_SEASON in the
 * site's src/lib/seasons.ts; none today). Its files, and the cross-season
 * search indexes, are rechecked with a conditional request at most every half
 * hour, so a nightly refresh reaches the app the morning after without
 * re-downloading anything that did not change.
 *
 * NEAREST FIRST:
 *   1. memory, for returning to a file already opened this session
 *   2. the site's own public/data, when running from the repo in development
 *   3. the disk cache under userData
 *   4. the network, written into the disk cache on the way back
 *
 * PAID SEASONS come through the site with the reader's session: team and
 * player seasons from /api/season, game logs through a signed URL from
 * /api/data-url, the same doors the website uses. They are cached apart from
 * everything else (userData/data-paid) so signing out removes exactly them.
 *
 * The renderer receives TEXT rather than an object. Parsing JSON on the
 * renderer side is faster than structured-cloning the same object graph across
 * the IPC boundary, and the biggest file here is a 7 MB game log.
 */

export type Corpus =
  | "teams"
  | "players"
  | "player-impact"
  | "player-box"
  | "player-shooting"
  | "team-games"
  | "player-games"
  | "matchup"
  | "conference-rankings"
  | "conference-splits"
  | "portal"
  | "teams-index"
  | "players-index"
  | "search-index";
export type DataSource = "memory" | "repo" | "cache" | "network";

type CorpusSpec = {
  path: (year: number) => string;
  /** Served from the site's R2 bucket rather than btacbb.xyz (R2_DIRS in src/lib/data-url.ts). */
  r2: boolean | ((year: number) => boolean);
  /**
   * The file legitimately does not exist for some seasons: the real impact fit
   * starts in 2024, for instance. A miss resolves to JSON `null` instead of an
   * error, so "no file" and "the season is gated" never look the same.
   */
  optional?: boolean;
  /** One file across every season; changes while a season is live. */
  crossSeason?: boolean;
  /** How a paid season of this corpus is reached, when the public copy is absent. */
  gated?: { via: "season"; kind: "teams" | "players" } | { via: "signed"; kind: "team-games" | "games" };
};

/**
 * Every file the renderer may ask for, as a fixed map.
 *
 * AN ALLOW-LIST, NOT A PATH JOIN. The corpus name and the year both end up in a
 * filesystem path and a URL, so the name is matched against this table and the
 * year is validated as four digits; nothing the renderer sends is interpolated.
 */
const CORPORA: Record<Corpus, CorpusSpec> = {
  teams: { path: (y) => `teams-by-year/${y}.json`, r2: false, gated: { via: "season", kind: "teams" } },
  players: { path: (y) => `players-explorer/${y}.json`, r2: false, gated: { via: "season", kind: "players" } },
  "player-impact": { path: (y) => `epm-${y}.json`, r2: false, optional: true },
  "player-box": { path: (y) => `box-epm-${y}.json`, r2: false, optional: true },
  "player-shooting": { path: (y) => `shooting-${y}.json`, r2: false, optional: true },
  "team-games": { path: (y) => `team-game-index/${y}.json`, r2: true, gated: { via: "signed", kind: "team-games" } },
  "player-games": { path: (y) => `game-index/${y}.json`, r2: true, gated: { via: "signed", kind: "games" } },
  // The Matchup Predictor's ratings, one season. While a season is live the
  // nightly job writes it to R2 as live/matchup.json, which is where the site
  // reads it from too (src/components/matchup/matchup-client.tsx).
  matchup: {
    path: (y) => (y === LIVE_SEASON ? "live/matchup.json" : `matchup/${y}.json`),
    r2: (y) => y === LIVE_SEASON,
    optional: true,
  },
  // CROSS-SEASON FILES, the site's search indexes. The path takes no year; the
  // caller passes the newest season they cover.
  "teams-index": { path: () => "teams-index.json", r2: false, crossSeason: true },
  "players-index": { path: () => "players-index.json", r2: false, crossSeason: true },
  "search-index": { path: () => "search-index.json", r2: false, crossSeason: true },
  // Conference Power Rankings: one file for every season, and its game splits.
  "conference-rankings": { path: () => "conference-rankings.json", r2: false, crossSeason: true },
  "conference-splits": { path: () => "conference-splits.json", r2: false, crossSeason: true },
  // The transfer portal: one file, rescored as the cycle moves.
  portal: { path: () => "portal.json", r2: false, crossSeason: true },
};

const SITE_DATA = "https://btacbb.xyz/data";
const R2_PUBLIC = "https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev";

/** A live file younger than this is used without asking the network. */
const LIVE_FRESH_MS = 30 * 60_000;

const memory = new Map<string, { json: string; at: number }>();
/** Memory keys holding paid bytes, dropped with the paid cache. */
const paidKeys = new Set<string>();

let tokenProvider: () => Promise<string | null> = async () => null;

/** Where gated requests get the reader's access token. Set once by index.ts. */
export function setTokenProvider(fn: () => Promise<string | null>): void {
  tokenProvider = fn;
}

/** A four-digit season inside the range the site has ever published. */
export function isValidYear(y: unknown): y is number {
  return typeof y === "number" && Number.isInteger(y) && y >= 2008 && y <= 2100;
}

export function isCorpus(k: unknown): k is Corpus {
  return typeof k === "string" && Object.hasOwn(CORPORA, k);
}

const cacheDir = () => join(app.getPath("userData"), "data");
const paidDir = () => join(app.getPath("userData"), "data-paid");

/** Removes every paid season from memory and disk: on sign-out, or when an account stops being entitled. */
export async function purgePaidCache(): Promise<void> {
  for (const key of paidKeys) memory.delete(key);
  paidKeys.clear();
  await rm(paidDir(), { recursive: true, force: true });
}

/** The site's public/data when this is a development run from the repo. */
function repoDataDir(): string | null {
  if (app.isPackaged) return null;
  // electron-vite runs the app from desktop/, so the site sits one level up.
  const dir = resolve(app.getAppPath(), "../public/data");
  return existsSync(dir) ? dir : null;
}

/** Write, then rename: a crash mid-write must never leave a half file for the frozen rule to trust. */
async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/** Refuse to cache anything that is not JSON: a captive-portal page saved here would be trusted too. */
function assertJson(text: string): void {
  JSON.parse(text);
}

async function fetchPaid(spec: CorpusSpec, year: number): Promise<string> {
  const gate = spec.gated!;
  const token = await tokenProvider();
  // Signed out: the renderer offers to sign in.
  if (!token) throw new Error("season-gated");
  const headers = { authorization: `Bearer ${token}` };

  if (gate.via === "season") {
    const res = await fetch(`${SITE}/api/season/${gate.kind}/${year}`, { headers });
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error("season-gated");
    if (!res.ok) throw new Error(`http-${res.status}`);
    return res.text();
  }

  const signed = await fetch(`${SITE}/api/data-url?kind=${gate.kind}&year=${year}`, { headers });
  if (signed.status === 401 || signed.status === 403) throw new Error("season-gated");
  if (!signed.ok) throw new Error(`http-${signed.status}`);
  const { url } = (await signed.json()) as { url?: string };
  if (!url) throw new Error("http-502");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.text();
}

export async function loadCorpus(corpus: Corpus, year: number): Promise<{ json: string; source: DataSource }> {
  const spec = CORPORA[corpus];
  const rel = spec.path(year);
  const live = LIVE_SEASON !== null && (spec.crossSeason === true || year === LIVE_SEASON);

  const hit = memory.get(rel);
  if (hit && (!live || Date.now() - hit.at < LIVE_FRESH_MS)) return { json: hit.json, source: "memory" };
  const remember = (json: string, paid = false) => {
    memory.set(rel, { json, at: Date.now() });
    if (paid) paidKeys.add(rel);
  };

  const repo = repoDataDir();
  if (repo) {
    const file = join(repo, rel);
    if (existsSync(file)) {
      const json = await readFile(file, "utf8");
      remember(json);
      return { json, source: "repo" };
    }
    // In development the repo is the whole truth: an optional file it lacks
    // does not exist anywhere, so there is nothing to go looking for.
    if (spec.optional) {
      remember("null");
      return { json: "null", source: "repo" };
    }
  }

  const cached = join(cacheDir(), rel);
  const etagFile = `${cached}.etag`;
  if (existsSync(cached)) {
    if (!live) {
      const json = await readFile(cached, "utf8");
      remember(json);
      return { json, source: "cache" };
    }
    if (Date.now() - (await stat(cached)).mtimeMs < LIVE_FRESH_MS) {
      const json = await readFile(cached, "utf8");
      remember(json);
      return { json, source: "cache" };
    }
  }

  // A paid season already on disk, for a reader still signed in.
  const paidCached = join(paidDir(), rel);
  if (spec.gated && existsSync(paidCached) && (await tokenProvider())) {
    const json = await readFile(paidCached, "utf8");
    remember(json, true);
    return { json, source: "cache" };
  }

  const onR2 = typeof spec.r2 === "function" ? spec.r2(year) : spec.r2;
  const url = onR2 ? `${R2_PUBLIC}/${rel}` : `${SITE_DATA}/${rel}`;
  let res: Response;
  try {
    const etag = live && existsSync(etagFile) ? (await readFile(etagFile, "utf8")).trim() : null;
    res = await fetch(url, etag ? { headers: { "if-none-match": etag } } : undefined);
  } catch (err) {
    // Offline. A live file on disk, however old, beats nothing.
    if (existsSync(cached)) {
      const json = await readFile(cached, "utf8");
      remember(json);
      return { json, source: "cache" };
    }
    throw err;
  }

  if (res.status === 304 && existsSync(cached)) {
    const now = new Date();
    await utimes(cached, now, now);
    const json = await readFile(cached, "utf8");
    remember(json);
    return { json, source: "cache" };
  }

  if (!res.ok) {
    if (spec.optional && res.status === 404) {
      remember("null");
      return { json: "null", source: "network" };
    }
    // A 403 or 404 on a gated corpus is the paywall, not a missing file: those
    // seasons are deliberately absent from the public copies.
    if (spec.gated && (res.status === 404 || res.status === 403)) {
      const json = await fetchPaid(spec, year);
      assertJson(json);
      await writeAtomic(paidCached, json);
      remember(json, true);
      return { json, source: "network" };
    }
    throw new Error(res.status === 404 || res.status === 403 ? "season-gated" : `http-${res.status}`);
  }

  const json = await res.text();
  assertJson(json);
  await writeAtomic(cached, json);
  const etag = res.headers.get("etag");
  if (live && etag) await writeAtomic(etagFile, etag);
  remember(json);
  return { json, source: "network" };
}
