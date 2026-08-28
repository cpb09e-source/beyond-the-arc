/**
 * The conference power rankings payload — one row per conference per season.
 *
 * Built by scripts/build-conference-rankings.mjs from the same
 * teams-by-year files the team explorer reads, so the two pages cannot
 * disagree about a season. See docs/conference-rankings-spec.md for how each
 * stat aggregates; the short version is that a row is the conference MINUS its
 * two worst teams by adjusted NET, and that rates are games-weighted while
 * ratings are plain means over the teams that survived the cut.
 *
 * ONE FILE FOR EVERY SEASON, fetched once. 382 rows over twelve seasons is
 * 105 KB gzipped — less than a single season of team rows — so splitting it by
 * year would buy nothing and cost a fetch every time the picker moves.
 */
import { dataUrl } from "@/lib/data-url";

/** A conference-season. Stat keys are the team explorer's own. */
export type ConfRow = {
  year: number;
  /** Conference code as the team files spell it: "B10", "SEC", "MWC". */
  conf: string;
  /** How many teams the conference had. */
  teams: number;
  /** How many fed the numbers — always `teams - 2`. */
  kept: number;
  /** The two that did not, worst adjusted NET first from the bottom. */
  dropped: string[];
} & Record<string, number | string | string[] | null>;

export type ConfPack = {
  built: string;
  seasons: number[];
  minTeams: number;
  dropWorst: number;
  rows: ConfRow[];
};

/** Numeric read that copes with the row's mixed value type. */
export function confValue(row: ConfRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

let cache: Promise<ConfPack | null> | null = null;

/**
 * Fetch (and remember) the payload.
 *
 * Module-level cache rather than component state: the page can mount twice in
 * development and the file never changes within a session.
 */
export function loadConferenceRankings(): Promise<ConfPack | null> {
  if (!cache) {
    cache = fetch(dataUrl("/data/conference-rankings.json"))
      .then((r) => (r.ok ? (r.json() as Promise<ConfPack>) : null))
      .catch(() => null);
  }
  return cache;
}
