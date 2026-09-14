/**
 * Measures Find Similar on real seasons, and searches its weights.
 *
 * SPLIT HALVES. Every team's regular-season games, and every rotation player's
 * games, are dealt into two halves, odd and even, and each half becomes a profile
 * built from its own box scores the way a season's numbers are. Three questions:
 *
 *   TWIN    does a half find its own other half among every other half that
 *           season? (first, top 5, mean reciprocal rank) The more a profile is
 *           signal rather than noise, the higher its twin ranks.
 *   STABLE  do the two halves find the same ten closest matches? A match list
 *           built on noise changes from one half to the other.
 *   EASED   for a rate on attempts, does one half's rate, eased toward the
 *           season's average, predict the other half's rate better than the raw
 *           rate does? That is the whole claim of easing.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/tune-similar.mts            measure
 *   npx tsx --tsconfig tsconfig.json scripts/tune-similar.mts --tune     also search the weights
 *
 * WHAT A HALF CANNOT HAVE is left out of it, not faked: shot locations (rim
 * rate) and EPM are season files, and height never changes within a season, so
 * it would find its twin for free. The adjusted ratings of a half are its points
 * per possession scaled by each opponent's BTA rating against the league's.
 *
 * TUNING searches a multiplier per stat (0.5× to 2× the profile's own weight),
 * under the variant that measured best, on the even seasons, and reports the odd
 * seasons, which it never saw.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { F } from "@/lib/game-index";
import { impactFromFiles, passesLeaderboardFloor, processPlayerSeason, type ExplorerPayload } from "@/lib/player-cohort";
import { DEFAULT_PLAYER_SPEC, type PlayerSummary } from "@/lib/players";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { POST, T, TOURNEY } from "@/lib/team-game-index";
import type { Player } from "~/data/player-model";
import { shapeSeason, type Team } from "~/data/team-model";
import { correlations, seasonScales, shareWeights, standardize, Z_CAP, type Candidate, type Feature, type Profile } from "~/similar/similar-model";
import { PLAYER_FEATURES, PLAYER_PROFILES, TEAM_FEATURES, TEAM_PROFILES } from "~/similar/similar-profiles";

const DATA = resolve(import.meta.dirname, "../../public/data");
const read = <J,>(rel: string): J => JSON.parse(readFileSync(`${DATA}/${rel}`, "utf8")) as J;
const optional = <J,>(rel: string): J | null => (existsSync(`${DATA}/${rel}`) ? read<J>(rel) : null);
const TUNE = process.argv.includes("--tune");
const YEARS = Array.from({ length: 13 }, (_, i) => 2014 + i).filter((y) =>
  ["team-game-index", "game-index", "teams-by-year"].every((d) => existsSync(`${DATA}/${d}/${y}.json`)),
);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const HALF = ["A", "B"] as const;
const deal = <X,>(xs: X[]): [X[], X[]] => [xs.filter((_, i) => i % 2 === 0), xs.filter((_, i) => i % 2 === 1)];

// ── Team halves ─────────────────────────────────────────────────────────────

type TeamPack = { teams: { names: string[] }; opps: string[]; rows: number[][] };
const teamSeasons = new Map<number, Team[]>();

function teamHalves(year: number): Candidate<Team>[] {
  const pack = read<TeamPack>(`team-game-index/${year}.json`);
  const season = shapeSeason(year, read<StaticTeamSeasonRow[]>(`teams-by-year/${year}.json`));
  teamSeasons.set(year, season.teams);
  const rating = new Map(season.teams.map((t) => [t.name, { o: t.explorer?.bta_ortg ?? null, d: t.explorer?.bta_drtg ?? null }]));
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null);
    return v.reduce((s, x) => s + x, 0) / v.length;
  };
  const lgO = avg([...rating.values()].map((r) => r.o));
  const lgD = avg([...rating.values()].map((r) => r.d));
  const index = new Map(pack.teams.names.map((n, i) => [n, i]));
  const on = new Map<string, number[]>();
  for (const r of pack.rows) on.set(`${r[T.t]}|${r[T.d]}`, r);

  const half = (rows: number[][]): Record<string, number | null> => {
    const s = { pts: 0, poss: 0, pace: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, ast: 0, stl: 0, tov: 0, adjPts: 0, adjPa: 0 };
    const o = { fgm: 0, fga: 0, fg3m: 0, fg3a: 0, oreb: 0, dreb: 0, tov: 0, poss: 0, ownOreb: 0, ownDreb: 0, blk: 0 };
    for (const r of rows) {
      s.pts += r[T.pts]!;
      s.poss += r[T.poss]!;
      s.pace += r[T.pace]! / 10;
      s.fgm += r[T.fgm]!;
      s.fga += r[T.fga]!;
      s.fg3m += r[T.fg3m]!;
      s.fg3a += r[T.fg3a]!;
      s.ftm += r[T.ftm]!;
      s.fta += r[T.fta]!;
      s.ast += r[T.ast]!;
      s.stl += r[T.stl]!;
      s.tov += r[T.tov]!;
      const opp = pack.opps[r[T.o]!]!;
      const rt = rating.get(opp);
      s.adjPts += r[T.pts]! * (lgD / (rt?.d ?? lgD));
      s.adjPa += r[T.pa]! * (lgO / (rt?.o ?? lgO));
      const x = on.get(`${index.get(opp) ?? -1}|${r[T.d]}`);
      if (!x) continue;
      o.fgm += x[T.fgm]!;
      o.fga += x[T.fga]!;
      o.fg3m += x[T.fg3m]!;
      o.fg3a += x[T.fg3a]!;
      o.oreb += x[T.oreb]!;
      o.dreb += x[T.reb]! - x[T.oreb]!;
      o.tov += x[T.tov]!;
      o.poss += r[T.poss]!;
      o.ownOreb += r[T.oreb]!;
      o.ownDreb += r[T.reb]! - r[T.oreb]!;
      o.blk += r[T.blk]!;
    }
    return {
      a_ortg: ratio(100 * s.adjPts, s.poss),
      a_drtg: ratio(100 * s.adjPa, s.poss),
      adjt: s.pace / rows.length,
      cbb_efg: ratio(s.fgm + 0.5 * s.fg3m, s.fga),
      cbb_tov: ratio(s.tov, s.poss),
      cbb_orb: ratio(o.ownOreb, o.ownOreb + o.dreb),
      cbb_ftarate: ratio(s.fta, s.fga),
      cbb_fg3rate: ratio(s.fg3a, s.fga),
      cbb_ft: ratio(s.ftm, s.fta),
      cbb_ast: ratio(s.ast, s.fgm),
      cbb_rim_rate: null,
      eff_height: null,
      cbb_efg_def: ratio(o.fgm + 0.5 * o.fg3m, o.fga),
      cbb_tov_def: ratio(o.tov, o.poss),
      cbb_orb_def: ratio(o.oreb, o.oreb + o.ownDreb),
      cbb_fg3_def: ratio(o.fg3m, o.fg3a),
      cbb_blk_pct: ratio(o.blk, o.fga - o.fg3a),
      cbb_stl_pct: ratio(s.stl, s.poss),
    };
  };

  const byTeam = new Map<string, number[][]>();
  for (const r of pack.rows) {
    if (r[T.f]! & (TOURNEY | POST)) continue;
    const name = pack.teams.names[r[T.t]!]!;
    (byTeam.get(name) ?? byTeam.set(name, []).get(name)!).push(r);
  }
  const out: Candidate<Team>[] = [];
  for (const [name, rows] of byTeam) {
    if (!rating.has(name)) continue;
    rows.sort((a, b) => a[T.d]! - b[T.d]!);
    const halves = deal(rows);
    if (halves.some((h) => h.length < 8)) continue;
    halves.forEach((h, k) => out.push({ id: `${year}|${name}|${HALF[k]}`, year, row: { explorer: half(h) } as unknown as Team }));
  }
  return out;
}

// ── Player halves, and whole player seasons ────────────────────────────────

function playerHalves(year: number): Candidate<Player>[] {
  const pack = read<{ rows: number[][] }>(`game-index/${year}.json`);
  const half = (rows: number[][]): Partial<PlayerSummary> => {
    const t = { min: 0, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, orb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, usg: 0 };
    for (const r of rows) {
      t.min += r[F.min]!;
      t.pts += r[F.pts]!;
      t.fgm += r[F.fgm]!;
      t.fga += r[F.fga]!;
      t.fg3m += r[F.fg3m]!;
      t.fg3a += r[F.fg3a]!;
      t.ftm += r[F.ftm]!;
      t.fta += r[F.fta]!;
      t.orb += r[F.orb]!;
      t.reb += r[F.reb]!;
      t.ast += r[F.ast]!;
      t.stl += r[F.stl]!;
      t.blk += r[F.blk]!;
      t.tov += r[F.tov]!;
      // Usage is stored in tenths of a percent; weighted by minutes, as a share.
      t.usg += (r[F.usg]! / 1000) * r[F.min]!;
    }
    const g = rows.length;
    const tsa = t.fga + 0.44 * t.fta;
    return {
      games: g,
      min_pg: t.min / g,
      pts_pg: t.pts / g,
      reb_pg: t.reb / g,
      orb_pg: t.orb / g,
      ast_pg: t.ast / g,
      stl_pg: t.stl / g,
      blk_pg: t.blk / g,
      tov_pg: t.tov / g,
      ts_pct: ratio(t.pts, 2 * tsa),
      fg3_pct: ratio(t.fg3m, t.fg3a),
      ft_pct: ratio(t.ftm, t.fta),
      fta_rate: ratio(t.fta, t.fga),
      tp_rate: ratio(t.fg3a, t.fga),
      tov_pct: ratio(t.tov, tsa + t.tov),
      usage_pct: ratio(t.usg, t.min),
      fg3_att: t.fg3a,
      rim_rate: null,
      epm: null,
      height: null,
    };
  };
  const byPlayer = new Map<number, number[][]>();
  for (const r of pack.rows) {
    if (!(r[F.min]! > 0)) continue;
    (byPlayer.get(r[F.p]!) ?? byPlayer.set(r[F.p]!, []).get(r[F.p]!)!).push(r);
  }
  const out: Candidate<Player>[] = [];
  for (const [p, rows] of byPlayer) {
    // About the leaderboard's floor: a real part of the rotation for most of a season.
    if (rows.length < 16 || rows.reduce((s, r) => s + r[F.min]!, 0) / rows.length < 12) continue;
    rows.sort((a, b) => a[F.d]! - b[F.d]!);
    deal(rows).forEach((h, k) => out.push({ id: `${year}|${p}|${HALF[k]}`, year, row: { s: half(h) } as unknown as Player }));
  }
  return out;
}

/** A season's leaderboard players as the app builds them (~/data/player-model.ts), for scoring random pairs. */
function playerSeason(year: number): Candidate<Player>[] {
  const payload = optional<ExplorerPayload>(`players-explorer/${year}.json`);
  if (!payload) return [];
  const box = optional<{ players?: Record<string, unknown> }>(`box-epm-${year}.json`);
  const shooting = optional<{ players?: Record<string, unknown> }>(`shooting-${year}.json`);
  const impact = impactFromFiles(optional(`epm-${year}.json`) as never, box as never);
  const { players } = processPlayerSeason(payload, impact, (box?.players ?? {}) as never, (shooting?.players ?? {}) as never);
  return players
    .filter((s) => passesLeaderboardFloor(s, DEFAULT_PLAYER_SPEC.minGames))
    .map((s) => ({ id: `${year}|${s.id}`, year, row: { s } as unknown as Player }));
}

// ── Measuring ───────────────────────────────────────────────────────────────

type Variant = { name: string; ease: number; cap: number | null; share: boolean };
const TEAM_VARIANTS: Variant[] = [
  { name: "as it was", ease: 0, cap: null, share: false },
  { name: "+ soft cap", ease: 0, cap: Z_CAP, share: false },
  { name: "+ shared weights", ease: 0, cap: null, share: true },
  { name: "cap and shared", ease: 0, cap: Z_CAP, share: true },
];
const PLAYER_VARIANTS: Variant[] = [
  { name: "as it was", ease: 0, cap: null, share: false },
  { name: "+ soft cap", ease: 0, cap: Z_CAP, share: false },
  { name: "cap, eased ×0.25", ease: 0.25, cap: Z_CAP, share: false },
  { name: "cap, eased ×0.5", ease: 0.5, cap: Z_CAP, share: false },
  { name: "cap, eased ×1", ease: 1, cap: Z_CAP, share: false },
  { name: "cap and shared", ease: 0, cap: Z_CAP, share: true },
];

type Season = { year: number; a: Float64Array; b: Float64Array; na: number; nb: number; twin: Int32Array; bToA: Int32Array };
type Prepared = { k: number; base: number[]; r2: number[][] | null; have: number[]; seasons: Season[] };

function prepare<R>(halves: Candidate<R>[], profile: Profile<R>, v: Variant): Prepared {
  const scales = seasonScales(halves, profile.features, { ease: v.ease });
  const k = profile.features.length;
  const have = new Array<number>(k).fill(0);
  const fill = (cs: Candidate<R>[]) => {
    const m = new Float64Array(cs.length * k).fill(Number.NaN);
    cs.forEach((c, i) =>
      profile.features.forEach((f, j) => {
        const z = standardize(scales, c, f, v.cap);
        if (z) {
          m[i * k + j] = z.z;
          have[j]! += 1;
        }
      }),
    );
    return m;
  };
  const byYear = new Map<number, { a: Candidate<R>[]; b: Candidate<R>[] }>();
  for (const c of halves) {
    const s = byYear.get(c.year) ?? byYear.set(c.year, { a: [], b: [] }).get(c.year)!;
    (c.id.endsWith("|A") ? s.a : s.b).push(c);
  }
  const out = [...byYear].map(([year, { a, b }]): Season => {
    const atB = new Map(b.map((c, i) => [c.id.slice(0, -2), i]));
    const atA = new Map(a.map((c, i) => [c.id.slice(0, -2), i]));
    return {
      year,
      a: fill(a),
      b: fill(b),
      na: a.length,
      nb: b.length,
      twin: Int32Array.from(a.map((c) => atB.get(c.id.slice(0, -2)) ?? -1)),
      bToA: Int32Array.from(b.map((c) => atA.get(c.id.slice(0, -2)) ?? -1)),
    };
  });
  return { k, base: profile.features.map((f) => f.weight), r2: v.share ? correlations(profile, halves, scales, v.cap) : null, have: have.map((n) => n / halves.length), seasons: out };
}

type Score = { top1: number; top5: number; mrr: number; stable: number | null; n: number };
const NEIGHBORS = 10;

function measure(p: Prepared, mult: number[], { years = null, perSeason = Infinity, stable = false }: { years?: ReadonlySet<number> | null; perSeason?: number; stable?: boolean } = {}): Score {
  const k = p.k;
  let w = p.base.map((b, j) => b * mult[j]!);
  if (p.r2) {
    const r2 = p.r2;
    const raw = w;
    w = raw.map((wa, a) => (wa * wa) / raw.reduce((s, wb, b) => s + wb * r2[a]![b]!, 0));
  }
  const total = w.reduce((s, x) => s + x, 0);
  const dist = (m1: Float64Array, i: number, m2: Float64Array, j: number): number => {
    let sw = 0;
    let sum = 0;
    for (let f = 0; f < k; f++) {
      const x = m1[i * k + f]!;
      const y = m2[j * k + f]!;
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      const d = x - y;
      sw += w[f]!;
      sum += w[f]! * d * d;
    }
    return sw >= total * 0.6 ? sum / sw : Infinity;
  };
  const closest = (m: Float64Array, i: number, n: number): number[] => {
    const d = new Float64Array(n);
    for (let j = 0; j < n; j++) d[j] = j === i ? Infinity : dist(m, i, m, j);
    return Array.from({ length: n }, (_, j) => j)
      .sort((x, y) => d[x]! - d[y]!)
      .slice(0, NEIGHBORS)
      .filter((j) => Number.isFinite(d[j]!));
  };
  let n = 0;
  let top1 = 0;
  let top5 = 0;
  let rr = 0;
  let overlap = 0;
  for (const s of p.seasons) {
    if (years && !years.has(s.year)) continue;
    const step = Math.max(1, Math.ceil(s.na / perSeason));
    for (let i = 0; i < s.na; i += step) {
      const t = s.twin[i]!;
      if (t < 0) continue;
      const own = dist(s.a, i, s.b, t);
      if (!Number.isFinite(own)) continue;
      let rank = 1;
      for (let j = 0; j < s.nb; j++) if (j !== t && dist(s.a, i, s.b, j) < own) rank++;
      n++;
      if (rank === 1) top1++;
      if (rank <= 5) top5++;
      rr += 1 / rank;
      if (stable) {
        const fromA = new Set(closest(s.a, i, s.na));
        const fromB = closest(s.b, t, s.nb).map((j) => s.bToA[j]!);
        overlap += fromB.filter((j) => fromA.has(j)).length / NEIGHBORS;
      }
    }
  }
  return { top1: top1 / n, top5: top5 / n, mrr: rr / n, stable: stable ? overlap / n : null, n };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(7);
const line = (label: string, s: Score) =>
  console.log(`  ${label.padEnd(24)} ${pct(s.top1)} ${pct(s.top5)}   ${s.mrr.toFixed(3)}   ${s.stable == null ? "      " : pct(s.stable)}   (${s.n.toLocaleString()})`);

const STEPS = [0.5, 0.75, 1.25, 1.5, 2];
const TRAIN = new Set(YEARS.filter((y) => y % 2 === 0));
const TEST = new Set(YEARS.filter((y) => y % 2 === 1));

/** The model each kind ships with, which tuning runs under. */
const FINAL: Record<string, string> = { Teams: "cap and shared", Players: "cap, eased ×1" };

function tune<R>(p: Prepared, original: Prepared, profile: Profile<R>, perSeason: number): void {
  const mult = profile.features.map(() => 1);
  // Only stats a half actually has can be tuned; the rest keep the profile's weight.
  const tunable = profile.features.map((_, j) => p.have[j]! > 0.5);
  let best = measure(p, mult, { years: TRAIN, perSeason }).mrr;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    profile.features.forEach((_, j) => {
      if (!tunable[j]) return;
      const keep = mult[j]!;
      let bestStep = keep;
      for (const step of STEPS) {
        if (step === keep) continue;
        mult[j] = step;
        const got = measure(p, mult, { years: TRAIN, perSeason }).mrr;
        if (got > best + 0.0005) {
          best = got;
          bestStep = step;
          moved = true;
        }
      }
      mult[j] = bestStep;
    });
    if (!moved) break;
  }
  const ones = profile.features.map(() => 1);
  line("test: as it was", measure(original, ones, { years: TEST, perSeason, stable: true }));
  line("test: new model", measure(p, ones, { years: TEST, perSeason, stable: true }));
  line("test: new model, tuned", measure(p, mult, { years: TEST, perSeason, stable: true }));
  const changed = profile.features.flatMap((f, j) => (mult[j] === 1 ? [] : [`${f.label} ${f.weight} → ${+(f.weight * mult[j]!).toFixed(2)}`]));
  console.log(`  tuned weights: ${changed.length ? changed.join(", ") : "none moved"}`);
}

function report<R>(kind: string, halves: Candidate<R>[], profiles: Profile<R>[], variants: Variant[], perSeason: number): void {
  for (const profile of profiles) {
    console.log(`\n${kind} · ${profile.label.padEnd(16)} first    top 5    MRR    stable`);
    if (TUNE) {
      const final = variants.find((v) => v.name === FINAL[kind])!;
      console.log(`  tuning under "${final.name}"`);
      tune(prepare(halves, profile, final), prepare(halves, profile, variants[0]!), profile, perSeason);
      continue;
    }
    for (const v of variants) line(v.name, measure(prepare(halves, profile, v), profile.features.map(() => 1), { perSeason, stable: true }));
  }
}

/** Does easing a half's rate predict the other half's rate better? The error of that prediction falls by this much. */
function easing<R>(halves: Candidate<R>[], features: readonly Feature<R>[], strengths: number[]): void {
  const byBase = new Map<string, Candidate<R>>();
  for (const c of halves) if (c.id.endsWith("|B")) byBase.set(c.id.slice(0, -2), c);
  const scaled = strengths.map((ease) => seasonScales(halves, features, { ease }));
  console.log(`  ${"".padEnd(10)} ${strengths.map((s) => `eased ×${s}`.padStart(12)).join("")}`);
  for (const f of features) {
    if (!f.n) continue;
    const cuts = scaled.map((scales) => {
      let raw = 0;
      let eased = 0;
      for (const a of halves) {
        if (!a.id.endsWith("|A")) continue;
        const b = byBase.get(a.id.slice(0, -2));
        const va = f.get(a.row);
        const vb = b ? f.get(b.row) : null;
        const na = f.n!(a.row);
        const prior = scales.get(`${a.year}|${f.key}`)?.prior;
        if (va == null || vb == null || na == null || !prior) continue;
        raw += (va - vb) ** 2;
        eased += ((na * va + prior.k * prior.mu) / (na + prior.k) - vb) ** 2;
      }
      return raw > 0 ? `${(100 * (1 - eased / raw)).toFixed(0)}%`.padStart(12) : "–".padStart(12);
    });
    console.log(`  ${f.label.padEnd(10)} ${cuts.join("")}`);
  }
}

/** What two unrelated seasons score under each variant: the median and the mean of 20,000 random pairs. */
function randomPairs<R>(pool: Candidate<R>[], profile: Profile<R>, features: readonly Feature<R>[], variants: Variant[]): void {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (const v of variants) {
    const scales = seasonScales(pool, features, { ease: v.ease });
    const prof = v.share ? shareWeights(profile, correlations(profile, pool, scales, v.cap)) : profile;
    const scores: number[] = [];
    while (scores.length < 20000) {
      const a = pool[Math.floor(rand() * pool.length)]!;
      const b = pool[Math.floor(rand() * pool.length)]!;
      if (a.id === b.id) continue;
      let sw = 0;
      let sum = 0;
      for (const f of prof.features) {
        const x = standardize(scales, a, f, v.cap);
        const y = standardize(scales, b, f, v.cap);
        if (!x || !y) continue;
        sw += f.weight;
        sum += f.weight * (x.z - y.z) ** 2;
      }
      if (sw > 0) scores.push(100 * Math.exp(-sum / sw));
    }
    scores.sort((x, y) => x - y);
    console.log(`  ${v.name.padEnd(24)} median ${scores[scores.length >> 1]!.toFixed(1)}, mean ${(scores.reduce((s, x) => s + x, 0) / scores.length).toFixed(1)}`);
  }
}

const started = Date.now();
console.log(`Find Similar on split halves, ${YEARS[0]}-${YEARS[YEARS.length - 1]}${TUNE ? ", tuning on even seasons, testing on odd" : ""}`);

const teams = YEARS.flatMap(teamHalves);
report("Teams", teams, TEAM_PROFILES, TEAM_VARIANTS, TUNE ? 200 : Infinity);
console.log("\nTwo unrelated team-seasons, Overall");
const teamPool: Candidate<Team>[] = [...teamSeasons].flatMap(([year, ts]) => ts.map((t) => ({ id: `${year}|${t.id}`, year, row: t })));
randomPairs(teamPool, TEAM_PROFILES[0]!, TEAM_FEATURES, [TEAM_VARIANTS[0]!, TEAM_VARIANTS[3]!]);

const players = YEARS.flatMap(playerHalves);
console.log("\nPlayers · easing: how much better one half's rate predicts the other half's");
easing(players, PLAYER_FEATURES, [0.25, 0.5, 1]);
// Impact is EPM, which a half does not have.
report("Players", players, PLAYER_PROFILES.filter((p) => p.key !== "impact"), PLAYER_VARIANTS, TUNE ? 150 : 300);

const playerPool = YEARS.flatMap(playerSeason);
console.log(`\nTwo unrelated player-seasons (${playerPool.length.toLocaleString()} leaderboard players), Overall`);
randomPairs(playerPool, PLAYER_PROFILES[0]!, PLAYER_FEATURES, PLAYER_VARIANTS);
console.log(`\n${((Date.now() - started) / 1000).toFixed(0)}s`);
