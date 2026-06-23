// 32-0 game: types + scoring.
//
// Roll a conference + 2-year group, draft players into G/G/F/F/C, and score the
// lineup on BTA PRTG talent plus BTA's Four Factors (REB / 3PM / FBP / TOV diff),
// proxied from each pick's era-normalized percentiles. A steep curve maps the
// team rating to a projected record out of 32 -- going 32-0 should be rare.

export type Bucket = 'G' | 'F' | 'C'

// One player-season from public/data/thirty-two-zero-index.json
export interface GamePlayer {
  id: number
  yr: number
  n: string // name
  t: string // team
  c: string // conference code
  g: string // year-group id
  b: Bucket
  alt?: Bucket | null // second eligible bucket (Stretch 4 → also C)
  gp: number | null
  prtg: number | null
  prtgP: number | null
  pts: number | null
  reb: number | null
  ast: number | null
  stl: number | null
  fg3: number | null
  fg3P: number | null
  tparP: number | null
  rebP: number | null
  orbP: number | null
  drbP: number | null
  astP: number | null
  stlP: number | null
  tovP: number | null
  efg: number | null
  efgP: number | null
  tsP: number | null
}

export interface ConferenceMeta {
  code: string
  name: string
  power: boolean
}

export interface GameIndex {
  groups: string[]
  conferences: ConferenceMeta[]
  count: number
  players: GamePlayer[]
}

// ---- Lineup shape: G G F F C ----
export interface Slot {
  id: string
  bucket: Bucket
  label: string
}

export const SLOTS: Slot[] = [
  { id: 'g1', bucket: 'G', label: 'G' },
  { id: 'g2', bucket: 'G', label: 'G' },
  { id: 'f1', bucket: 'F', label: 'F' },
  { id: 'f2', bucket: 'F', label: 'F' },
  { id: 'c1', bucket: 'C', label: 'C' },
]

export const BUCKET_NEED: Record<Bucket, number> = { G: 2, F: 2, C: 1 }

/** Whether a player can fill a given bucket (covers dual-position Stretch 4s). */
export function playsBucket(p: GamePlayer, bucket: Bucket): boolean {
  return p.b === bucket || p.alt === bucket
}

// Power-6 conferences are rolled slightly more often.
export const POWER_WEIGHT = 1.8
export const NORMAL_WEIGHT = 1.0
// The very first roll of a game leans harder toward a power conference so most
// runs open on a marquee league. Subsequent rolls use the normal POWER_WEIGHT.
export const FIRST_ROLL_POWER_WEIGHT = 3.2

// ---- Scoring config (tunable) ----
export const SCORE_CONFIG = {
  // rating = coreWeight*Talent + effWeight*Efficiency + ffWeight*FourFactors
  // Efficiency (eFG/TS percentile) separates dominant, efficient stars from
  // empty-calorie volume scorers that talent alone can overrate.
  coreWeight: 0.5,
  effWeight: 0.25,
  ffWeight: 0.25,
  // four-factor blend (equal by default, sums to 1)
  ff: { reb: 0.25, threeP: 0.25, fbp: 0.25, tov: 0.25 },
  // Severe-lack-of-talent penalty. Below `talentFloor` (on the 0-100 Talent
  // scale), subtract `talentPenaltyK` rating points per point under the floor —
  // so a lineup of efficient role players with no real shot-makers can't post
  // an elite record on Efficiency + Four Factors alone. Above the floor it's a
  // no-op, so good/great teams (and the 32-0 tail) are untouched.
  talentFloor: 52,
  talentPenaltyK: 0.6,
  // Talent is scaled LINEARLY off raw BTA PRTG (not the cohort percentile, which
  // saturates at p100 and flattens a 105-PRTG monster to the same value as a
  // p100 role player). talentRef = the dataset max raw PRTG (Zach Edey 2024) so
  // the most dominant season maps to ~100 and everyone scales below it.
  talentRef: 105.7,
  // projected record = linear map of rating onto 0..games, clamped.
  // rating recordLo → 0 wins, recordHi → 32 wins. Retuned via Monte Carlo
  // (scripts/ttz-sim.mjs) for the linear-talent formula, whose ratings sit lower
  // (raw PRTG averages well under 100). With lo=7/hi=68: good play averages
  // ~22 wins, tails stay rare — >=30 ~5.4%, 32-0 ~1.6% — and a genuinely stacked
  // roster (Edey/Cunningham/Dybantsa…) lands ~29-3 at the ~94th percentile.
  recordLo: 7,
  recordHi: 68,
  games: 32,
}

const nz = (v: number | null | undefined, fallback = 50) =>
  v == null || Number.isNaN(v) ? fallback : v

/**
 * 2K-style overall rating (1-99) from a player's raw BTA PRTG. Anchored so the
 * dataset's best season (Zach Edey 2024 ≈ talentRef) lands at 99 and the floor
 * sits at 66 — i.e. the pool spans a believable ~69-99 "rotation player" band
 * the way 2K ratings do, rather than 0-100. Revealed only after a player is
 * placed (never in the pool).
 */
export function overallRating(prtg: number | null | undefined): number {
  const v = 66 + (nz(prtg, 0) / SCORE_CONFIG.talentRef) * 33
  return Math.max(1, Math.min(99, Math.round(v)))
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface FourFactors {
  reb: number // REB DIFF proxy
  threeP: number // 3PM DIFF / spacing proxy
  fbp: number // fast-break-points DIFF proxy
  tov: number // TOV DIFF proxy
}

export interface LineupScore {
  rating: number // raw weighted rating (~36..68 in practice)
  grade: number // rating remapped to an intuitive 0-100 (32-0 → 100, coin-flip → 50)
  core: number // PRTG talent component (0-100)
  efficiency: number // eFG/TS percentile component (0-100)
  fourFactors: FourFactors
  ffOverall: number // blended four-factor score (0-100)
  projectedW: number
  projectedL: number
  perfect: boolean // 32-0
}

/**
 * Score a full or partial lineup. Pass the drafted players (1-5). Empty slots
 * are ignored, so the running score reflects what is on the floor so far.
 */
export function scoreLineup(players: GamePlayer[]): LineupScore {
  const cfg = SCORE_CONFIG
  if (players.length === 0) {
    return {
      rating: 0,
      grade: 0,
      core: 0,
      efficiency: 0,
      fourFactors: { reb: 0, threeP: 0, fbp: 0, tov: 0 },
      ffOverall: 0,
      projectedW: 0,
      projectedL: cfg.games,
      perfect: false,
    }
  }

  // Talent — linear off raw BTA PRTG so a dominant season towers over a merely
  // "p100-in-cohort" role player. Clamped to 0..100 against the dataset max.
  const core = avg(
    players.map((p) => Math.max(0, Math.min(100, (100 * nz(p.prtg, 0)) / cfg.talentRef))),
  )

  // Efficiency — average of eFG% and TS% percentiles (era-normalized).
  const efficiency = avg(players.map((p) => (nz(p.efgP) + nz(p.tsP)) / 2))

  // Centers are floored at the team's PERIMETER level on the guard-skill factors
  // (spacing, transition, ball-security) so they're never dragged by jobs that
  // aren't theirs; if a big is actually good at one, it counts as a bonus.
  // Rebounding — a big's strength — is graded straight up for everyone.
  const spaceRaw = (p: GamePlayer) => {
    const make = p.fg3P == null ? 0 : p.fg3P
    const willing = nz(p.tparP, 0) / 100
    return make * (0.4 + 0.6 * willing)
  }
  // FBP DIFF — transition proxy: steals create run-outs, assists push tempo.
  const fbpRaw = (p: GamePlayer) => (nz(p.stlP) + nz(p.astP)) / 2
  // TOV DIFF — protect the ball (invert TOV%). Pure security, no steal credit
  // here (steals already count in FBP — double-counting buried non-stealing bigs).
  const tovRaw = (p: GamePlayer) => 100 - nz(p.tovP)

  const perim = players.filter((p) => p.b !== 'C')
  const pAvg = (fn: (p: GamePlayer) => number) => (perim.length ? avg(perim.map(fn)) : 50)
  const pSpace = pAvg(spaceRaw)
  const pFbp = pAvg(fbpRaw)
  const pTov = pAvg(tovRaw)
  const floorC = (p: GamePlayer, fn: (p: GamePlayer) => number, pv: number) =>
    p.b === 'C' ? Math.max(fn(p), pv) : fn(p)

  const reb = avg(players.map((p) => nz(p.rebP)))
  const threeP = avg(players.map((p) => floorC(p, spaceRaw, pSpace)))
  const fbp = avg(players.map((p) => floorC(p, fbpRaw, pFbp)))
  const tov = avg(players.map((p) => floorC(p, tovRaw, pTov)))

  const fourFactors: FourFactors = { reb, threeP, fbp, tov }
  const ffOverall =
    cfg.ff.reb * reb + cfg.ff.threeP * threeP + cfg.ff.fbp * fbp + cfg.ff.tov * tov

  // Penalize lineups whose talent sits below the floor (severe lack of
  // shot-making), scaled by how far under they are.
  const talentPenalty =
    core < cfg.talentFloor ? -cfg.talentPenaltyK * (cfg.talentFloor - core) : 0

  const rating =
    cfg.coreWeight * core + cfg.effWeight * efficiency + cfg.ffWeight * ffOverall + talentPenalty

  // Projected record — linear map of rating onto 0..games, clamped.
  const span = cfg.recordHi - cfg.recordLo
  const projectedW = Math.max(
    0,
    Math.min(cfg.games, Math.round(((rating - cfg.recordLo) / span) * cfg.games)),
  )
  const projectedL = cfg.games - projectedW

  // Display grade — the same linear map as the record, scaled to 0-100 so the
  // shown number is intuitive (recordHi rating → 100, a 16-16 team → 50).
  const grade = Math.max(0, Math.min(100, ((rating - cfg.recordLo) / span) * 100))

  return {
    rating,
    grade,
    core,
    efficiency,
    fourFactors,
    ffOverall,
    projectedW,
    projectedL,
    perfect: projectedW >= cfg.games,
  }
}

// ---- Four-factor projection (vs D-I) ----
// National distribution of each four-factor season DIFF total across the 365
// D-I teams (2026, frozen). Stored as 21 ascending quantile breakpoints (p=0,
// 5, …, 100). We map a lineup's 0-100 four-factor proxy → a percentile, then
// read a projected season DIFF off the inverse-CDF and a rank out of 365 — so
// the result reads like the team page's Four Factors panel.
const FF_TOTAL = 365
const FF_DIST = {
  reb_diff:     [-324, -200, -153, -120, -103, -83, -61, -41, -32, -15, -5, 14, 23, 39, 59, 78, 90, 111, 135, 201, 514],
  fg3_made_diff:[-179, -85, -67, -52, -43, -36, -29, -21, -14, -5, 1, 10, 16, 21, 26, 33, 42, 53, 63, 84, 163],
  fbpts_diff:   [-264, -136, -109, -90, -80, -60, -51, -40, -30, -23, -16, -1, 14, 33, 47, 62, 73, 99, 115, 159, 308],
  tov_diff_ct:  [-222, -105, -79, -66, -47, -36, -30, -16, -9, -2, 7, 13, 17, 24, 31, 38, 46, 57, 75, 98, 149],
} as const

// Linear-interpolated quantile from the 21-point ascending breakpoints (p 0-100).
function ffQuantile(bp: readonly number[], p: number): number {
  const x = Math.max(0, Math.min(100, p)) / 5
  const lo = Math.floor(x)
  if (lo >= bp.length - 1) return bp[bp.length - 1]!
  const frac = x - lo
  return bp[lo]! + (bp[lo + 1]! - bp[lo]!) * frac
}

export type FourFactorProjection = {
  key: string
  label: string
  sub: string
  value: number          // projected season DIFF total (signed)
  rank: number           // 1..365 (1 = best)
  total: number
  percentile: number     // 0-100, higher = better (bar marker position)
}

/**
 * Convert a scored lineup's four-factor proxies into projected season DIFF
 * totals + a national rank, the way the team page shows them. `goodHigh=false`
 * stats (TOV diff — negative is good) read the inverse-CDF from the other end
 * so a strong ball-security lineup projects a negative (favorable) number.
 */
export function projectFourFactors(ff: FourFactors): FourFactorProjection[] {
  const defs = [
    { key: 'reb_diff',      label: 'REB Diff', sub: 'total rebounds vs allowed',      pct: ff.reb,    goodHigh: true },
    { key: 'fg3_made_diff', label: '3PM Diff', sub: '3-pointers made vs allowed',     pct: ff.threeP, goodHigh: true },
    { key: 'fbpts_diff',    label: 'FBP Diff', sub: 'fast-break points vs allowed',   pct: ff.fbp,    goodHigh: true },
    { key: 'tov_diff_ct',   label: 'TOV Diff', sub: 'turnovers forced vs committed',  pct: ff.tov,    goodHigh: false },
  ] as const
  return defs.map((d) => {
    const pct = Math.max(0, Math.min(100, d.pct))
    const bp = FF_DIST[d.key as keyof typeof FF_DIST]
    const value = Math.round(ffQuantile(bp, d.goodHigh ? pct : 100 - pct))
    const rank = Math.max(1, Math.min(FF_TOTAL, Math.round(((100 - pct) / 100) * (FF_TOTAL - 1)) + 1))
    return { key: d.key, label: d.label, sub: d.sub, value, rank, total: FF_TOTAL, percentile: pct }
  })
}

// ---- Conference logos (ESPN) ----
// torvik conf code -> ESPN conference-logo slug.
const CONF_LOGOS: Record<string, string> = {
  ACC: 'acc', SEC: 'sec', B10: 'big_ten', B12: 'big_12', BE: 'big_east',
  P12: 'pac_12', Amer: 'american', A10: 'atlantic_10', MWC: 'mountain_west',
  WCC: 'west_coast', CUSA: 'conference_usa', MVC: 'missouri_valley', SB: 'sun_belt',
  MAC: 'mac', Ivy: 'ivy', Pat: 'patriot', BSky: 'big_sky', BW: 'big_west',
  CAA: 'caa', Horz: 'horizon', MAAC: 'maac', MEAC: 'meac', NEC: 'nec', OVC: 'ovc',
  SC: 'southern', Slnd: 'southland', SWAC: 'swac', Sum: 'summit', WAC: 'wac',
  ASun: 'atlantic_sun', AE: 'america_east', BSth: 'big_south',
}

export function confLogoUrl(code: string): string | null {
  const slug = CONF_LOGOS[code]
  return slug ? `https://a.espncdn.com/i/teamlogos/ncaa_conf/500/${slug}.png` : null
}

// ---- Roll helpers ----

/**
 * Map of "CONF|GROUP" -> set of buckets that combo can actually fill. Used to
 * keep rolls bucket-aware so the game never offers a conf+era that can't fill
 * one of your remaining open slots (which would soft-lock the no-skip rule).
 */
export function comboBuckets(index: GameIndex): Map<string, Set<Bucket>> {
  const m = new Map<string, Set<Bucket>>()
  for (const p of index.players) {
    const k = p.c + '|' + p.g
    let set = m.get(k)
    if (!set) {
      set = new Set<Bucket>()
      m.set(k, set)
    }
    set.add(p.b)
    if (p.alt) set.add(p.alt)
  }
  return m
}

/**
 * Weighted-random conference + group roll.
 * - opts.conf / opts.group pin a dimension (for the conf / era rerolls).
 * - opts.open restricts to combos that can fill at least one still-open bucket,
 *   so a full-but-wrong-position roll can never strand the player.
 */
export function rollComboWeighted(
  index: GameIndex,
  buckets: Map<string, Set<Bucket>>,
  opts: { conf?: string; group?: string; open?: Set<Bucket>; powerWeight?: number } = {},
): { conf: string; group: string } {
  const powerW = opts.powerWeight ?? POWER_WEIGHT
  const powerSet = new Set(index.conferences.filter((c) => c.power).map((c) => c.code))
  const pool: { conf: string; group: string; w: number }[] = []
  for (const [key, bset] of buckets) {
    const [conf, group] = key.split('|')
    if (opts.conf && conf !== opts.conf) continue
    if (opts.group && group !== opts.group) continue
    if (opts.open && ![...opts.open].some((b) => bset.has(b))) continue
    pool.push({ conf, group, w: powerSet.has(conf) ? powerW : NORMAL_WEIGHT })
  }
  // Fallback: if a pinned reroll left nothing fillable, drop the open filter.
  if (pool.length === 0) return rollComboWeighted(index, buckets, { ...opts, open: undefined })

  const total = pool.reduce((a, b) => a + b.w, 0)
  let r = Math.random() * total
  for (const c of pool) {
    r -= c.w
    if (r <= 0) return { conf: c.conf, group: c.group }
  }
  return { conf: pool[0].conf, group: pool[0].group }
}
