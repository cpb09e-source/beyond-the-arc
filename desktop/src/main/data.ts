import { app } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Data files for the renderer, from wherever the nearest copy is.
 *
 * EVERY SEASON THROUGH 2025-26 IS FROZEN, and will never change again. So once
 * a copy exists on this machine it is trusted forever: no revalidation, no
 * version probe, no network after the first read. The live season (2026-27,
 * refreshed nightly from November to April, then frozen like the rest) gets a
 * version check in P3. Until then nothing this file serves is live.
 *
 * NEAREST FIRST:
 *   1. memory, for returning to a file already opened this session
 *   2. the site's own public/data, when running from the repo in development
 *   3. the disk cache under userData
 *   4. the network, written into the disk cache on the way back
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
  | "player-games";
export type DataSource = "memory" | "repo" | "cache" | "network";

type CorpusSpec = {
  path: (year: number) => string;
  /** Served from the site's R2 bucket rather than btacbb.xyz (R2_DIRS in src/lib/data-url.ts). */
  r2: boolean;
  /**
   * The file legitimately does not exist for some seasons: the real impact fit
   * starts in 2024, for instance. A miss resolves to JSON `null` instead of an
   * error, so "no file" and "the season is gated" never look the same.
   */
  optional?: boolean;
};

/**
 * Every file the renderer may ask for, as a fixed map.
 *
 * AN ALLOW-LIST, NOT A PATH JOIN. The corpus name and the year both end up in a
 * filesystem path and a URL, so the name is matched against this table and the
 * year is validated as four digits; nothing the renderer sends is interpolated.
 *
 * Paid seasons of the R2 corpora live in a private bucket behind a signing
 * function, which the app reaches once it can sign in (P3).
 */
const CORPORA: Record<Corpus, CorpusSpec> = {
  teams: { path: (y) => `teams-by-year/${y}.json`, r2: false },
  players: { path: (y) => `players-explorer/${y}.json`, r2: false },
  "player-impact": { path: (y) => `epm-${y}.json`, r2: false, optional: true },
  "player-box": { path: (y) => `box-epm-${y}.json`, r2: false, optional: true },
  "player-shooting": { path: (y) => `shooting-${y}.json`, r2: false, optional: true },
  "team-games": { path: (y) => `team-game-index/${y}.json`, r2: true },
  "player-games": { path: (y) => `game-index/${y}.json`, r2: true },
};

const SITE_DATA = "https://btacbb.xyz/data";
const R2_PUBLIC = "https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev";

const memory = new Map<string, string>();

/** A four-digit season inside the range the site has ever published. */
export function isValidYear(y: unknown): y is number {
  return typeof y === "number" && Number.isInteger(y) && y >= 2008 && y <= 2100;
}

export function isCorpus(k: unknown): k is Corpus {
  return typeof k === "string" && Object.hasOwn(CORPORA, k);
}

/** The site's public/data when this is a development run from the repo. */
function repoDataDir(): string | null {
  if (app.isPackaged) return null;
  // electron-vite runs the app from desktop/, so the site sits one level up.
  const dir = resolve(app.getAppPath(), "../public/data");
  return existsSync(dir) ? dir : null;
}

export async function loadCorpus(
  corpus: Corpus,
  year: number,
): Promise<{ json: string; source: DataSource }> {
  const spec = CORPORA[corpus];
  const rel = spec.path(year);

  const hit = memory.get(rel);
  if (hit) return { json: hit, source: "memory" };

  const repo = repoDataDir();
  if (repo) {
    const file = join(repo, rel);
    if (existsSync(file)) {
      const json = await readFile(file, "utf8");
      memory.set(rel, json);
      return { json, source: "repo" };
    }
    // In development the repo is the whole truth: an optional file it lacks
    // does not exist anywhere, so there is nothing to go looking for.
    if (spec.optional) {
      memory.set(rel, "null");
      return { json: "null", source: "repo" };
    }
  }

  const cached = join(app.getPath("userData"), "data", rel);
  if (existsSync(cached)) {
    const json = await readFile(cached, "utf8");
    memory.set(rel, json);
    return { json, source: "cache" };
  }

  const url = spec.r2 ? `${R2_PUBLIC}/${rel}` : `${SITE_DATA}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (spec.optional && res.status === 404) {
      memory.set(rel, "null");
      return { json: "null", source: "network" };
    }
    // A 403 or 404 on a paid season is the archive gate, not a missing file:
    // those seasons are deliberately absent from the public copies. Signing in
    // to the app arrives in P3; until then the renderer says so plainly.
    throw new Error(res.status === 404 || res.status === 403 ? "season-gated" : `http-${res.status}`);
  }
  const json = await res.text();
  // Refuse to cache anything that is not JSON. A frozen season is trusted
  // forever once written, so a captive-portal page saved here would be too.
  JSON.parse(json);

  await mkdir(dirname(cached), { recursive: true });
  // Write, then rename. A crash mid-write must never leave a half file behind
  // for the frozen rule to trust on every launch after.
  const tmp = `${cached}.${process.pid}.tmp`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, cached);

  memory.set(rel, json);
  return { json, source: "network" };
}
