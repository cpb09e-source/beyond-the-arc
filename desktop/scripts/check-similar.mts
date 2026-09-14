/**
 * Checks Find Similar's score and its breakdown on made-up seasons: the stat-by-stat
 * losses add up to exactly 100 − score, the whole points add up to what the table
 * prints, a stat one side lacks is listed as left out, and an identical profile
 * loses nothing.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/check-similar.mts
 */
import { findSimilar, scoreBreakdown, seasonScales, wholePoints, type Candidate, type Profile } from "../src/renderer/src/similar/similar-model";

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

check("the check compared a real number of matches", matchesChecked > 1000, String(matchesChecked));
console.log(failures === 0 ? `ALL SIMILAR CHECKS PASSED (${matchesChecked.toLocaleString()} matches)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
