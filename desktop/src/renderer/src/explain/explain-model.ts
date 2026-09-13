import { T } from "@/lib/team-game-index";
import type { TeamGame } from "~/data/team-game-model";

/**
 * Why two ratings differ, as parts that add up to the gap.
 *
 * ONE ENGINE, SEVERAL QUESTIONS. Duke against Auburn (the Difference
 * Explainer), Michigan's last ten games against its first twenty (What
 * Changed), a season against the one before: each is one set of games against
 * another, and each is answered here.
 *
 * AN IDENTITY, NOT A REGRESSION. Points per possession is exactly
 *
 *   shots per possession × 2 × eFG%  +  free throws made per possession
 *
 * and shots per possession is exactly the box score's possession count
 * (FGA − OREB + TOV + 0.475 FTA) with the turnovers, offensive rebounds and
 * trips to the line put back:
 *
 *   FGA / poss = count + OREB/poss − TOV/poss − 0.475 FTA/poss
 *
 * `count` is the box score's possessions over the log's own count, a hair
 * above 1 (the log counts 0.66% fewer across 2025-26). So a rating is a
 * function of six numbers in five groups (shooting, turnovers, offensive
 * rebounds, free throws, and the count), and nothing is left over except
 * the handful of games whose points the box score does not itemize.
 *
 * PARTS THAT ADD UP. A gap is shared among the groups by Shapley value: each
 * group's effect averaged over every order the groups could be switched from
 * one side to the other, so no part depends on which went first and the
 * parts sum to the gap exactly. Five groups is 32 evaluations.
 *
 * DEFENSE FROM THE OPPONENT'S OWN BOX. A game's other side is the opponent's
 * row that night (TeamGame.oppRow), so what a team allowed is rebuilt from the
 * makes, attempts and turnovers its opponents actually had, over the team's
 * own possessions, the same way offense is.
 */

/** Box totals over a set of games, for one end of the floor. `pts` and `poss` are what the rating divides. */
export type Box = { pts: number; poss: number; fgm: number; fga: number; fg3m: number; ftm: number; fta: number; oreb: number; tov: number };

/** The six numbers a rating is built from. */
export type Inputs = {
  /** Effective FG%. */
  e: number;
  /** Turnovers per possession. */
  t: number;
  /** Offensive rebounds per possession. */
  r: number;
  /** Free throw attempts per possession. */
  a: number;
  /** Free throw %. */
  f: number;
  /** The box score's possession count over the log's. */
  c: number;
};

export type FactorKey = "shooting" | "turnovers" | "rebounds" | "freeThrows" | "count";
export const FACTORS: FactorKey[] = ["shooting", "turnovers", "rebounds", "freeThrows", "count"];

/** Share of a free throw attempt that ends a possession, the coefficient the box score's count uses. */
const FT_TRIP = 0.475;

const GROUP_OF: Record<keyof Inputs, FactorKey> = { e: "shooting", t: "turnovers", r: "rebounds", a: "freeThrows", f: "freeThrows", c: "count" };
const INPUT_KEYS = Object.keys(GROUP_OF) as Array<keyof Inputs>;

const emptyBox = (): Box => ({ pts: 0, poss: 0, fgm: 0, fga: 0, fg3m: 0, ftm: 0, fta: 0, oreb: 0, tov: 0 });

function addCounts(box: Box, row: number[]): void {
  box.fgm += row[T.fgm]!;
  box.fga += row[T.fga]!;
  box.fg3m += row[T.fg3m]!;
  box.ftm += row[T.ftm]!;
  box.fta += row[T.fta]!;
  box.oreb += row[T.oreb]!;
  box.tov += row[T.tov]!;
}

/** What a set of games scored, and on what. */
export function offenseBox(games: TeamGame[]): Box {
  const box = emptyBox();
  for (const g of games) {
    box.pts += g.row[T.pts]!;
    box.poss += g.row[T.poss]!;
    addCounts(box, g.row);
  }
  return box;
}

/**
 * What a set of games allowed: the opponents' makes and misses, over the team's
 * own possessions. A game with no opponent row still counts its points and
 * possessions, so the rating is the log's; its missing counts show up in the
 * count group rather than disappearing.
 */
export function defenseBox(games: TeamGame[]): Box {
  const box = emptyBox();
  for (const g of games) {
    box.pts += g.row[T.pa]!;
    box.poss += g.row[T.poss]!;
    if (g.oppRow) addCounts(box, g.oppRow);
  }
  return box;
}

export function inputsOf(box: Box): Inputs | null {
  const p = box.poss;
  if (p <= 0 || box.fga <= 0) return null;
  return {
    e: (box.fgm + 0.5 * box.fg3m) / box.fga,
    t: box.tov / p,
    r: box.oreb / p,
    a: box.fta / p,
    f: box.fta > 0 ? box.ftm / box.fta : 0,
    c: (box.fga - box.oreb + box.tov + FT_TRIP * box.fta) / p,
  };
}

/** Points per 100 possessions from the six numbers. Equals 100 × pts / poss whenever the box itemizes every point. */
export const ratingOf = (x: Inputs): number => 100 * (2 * x.e * (x.c + x.r - x.t - FT_TRIP * x.a) + x.f * x.a);

const FACT = [1, 1, 2, 6, 24, 120];

/** Each group's Shapley share of ratingOf(x) − ratingOf(y). */
function shares(x: Inputs, y: Inputs): Record<FactorKey, number> {
  const n = FACTORS.length;
  const memo = new Map<number, number>();
  const valueAt = (mask: number): number => {
    let v = memo.get(mask);
    if (v === undefined) {
      const mixed = { ...y };
      for (const k of INPUT_KEYS) if (mask & (1 << FACTORS.indexOf(GROUP_OF[k]))) mixed[k] = x[k];
      v = ratingOf(mixed);
      memo.set(mask, v);
    }
    return v;
  };
  const out = {} as Record<FactorKey, number>;
  FACTORS.forEach((g, i) => {
    let s = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask & (1 << i)) continue;
      let size = 0;
      for (let m = mask; m; m &= m - 1) size += 1;
      s += ((FACT[size]! * FACT[n - size - 1]!) / FACT[n]!) * (valueAt(mask | (1 << i)) - valueAt(mask));
    }
    out[g] = s;
  });
  return out;
}

/** One side of a comparison: a team over a set of games. */
export type Side = {
  games: TeamGame[];
  off: Box;
  def: Box;
  offIn: Inputs | null;
  defIn: Inputs | null;
  /** From the games, per 100 possessions. */
  raw: { o: number | null; d: number | null; net: number | null };
  /** The published schedule-adjusted ratings, when the side is a whole season that carries them. */
  adj: { o: number; d: number; net: number } | null;
};

export function sideOf(games: TeamGame[], adj: { o: number | null; d: number | null; net: number | null } | null = null): Side {
  const off = offenseBox(games);
  const def = defenseBox(games);
  const o = off.poss > 0 ? (100 * off.pts) / off.poss : null;
  const d = def.poss > 0 ? (100 * def.pts) / def.poss : null;
  return {
    games,
    off,
    def,
    offIn: inputsOf(off),
    defIn: inputsOf(def),
    raw: { o, d, net: o != null && d != null ? o - d : null },
    adj: adj && adj.o != null && adj.d != null && adj.net != null ? { o: adj.o, d: adj.d, net: adj.net } : null,
  };
}

export type Measure = "net" | "offense" | "defense";

export type Part = {
  key: FactorKey;
  /** In x's favor, per 100 possessions: what this group of x's offense is worth over y's. */
  offense: number;
  /** In x's favor: what this group of x's defense is worth over y's (allowing less is in its favor). */
  defense: number;
  /** What the part adds to the gap under the measure asked for. */
  total: number;
};

export type Explanation = {
  measure: Measure;
  /** Both sides carry adjusted ratings, and the gap is between those. */
  adjusted: boolean;
  /** The two figures compared: net, offensive or defensive rating. */
  x: number;
  y: number;
  /** In x's favor. For defense that is y − x, since allowing less is better. */
  gap: number;
  parts: Part[];
  /** What the schedule adjustment is worth to the gap, when `adjusted`. */
  schedule: number | null;
};

/**
 * x against y. Every number is in x's favor, per 100 possessions, and the parts
 * plus the schedule add up to the gap exactly (to floating point).
 */
export function explain(x: Side, y: Side, measure: Measure): Explanation | null {
  if (!x.offIn || !y.offIn || !x.defIn || !y.defIn) return null;
  if (x.raw.o == null || x.raw.d == null || y.raw.o == null || y.raw.d == null) return null;

  const off = shares(x.offIn, y.offIn);
  const def = shares(x.defIn, y.defIn);
  // Points the box score does not itemize (a handful of games a season) ride with the count.
  off.count += x.raw.o - ratingOf(x.offIn) - (y.raw.o - ratingOf(y.offIn));
  def.count += x.raw.d - ratingOf(x.defIn) - (y.raw.d - ratingOf(y.defIn));

  const parts: Part[] = FACTORS.map((key) => {
    const o = off[key];
    const d = -def[key];
    return { key, offense: o, defense: d, total: measure === "net" ? o + d : measure === "offense" ? o : d };
  });

  const adjusted = !!x.adj && !!y.adj;
  const figure = (s: Side): number =>
    measure === "net" ? (adjusted ? s.adj!.net : s.raw.net!) : measure === "offense" ? (adjusted ? s.adj!.o : s.raw.o!) : adjusted ? s.adj!.d : s.raw.d!;
  const fx = figure(x);
  const fy = figure(y);
  const gap = measure === "defense" ? fy - fx : fx - fy;

  let schedule: number | null = null;
  if (adjusted) {
    // The adjustment each side's rating carries over what its games show raw. The
    // published net is rounded on its own, so it is read directly, not as O − D.
    const worth = (s: Side) =>
      measure === "net" ? s.adj!.net - s.raw.net! : measure === "offense" ? s.adj!.o - s.raw.o! : -(s.adj!.d - s.raw.d!);
    schedule = worth(x) - worth(y);
  }

  return { measure, adjusted, x: fx, y: fy, gap, parts, schedule };
}

/** Each game's share of how far a set of games sits from a baseline figure. The shares add up to (figure − baseline). */
export type GameShare = { game: TeamGame; value: number; share: number };

export function gameShares(games: TeamGame[], baseline: number, measure: Measure): GameShare[] {
  const poss = games.reduce((n, g) => n + g.row[T.poss]!, 0);
  if (poss <= 0) return [];
  return games.map((g) => {
    const p = g.row[T.poss]!;
    const o = p > 0 ? (100 * g.row[T.pts]!) / p : 0;
    const d = p > 0 ? (100 * g.row[T.pa]!) / p : 0;
    const value = measure === "net" ? o - d : measure === "offense" ? o : d;
    // In the set's favor: for defense, a game that allowed less than the baseline helps.
    const lift = measure === "defense" ? baseline - value : value - baseline;
    return { game: g, value, share: (lift * p) / poss };
  });
}

/** The figure a measure reads off a side, raw. */
export const rawFigure = (s: Side, m: Measure): number | null => (m === "net" ? s.raw.net : m === "offense" ? s.raw.o : s.raw.d);
