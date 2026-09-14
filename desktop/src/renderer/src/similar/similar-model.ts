/**
 * Find Similar: the team-seasons or player-seasons whose numbers look most like
 * one chosen one, across every season.
 *
 * STANDARDIZED WITHIN EACH SEASON. A number is compared as where it stood in
 * its own season (how many standard deviations from that season's mean), never
 * as itself: a 2014 three-point rate and a 2026 one describe different sports,
 * and a raw comparison would match every modern team to every other modern team.
 *
 * A PROFILE IS A SET OF STATS AND WEIGHTS, chosen by the reader (overall, style,
 * offense, defense). The distance is the weighted mean of squared differences
 * over the stats both sides have, so each profile's scale is the same.
 *
 * A MISSING NUMBER IS LEFT OUT, NOT GUESSED. Adjusted ratings are withheld in
 * five seasons and shot locations begin in some years only; a candidate is
 * compared on what it has, and only when that covers most of the profile's
 * weight, so a match is never made of two numbers.
 *
 * THREE GUARDS, each measured by scripts/tune-similar.mts, which deals every
 * season's games into two halves and asks how often a half finds its own other
 * half:
 *
 *   A RATE ON FEW ATTEMPTS IS EASED toward its season's average, by as much as
 *   its attempts are few. How many attempts a rate needs before it is believed
 *   is read from the season itself: the spread its rates show beyond what chance
 *   alone would put there.
 *
 *   AN EXTREME NUMBER IS CAPPED SOFTLY, at three standard deviations
 *   (3·tanh(z/3)), so one outlier cannot decide a match on its own; order is kept.
 *
 *   STATS THAT SAY THE SAME THING SHARE THEIR WEIGHT (sharedWeights), so a
 *   profile that names adjusted offense and the shooting under it does not count
 *   the shooting twice.
 *
 * THE SCORE: 100 × e^(−d²). Two identical profiles score 100; two unrelated
 * team-seasons or player-seasons score about 24 at the median (measured over
 * 20,000 random pairs by scripts/tune-similar.mts). Not the 13 that independent
 * stats would give: a profile's stats move together, and the soft cap draws the
 * farthest numbers in.
 */

export type Feature<R> = {
  key: string;
  label: string;
  get: (r: R) => number | null;
  weight: number;
  /** Printed as a percentage (stored as a share). */
  pct?: boolean;
  digits: number;
  /** How a difference reads: "faster" / "slower", "more threes" / "fewer threes". */
  more: string;
  less: string;
  /**
   * The attempts a rate stands on (three-point attempts under 3P%), for a rate a
   * small sample makes noisy. Such a rate is compared after it is eased toward its
   * season's average by as much as its attempts are few.
   */
  n?: (r: R) => number | null;
};

export type Profile<R> = { key: string; label: string; desc: string; features: Feature<R>[] };

export type Candidate<R> = { id: string; year: number; row: R };

export type Part<R> = { f: Feature<R>; subject: number; match: number; zs: number; zm: number };

export type Match<R> = { c: Candidate<R>; score: number; d2: number; parts: Part<R>[]; coverage: number };

export type Scale = {
  mean: number;
  sd: number;
  /** A rate with attempts: its season's average, and how many attempts weigh as much as that average (k). */
  prior?: { mu: number; k: number };
};

/** Per season and stat, keyed `${year}|${key}`. */
export type Scales = Map<string, Scale>;

/** Where a standardized number is capped, softly: z becomes CAP·tanh(z/CAP). */
export const Z_CAP = 3;

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** A rate eased toward its season's average: (n·x + k·μ) / (n + k). */
function eased(v: number, n: number | null, prior: Scale["prior"]): number {
  if (!prior || !finite(n) || n < 0) return v;
  return (n * v + prior.k * prior.mu) / (n + prior.k);
}

/**
 * A season's prior for one rate: the attempt-weighted average, and k, the attempts
 * it takes for a player's own rate to count as much as that average.
 *
 * METHOD OF MOMENTS. The attempt-weighted spread of the season's rates is the
 * true spread plus what chance adds (a binomial rate on n attempts varies by
 * μ(1−μ)/n), so the true spread is what is left, and k = μ(1−μ) / true spread.
 * A rate kept as a percentage rather than a share is read at its own scale.
 *
 * NEVER TO NOTHING: k stops at EASE times the season's average attempts, so a
 * player with an ordinary number of attempts keeps most of his own rate.
 */
function priorOf(xs: { v: number; n: number }[], ease: number): Scale["prior"] {
  if (xs.length < 20) return undefined;
  let sn = 0;
  let snv = 0;
  for (const { v, n } of xs) {
    sn += n;
    snv += n * v;
  }
  if (sn <= 0) return undefined;
  const mu = snv / sn;
  let spread = 0;
  for (const { v, n } of xs) spread += n * (v - mu) ** 2;
  spread /= sn;
  const unit = Math.abs(mu) > 1 ? 100 : 1;
  const share = Math.min(0.999, Math.max(0.001, mu / unit));
  const bern = unit * unit * share * (1 - share);
  const truth = spread - (xs.length * bern) / sn;
  const meanN = sn / xs.length;
  const k = truth > 1e-12 ? bern / truth : ease * meanN;
  return { mu, k: Math.min(k, ease * meanN) };
}

/**
 * How hard a rate on few attempts is eased: the most k can be, as a multiple of
 * the season's average attempts. 0 turns easing off. Chosen by measurement
 * (scripts/tune-similar.mts): stronger easing predicts a player's other games
 * better, and past a point makes his matches less repeatable.
 */
export const EASE = 1;

/** Each feature's mean and spread within each season, over every candidate that has it, after easing its rates. */
export function seasonScales<R>(pool: readonly Candidate<R>[], features: readonly Feature<R>[], { ease = EASE }: { ease?: number } = {}): Scales {
  const priors = new Map<string, NonNullable<Scale["prior"]>>();
  if (ease > 0) {
    const rates = new Map<string, { v: number; n: number }[]>();
    for (const c of pool) {
      for (const f of features) {
        if (!f.n) continue;
        const v = f.get(c.row);
        const n = f.n(c.row);
        if (!finite(v) || !finite(n) || n <= 0) continue;
        const k = `${c.year}|${f.key}`;
        (rates.get(k) ?? rates.set(k, []).get(k)!).push({ v, n });
      }
    }
    for (const [k, xs] of rates) {
      const p = priorOf(xs, ease);
      if (p) priors.set(k, p);
    }
  }

  const acc = new Map<string, { n: number; sum: number; sq: number }>();
  for (const c of pool) {
    for (const f of features) {
      const v = f.get(c.row);
      if (!finite(v)) continue;
      const k = `${c.year}|${f.key}`;
      const prior = priors.get(k);
      const x = prior && f.n ? eased(v, f.n(c.row), prior) : v;
      const a = acc.get(k) ?? { n: 0, sum: 0, sq: 0 };
      a.n += 1;
      a.sum += x;
      a.sq += x * x;
      acc.set(k, a);
    }
  }
  const out: Scales = new Map();
  for (const [k, a] of acc) {
    if (a.n < 20) continue;
    const mean = a.sum / a.n;
    const sd = Math.sqrt(Math.max(0, a.sq / a.n - mean * mean));
    if (sd > 1e-9) out.set(k, { mean, sd, prior: priors.get(k) });
  }
  return out;
}

/** One number as the distance reads it: eased if it is a rate on attempts, standardized in its season, capped softly. */
export function standardize<R>(scales: Scales, c: Candidate<R>, f: Feature<R>, cap: number | null = Z_CAP): { v: number; z: number } | null {
  const v = f.get(c.row);
  if (!finite(v)) return null;
  const s = scales.get(`${c.year}|${f.key}`);
  if (!s) return null;
  const x = s.prior && f.n ? eased(v, f.n(c.row), s.prior) : v;
  const z = (x - s.mean) / s.sd;
  return { v, z: cap ? cap * Math.tanh(z / cap) : z };
}

/** How much of a profile's weight a candidate must share with the subject to be a match at all. */
const MIN_COVERAGE = 0.6;

export function findSimilar<R>(
  subject: Candidate<R>,
  pool: readonly Candidate<R>[],
  profile: Profile<R>,
  scales: Scales,
  { limit = 50, keep, cap = Z_CAP }: { limit?: number; keep?: (c: Candidate<R>) => boolean; cap?: number | null } = {},
): Match<R>[] {
  const total = profile.features.reduce((s, f) => s + f.weight, 0);
  const mine = profile.features.map((f) => standardize(scales, subject, f, cap));
  const found: Match<R>[] = [];
  for (const c of pool) {
    if (c.id === subject.id || (keep && !keep(c))) continue;
    let w = 0;
    let sum = 0;
    const parts: Part<R>[] = [];
    profile.features.forEach((f, i) => {
      const s = mine[i];
      if (!s) return;
      const m = standardize(scales, c, f, cap);
      if (!m) return;
      const d = s.z - m.z;
      w += f.weight;
      sum += f.weight * d * d;
      parts.push({ f, subject: s.v, match: m.v, zs: s.z, zm: m.z });
    });
    if (w < total * MIN_COVERAGE) continue;
    const d2 = sum / w;
    found.push({ c, d2, score: 100 * Math.exp(-d2), parts, coverage: w / total });
  }
  found.sort((a, b) => a.d2 - b.d2);
  return found.slice(0, limit);
}

/**
 * How much each pair of a profile's stats say the same thing: the squared
 * correlation of their standardized numbers over the whole pool (1 on the
 * diagonal), from every candidate that has both.
 */
export function correlations<R>(profile: Profile<R>, pool: readonly Candidate<R>[], scales: Scales, cap: number | null = Z_CAP): number[][] {
  const k = profile.features.length;
  const cols = profile.features.map(() => new Float64Array(pool.length).fill(Number.NaN));
  pool.forEach((c, i) => {
    profile.features.forEach((f, j) => {
      const z = standardize(scales, c, f, cap);
      if (z) cols[j]![i] = z.z;
    });
  });
  const r2 = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a++) {
    r2[a]![a] = 1;
    for (let b = a + 1; b < k; b++) {
      const x = cols[a]!;
      const y = cols[b]!;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let i = 0; i < x.length; i++) {
        const u = x[i]!;
        const v = y[i]!;
        if (Number.isNaN(u) || Number.isNaN(v)) continue;
        n++;
        sx += u;
        sy += v;
        sxx += u * u;
        syy += v * v;
        sxy += u * v;
      }
      if (n < 30) continue;
      const cov = sxy / n - (sx / n) * (sy / n);
      const vx = sxx / n - (sx / n) ** 2;
      const vy = syy / n - (sy / n) ** 2;
      const r = vx > 1e-12 && vy > 1e-12 ? (cov * cov) / (vx * vy) : 0;
      r2[a]![b] = r;
      r2[b]![a] = r;
    }
  }
  return r2;
}

/**
 * Weights shared among stats that say the same thing: w′ = w² / Σ w_j·r², summed
 * over the profile's stats with r² from correlations() (itself included, at 1).
 * A stat nothing else echoes keeps its weight; two that move together split theirs.
 */
export function shareWeights<R>(profile: Profile<R>, r2: number[][]): Profile<R> {
  const features = profile.features.map((f, a) => {
    const echo = profile.features.reduce((s, g, b) => s + g.weight * (r2[a]?.[b] ?? (a === b ? 1 : 0)), 0);
    return { ...f, weight: echo > 0 ? (f.weight * f.weight) / echo : f.weight };
  });
  return { ...profile, features };
}

/**
 * A profile whose stats share their weight with the stats that say the same
 * thing, measured over the pool. Adjusted offense is made of the shooting,
 * turnovers and offensive rebounds listed beside it; this is what keeps a profile
 * naming all four from counting the shooting twice. The breakdown reads these
 * weights, so its points still add up.
 */
export function sharedWeights<R>(profile: Profile<R>, pool: readonly Candidate<R>[], scales: Scales, cap: number | null = Z_CAP): Profile<R> {
  return shareWeights(profile, correlations(profile, pool, scales, cap));
}

/** One stat's cost to a score: how far apart the two stood, and the points that took off. */
export type Loss<R> = { part: Part<R>; gap: number; lost: number };

export type Breakdown<R> = {
  /** Largest first; they add up to exactly 100 − score. */
  losses: Loss<R>[];
  /** Stats in the profile that one side has no number for, so they were left out. */
  missing: Feature<R>[];
  coverage: number;
};

/**
 * Where a score's points went. A score starts at 100 and only loses points, so a
 * stat never adds to it. d² is a weighted mean of each stat's squared gap, and
 * each stat takes its share of d² as its share of the points lost: the losses
 * add up to exactly 100 − score, and a stat that stood twice as far apart (at the
 * same weight) costs four times the points.
 */
export function scoreBreakdown<R>(m: Match<R>, profile: Profile<R>): Breakdown<R> {
  const cost = (p: Part<R>) => p.f.weight * (p.zs - p.zm) ** 2;
  const sum = m.parts.reduce((s, p) => s + cost(p), 0);
  const loss = 100 - m.score;
  const losses = m.parts
    .map((part) => ({ part, gap: Math.abs(part.zs - part.zm), lost: sum > 0 ? (loss * cost(part)) / sum : 0 }))
    .sort((a, b) => b.lost - a.lost);
  const have = new Set(m.parts.map((p) => p.f.key));
  return { losses, missing: profile.features.filter((f) => !have.has(f.key)), coverage: m.coverage };
}

/**
 * The losses as whole points that add up to what the table prints: 100 minus the
 * rounded score. Largest remainder, so no stat is rounded into a total that
 * disagrees with the score beside it.
 */
export function wholePoints(losses: readonly { lost: number }[], score: number): number[] {
  const total = 100 - Math.round(score);
  const floors = losses.map((l) => Math.floor(l.lost));
  let left = total - floors.reduce((s, v) => s + v, 0);
  const order = losses.map((l, i) => ({ i, r: l.lost - Math.floor(l.lost) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/** The stats a match is most alike on, and the one it is furthest apart on, in words. */
export function alikeAndApart<R>(m: Match<R>): { alike: string[]; apart: { label: string; word: string } | null } {
  const byGap = [...m.parts].sort((a, b) => Math.abs(a.zs - a.zm) - Math.abs(b.zs - b.zm));
  const far = byGap[byGap.length - 1];
  return {
    alike: byGap.slice(0, 3).map((p) => p.f.label),
    // In the match's words: a match that plays faster than the subject is "faster".
    apart: far && Math.abs(far.zs - far.zm) >= 0.5 ? { label: far.f.label, word: far.zm > far.zs ? far.f.more : far.f.less } : null,
  };
}

/** A value as the tables print it. */
export const printFeature = <R>(f: Feature<R>, v: number | null): string =>
  v == null ? "–" : f.pct ? (v * 100).toFixed(f.digits) : v.toFixed(f.digits);
