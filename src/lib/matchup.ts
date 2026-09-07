/**
 * The Matchup Predictor's model — one implementation, used by the prerender
 * and by the browser, so the number in the static HTML is the number the
 * page shows a second later.
 *
 * Every constant here was fitted on 2022-23 + 2023-24 and verified once each
 * on 2024-25 and 2025-26. The derivation, the alternatives tried, and what
 * each term is worth are in docs/matchup-predictor.md. The short version:
 *
 *   - Opponent-adjusted efficiency, home court and pace do ~94% of the
 *     achievable work. Everything below the base projection is the other 6%.
 *   - The home floor is not one number. A conference home game is worth
 *     +0.78; a power-conference team hosting a non-power team is worth
 *     +1.85 + 3.02 = +4.87 on top of the location term in the base.
 *   - The strongest style term is NEGATIVE: a team projected to out-shoot
 *     its opponent from three under-performs. 3P% is the least persistent
 *     thing a team does, and the efficiency rating has already banked it.
 *   - Who is dressed matters; who is on the roster does not. Losing your
 *     best player costs ~1.85 points beyond the ratings. A minutes-weighted
 *     roster rating adds nothing (blend weight −0.004), so there is no
 *     minutes editor here — a player is in or out.
 *   - Fast games are wider, not more upset-prone: the same pace multiplier
 *     that widens the distribution widens the projected margin, and the two
 *     cancel. So σ is a constant, and the score RANGE scales with pace while
 *     the win probability does not.
 */

// ── The data file ──────────────────────────────────────────────────────────

/** One of the six adjusted style dimensions, in the order of MatchupPack.dims. */
export type StyleKey = "efg" | "orb" | "tov" | "ftr" | "t3r" | "t3p";

export type MatchupTeam = {
  /** CBBD name — the key inside this file. */
  n: string;
  /** Bart name — what the team pages and logos are keyed on. */
  b: string;
  /** Team-page slug. */
  s: string;
  c: string | null;
  /** 1 if the conference is one of the season's six strongest. */
  p: 0 | 1;
  rk: number;
  w: number;
  l: number;
  /** Adjusted offence, defence (per 100) and tempo. */
  o: number;
  d: number;
  t: number;
  /** Adjusted style, offence and what the defence concedes, by dims order. */
  so: number[];
  sd: number[];
  /** Share of last season's minutes that returned. */
  k: number;
  /** Index into `r` of the best player, or −1. */
  best: number;
  /** [name, minutes per game, value per game, games played] */
  r: Array<[string, number, number, number]>;
};

export type MatchupPack = {
  season: number;
  built_at: string;
  games: number;
  dropped: number;
  league: { eff: number; tempo: number; style: number[] };
  dims: StyleKey[];
  power: string[];
  teams: MatchupTeam[];
};

// ── The constants ──────────────────────────────────────────────────────────

/** Home court in the base projection, per side, per 100 possessions. */
export const HCA = 2.0;

/** Margin corrections, in points. Fitted on 2023+2024 residuals. */
export const CORR = {
  intercept: -0.5168,
  /** Non-conference home floor. */
  ncHome: 1.8491,
  /** Conference home floor. */
  confHome: 0.7805,
  /** A power-conference team hosting a non-power team — stacks on ncHome. */
  powerHost: 3.0172,
  orbEdge: 0.0878,
  tovEdge: -0.0711,
  t3rEdge: 0.0678,
  /** Negative on purpose. Fade the hot shooters. */
  t3pEdge: -0.2465,
  qualSum: 0.0325,
  /** Per unit of (away missing value − home missing value). */
  missVal: 0.0578,
  /** Best player out, away minus home. */
  missTop: 1.8509,
  /** Roster continuity, home minus away. */
  cont: 2.4674,
} as const;

/** Spread of the margin around its projection. Normal; the form is irrelevant. */
export const SIGMA = 11.0;

/** Coefficients of the fitted pace form: L − 0.75 + 0.83 × (tA + tB − 2L). */
const PACE_INTERCEPT = -0.75, PACE_SLOPE = 0.83;

export type Site = "home" | "away" | "neutral";

// ── The projection ─────────────────────────────────────────────────────────

const erfApprox = (x: number): number => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
};
/** Standard normal CDF. */
export const phi = (z: number): number => 0.5 * (1 + erfApprox(z / Math.SQRT2));

export type Projection = {
  a: MatchupTeam;
  b: MatchupTeam;
  site: Site;
  sameConf: boolean;
  pace: number;
  /** What each formula would have said — printed on the page, not used. */
  paceSimpleAvg: number;
  paceKenpom: number;
  effA: number;
  effB: number;
  baseA: number;
  baseB: number;
  baseMargin: number;
  /** Every correction term in points, home-positive. */
  parts: {
    intercept: number;
    homeFloor: number;
    powerHost: number;
    orb: number;
    tov: number;
    t3r: number;
    t3p: number;
    qual: number;
    availability: number;
    continuity: number;
  };
  correction: number;
  margin: number;
  total: number;
  scoreA: number;
  scoreB: number;
  winA: number;
  /** The style edges themselves, A minus B, in each dimension's own units. */
  edges: Record<StyleKey, number>;
  /** Expected values per side, so the style panel can show the collision. */
  expA: Record<StyleKey, number>;
  expB: Record<StyleKey, number>;
  /** The availability inputs the page fed in, echoed back. */
  outA: number[];
  outB: number[];
};

export type ProjectInput = {
  pack: MatchupPack;
  a: MatchupTeam;
  b: MatchupTeam;
  /** Where A plays. */
  site: Site;
  /** Indexes into a.r / b.r of players ruled out. */
  outA?: number[];
  outB?: number[];
};

/**
 * Project A against B.
 *
 * "Home" means A hosts. The model is symmetric, so A at home is exactly B
 * away with the sign flipped — the page keeps A on the left regardless.
 */
export function project({ pack, a, b, site, outA = [], outB = [] }: ProjectInput): Projection {
  const M = pack.league.eff, L = pack.league.tempo;
  const loc = site === "neutral" ? 0 : site === "home" ? 1 : -1;

  // Pace. The simple average is wrong by ~6 possessions when both teams are
  // fast and the KenPom product overshoots the other way; this is the form
  // that is flat across every tempo band.
  const pace = L + PACE_INTERCEPT + PACE_SLOPE * (a.t + b.t - 2 * L);

  const effA = a.o + (b.d - M) + loc * HCA;
  const effB = b.o + (a.d - M) - loc * HCA;
  const baseA = (effA * pace) / 100, baseB = (effB * pace) / 100;
  const baseMargin = baseA - baseB;

  // Style. Expectation ADDS the two deviations: what A does against an
  // average defence, plus what B concedes to an average offence.
  const edges = {} as Record<StyleKey, number>;
  const expA = {} as Record<StyleKey, number>, expB = {} as Record<StyleKey, number>;
  pack.dims.forEach((k, i) => {
    const Lk = pack.league.style[i]!;
    expA[k] = a.so[i]! + (b.sd[i]! - Lk);
    expB[k] = b.so[i]! + (a.sd[i]! - Lk);
    edges[k] = expA[k] - expB[k];
  });

  const sameConf = a.c != null && a.c === b.c;
  const powerHost = loc === 1 ? a.p === 1 && b.p === 0 : loc === -1 ? b.p === 1 && a.p === 0 : false;

  // Availability. Missing value is the sum of value-per-game of everyone
  // ruled out; "best player out" is a flag. Both differentials are B minus A
  // so that A losing someone pushes the margin down.
  const missVal = (team: MatchupTeam, out: number[]) => out.reduce((s, i) => s + (team.r[i]?.[2] ?? 0), 0);
  const missTop = (team: MatchupTeam, out: number[]) => (team.best >= 0 && out.includes(team.best) ? 1 : 0);
  const missValDiff = missVal(b, outB) - missVal(a, outA);
  const missTopDiff = missTop(b, outB) - missTop(a, outA);

  const parts = {
    intercept: CORR.intercept,
    homeFloor: loc * (sameConf ? CORR.confHome : CORR.ncHome),
    powerHost: powerHost ? loc * CORR.powerHost : 0,
    orb: CORR.orbEdge * edges.orb,
    tov: CORR.tovEdge * edges.tov,
    t3r: CORR.t3rEdge * edges.t3r,
    t3p: CORR.t3pEdge * edges.t3p,
    qual: CORR.qualSum * ((a.o - a.d) + (b.o - b.d)),
    availability: CORR.missVal * missValDiff + CORR.missTop * missTopDiff,
    continuity: CORR.cont * (a.k - b.k),
  };
  const correction = Object.values(parts).reduce((s, x) => s + x, 0);
  const margin = baseMargin + correction;
  const total = baseA + baseB;

  return {
    a, b, site, sameConf, pace,
    paceSimpleAvg: (a.t + b.t) / 2,
    paceKenpom: (a.t * b.t) / L,
    effA, effB, baseA, baseB, baseMargin,
    parts, correction, margin, total,
    scoreA: (total + margin) / 2,
    scoreB: (total - margin) / 2,
    winA: phi(margin / SIGMA),
    edges, expA, expB, outA, outB,
  };
}

/**
 * The score range the page draws. σ is constant in the MARGIN; the spread in
 * either team's SCORE grows with the possessions played, which is the
 * "fast games are wider, not more upset-prone" result made visible.
 */
export function scoreBand(p: Projection, z = 1): { a: [number, number]; b: [number, number] } {
  const half = (z * SIGMA) / 2;
  return {
    a: [p.scoreA - half, p.scoreA + half],
    b: [p.scoreB - half, p.scoreB + half],
  };
}

// ── Presentation helpers ───────────────────────────────────────────────────

export const STYLE_LABEL: Record<StyleKey, string> = {
  efg: "Shooting (eFG%)",
  orb: "Offensive rebounding",
  tov: "Turnover rate",
  ftr: "Free-throw rate",
  t3r: "3PA share",
  t3p: "3P%",
};

/** Whether a higher value of the dimension is good for the offence. */
export const STYLE_HIGHER_BETTER: Record<StyleKey, boolean> = {
  efg: true, orb: true, tov: false, ftr: true, t3r: true, t3p: true,
};

/** Which style dimensions carry a coefficient in the model. */
export const STYLE_IN_MODEL: ReadonlySet<StyleKey> = new Set<StyleKey>(["orb", "tov", "t3r", "t3p"]);

export const fmtPct = (p: number): string => `${Math.round(p * 100)}%`;
export const fmt1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
export const fmtSigned = (x: number, digits = 1): string => {
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : x < 0 ? `−${v.slice(1)}` : v;
};
