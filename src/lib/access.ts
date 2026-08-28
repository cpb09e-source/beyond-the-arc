/**
 * WHAT IS FREE AND WHAT IS PAID. One file. This is the whole policy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ▸ THREE BLOCKS BELOW: the seasons, the free-tier allowances, and the
 *    per-view rules. Change what costs money here and nowhere else.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * TWO KINDS OF GATE LIVE HERE, AND THEY ARE NOT THE SAME STRENGTH. Saying so
 * once, at the top, because the difference is invisible from the call sites
 * and is exactly the thing that gets forgotten.
 *
 *   A DATA GATE withholds bytes. Only §1 is one. A paid season is not
 *   published to the CDN at all — it sits inside the function bundle and comes
 *   back only for a request carrying a subscriber's token. There is no client
 *   trick that recovers it.
 *
 *   A PRODUCT GATE withholds the presentation. §2 and §3 are these. The season
 *   file the browser already holds contains every stat for every team, because
 *   the table renders client-side, so hiding Shot Profile behind a lock hides
 *   the COLUMN, not the numbers. Anyone who opens devtools has them.
 *
 * That is a deliberate trade, not an oversight. Making §3 a data gate would
 * mean splitting each season file by column set and merging in the browser —
 * real work, and worth doing only if the archive gate turns out not to be the
 * thing people actually pay for. Until then these are shaped like the rest of
 * the industry: the feature is presented as part of the plan, and presentation
 * is what people buy.
 *
 * WHAT NONE OF THIS PROTECTS, stated plainly so it is never assumed: the team
 * and player PAGES prerender their numbers into HTML at build time. Gating a
 * season's bulk file does nothing about the copy embedded in /teams/duke/2019/.
 * That is a separate, larger change — the pages have to stop rendering paid
 * data at build time, which means deciding what a signed-out visitor sees.
 */
import { EXPLORER_SEASONS, PREVIEW_SEASON } from "@/lib/seasons";

/* ══ §1 · SEASONS ═══════════════════════════════════════ THE DATA GATE ══ */

/**
 * Seasons anyone can read without an account.
 *
 * CURRENTLY EVERY SEASON — the machinery is built and deliberately inert, so
 * that turning it on is a decision rather than a deploy accident. Narrowing
 * this list is what switches the archive paywall on.
 *
 * The agreed setting, held until the rest of the ledger is filled in, is the
 * current season and the one before it. Roll it forward when a new season
 * starts — 2027-28 opening moves 2025-26 behind the wall:
 *
 *   export const FREE_SEASONS: readonly number[] = [2026, 2025];
 *
 * Keep at least the current season public whatever else changes. It is what
 * Google indexes and what a first-time visitor lands on, and the free tier is
 * the top of the funnel that sells the archive.
 */
export const FREE_SEASONS: readonly number[] = [...EXPLORER_SEASONS];

/** True when `year` needs no account. */
export function isSeasonFree(year: number): boolean {
  // The preview season is always free: it is a marketing surface — mostly
  // empty columns and next year's roster continuity — and charging for a
  // table of dashes would be a strange first impression.
  if (year === PREVIEW_SEASON) return true;
  return FREE_SEASONS.includes(year);
}

/** Seasons that require an active subscription. */
export function paidSeasons(): number[] {
  return EXPLORER_SEASONS.filter((y) => !isSeasonFree(y));
}

/** True when the archive gate is doing nothing — every season is free. */
export function paywallIsOff(): boolean {
  return paidSeasons().length === 0;
}

/* ══ §2 · FREE-TIER ALLOWANCES ══════════════════════ THE PRODUCT GATES ══ */

/**
 * How far a signed-out or free reader gets before the wall.
 *
 * EVERY ONE OF THESE IS A TASTE, NOT A TRIAL. The point is that the feature
 * works — really works, on real data — for long enough that the reader knows
 * what they would be buying. A control that is visible but dead teaches
 * nothing; a control that runs three times teaches everything.
 */
export const FREE_LIMITS = {
  /**
   * Stat columns on the table at once. The identity columns — rank, team,
   * conference, season, record — never count: they are the table, not a
   * feature, and a reader who has added nothing should not be at a limit.
   */
  statCols: 3,
  /**
   * How many of those columns may carry a value bound.
   *
   * LOWER THAN statCols ON PURPOSE, and the gap is the whole design. Adding a
   * column asks "what is this number?"; bounding one asks "who clears this
   * bar?", which is the question the archive exists to answer and the more
   * valuable half of the tool. Three columns to look at, two to filter on.
   */
  boundedStatCols: 2,
  /** Saved filters kept in the browser. Paid readers get MAX_SAVED. */
  savedFilters: 3,
  /** Rows shown of a locked view — enough to see the shape, not the ranking. */
  previewRows: 5,
  /**
   * Seasons selectable at once.
   *
   * Cross-season comparison is the thing the archive is FOR: one season is a
   * table, several is an argument. It is also the only allowance here that
   * gets stronger rather than weaker once §1 is switched on, since most
   * seasons will not be loadable at all.
   */
  seasonsAtOnce: 1,
} as const;

/**
 * The shape of an explorer query, as far as the free-tier limits care.
 *
 * Structural rather than importing TeamFilterSpec, so this file stays at the
 * bottom of the dependency graph — team-views.ts already imports it, and
 * team-views imports team-filters.
 */
export type FreeTierScope = {
  years: number[];
  cols: readonly string[];
  filters: ReadonlyArray<{ stat: string }>;
};

/**
 * Cut a query down to what this reader is entitled to run.
 *
 * THIS EXISTS BECAUSE THE BUILDER UI IS NOT A LIMIT. Capping the picker stops
 * a reader ASSEMBLING a fourth column; it does nothing about a URL that
 * already has five in it — a link from a subscriber, a saved filter made
 * before a subscription lapsed, or an address bar. The controls were correctly
 * capped and the table rendered all five anyway, which is the version of this
 * bug that never shows up in testing because you have to arrive sideways to
 * hit it.
 *
 * So the limit lives HERE, on the query the table actually runs, and the UI
 * caps are a courtesy on top of it: they exist so a reader is told about the
 * ceiling rather than watching columns silently disappear.
 *
 * FILTERS ARE DROPPED WITH THEIR COLUMNS, never left behind. A bound on a
 * stat that is no longer on the table is the one outcome worse than either
 * showing it or hiding it — a filtered list of teams with nothing to say why
 * any of them qualified.
 *
 * The reader's real selection is NOT rewritten anywhere: this narrows what is
 * computed, and the URL keeps what they asked for, so subscribing restores the
 * table rather than making them rebuild it.
 */
export function clampToFreeTier<T extends FreeTierScope>(spec: T, paid: boolean): T {
  if (paid) return spec;
  const cols = spec.cols.slice(0, FREE_LIMITS.statCols);
  const keep = new Set<string>(cols);
  const next = {
    ...spec,
    years: spec.years.slice(0, FREE_LIMITS.seasonsAtOnce),
    cols,
    filters: spec.filters
      .filter((f) => keep.has(f.stat))
      .slice(0, FREE_LIMITS.boundedStatCols),
  };
  // The spread widens `cols` to string[] and `filters` to the structural type;
  // both are the same values the caller passed in, narrowed only in length.
  return next as unknown as T;
}

/* ══ §3 · VIEWS ═════════════════════════════════════ THE PRODUCT GATES ══ */

/**
 * How a table view behaves for a reader without a subscription.
 *
 *   free    — no gate at all.
 *   preview — the columns render, but only FREE_LIMITS.previewRows of them,
 *             and the table cannot be re-sorted. Filters and search still
 *             apply, so the five rows are the top five of whatever the reader
 *             asked for: the tool demonstrably works, it just stops short of
 *             being a ranking.
 *   bands   — some column groups are free and the rest render blurred, in
 *             place, under a lock. Used where a view is genuinely two things:
 *             the record is a fact, the scoreboard context around it is the
 *             product.
 *   cols    — nothing is locked by the view; FREE_LIMITS.statCols does the
 *             work, because the view has no columns of its own. Its own kind
 *             rather than "free" so the empty table can say what the limit is
 *             before the reader hits it.
 *
 * BAND NAMES ARE MATCHED AGAINST team-views.ts AT MODULE LOAD in development —
 * see the check at the bottom of that file. A renamed band would otherwise
 * silently unlock, which is the one failure here nobody would notice.
 */
export type ViewAccess =
  | { kind: "free" }
  | { kind: "preview" }
  | { kind: "bands"; free: readonly string[] }
  | { kind: "cols" };

const FREE: ViewAccess = { kind: "free" };
const PREVIEW: ViewAccess = { kind: "preview" };

export const VIEW_ACCESS: Readonly<Record<string, ViewAccess>> = {
  // Ratings — the shop window. Everything a casual reader came for.
  overview: FREE,
  "four-factors": FREE,
  adjusted: FREE,

  // Shooting — where the site stops being a scoreboard.
  shooting: PREVIEW,
  "shot-profile": PREVIEW,

  // Box score — the traditional line is free; the context around it is not.
  traditional: FREE,
  "scoring-context": PREVIEW,
  differentials: PREVIEW,

  // Defense — no free equivalent anywhere on the site.
  "opp-shooting": PREVIEW,
  "defensive-events": PREVIEW,

  // Team profile — split, because half of each is a public fact.
  //
  // The record is on every other basketball site in the world and there is no
  // sense charging for it. What follows it is not: whether a team ever
  // trailed, and what happened when it did.
  record: { kind: "bands", free: ["Record"] },
  // Same shape. Who came back and how many minutes they bring is knowable from
  // a roster page; what the portal added and whether the rotation held its
  // shape is the part we compute.
  continuity: { kind: "bands", free: ["Prior season", "Minutes returned"] },
  roster: PREVIEW,

  // Custom — the reader's own columns, capped by §2.
  custom: { kind: "cols" },
};

/** The rule for a view. Unknown keys are free — a view with no entry is new,
 *  and shipping it locked by accident is the worse failure. */
export function viewAccess(key: string): ViewAccess {
  return VIEW_ACCESS[key] ?? FREE;
}

/** The rule that actually applies to this reader. */
export function effectiveViewAccess(key: string, paid: boolean): ViewAccess {
  return paid ? FREE : viewAccess(key);
}

/** True when a view shows a subscriber something a free reader cannot see. */
export function viewIsGated(key: string): boolean {
  return viewAccess(key).kind !== "free";
}

/* ══ §4 · PATHS ═════════════════════════════════════════════════════════ */

/**
 * Where a gated season file lives inside the function bundle.
 *
 * NOT under `out/`. Netlify publishes `out/` as the website and would serve
 * anything in it to anyone; these files are referenced by
 * `[functions] included_files` in netlify.toml instead, which puts them on the
 * function's own filesystem and nowhere a browser can reach.
 */
export const GATED_DIR = "gated-data";

/** The gated path for a season, relative to the repo root. */
export function gatedSeasonFile(year: number): string {
  return `${GATED_DIR}/teams-by-year/${year}.json`;
}

/** The public path for a season, as written in /public. */
export function publicSeasonFile(year: number): string {
  return `/data/teams-by-year/${year}.json`;
}

/**
 * Where the browser should ask for a season.
 *
 * A free season is an ordinary static file on the CDN — no function call, no
 * token, cacheable at the edge. Only a paid season pays the cost of going
 * through the function, which is what keeps the common path fast.
 */
export function seasonEndpoint(year: number): string {
  return isSeasonFree(year) ? publicSeasonFile(year) : `/api/season/${year}`;
}
