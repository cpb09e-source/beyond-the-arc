// 32-0 record-curve investigation.
// Loads the game index, simulates "good play" (greedy by talent) lineups over
// random weighted rolls, and reports the rating + projected-record distribution
// so we can see how compressed/low the curve is and retune recordLo/recordHi.
//
// Run: node scripts/ttz-sim.mjs

import fs from 'node:fs'
import path from 'node:path'

const J = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'public/data/thirty-two-zero-index.json'), 'utf8'),
)

const POWER = new Set(['ACC', 'B12', 'B10', 'BE', 'SEC', 'P12'])
const nz = (v, f = 50) => (v == null || Number.isNaN(v) ? f : v)
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// dataset max raw PRTG (Edey 2024) — talent scales linearly off this.
const TALENT_REF = Math.max(...J.players.map((p) => p.prtg ?? 0))

// ---- final scoring (mirror of src/lib/thirty-two-zero.ts) ----
const CFG = { coreWeight: 0.65, effWeight: 0.20, ffWeight: 0.15, talentFloor: 52, talentPenaltyK: 0.6, recordLo: 7, recordHi: 73, games: 32 }

function components(players) {
  // Talent — linear off raw BTA PRTG (magnitude, not saturated percentile), so a
  // truly dominant player towers over a merely "p100-in-cohort" role player.
  const core = avg(players.map((p) => Math.max(0, Math.min(100, (100 * nz(p.prtg, 0)) / TALENT_REF))))
  const efficiency = avg(players.map((p) => (nz(p.efgP) + nz(p.tsP)) / 2))
  // Centers are floored at the team's perimeter level on guard-skill factors
  // (spacing, transition, ball-security) so they're never dragged by jobs that
  // aren't theirs — but rebounding (their strength) is graded straight up.
  const spaceRaw = (p) => (p.fg3P == null ? 0 : p.fg3P) * (0.4 + 0.6 * (nz(p.tparP, 0) / 100))
  const fbpRaw = (p) => (nz(p.stlP) + nz(p.astP)) / 2
  const tovRaw = (p) => 100 - nz(p.tovP)
  const perim = players.filter((p) => p.b !== 'C')
  const pAvg = (fn) => (perim.length ? avg(perim.map(fn)) : 50)
  const pSpace = pAvg(spaceRaw), pFbp = pAvg(fbpRaw), pTov = pAvg(tovRaw)
  const floorC = (p, fn, pv) => (p.b === 'C' ? Math.max(fn(p), pv) : fn(p))
  const reb = avg(players.map((p) => nz(p.rebP)))
  const threeP = avg(players.map((p) => floorC(p, spaceRaw, pSpace)))
  const fbp = avg(players.map((p) => floorC(p, fbpRaw, pFbp)))
  const tov = avg(players.map((p) => floorC(p, tovRaw, pTov)))
  const ffOverall = 0.25 * (reb + threeP + fbp + tov)
  return { core, efficiency, reb, threeP, fbp, tov, ffOverall }
}
function ratingOf(players, cfg = CFG) {
  const c = components(players)
  const talentPenalty = c.core < cfg.talentFloor ? -cfg.talentPenaltyK * (cfg.talentFloor - c.core) : 0
  return cfg.coreWeight * c.core + cfg.effWeight * c.efficiency + cfg.ffWeight * c.ffOverall + talentPenalty
}
function winsOf(rating, cfg = CFG) {
  const span = cfg.recordHi - cfg.recordLo
  return Math.max(0, Math.min(cfg.games, Math.round(((rating - cfg.recordLo) / span) * cfg.games)))
}

// ---- pools by conf|era, dedup best prtg per id, split by bucket (alt-aware) ----
function poolFor(conf, era) {
  const byId = new Map()
  for (const p of J.players) {
    if (p.c !== conf || p.g !== era) continue
    const prev = byId.get(p.id)
    if (!prev || (p.prtg ?? 0) > (prev.prtg ?? 0)) byId.set(p.id, p)
  }
  const all = [...byId.values()]
  const plays = (p, b) => p.b === b || p.alt === b
  return {
    G: all.filter((p) => plays(p, 'G')).sort((a, b) => (b.prtgP ?? 0) - (a.prtgP ?? 0)),
    F: all.filter((p) => plays(p, 'F')).sort((a, b) => (b.prtgP ?? 0) - (a.prtgP ?? 0)),
    C: all.filter((p) => plays(p, 'C')).sort((a, b) => (b.prtgP ?? 0) - (a.prtgP ?? 0)),
  }
}

// ---- real game mechanics ----
// Each of the 5 slots is its OWN roll: roll a conf+era (bucket-aware so it can
// fill a still-open slot), draft one player from that pool, repeat. Power confs
// are weighted POWER_W; the FIRST roll of the game gets FIRST_W instead.
const POWER_W = 1.8
const FIRST_W = 2.6

// combos with which buckets they can fill (alt-aware) + power flag.
const combos = []
{
  const seen = new Map()
  for (const p of J.players) {
    const k = p.c + '|' + p.g
    if (!seen.has(k)) seen.set(k, poolFor(p.c, p.g))
  }
  for (const [k, pool] of seen) {
    const [conf, era] = k.split('|')
    const has = { G: pool.G.length > 0, F: pool.F.length > 0, C: pool.C.length > 0 }
    if (has.G || has.F || has.C) combos.push({ conf, era, pool, has, power: POWER.has(conf) })
  }
}

// weighted pick among combos that can fill at least one open bucket.
function rollSlot(openSet, isFirst) {
  const cand = combos.filter((c) => [...openSet].some((b) => c.has[b]))
  const wOf = (c) => (c.power ? (isFirst ? FIRST_W : POWER_W) : 1)
  const tot = cand.reduce((a, c) => a + wOf(c), 0)
  let r = Math.random() * tot
  for (const c of cand) {
    r -= wOf(c)
    if (r <= 0) return c
  }
  return cand[cand.length - 1]
}

// "good play": from the rolled pool, take the highest raw-PRTG available player
// among the open buckets (talent-greedy, matching the linear-talent core).
function playGame() {
  const open = ['G', 'G', 'F', 'F', 'C']
  const used = new Set()
  const picks = []
  for (let i = 0; i < 5; i++) {
    const openSet = new Set(open)
    const combo = rollSlot(openSet, i === 0)
    // best available top-of-bucket across open buckets
    let best = null
    for (const b of openSet) {
      const p = combo.pool[b].find((x) => !used.has(x.id))
      if (p && (!best || (p.prtg ?? 0) > (best.p.prtg ?? 0))) best = { p, b }
    }
    if (!best) return null // dead game (shouldn't happen with bucket-aware roll)
    used.add(best.p.id)
    picks.push(best.p)
    open.splice(open.indexOf(best.b), 1)
  }
  return picks
}

const pct = (arr, q) => arr[Math.floor((arr.length - 1) * q)]
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
const share = (arr, pred) => ((100 * arr.filter(pred).length) / arr.length).toFixed(2) + '%'

const N = 200000
const wins = []
let dead = 0
for (let i = 0; i < N; i++) {
  const lu = playGame()
  if (!lu) { dead++; continue }
  wins.push(winsOf(ratingOf(lu), CFG))
}
wins.sort((a, b) => a - b)

console.log(`\n=== GOOD PLAY (per-slot rolls, power ${POWER_W} / first ${FIRST_W}), ${wins.length} games (${dead} dead) ===`)
console.log(`curve lo=${CFG.recordLo} hi=${CFG.recordHi}`)
console.log(`  wins  mean ${mean(wins).toFixed(1)}  p50 ${pct(wins, 0.5)}  p90 ${pct(wins, 0.9)}  p99 ${pct(wins, 0.99)}  max ${pct(wins, 1)}`)
console.log(`  >=28 ${share(wins, (x) => x >= 28)}`)
console.log(`  >=30 ${share(wins, (x) => x >= 30)}`)
console.log(`  >=31 ${share(wins, (x) => x >= 31)}`)
console.log(`  ==32 ${share(wins, (x) => x === 32)}`)
