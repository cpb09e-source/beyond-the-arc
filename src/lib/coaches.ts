/**
 * Coach data layer — the FILE-READING half. Reads three sources:
 *   1. src/data/coach-history.json (SR scrape, 2013-2026) — preferred when present
 *   2. src/data/team-coaches.json (ESPN snapshot, 2025-26 only) — fallback / supplement
 *   3. public/data/teams-all.json — current-season conference + record
 * plus src/data/tournament-games.json for the bracket.
 *
 * Output shapes:
 *   - CoachIndexRow: one row per unique coach (for /coaches index)
 *   - CoachProfile:  full timeline + per-school breakdown (for /coaches/<slug>)
 *
 * If coach-history.json doesn't exist yet (scraper still running), the layer
 * gracefully degrades to ESPN-only single-season data.
 *
 * EVERYTHING THAT IS NOT A FILE READ LIVES IN lib/coaches-core.ts — the shapes,
 * the joins, the composite, the bracket lookups. The loaders here read the
 * files and hand them to buildCoachProfiles(), which is also what anything
 * without node:fs calls directly. Import pure pieces from there, never from
 * here: this module brings node:fs with it.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readAllTeams } from "@/lib/static-data";
import {
  buildCoachProfiles,
  toIndexRow,
  styleLeagueAverages,
  overrideTeam,
  LATEST_YEAR,
  type CoachHistory,
  type CoachIndexRow,
  type CoachProfile,
  type CoachStyle,
  type EspnCoach,
  type TourneyGame,
} from "@/lib/coaches-core";

// The shapes stay importable from here for callers that already do —
// scripts/analyze-round-repair.mts reads CoachProfile off this path. Types
// only, so no runtime cost; new code should take them from coaches-core.
export type {
  CoachIndexRow,
  CoachProfile,
  CoachSchoolStint,
  CoachSeason,
  CoachStyle,
  TourneyGame,
  TourneyRound,
} from "@/lib/coaches-core";

// ---------- loaders ----------

export async function loadAllCoachProfiles(): Promise<CoachProfile[]> {
  const dataDir = path.resolve("src/data");
  let history: CoachHistory = {};
  let espn: Record<string, EspnCoach> = {};

  const historyPath = path.join(dataDir, "coach-history.json");
  if (existsSync(historyPath)) {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"));
  }
  const espnPath = path.join(dataDir, "team-coaches.json");
  if (existsSync(espnPath)) {
    espn = JSON.parse(await fs.readFile(espnPath, "utf8"));
  }

  const teams = await readAllTeams();
  const tournamentGames = await loadTournamentGames();
  return buildCoachProfiles({ history, espn, teams, tournamentGames });
}

/**
 * D-I mean for each style dimension, per season — over every team row in the
 * window. The reasoning is on styleLeagueAverages in lib/coaches-core.ts.
 */
export async function readStyleLeagueAverages(): Promise<Map<number, CoachStyle>> {
  return styleLeagueAverages(await readAllTeams());
}

export async function loadCoachIndex(): Promise<CoachIndexRow[]> {
  const profiles = await loadAllCoachProfiles();
  // Strip the heavy fields for the index page — see toIndexRow.
  return profiles.map((p) => toIndexRow(p));
}

export async function loadCoachProfile(slug: string): Promise<CoachProfile | null> {
  const profiles = await loadAllCoachProfiles();
  return profiles.find((p) => p.slug === slug) ?? null;
}

/**
 * Load all NCAA Tournament games (winner/loser, score, round) by year. The
 * SR scrape stores them in `src/data/tournament-games.json`. Returns the raw
 * map; callers index into it as needed.
 */
export async function loadTournamentGames(): Promise<Record<string, TourneyGame[]>> {
  const file = path.join(path.resolve("src/data"), "tournament-games.json");
  if (!existsSync(file)) return {};
  return JSON.parse(await fs.readFile(file, "utf8"));
}

// ---------- legacy types kept for the existing /coaches index ----------

export type CoachTeamRow = {
  name: string;
  team_name: string;
  conference: string | null;
  record: string | null;
  wins: number | null;
  losses: number | null;
  espn_id: string | null;
};

/**
 * Legacy loader — single-season ESPN snapshot only. Retained while the index
 * page transitions to the new loadCoachIndex() shape. New code should use
 * loadCoachIndex() / loadCoachProfile().
 */
export async function loadCoachTeamRows(): Promise<CoachTeamRow[]> {
  const dataDir = path.resolve("src/data");
  const espnPath = path.join(dataDir, "team-coaches.json");
  let raw: Record<string, EspnCoach> = {};
  if (existsSync(espnPath)) {
    raw = JSON.parse(await fs.readFile(espnPath, "utf8"));
  }
  const teams = await readAllTeams();
  type TeamRecord = { conference: string | null; record: string | null; wins: number | null; losses: number | null };
  const meta = new Map<string, TeamRecord>();
  for (const t of teams) {
    if (t.year !== LATEST_YEAR) continue;
    const trank = (t as unknown as { team_trank_stats?: { record?: string | null; wins?: number | null; losses?: number | null } | null }).team_trank_stats;
    meta.set(overrideTeam(t.name), {
      conference: t.conference ?? null,
      record: trank?.record ?? null,
      wins: trank?.wins ?? null,
      losses: trank?.losses ?? null,
    });
  }
  const rows: CoachTeamRow[] = [];
  for (const [bartName, c] of Object.entries(raw)) {
    const team = overrideTeam(bartName);
    const m = meta.get(team);
    rows.push({
      name: c.name,
      team_name: team,
      conference: m?.conference ?? null,
      record: m?.record ?? null,
      wins: m?.wins ?? null,
      losses: m?.losses ?? null,
      espn_id: c.espn_id,
    });
  }
  return rows;
}

