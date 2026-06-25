// Builds the 32-0 game index: one compact record per qualifying player-season,
// keyed for instant conf+year-group rolls. Reads players-index.json (name/team/
// conf/year) joined with player-ranks/<id>.json (bucket + PRTG + four-factor +
// spacing stats, each with an era-normalized percentile).
//
// Output: public/data/thirty-two-zero-index.json
//   { groups: [...], conferences: [{code,name,power}], players: [ {...} ] }
//
// Run: node scripts/build-thirty-two-zero-index.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const IDX = path.join(ROOT, 'public/data/players-index.json')
const RANKS = path.join(ROOT, 'public/data/player-ranks')
const PLAYER = path.join(ROOT, 'public/data/player')
const OUT = path.join(ROOT, 'public/data/thirty-two-zero-index.json')

// Year groups — skip COVID 2020. 2019 pairs with 2021.
const GROUPS = [
  { id: '2008-10', years: [2008, 2009, 2010] },
  { id: '2011-12', years: [2011, 2012] },
  { id: '2013-14', years: [2013, 2014] },
  { id: '2015-16', years: [2015, 2016] },
  { id: '2017-18', years: [2017, 2018] },
  { id: '2019-21', years: [2019, 2021] },
  { id: '2022-23', years: [2022, 2023] },
  { id: '2024-26', years: [2024, 2025, 2026] },
]
const yr2grp = {}
for (const g of GROUPS) for (const y of g.years) yr2grp[y] = g.id

// Power-6 weighted slightly higher in the roll.
const POWER = new Set(['ACC', 'B12', 'B10', 'BE', 'SEC', 'P12', 'P10'])
const CONF_NAME = {
  ACC: 'ACC', B12: 'Big 12', B10: 'Big Ten', BE: 'Big East', SEC: 'SEC', P12: 'Pac-12', P10: 'Pac-10',
  A10: 'Atlantic 10', Amer: 'American', MWC: 'Mountain West', WCC: 'West Coast',
  MVC: 'Missouri Valley', CUSA: 'Conference USA', SB: 'Sun Belt', MAC: 'MAC',
  CAA: 'Colonial', Horz: 'Horizon', Sum: 'Summit', OVC: 'Ohio Valley', BSky: 'Big Sky',
  BW: 'Big West', SC: 'Southern', Slnd: 'Southland', MAAC: 'MAAC', AE: 'America East',
  Pat: 'Patriot', BSth: 'Big South', ASun: 'ASUN', NEC: 'Northeast', WAC: 'WAC',
  SWAC: 'SWAC', MEAC: 'MEAC', Ivy: 'Ivy',
}
// Junk / defunct / non-conferences excluded from the game.
const EXCLUDE = new Set(['GWC', 'Ind', 'ind'])
// Pac-12 effectively dead after 2024 — drop its 2024-26 group.
const DEAD = new Set(['P12|2024-26'])

const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d)

// PRTG floors — trim weak players to shrink the index (faster download/parse)
// and keep rolls to relevant names. Power confs are deep, so floor is higher.
const POWER_MIN = 25
const OTHER_MIN = 10

const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'))
// (id_year) -> {n,t,c}
const meta = new Map()
for (const p of idx) meta.set(p.id + '_' + p.y, p)

const ids = [...new Set(idx.map((p) => p.id))]
const players = []
let read = 0,
  skipped = 0,
  lowPrtg = 0

for (const id of ids) {
  const f = path.join(RANKS, id + '.json')
  if (!fs.existsSync(f)) continue
  let j
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    continue
  }
  read++

  // Per-year Torvik position note (raw_row[64]) from the player file. Used to
  // detect "Stretch 4" — those F-bucket bigs are made eligible for C too.
  const noteByYear = {}
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(PLAYER, id + '.json'), 'utf8'))
    for (const s of pj.seasons || []) {
      const note = Array.isArray(s.raw_row) ? s.raw_row[64] : null
      if (typeof note === 'string') noteByYear[s.year] = note
    }
  } catch {
    /* no player file — leave notes empty */
  }

  for (const sr of j.seasonRanks || []) {
    const m = meta.get(id + '_' + sr.year)
    if (!m) continue
    const conf = m.c
    if (EXCLUDE.has(conf)) {
      skipped++
      continue
    }
    const grp = yr2grp[sr.year]
    if (!grp) continue // skips 2020
    if (DEAD.has(conf + '|' + grp)) continue
    const b = sr.bucket
    if (!['G', 'F', 'C'].includes(b)) continue
    const s = sr.stats || {}
    const pct = (k) => (s[k] ? s[k].percentile : null)
    const val = (k) => (s[k] ? s[k].value : null)
    const prtgVal = val('bta_portg')
    if (prtgVal == null) continue
    // PRTG floor: power confs > 30, everyone else > 5
    if (prtgVal <= (POWER.has(conf) ? POWER_MIN : OTHER_MIN)) {
      lowPrtg++
      continue
    }

    // Dual-position eligibility → second draftable bucket. Stretch 4s play F+C;
    // the height-derived 2008-09 notes (G/F, F/G, C/F) carry their own pairing.
    const note = noteByYear[sr.year]
    let alt = null
    if (note === 'Stretch 4') alt = 'C'   // F primary
    else if (note === 'G/F') alt = 'F'    // G primary
    else if (note === 'F/G') alt = 'G'    // F primary
    else if (note === 'C/F') alt = 'F'    // C primary
    if (alt === b) alt = null             // never duplicate the primary bucket

    players.push({
      id,
      yr: sr.year,
      n: m.n,
      t: m.t,
      c: conf,
      g: grp,
      b,
      ...(alt ? { alt } : {}),
      gp: m.g ?? null,
      // talent
      prtg: round(val('bta_portg'), 1),
      prtgP: pct('bta_portg'),
      // display box
      pts: round(val('pts_pg'), 1),
      reb: round(val('reb_pg'), 1),
      ast: round(val('ast_pg'), 1),
      stl: round(val('stl_pg'), 1),
      // BTA Four Factors proxies + spacing (percentiles, era-normalized)
      // 3PM DIFF / spacing
      fg3: round(val('fg3_pct') != null ? val('fg3_pct') * 100 : null, 1),
      fg3P: pct('fg3_pct'),
      tparP: pct('tpar'),
      // REB DIFF
      rebP: pct('reb_pg'),
      orbP: pct('orb_pct'),
      drbP: pct('drb_pct'),
      // FBP DIFF (transition proxy) + TOV DIFF (security + forcing)
      astP: pct('ast_pg'),
      stlP: pct('stl_pct'),
      tovP: pct('tov_pct'), // higher pct = MORE turnovers (worse) -> invert at scoring time
      // shooting efficiency (era-normalized) — drives the eff factor + display
      efg: round(val('efg_pct'), 1),
      efgP: pct('efg_pct'),
      tsP: pct('ts_pct'),
    })
  }
}

// ---- One-time exception: Mitch Williams (id 79043) ----
// Deep-bench walk-on — 4 GP / 1.0 ppg, never clears the ranking baseline, so he
// has no rank file and the loop above skips him. Added by explicit request as an
// easter egg. Hand-built record from his 2024-25 Northwestern St. (Southland)
// line; low PRTG keeps him a clear bench scrub on the court.
players.push({
  id: 79043, yr: 2025, n: 'Mitch Williams', t: 'Northwestern St.',
  c: 'Slnd', g: '2024-26', b: 'G',
  gp: 4,
  prtg: 5, prtgP: 3,
  pts: 1.0, reb: 0.0, ast: 0.2, stl: 0.2,
  fg3: null, fg3P: null, tparP: null,
  rebP: 5, orbP: null, drbP: null,
  astP: 20, stlP: 40, tovP: 50,
  efg: null, efgP: 10, tsP: 10,
})

const conferences = [...new Set(players.map((p) => p.c))]
  .sort()
  .map((code) => ({ code, name: CONF_NAME[code] ?? code, power: POWER.has(code) }))

const out = {
  builtFrom: 'players-index.json + player-ranks',
  groups: GROUPS.map((g) => g.id),
  conferences,
  count: players.length,
  players,
}

fs.writeFileSync(OUT, JSON.stringify(out))
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2)
console.log(`read ${read} ranks files, excluded ${skipped} junk-conf seasons, ${lowPrtg} below PRTG floor`)
console.log(`wrote ${players.length} player-seasons, ${conferences.length} conferences -> ${OUT} (${mb} MB)`)
// quick dead-roll recheck on final pool
const combos = {}
for (const p of players) {
  const k = p.c + '|' + p.g
  combos[k] ??= { G: 0, F: 0, C: 0 }
  combos[k][p.b]++
}
const allKeys = []
for (const c of conferences) for (const g of out.groups) allKeys.push(c.code + '|' + g)
const empties = allKeys.filter((k) => !combos[k])
const noC = allKeys.filter((k) => combos[k] && combos[k].C === 0)
console.log(`final dead rolls -> empty: ${empties.length}, no-center: ${noC.length}`)
if (empties.length) console.log('  empty:', empties.join(', '))
if (noC.length) console.log('  no-center:', noC.join(', '))
