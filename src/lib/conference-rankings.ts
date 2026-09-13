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
import { midrankPercentileMap } from "@/lib/percentile";

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

/** Split key -> its stats, for one conference-season. */
export type ConfSplitBlock = Record<string, number | null>;
export type ConfSplitPack = {
  built: string;
  splits: Array<{ key: string; label: string }>;
  /** "2026|B10" -> { conf: {...}, nonconf: {...} } */
  rows: Record<string, Record<string, ConfSplitBlock>>;
};

let splitCache: Promise<ConfSplitPack | null> | null = null;

/**
 * Fetch the game splits, the first time somebody asks for one.
 *
 * SEPARATE FILE, LAZILY. The splits are as big again as the rankings
 * themselves (103 KB gzipped), and most readers will never touch the control,
 * so folding them into the main payload would double every visit to serve a
 * minority of them.
 */
export function loadConferenceSplits(): Promise<ConfSplitPack | null> {
  if (!splitCache) {
    splitCache = fetch(dataUrl("/data/conference-splits.json"))
      .then((r) => (r.ok ? (r.json() as Promise<ConfSplitPack>) : null))
      .catch(() => null);
  }
  return splitCache;
}

/** The value for a row and stat, under whichever split is showing. */
export function splitValue(
  block: ConfSplitBlock | undefined,
  key: string,
): number | null {
  const v = block?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * How one row's value for a stat is read under a game split: the row itself on
 * the full season, the split file's block otherwise. The season is a property
 * of the row, not of a split of its games.
 */
export function confReader(
  split: string,
  splitPack: ConfSplitPack | null,
): (r: ConfRow, key: string) => number | null {
  return (r, key) => {
    if (key === "year") return r.year;
    if (split === "full") return confValue(r, key);
    const block = splitPack?.rows[`${r.year}|${r.conf}`]?.[split];
    return splitValue(block, key);
  };
}

/**
 * Percentiles per stat, computed WITHIN EACH SEASON and then merged.
 *
 * Same rule the team explorer uses for teams: a conference is compared to the
 * conferences it actually played that year. Pooling twelve seasons would let
 * scoring inflation decide the colors — every 2026 league would outrank
 * every 2015 one on points per game, which is a fact about the era.
 */
export function confPercentiles(
  cohort: readonly ConfRow[],
  cols: ReadonlyArray<{ key: string; lowerBetter: boolean; noPct?: boolean }>,
  read: (r: ConfRow, key: string) => number | null,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const byYear = new Map<number, ConfRow[]>();
  for (const r of cohort) {
    const arr = byYear.get(r.year) ?? [];
    arr.push(r);
    byYear.set(r.year, arr);
  }
  for (const c of cols) {
    if (c.noPct) continue;
    const merged = new Map<string, number>();
    for (const rows of byYear.values()) {
      const m = midrankPercentileMap(
        rows.map((r) => [`${r.year}|${r.conf}`, read(r, c.key)] as const),
        !c.lowerBetter,
      );
      for (const [k, v] of m) merged.set(k, v);
    }
    out.set(c.key, merged);
  }
  return out;
}
