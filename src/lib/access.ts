/**
 * WHAT IS FREE AND WHAT IS PAID. One file. This is the whole policy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ▸ TO CHANGE WHAT COSTS MONEY, EDIT `FREE_SEASONS` BELOW. Nothing else.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything downstream reads from here: the build decides which season files
 * to publish and which to hide inside the function bundle, the browser decides
 * which URL to fetch, and the function decides whether to ask who you are.
 * Three places that must agree, all deriving from one list, because a paywall
 * whose three halves disagree is worse than no paywall — it either locks out
 * subscribers or leaks to everyone, and you find out from a customer.
 *
 * WHY SEASONS, RATHER THAN PAGES OR FEATURES. Two reasons, one principled and
 * one structural. The principled one: a season is a unit a reader already
 * understands, so "the last two years are free, the archive is the product"
 * needs no explanation on a pricing page. The structural one: the bulk season
 * files are the only place the whole dataset sits in one downloadable piece.
 * Gating a page protects a page; gating these protects the asset.
 *
 * WHAT THIS DOES NOT PROTECT, stated plainly so it is never assumed:
 *
 *   1. The team and player PAGES prerender their numbers into HTML at build
 *      time. Gating a season's bulk file does nothing about the copy embedded
 *      in /teams/duke/2019/. That is a separate, larger change — the pages
 *      have to stop rendering paid data at build time, which means deciding
 *      what a signed-out visitor sees on them.
 *   2. Anything a free season legitimately shows. A determined reader can
 *      still read what they are entitled to read, which is the point.
 *
 * What it DOES stop is the one-line theft: twelve URLs, no account, the entire
 * team dataset. That is the exposure worth closing first.
 */
import { EXPLORER_SEASONS, PREVIEW_SEASON } from "@/lib/seasons";

/**
 * Seasons anyone can read without an account.
 *
 * CURRENTLY EVERY SEASON — the machinery is built and deliberately inert, so
 * that turning it on is a decision rather than a deploy accident. Narrowing
 * this list is what switches the paywall on.
 *
 * When you do narrow it, keep at least the current season public. It is what
 * Google indexes and what a first-time visitor lands on, and the free tier is
 * the top of the funnel that sells the archive.
 *
 * Example, matching what /pricing already advertises (two free, the rest paid):
 *
 *   export const FREE_SEASONS: readonly number[] = [2026, 2025, PREVIEW_SEASON];
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

/** True when the paywall is doing nothing — every season is free. */
export function paywallIsOff(): boolean {
  return paidSeasons().length === 0;
}

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
