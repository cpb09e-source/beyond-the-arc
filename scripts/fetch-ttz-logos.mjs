// Downloads every known team's logo into public/ttz-logos/ so they can render
// SAME-ORIGIN. The GCS logo host sends no CORS headers, which taints the canvas
// and makes html-to-image throw on any "save as image" path. Local copies dodge
// that entirely (works in dev + static export). Resolution logic mirrors
// src/components/team-logo.tsx lookup().
//
// The `ttz-` name is historical: this began as a fetcher for the 32-0 game's
// share card. The directory is now what TeamLogo serves from everywhere, and
// outlived the game — see the archive/32-0-game tag.
//
// Run: node scripts/fetch-ttz-logos.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'public/ttz-logos')
const TEAMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cbb-team-ids.json'), 'utf8'))

// ---- mirror of team-logo.tsx lookup() ----
const normalize = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')

const TEAMS_BY_MARKET = {}
for (const k of Object.keys(TEAMS)) {
  const e = TEAMS[k]
  if (e.market) TEAMS_BY_MARKET[normalize(e.market)] = e
}
const SR_NAME_ALIASES = {
  unc: 'north carolina', 'virginia commonwealth': 'virginia commonwealth', vcu: 'vcu',
  byu: 'byu', 'brigham young': 'byu', ucla: 'ucla', usc: 'usc', smu: 'smu', lsu: 'lsu',
  ucf: 'ucf', 'siu edwardsville': 'siu edwardsville', 'ut martin': 'tennessee martin',
  umkc: 'kansas city', ualbany: 'albany', 'miami fl': 'miami fl', 'miami florida': 'miami fl',
  'miami oh': 'miami oh', 'miami ohio': 'miami oh',
}
function lookup(name) {
  const k = normalize(name)
  if (TEAMS[k]) return TEAMS[k]
  if (TEAMS_BY_MARKET[k]) return TEAMS_BY_MARKET[k]
  const alias = SR_NAME_ALIASES[k]
  if (alias && TEAMS[alias]) return TEAMS[alias]
  const stateToSt = k.replace(/\bstate\b/g, 'st')
  if (stateToSt !== k) {
    if (TEAMS[stateToSt]) return TEAMS[stateToSt]
    if (TEAMS_BY_MARKET[stateToSt]) return TEAMS_BY_MARKET[stateToSt]
  }
  const noSuffix = k
    .replace(/\b(wildcats|tigers|bulldogs|huskies|hurricanes|cowboys|raiders|spartans|gators|tar heels|cougars|bears|aggies|red raiders|sun devils|seminoles|jayhawks|wolverines|lions|cyclones|cavaliers|panthers|fighting irish|heels|tide|crimson|jaguars|knights|colonels|musketeers|cardinals)\b/g, '')
    .trim().replace(/\s+/g, ' ')
  if (noSuffix !== k && noSuffix.length > 0) {
    if (TEAMS[noSuffix]) return TEAMS[noSuffix]
    if (TEAMS_BY_MARKET[noSuffix]) return TEAMS_BY_MARKET[noSuffix]
  }
  return null
}

// EVERY known team, rather than the distinct schools in the 32-0 index.
//
// The index was the source here until the game was archived (see the
// archive/32-0-game tag). It was always the wrong list anyway — the local
// copies are what TeamLogo serves site-wide, not just on the game's share
// card, so scoping them to the schools that happened to appear in the draft
// pool left every other team falling back to the CORS-less GCS host. The full
// table is a superset, so nothing that worked before stops working.
const ids = new Set()
const misses = []
for (const key of Object.keys(TEAMS)) {
  const e = TEAMS[key]
  if (e && e.id) ids.add(e.id)
  else misses.push(key)
}

fs.mkdirSync(OUT, { recursive: true })
const url = (id) => `https://storage.googleapis.com/cbb-image-files/team-logos/${id}.png`

let got = 0, skip = 0, fail = []
const list = [...ids]
console.log(`resolving ${list.length} unique logo ids (${misses.length} name misses -> monogram)`)
for (const id of list) {
  const dest = path.join(OUT, id + '.png')
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skip++; continue }
  try {
    const res = await fetch(url(id))
    if (!res.ok) { fail.push(id + ' ' + res.status); continue }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(dest, buf)
    got++
  } catch (e) {
    fail.push(id + ' ' + e.message)
  }
}
console.log(`downloaded ${got}, skipped ${skip} existing, failed ${fail.length}`)
if (fail.length) console.log('  fails:', fail.slice(0, 20).join(', '))
if (misses.length) console.log('  name misses:', misses.join(', '))
