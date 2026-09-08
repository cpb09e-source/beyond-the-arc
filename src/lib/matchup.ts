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
  /** Adjusted offense, defense (per 100) and tempo. */
  o: number;
  d: number;
  t: number;
  /** Adjusted style, offense and what the defense concedes, by dims order. */
  so: number[];
  sd: number[];
  /** Share of last season's minutes that returned. */
  k: number;
  /**
   * The site's own BTA rank, for display.
   *
   * SEPARATE FROM `rk`, which is this model's ordering by adjusted net. The
   * two disagree — Belmont is 64th here and 88th on its team page — and a
   * reader who sees one number on the matchup page and another one click away
   * is right to distrust both. `rk` orders the picker; this is what is shown.
   */
  br: number | null;
  /** Index into `r` of the best player, or −1. */
  best: number;
  /** [name, minutes per game, value per game, games played, stable player id] */
  r: Array<[string, number, number, number, string]>;
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
  /** Non-conference home floor. */
  ncHome: 1.3857,
  /** Conference home floor. */
  confHome: 0.2496,
  /** A power-conference team hosting a non-power team — stacks on ncHome. */
  powerHost: 2.8255,
  orbEdge: 0.0889,
  tovEdge: -0.0636,
  t3rEdge: 0.0687,
  /** Negative on purpose. Fade the hot shooters. */
  t3pEdge: -0.2464,
  /** Both teams strong — a HOME effect, so it is multiplied by location. */
  qualHome: 0.0419,
  /**
   * Per unit of the absence term below. Large because the term is a share
   * raised to a power, so it is a small number for any ordinary absence.
   */
  absence: 20.2209,
  /** Best player out, away minus home — on top of the absence term. */
  missTop: 1.9235,
  /** Roster continuity, home minus away. */
  cont: 2.4689,
} as const;

/**
 * How the cost of absences grows with how much of the rotation is gone.
 *
 * THE FIRST VERSION OF THIS WAS LINEAR IN THE MISSING PLAYERS' VALUE, AND IT
 * WAS WRONG WHERE IT MATTERED. Fitted on three seasons whose mean absence is
 * 19 minutes, it was then asked about a team missing its entire starting five
 * — far outside anything it had seen — and answered with about four points.
 * The measured curve is steeply convex, because the cost is not the missing
 * player, it is the man who replaces him: lose one and the sixth man covers
 * it; lose five and walk-ons play.
 *
 *   rotation minutes out     mean residual for that side
 *      0                        +0.12
 *      0.1-20                   +0.45
 *      60-80                    −1.28
 *      100-120                  −2.63
 *      120+                     −6.25
 *
 * A REDISTRIBUTION MODEL WAS TRIED FIRST AND REJECTED. Handing the missing
 * minutes to whoever was left, valued by Game Score per 40, made removing
 * Iowa's second and third men *improve* them — Game Score is counting-based
 * and rates a low-usage defensive starter below a high-usage reserve. A page
 * cannot say that. This form is monotone in minutes by construction.
 *
 * Fitted exponent 2.5. Every exponent from 1 to 3 scores the same on the
 * holdout — large absences are 0.9% of the data — so it was chosen by which
 * one reproduces the measured curve at the deep end, where the choice shows.
 */
export const ABSENCE_EXP = 2.5;
/** Clip on the quality tilt, so a noisy per-40 rate cannot flip the sign. */
const TILT_MIN = 0.6, TILT_MAX = 1.6;

/**
 * What a team loses by being without these players, in the model's own units.
 *
 * The share of the rotation's minutes that is missing, raised to ABSENCE_EXP,
 * tilted by whether the missing players are worth more or less per minute than
 * the rotation's average. Always ≥ 0, and never smaller for a larger set.
 */
export function absenceLoss(team: MatchupTeam, out: readonly number[]): number {
  if (!out.length || !team.r.length) return 0;
  let totMin = 0, totVal = 0, outMin = 0, outVal = 0;
  team.r.forEach((p, i) => {
    totMin += p[1]; totVal += p[2];
    if (out.includes(i)) { outMin += p[1]; outVal += p[2]; }
  });
  if (totMin <= 0) return 0;
  const share = Math.min(1, outMin / totMin);
  const vShare = totVal > 0 ? outVal / totVal : share;
  const tilt = Math.max(TILT_MIN, Math.min(TILT_MAX, share > 0 ? vShare / share : 1));
  return Math.pow(share, ABSENCE_EXP) * tilt;
}

/** Spread of the margin around its projection. Normal; the form is irrelevant. */
export const SIGMA = 11.0;

/**
 * Spread of ONE TEAM'S SCORE around its projection, at league-average pace.
 *
 * NOT σ/2. A team's score carries the total's error as well as the margin's,
 * and the total is the harder of the two: measured on 2025-26, per-team score
 * error has sd 10.43 against the margin's 11.63 and the total's 17.30. Two in
 * three projected scores land within 10.4 points; half land within 7.1.
 *
 * The first version of this file halved SIGMA and called it a range, which put
 * a band of ±5.5 on the page — narrow enough to be read as a promise, and
 * wrong by a factor of two.
 */
export const SCORE_SIGMA = 10.43;
/** Spread of the total. Roughly 50% harder to call than the margin. */
export const TOTAL_SIGMA = 17.30;

/**
 * How the score's spread grows with the pace of the game.
 *
 * Measured across pace octiles of 2025-26: a log-log slope of 0.452, which is
 * the √pace a possession-level random walk predicts and nothing like the
 * linear scaling a "more possessions, more points" intuition suggests. It is
 * also why the win probability does NOT move with pace — the margin's own
 * spread grows at the same rate as the margin, and the two cancel.
 */
export const SCORE_PACE_EXP = 0.452;

/** Coefficients of the fitted pace form: L − 0.75 + 0.83 × (tA + tB − 2L). */
const PACE_INTERCEPT = -0.75, PACE_SLOPE = 0.83;

/**
 * Points added to the projected TOTAL, and to nothing else.
 *
 * WHY IT EXISTS. Efficiency times pace is a projection of REGULATION scoring
 * by two average-luck teams, and the number a reader wants is the expected
 * points in the game that gets played. Backtested against every game of four
 * seasons, the uncorrected total came in low every single year:
 *
 *     2022-23  −3.11      2024-25  −2.91
 *     2023-24  −3.84      2025-26  −3.88        mean −3.44
 *
 * Two known pieces, roughly equal. About 1.0 point is OVERTIME: 5.2% of
 * games go past regulation and average 168 points against the field's 149,
 * and a projection of expected points has to carry that. About 1.7 points is
 * the pace form, whose −0.75 intercept puts projected possessions 0.8 below
 * the league's actual mean. The remainder is the ±25 efficiency clamp
 * pulling both offenses toward the mean.
 *
 * WHY IT IS APPLIED HERE AND NOT UPSTREAM. `margin` is a DIFFERENCE, so a
 * shortfall common to both teams cancels out of it — measured bias +0.08
 * points, which is as close to zero as a fitted model gets. `total` is a SUM,
 * so the same shortfall accumulates. Raising PACE_INTERCEPT would fix half of
 * this but would rescale every margin by about 1.1% and de-calibrate CORR,
 * which was fitted against the current pace. Adding it to the total alone
 * leaves the margin, the win probability and every fitted constant untouched:
 * `total` moves, `scoreA` and `scoreB` each move by half of it, and
 * `margin` — their difference — does not move at all.
 *
 * WHAT IT DOES NOT DO. It does not make the total a good bet. Backtested
 * walk-forward against 5,400 closing lines, the model's disagreements with
 * the total line were wrong more often than right, and MORE wrong the larger
 * they got, even after this correction. It makes the printed number honest;
 * it does not make it sharp. See the method page.
 */
export const TOTAL_ADJ = 3.44;

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
  // average defense, plus what B concedes to an average offense.
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
  const missTop = (team: MatchupTeam, out: number[]) => (team.best >= 0 && out.includes(team.best) ? 1 : 0);
  const lossDiff = absenceLoss(b, outB) - absenceLoss(a, outA);
  const missTopDiff = missTop(b, outB) - missTop(a, outA);

  /**
   * EVERY TERM HAS TO FLIP WHEN THE TEAMS SWAP, or the page gives two
   * different answers to one question. The style, continuity and availability
   * terms are already A-minus-B differentials, so they flip on their own. The
   * two that did not were a free intercept and the quality term: both were
   * added regardless of location, which handed them to whichever team happened
   * to be listed first. Michigan-Duke on a neutral floor read +1.09 Michigan,
   * and Duke-Michigan read +2.50 Duke.
   *
   * The intercept is gone (the fit is now through the origin) and quality is
   * multiplied by location, so on a neutral court both vanish and swapping the
   * teams mirrors the projection exactly.
   */
  const parts = {
    homeFloor: loc * (sameConf ? CORR.confHome : CORR.ncHome),
    powerHost: powerHost ? loc * CORR.powerHost : 0,
    orb: CORR.orbEdge * edges.orb,
    tov: CORR.tovEdge * edges.tov,
    t3r: CORR.t3rEdge * edges.t3r,
    t3p: CORR.t3pEdge * edges.t3p,
    qual: loc * CORR.qualHome * ((a.o - a.d) + (b.o - b.d)),
    availability: CORR.absence * lossDiff + CORR.missTop * missTopDiff,
    continuity: CORR.cont * (a.k - b.k),
  };
  const correction = Object.values(parts).reduce((s, x) => s + x, 0);
  const margin = baseMargin + correction;
  // See TOTAL_ADJ: overtime and a low pace intercept, both of which cancel
  // out of the margin and accumulate in the total.
  const total = baseA + baseB + TOTAL_ADJ;

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
 * The score range the page draws, and the one it means.
 *
 * σ is constant in the MARGIN, so the win probability never moves with pace.
 * The spread in either team's SCORE does move with it — as √pace — which is
 * the "fast games are wider, but not more upset-prone" result made visible:
 * the range opens up while the probability holds still.
 *
 * `z` is in standard deviations. 1.0 covers about two games in three, which
 * is what the page labels it.
 */
export function scoreBand(p: Projection, leagueTempo: number, z = 1): {
  a: [number, number]; b: [number, number]; total: [number, number]; half: number;
} {
  const scale = Math.pow(p.pace / leagueTempo, SCORE_PACE_EXP);
  const half = z * SCORE_SIGMA * scale;
  const halfTotal = z * TOTAL_SIGMA * scale;
  return {
    a: [p.scoreA - half, p.scoreA + half],
    b: [p.scoreB - half, p.scoreB + half],
    total: [p.total - halfTotal, p.total + halfTotal],
    half,
  };
}

/**
 * What ruling this player out is worth RIGHT NOW, in points of margin.
 *
 * Marginal, not absolute: because the cost curve is convex, the fourth man
 * ruled out costs more than the first did. So it depends on who is already
 * out, which is why `out` is a parameter rather than assumed empty.
 */
export function playerCost(team: MatchupTeam, i: number, out: readonly number[] = []): number {
  if (out.includes(i)) return 0;
  const before = absenceLoss(team, out);
  const after = absenceLoss(team, [...out, i]);
  return CORR.absence * (after - before) + (i === team.best ? CORR.missTop : 0);
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

/** Whether a higher value of the dimension is good for the offense. */
export const STYLE_HIGHER_BETTER: Record<StyleKey, boolean> = {
  efg: true, orb: true, tov: false, ftr: true, t3r: true, t3p: true,
};

/** Which style dimensions carry a coefficient in the model. */
export const STYLE_IN_MODEL: ReadonlySet<StyleKey> = new Set<StyleKey>(["orb", "tov", "t3r", "t3p"]);

/**
 * The two scores as the headline prints them.
 *
 * Rounding each independently could show 70-70 under a line that reads
 * "by 0.8", which is the page contradicting itself in the space of two
 * elements. When the rounded pair ties and the margin does not, the favorite
 * takes the extra point: the projection is a point estimate either way, and
 * a headline that disagrees with its own margin is the worse error.
 */
export function displayScores(scoreA: number, scoreB: number): [number, number] {
  let a = Math.round(scoreA), b = Math.round(scoreB);
  const m = scoreA - scoreB;
  if (a === b && Math.abs(m) >= 0.05) {
    if (m > 0) a += 1; else b += 1;
  }
  return [a, b];
}

/**
 * The share of a team's rotation minutes that is missing.
 *
 * Used to tell the reader when the projection has left the evidence behind.
 * The absence coefficient is fitted at 20.2 with a standard error near 6 — and
 * near 10 once the fit is restricted to players who genuinely returned rather
 * than left the program. Anywhere from half to double the printed effect is
 * consistent with the data once a rotation is gutted, and fewer than 1% of the
 * games in the sample were missing that much. The number is still the best
 * estimate available; it is not a confident one, and the page says so.
 */
export function outShare(team: MatchupTeam, out: readonly number[]): number {
  if (!out.length || !team.r.length) return 0;
  let tot = 0, miss = 0;
  team.r.forEach((p, i) => { tot += p[1]; if (out.includes(i)) miss += p[1]; });
  return tot > 0 ? Math.min(1, miss / tot) : 0;
}

/** Above this share of the rotation, the absence term is extrapolating. */
export const OUT_SHARE_WARN = 0.25;

/** Player ids ruled out, as indexes into `team.r`. Unknown ids are dropped. */
export function outIndexes(team: MatchupTeam, ids: readonly string[]): number[] {
  if (!ids.length) return [];
  const at = new Map(team.r.map((p, i) => [p[4], i]));
  return [...new Set(ids.map((id) => at.get(id)).filter((i): i is number => i != null))].sort((x, y) => x - y);
}

export const fmtPct = (p: number): string => `${Math.round(p * 100)}%`;
export const fmt1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
export const fmtSigned = (x: number, digits = 1): string => {
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : x < 0 ? `−${v.slice(1)}` : v;
};
