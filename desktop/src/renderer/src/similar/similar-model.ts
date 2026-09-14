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
 * THE SCORE: 100 × e^(−d²). Two identical profiles score 100; a random pair of
 * teams scores about 13, because two independent standardized numbers differ by
 * √2 on average.
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
};

export type Profile<R> = { key: string; label: string; desc: string; features: Feature<R>[] };

export type Candidate<R> = { id: string; year: number; row: R };

export type Part<R> = { f: Feature<R>; subject: number; match: number; zs: number; zm: number };

export type Match<R> = { c: Candidate<R>; score: number; d2: number; parts: Part<R>[]; coverage: number };

type Scale = { mean: number; sd: number };

/** Each feature's mean and spread within each season, over every candidate that has it. */
export function seasonScales<R>(pool: readonly Candidate<R>[], features: readonly Feature<R>[]): Map<string, Scale> {
  const acc = new Map<string, { n: number; sum: number; sq: number }>();
  for (const c of pool) {
    for (const f of features) {
      const v = f.get(c.row);
      if (v == null || !Number.isFinite(v)) continue;
      const k = `${c.year}|${f.key}`;
      const a = acc.get(k) ?? { n: 0, sum: 0, sq: 0 };
      a.n += 1;
      a.sum += v;
      a.sq += v * v;
      acc.set(k, a);
    }
  }
  const out = new Map<string, Scale>();
  for (const [k, a] of acc) {
    if (a.n < 20) continue;
    const mean = a.sum / a.n;
    const sd = Math.sqrt(Math.max(0, a.sq / a.n - mean * mean));
    if (sd > 1e-9) out.set(k, { mean, sd });
  }
  return out;
}

function zOf<R>(scales: Map<string, Scale>, c: Candidate<R>, f: Feature<R>): { v: number; z: number } | null {
  const v = f.get(c.row);
  if (v == null || !Number.isFinite(v)) return null;
  const s = scales.get(`${c.year}|${f.key}`);
  return s ? { v, z: (v - s.mean) / s.sd } : null;
}

/** How much of a profile's weight a candidate must share with the subject to be a match at all. */
const MIN_COVERAGE = 0.6;

export function findSimilar<R>(
  subject: Candidate<R>,
  pool: readonly Candidate<R>[],
  profile: Profile<R>,
  scales: Map<string, Scale>,
  { limit = 50, keep }: { limit?: number; keep?: (c: Candidate<R>) => boolean } = {},
): Match<R>[] {
  const total = profile.features.reduce((s, f) => s + f.weight, 0);
  const mine = profile.features.map((f) => zOf(scales, subject, f));
  const found: Match<R>[] = [];
  for (const c of pool) {
    if (c.id === subject.id || (keep && !keep(c))) continue;
    let w = 0;
    let sum = 0;
    const parts: Part<R>[] = [];
    profile.features.forEach((f, i) => {
      const s = mine[i];
      if (!s) return;
      const m = zOf(scales, c, f);
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
