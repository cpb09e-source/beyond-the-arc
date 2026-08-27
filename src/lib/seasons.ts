/**
 * Canonical season window for the whole site. Zero imports on purpose — every
 * other module reads from here, so there is exactly one place to change the
 * data window and no chance of an import cycle.
 *
 * FLOOR (2014 = the 2013-14 season): first year with reliable possession /
 * efficiency data. CBBD's own adjusted ratings start here too, and pre-2014
 * box scores are missing possessions on many games.
 *
 * EXCLUDED (2021 = the 2020-21 COVID season): deliberately skipped site-wide.
 * That season is not comparable to any other — games were cancelled wholesale,
 * teams opted out mid-year, schedules were conference-only for long stretches,
 * and most arenas had no crowd (so home-court advantage, and therefore venue
 * and quadrant math, behaves differently). Our own logs show it: 8,208 game
 * rows vs 12,358 in 2025-26, a 34% shortfall. Including it quietly poisons
 * multi-season pooling, era normalization, and any home/away split.
 *
 * Verified safe to drop: no player in the corpus has 2021 as their only
 * season, so excluding it orphans no player profile.
 */

export const SEASON_FLOOR = 2014;
/** Last season that has actually been played. */
export const SEASON_CEIL = 2026;

/**
 * The season that has not started yet.
 *
 * DELIBERATELY NOT SEASON_CEIL + 1 BY ACCIDENT — it is a separate constant
 * because it is a separate kind of thing. SEASON_CEIL bounds everything derived
 * from played games: /calc's game picker, the players grid, every rating. This
 * one exists so the team explorer can show projected-roster figures for the
 * upcoming season, and nothing else should offer it.
 *
 * Only three stats can exist for it (returning minutes and its two inputs), so
 * a surface that opts in has to be able to render a mostly-empty row honestly.
 */
export const PREVIEW_SEASON = 2027;

/** Seasons omitted from every list, picker, and route. */
export const EXCLUDED_SEASONS: ReadonlySet<number> = new Set([2021]);

export function isExcludedSeason(y: number): boolean {
  return EXCLUDED_SEASONS.has(y);
}

/**
 * True when a season is inside the floor/ceiling AND not excluded.
 *
 * The preview season counts as usable: readAllTeams filters the whole corpus
 * through this, and excluding it here would strip the rows the explorer needs
 * before any page saw them. Surfaces that only want PLAYED seasons read
 * ALL_SEASONS, which still stops at SEASON_CEIL.
 */
export function isUsableSeason(y: number): boolean {
  if (y === PREVIEW_SEASON) return true;
  return Number.isFinite(y) && y >= SEASON_FLOOR && y <= SEASON_CEIL && !isExcludedSeason(y);
}

/** Every PLAYED season, newest first. Excludes the preview season by design. */
export const ALL_SEASONS: readonly number[] = (() => {
  const out: number[] = [];
  for (let y = SEASON_CEIL; y >= SEASON_FLOOR; y--) if (!isExcludedSeason(y)) out.push(y);
  return out;
})();

/**
 * The season list for surfaces that can show the upcoming season — currently
 * only the team explorer. Newest first, so the preview season leads.
 */
export const EXPLORER_SEASONS: readonly number[] = [PREVIEW_SEASON, ...ALL_SEASONS];

/**
 * Preseason exhibitions (and closed scrimmages) leak into the game logs from
 * 2022-23 onward, after the NCAA began allowing D1-vs-D1 charity exhibitions.
 * They are not real results — opponents are frequently D2/D3/NAIA (Arizona vs
 * Embry-Riddle, St. Bonaventure vs Alfred) — so they must not count toward any
 * record, win%, or quadrant.
 *
 * The regular season has never opened before November, and seasons 2013-14
 * through 2021-22 contain zero pre-November rows, so "played before Nov 1 of
 * the season's opening calendar year" identifies exhibitions with no false
 * positives. CBBD's own box feed agrees — it carries none of these games.
 *
 * @param gameDate ISO calendar date, "YYYY-MM-DD"
 * @param season   season-ending year (2026 = the 2025-26 season)
 */
export function isExhibitionGame(gameDate: string | null | undefined, season: number): boolean {
  if (!gameDate) return false;
  return gameDate < `${season - 1}-11-01`;
}

/**
 * Clamp an arbitrary year into the usable window. Values inside the window but
 * excluded snap to the nearest usable season (ties go newer), so a stale
 * ?year=2021 URL lands somewhere sensible instead of rendering an empty page.
 */
export function clampSeason(y: number, fallback: number = SEASON_CEIL): number {
  if (!Number.isFinite(y)) return fallback;
  if (Math.trunc(y) === PREVIEW_SEASON) return PREVIEW_SEASON;
  const v = Math.max(SEASON_FLOOR, Math.min(SEASON_CEIL, Math.trunc(y)));
  if (!isExcludedSeason(v)) return v;
  for (let d = 1; d <= SEASON_CEIL - SEASON_FLOOR; d++) {
    if (isUsableSeason(v + d)) return v + d;
    if (isUsableSeason(v - d)) return v - d;
  }
  return fallback;
}
