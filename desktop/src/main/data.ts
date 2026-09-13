import { app } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Season files for the renderer, from wherever the nearest copy is.
 *
 * EVERY SEASON THROUGH 2025-26 IS FROZEN, and will never change again. So once
 * a copy exists on this machine it is trusted forever: no revalidation, no
 * version probe, no network after the first read. The live season (2026-27,
 * refreshed nightly from November to April, then frozen like the rest) gets a
 * version check in P3. Until then nothing this file serves is live.
 *
 * NEAREST FIRST:
 *   1. memory, for flicking back to a season already opened this session
 *   2. the site's own public/data, when running from the repo in development
 *   3. the disk cache under userData
 *   4. btacbb.xyz, written into the disk cache on the way back
 *
 * The renderer receives TEXT rather than an object. Parsing 1.3 MB of JSON on
 * the renderer side is faster than structured-cloning the same object graph
 * across the IPC boundary.
 */

export type SeasonKind = "teams";
export type SeasonSource = "memory" | "repo" | "cache" | "network";

const CORPUS: Record<SeasonKind, string> = { teams: "teams-by-year" };
const ORIGIN = "https://btacbb.xyz";

const memory = new Map<string, string>();

/** A four-digit season inside the range the site has ever published. */
export function isValidYear(y: unknown): y is number {
  return typeof y === "number" && Number.isInteger(y) && y >= 2008 && y <= 2100;
}

export function isSeasonKind(k: unknown): k is SeasonKind {
  return typeof k === "string" && Object.hasOwn(CORPUS, k);
}

/** The site's public/data when this is a development run from the repo. */
function repoDataDir(): string | null {
  if (app.isPackaged) return null;
  // electron-vite runs the app from desktop/, so the site sits one level up.
  const dir = resolve(app.getAppPath(), "../public/data");
  return existsSync(dir) ? dir : null;
}

export async function loadSeason(
  kind: SeasonKind,
  year: number,
): Promise<{ json: string; source: SeasonSource }> {
  const rel = join(CORPUS[kind], `${year}.json`);

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
  }

  const cached = join(app.getPath("userData"), "data", rel);
  if (existsSync(cached)) {
    const json = await readFile(cached, "utf8");
    memory.set(rel, json);
    return { json, source: "cache" };
  }

  const res = await fetch(`${ORIGIN}/data/${CORPUS[kind]}/${year}.json`);
  if (!res.ok) {
    // A 404 on a paid season is the archive gate, not a missing file: those
    // seasons are deliberately absent from the public site. Signing in to the
    // app arrives in P3; until then the renderer says so plainly.
    throw new Error(res.status === 404 ? "season-gated" : `http-${res.status}`);
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
