/**
 * Checks Find Similar's score and its breakdown on made-up seasons: the stat-by-stat
 * losses add up to exactly 100 − score, the whole points add up to what the table
 * prints, a stat one side lacks is listed as left out, and an identical profile
 * loses nothing.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/check-similar.mts
 */
import {
  findSimilar,
  scoreBreakdown,
  seasonScales,
  sharedWeights,
  standardize,
  wholePoints,
  Z_CAP,
  type Candidate,
  type Feature,
  type Profile,
} from "../src/renderer/src/similar/similar-model";

type Row = { a: number | null; b: number | null; c: number | null; d: number | null };

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// A seeded generator, so a failure reproduces.
let seed = 20260914;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());

const pool: Candidate<Row>[] = [];
for (const year of [2019, 2020, 2021]) {
  for (let i = 0; i < 60; i++) {
    pool.push({
      id: `${year}-${i}`,
      year,
      row: {
        a: 100 + 10 * normal(),
        b: 0.35 + 0.05 * normal(),
        // Some candidates lack c, as withheld ratings do.
        c: i % 9 === 0 ? null : 60 + 8 * normal(),
        d: 5 * normal(),
      },
    });
  }
}
// An exact twin of the first team, in another season with the same scale: loses nothing.
const twinOf = pool[0]!;

const profile: Profile<Row> = {
  key: "test",
  label: "Test",
  desc: "",
  features: [
    { key: "a", label: "A", get: (r) => r.a, weight: 2, digits: 1, more: "more", less: "less" },
    { key: "b", label: "B", get: (r) => r.b, weight: 1, pct: true, digits: 1, more: "more", less: "less" },
    { key: "c", label: "C", get: (r) => r.c, weight: 1.5, digits: 1, more: "more", less: "less" },
    { key: "d", label: "D", get: (r) => r.d, weight: 0.5, digits: 1, more: "more", less: "less" },
  ],
};

const scales = seasonScales(pool, profile.features);
let matchesChecked = 0;
for (const subject of pool.slice(0, 40)) {
  for (const m of findSimilar(subject, pool, profile, scales, { limit: 60 })) {
    matchesChecked++;
    const b = scoreBreakdown(m, profile);
    const sum = b.losses.reduce((s, l) => s + l.lost, 0);
    check("losses add up to 100 − score", Math.abs(sum - (100 - m.score)) < 1e-9, `${sum} vs ${100 - m.score}`);
    check("no loss is negative", b.losses.every((l) => l.lost >= 0));
    check("losses are largest first", b.losses.every((l, i) => i === 0 || b.losses[i - 1]!.lost >= l.lost));
    check("every compared stat is listed once", b.losses.length === m.parts.length);
    check("compared and left out cover the profile", b.losses.length + b.missing.length === profile.features.length);
    const whole = wholePoints(b.losses, m.score);
    check("whole points add up to the printed score", whole.reduce((s, v) => s + v, 0) === 100 - Math.round(m.score), `${whole} for ${m.score}`);
    check("whole points stay within a point of the exact loss", whole.every((w, i) => Math.abs(w - b.losses[i]!.lost) < 1));
    check("every compared number is inside the soft cap", m.parts.every((p) => Math.abs(p.zs) < Z_CAP && Math.abs(p.zm) < Z_CAP));
    const lacksC = subject.row.c == null || m.c.row.c == null;
    check("a stat one side lacks is left out", lacksC === b.missing.some((f) => f.key === "c"));
    // Same weight, twice the gap: four times the points.
    const [x, y] = b.losses;
    if (x && y && x.part.f.weight === y.part.f.weight && y.gap > 0) {
      check("points follow the squared gap", Math.abs(x.lost / y.lost - (x.gap / y.gap) ** 2) < 1e-6);
    }
  }
}

// An identical profile in a season with the same scale scores 100 and loses nothing.
const twin: Candidate<Row> = { id: "twin", year: twinOf.year, row: { ...twinOf.row } };
const [top] = findSimilar(twinOf, [...pool, twin], profile, seasonScales([...pool, twin], profile.features), { limit: 1 });
check("the identical twin is the top match", top?.c.id === "twin", top?.c.id);
if (top) {
  check("the identical twin scores 100", Math.abs(top.score - 100) < 1e-9, String(top.score));
  check("the identical twin loses nothing", scoreBreakdown(top, profile).losses.every((l) => l.lost < 1e-9));
  check("its whole points are all zero", wholePoints(scoreBreakdown(top, profile).losses, top.score).every((v) => v === 0));
}

// The soft cap keeps order: a bigger number never standardizes smaller.
{
  const far: Candidate<Row> = { id: "far", year: 2019, row: { a: 200, b: 0.35, c: 60, d: 0 } };
  const farther: Candidate<Row> = { id: "farther", year: 2019, row: { a: 260, b: 0.35, c: 60, d: 0 } };
  const zf = standardize(scales, far, profile.features[0]!)!.z;
  const zff = standardize(scales, farther, profile.features[0]!)!.z;
  check("the soft cap keeps order", zff > zf && zff < Z_CAP, `${zf} then ${zff}`);
  check("the cap can be switched off", standardize(scales, far, profile.features[0]!, null)!.z > Z_CAP);
}

// Easing: the same extreme rate on few attempts stands nearer its season's average than on many.
{
  type Rate = { v: number; n: number };
  const rates: Candidate<Rate>[] = [];
  for (let i = 0; i < 300; i++) {
    const n = 20 + Math.floor(rand() * 300);
    const truth = 0.35 + 0.03 * normal();
    let made = 0;
    for (let k = 0; k < n; k++) if (rand() < truth) made++;
    rates.push({ id: `r${i}`, year: 2020, row: { v: made / n, n } });
  }
  const rate: Feature<Rate> = { key: "v", label: "V", get: (r) => r.v, n: (r) => r.n, weight: 1, digits: 1, more: "more", less: "less" };
  const few: Candidate<Rate> = { id: "few", year: 2020, row: { v: 0.6, n: 10 } };
  const many: Candidate<Rate> = { id: "many", year: 2020, row: { v: 0.6, n: 400 } };
  const eased = seasonScales(rates, [rate]);
  const zFew = standardize(eased, few, rate, null)!.z;
  const zMany = standardize(eased, many, rate, null)!.z;
  check("a rate on few attempts is eased more than on many", zFew > 0 && zFew < zMany, `${zFew} vs ${zMany}`);
  check("a season's prior was fitted", (eased.get("2020|v")?.prior?.k ?? 0) > 0, JSON.stringify(eased.get("2020|v")));
  const plain = seasonScales(rates, [rate], { ease: 0 });
  check("easing can be switched off", Math.abs(standardize(plain, few, rate, null)!.z - standardize(plain, many, rate, null)!.z) < 1e-12);
}

// Sharing: a stat listed twice splits its weight; a stat nothing echoes keeps its own.
{
  const a = profile.features[0]!;
  const d = profile.features[3]!;
  const dup: Profile<Row> = { ...profile, features: [a, { ...a, key: "a2", label: "A again" }, d] };
  const shared = sharedWeights(dup, pool, seasonScales(pool, dup.features));
  const [wa, wa2, wd] = shared.features.map((f) => f.weight);
  check("a stat listed twice splits its weight", Math.abs(wa! - a.weight / 2) < 0.05 && Math.abs(wa2! - a.weight / 2) < 0.05, `${wa}, ${wa2}`);
  check("a stat nothing echoes keeps its weight", Math.abs(wd! - d.weight) < 0.05, String(wd));
  const sharedProfile = sharedWeights(profile, pool, scales);
  const m = findSimilar(pool[1]!, pool, sharedProfile, scales, { limit: 5 });
  check("shared weights still break down exactly", m.every((x) => Math.abs(scoreBreakdown(x, sharedProfile).losses.reduce((s, l) => s + l.lost, 0) - (100 - x.score)) < 1e-9));
}

check("the check compared a real number of matches", matchesChecked > 1000, String(matchesChecked));
console.log(failures === 0 ? `ALL SIMILAR CHECKS PASSED (${matchesChecked.toLocaleString()} matches)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
