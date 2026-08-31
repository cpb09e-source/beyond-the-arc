/**
 * Canonical season window for the whole site. Zero imports on purpose — every
 * other module reads from here, so there is exactly one place to change the
 * data window and no chance of an import cycle.
 *
 * FLOOR (2014 = the 2013-14 season): first year with reliable possession /
 * efficiency data. CBBD's own adjusted ratings start here too, and pre-2014
 * box scores are missing possessions on many games.
 *
 * FLAGGED (2021 = the 2020-21 COVID season): shown, but marked.
 *
 * It used to be EXCLUDED — dropped from every list, picker and route. That was
 * one decision standing in for two, and only one of them was right:
 *
 *   "Is it comparable to other seasons?" No, and that has not changed. Games
 *   were cancelled wholesale, teams opted out mid-year, schedules went
 *   conference-only for long stretches, and most arenas had no crowd, so
 *   home-court advantage — and the venue and quadrant math built on it —
 *   behaves differently. 8,243 game rows against 12,358 in 2025-26, a 33%
 *   shortfall.
 *
 *   "Did it happen?" Yes. Duke played a 2020-21 season, and 2,123 players in
 *   this corpus have games in both 2020 and 2022 — a hole punched in the
 *   middle of their careers, on their own profile pages, for a season they
 *   actually played. Hiding a real season to protect an average is the site
 *   answering a question nobody asked.
 *
 * So it is visible, and it carries a flag that surfaces render as a marker.
 * Nearly every number on this site is already computed WITHIN a season — a
 * percentile against that year's cohort, a rank among that year's teams — and
 * those are correct for 2021 precisely because they never leave it. What the
 * flag exists to warn about is the reader pooling it themselves: several
 * seasons selected at once in an explorer, or a career total.
 *
 * COVERAGE IS PARTIAL, and honestly so. The archive has 2021's team box and
 * ratings but not its per-player box or its play-by-play, so team pages, the
 * team explorer and the Team Game Log Explorer carry 2021 in full, while the
 * per-player game log and everything derived from play-by-play (shot charts,
 * lineups, on/off, assist networks) do not. Surfaces read their own data and
 * show nothing where there is nothing, rather than being told a season-wide
 * lie in either direction.
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

/**
 * Seasons omitted from every list, picker, and route.
 *
 * EMPTY, and kept rather than deleted. It is the right tool for a season we
 * genuinely cannot stand behind — one whose data is wrong rather than merely
 * unusual — and the machinery below (clampSeason's neighbour walk, the
 * ALL_SEASONS filter) is what makes such a season safe to remove. 2021 moved
 * to FLAGGED_SEASONS because its data is not wrong, only incomparable.
 */
export const EXCLUDED_SEASONS: ReadonlySet<number> = new Set<number>();

export function isExcludedSeason(y: number): boolean {
  return EXCLUDED_SEASONS.has(y);
}

/**
 * Real seasons that do not belong in a cross-season comparison.
 *
 * A flagged season is present everywhere an ordinary one is. What it is not is
 * silent: any surface that lets a reader pool seasons, or that reports a
 * career or all-time figure, should say this one is in the mix. See
 * SEASON_FLAG_NOTE for the wording, and seasonFlagNote() to look it up.
 */
export const FLAGGED_SEASONS: ReadonlySet<number> = new Set([2021]);

export function isFlaggedSeason(y: number): boolean {
  return FLAGGED_SEASONS.has(y);
}

/** Why a season is flagged, keyed by season. One sentence, shown in a tooltip. */
export const SEASON_FLAG_NOTE: Readonly<Record<number, string>> = {
  2021: "The COVID season: a third fewer games, conference-only stretches, mid-season opt-outs and empty arenas. Fine on its own, not comparable to other years.",
};

export function seasonFlagNote(y: number): string | null {
  return SEASON_FLAG_NOTE[y] ?? null;
}

/**
 * The seasons safe to pool without a caveat — everything except the flagged.
 *
 * For an average, an era baseline or an all-time list that has no way to show
 * a marker. A surface that CAN show one should use ALL_SEASONS and mark it,
 * because dropping a season a reader can see elsewhere is its own kind of lie.
 */
export const POOLABLE_SEASONS: readonly number[] = (() => {
  const out: number[] = [];
  for (let y = SEASON_CEIL; y >= SEASON_FLOOR; y--) {
    if (!isExcludedSeason(y) && !isFlaggedSeason(y)) out.push(y);
  }
  return out;
})();

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
