import coachHistory from "@/data/coach-history.json";
import { ALL_SEASONS } from "@/lib/seasons";
import { overrideTeam } from "@/lib/win-calc";
import { coachLookup } from "~/views/win-calc/calc-model";

/**
 * A program's seasons as the coach history records them: who coached, the
 * record, the conference, and how the NCAA tournament went.
 *
 * THE SITE'S FILE, READ THE SITE'S WAY. src/data/coach-history.json is what the
 * /coaches pages and the Win Calculator's coach filter are built from, keyed by
 * Torvik's school names with the same one override the calculator applies, so a
 * school found here is the school those filters mean.
 *
 * IT STARTS IN 2012-13. A coach whose run reaches that far back has been there
 * at least that long, not exactly that long, and the labels say so.
 */

export type HistorySeason = {
  year: number;
  coach: string;
  wins: number | null;
  losses: number | null;
  conf: string | null;
  confWins: number | null;
  confLosses: number | null;
  seed: number | null;
  round: string | null;
};

type Raw = Record<
  string,
  Record<
    string,
    {
      name: string;
      wins?: number | null;
      losses?: number | null;
      conf?: string | null;
      conf_wins?: number | null;
      conf_losses?: number | null;
      seed?: number | null;
      round?: string | null;
    }
  >
>;

let byTeam: Map<string, HistorySeason[]> | null = null;
let floor = Number.POSITIVE_INFINITY;

function index(): Map<string, HistorySeason[]> {
  if (byTeam) return byTeam;
  byTeam = new Map();
  for (const [bartName, years] of Object.entries(coachHistory as Raw)) {
    const list: HistorySeason[] = [];
    for (const [y, s] of Object.entries(years)) {
      const year = Number(y);
      if (!Number.isFinite(year)) continue;
      floor = Math.min(floor, year);
      list.push({
        year,
        coach: s.name,
        wins: s.wins ?? null,
        losses: s.losses ?? null,
        conf: s.conf ?? null,
        confWins: s.conf_wins ?? null,
        confLosses: s.conf_losses ?? null,
        seed: s.seed ?? null,
        round: s.round ?? null,
      });
    }
    byTeam.set(overrideTeam(bartName), list.sort((a, b) => b.year - a.year));
  }
  return byTeam;
}

/** Every season on record for a school, newest first. */
export const teamHistory = (team: string): HistorySeason[] => index().get(overrideTeam(team)) ?? [];

/** The seasons a coach's teams played that the app has data for, newest first: the Win Calculator's years for that coach. */
export function coachSeasons(coach: string): number[] {
  const years = new Set<number>();
  for (const byYear of Object.values(coachLookup().coachByTeamYear)) {
    for (const [y, name] of Object.entries(byYear)) if (name === coach) years.add(Number(y));
  }
  return [...years].filter((y) => ALL_SEASONS.includes(y)).sort((a, b) => b - a);
}

const ROUND: Record<string, string> = { R64: "Round of 64", R32: "Round of 32" };

/** "1 seed · Champion", or null without a bid. */
export const ncaaLabel = (h: HistorySeason): string | null =>
  h.seed == null ? null : [`${h.seed} seed`, h.round ? (ROUND[h.round] ?? h.round) : null].filter(Boolean).join(" · ");

/** Unbroken runs of one coach, newest first. */
export function byCoach(history: HistorySeason[]): Array<{ coach: string; seasons: HistorySeason[] }> {
  const runs: Array<{ coach: string; seasons: HistorySeason[] }> = [];
  for (const h of history) {
    const last = runs[runs.length - 1];
    const prev = last?.seasons[last.seasons.length - 1];
    if (last && last.coach === h.coach && prev && prev.year === h.year + 1) last.seasons.push(h);
    else runs.push({ coach: h.coach, seasons: [h] });
  }
  return runs;
}

/**
 * A coach's run as "5 seasons", or "13+ seasons" when the same coach was there
 * the season before the first one listed, or that season is the first on record.
 */
export function runLabel(run: { coach: string; seasons: HistorySeason[] }, history: HistorySeason[]): string {
  const oldest = run.seasons[run.seasons.length - 1]!.year;
  index();
  const before = oldest <= floor || history.some((h) => h.year === oldest - 1 && h.coach === run.coach);
  const n = run.seasons.length;
  return `${n}${before ? "+" : ""} ${n === 1 && !before ? "season" : "seasons"}`;
}
