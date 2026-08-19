/**
 * build-search-index.mjs — reads existing public/data JSONs and writes a slim
 * search index for the navbar ⌘K dialog. Standalone so it can run without
 * touching Supabase. The same logic also runs inside export-static-data.mts
 * as part of the normal build pipeline.
 *
 * Output:  public/data/search-index.json
 *   [
 *     { t: "t", n: "Duke", s: "duke", c: "ACC" },
 *     { t: "p", n: "Cooper Flagg", b: 127998, tm: "Duke", y: 2025 },
 *     ...
 *   ]
 *
 * Compact field names to keep the file small over the wire.
 */
import fs from "node:fs";
import path from "node:path";
import { aliasKeywords } from "./lib/team-aliases.mjs";

const ROOT = path.resolve("public/data");
const OUT = path.join(ROOT, "search-index.json");

function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- TEAMS (one entry per unique team name; use latest season's conference) ----
const teamsAll = JSON.parse(fs.readFileSync(path.join(ROOT, "teams-all.json"), "utf8"));
/**
 * One row per team: its newest season, and — for the palette's columns — its
 * newest season THAT HAS BEEN PLAYED.
 *
 * Those are deliberately two different years. The conference shown on a team
 * row should follow the team the moment a new season's row exists, but a
 * record and a rank must not: a season that has tipped off but has no games in
 * it yet carries 0-0 and a placeholder rank, and showing that would replace a
 * real 27-9 with nothing the day the schedule turns over. So the stat line
 * holds the last season with a game in it and is replaced the moment the new
 * one has one, which is the point at which the new number means something.
 */
const byName = new Map();
for (const t of teamsAll) {
  const cur = byName.get(t.name);
  const tr = t.team_trank_stats ?? {};
  const played = (tr.wins ?? 0) + (tr.losses ?? 0) > 0;
  if (!cur) {
    byName.set(t.name, { name: t.name, year: t.year, conf: t.conference, statYear: null, rank: null, wins: null, losses: null, net: null });
  }
  const rec = byName.get(t.name);
  if (t.year >= rec.year) { rec.year = t.year; rec.conf = t.conference; }
  if (played && (rec.statYear === null || t.year > rec.statYear)) {
    rec.statYear = t.year;
    rec.rank = tr.rank ?? null;
    rec.wins = tr.wins ?? null;
    rec.losses = tr.losses ?? null;
    // NET = adjusted efficiency margin, the same quantity the team pages rank on.
    rec.net = tr.adjoe != null && tr.adjde != null ? tr.adjoe - tr.adjde : null;
  }
}
const teamEntries = [...byName.values()]
  .map((t) => {
    return {
      t: "t",
      n: t.name,
      s: slug(t.name),
      // NB: `t.conf`, matching the map literal above. This read `t.conference`
      // (a field the map value never had) for a while, which silently nulled the
      // conference on every one of the 370 team rows in the dialog.
      c: t.conf ?? null,
      // Colloquial aliases ("uconn", "ole miss") the dialog also matches on.
      ...(aliasKeywords(t.name) ? { k: aliasKeywords(t.name) } : {}),
    };
  })
  .sort((a, b) => a.n.localeCompare(b.n));

// ---- PLAYERS (one entry per bart_player_id; use latest season's team/year) ----
const yearFiles = fs.readdirSync(path.join(ROOT, "players-by-year")).filter((f) => f.endsWith(".json"));
const latestByBart = new Map();
for (const f of yearFiles) {
  const year = Number(f.replace(".json", ""));
  if (!Number.isFinite(year)) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(ROOT, "players-by-year", f), "utf8"));
  for (const p of arr) {
    if (!p.bart_player_id) continue;
    const cur = latestByBart.get(p.bart_player_id);
    if (cur && cur.year >= year) continue;
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    latestByBart.set(p.bart_player_id, {
      name: p.name,
      year,
      team: team?.name ?? "—",
      bartId: p.bart_player_id,
    });
  }
}
// ---- per-season box lines for the palette's stat columns ----
// The dialog shows PPG · RPG · APG · TS% next to every player, TS% as a site
// percentile chip. Values come from players-explorer/<year>.json (already the
// site's per-season stat source) and ride the sidecar as a compact int array
// `x: [ppg*10, rpg*10, apg*10, ts*1000, tsPctile]` — ints because 26k rows of
// float keys are most of a megabyte, and this file is on the ⌘K critical path.
// ts and its percentile are -1 when unknown. The percentile is computed here,
// per season, over the same ≥10-game floor the explorer's pool uses, so the
// chip colors mean the same thing they mean everywhere else on the site.
const statLineByBart = new Map(); // bartId -> { year, x }
{
  const exDir = path.join(ROOT, "players-explorer");
  let exFiles = [];
  try { exFiles = fs.readdirSync(exDir).filter((f) => f.endsWith(".json")); } catch {}
  for (const f of exFiles) {
    const year = Number(f.replace(".json", ""));
    if (!Number.isFinite(year)) continue;
    const { fields, rows } = JSON.parse(fs.readFileSync(path.join(exDir, f), "utf8"));
    const I = Object.fromEntries(fields.map((n, i) => [n, i]));
    // Season TS distribution over the eligible pool, for the percentile.
    const tsPool = [];
    for (const r of rows) {
      const ts = r[I.ts_pct];
      if ((r[I.games] ?? 0) >= 10 && typeof ts === "number") tsPool.push(ts);
    }
    tsPool.sort((a, b) => a - b);
    const pctOf = (ts) => {
      if (typeof ts !== "number" || tsPool.length < 2) return -1;
      // binary search: rank of ts within the season pool
      let lo = 0, hi = tsPool.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tsPool[mid] < ts) lo = mid + 1; else hi = mid; }
      return Math.round((lo / (tsPool.length - 1)) * 100);
    };
    for (const r of rows) {
      const bart = r[I.bart_player_id];
      if (!bart) continue;
      const cur = statLineByBart.get(bart);
      if (cur && cur.year >= year) continue;
      const g = r[I.games], pts = r[I.pts_pg], reb = r[I.reb_pg], ast = r[I.ast_pg], ts = r[I.ts_pct];
      if (pts == null && reb == null && ast == null) continue;
      const eligible = (g ?? 0) >= 10;
      const t10 = (v) => (typeof v === "number" ? Math.round(v * 10) : -1);
      statLineByBart.set(bart, {
        year,
        x: [
          t10(pts),
          t10(reb),
          t10(ast),
          typeof ts === "number" ? Math.round(ts * 1000) : -1,
          eligible ? pctOf(ts) : -1,
        ],
      });
    }
  }
}

const playerEntries = [...latestByBart.values()]
  .map((p) => ({ t: "p", n: p.name, b: p.bartId, tm: p.team, y: p.year }))
  .sort((a, b) => a.n.localeCompare(b.n));

// ---- COACHES (one entry per unique coach name; use latest team + active flag) ----
// Read both data sources: SR historical (coach-history.json) and ESPN snapshot
// (team-coaches.json). Build a name → { latest team, latest year, is_active }
// map keyed by coach name (collisions of distinct same-named coaches are
// surfaced as a single entry showing the most-recent team — the same trade-off
// we make in /coaches index).
const SRC = path.resolve("src/data");
let history = {};
let espn = {};
try { history = JSON.parse(fs.readFileSync(path.join(SRC, "coach-history.json"), "utf8")); } catch {}
try { espn = JSON.parse(fs.readFileSync(path.join(SRC, "team-coaches.json"), "utf8")); } catch {}
const LATEST_YEAR = 2026;
const coachLatest = new Map(); // name → { team, year }
for (const [team, byYear] of Object.entries(history)) {
  for (const [yearStr, s] of Object.entries(byYear)) {
    const year = parseInt(yearStr, 10);
    const cur = coachLatest.get(s.name);
    if (!cur || year > cur.year) coachLatest.set(s.name, { team, year });
  }
}
for (const [team, c] of Object.entries(espn)) {
  const cur = coachLatest.get(c.name);
  if (!cur || LATEST_YEAR > cur.year) coachLatest.set(c.name, { team, year: LATEST_YEAR });
}
// Dedupe by SLUG, not just name. The two sources can spell one person two
// ways ("Donte Jackson" in SR, "Donte' Jackson" on ESPN) — distinct map keys
// above, but identical slugs, so the dialog rendered two rows with the same
// React key pointing at the same /coaches/ page. On collision keep the SR
// spelling (history is the preferred source everywhere else in lib/coaches)
// and let either row's active flag win.
const bySlug = new Map();
for (const [name, info] of coachLatest.entries()) {
  const s = slug(name);
  const cur = bySlug.get(s);
  if (!cur) {
    bySlug.set(s, { name, info });
  } else {
    const active = Math.max(cur.info.year, info.year);
    // SR names come without the apostrophe; prefer the plain-ASCII one for
    // consistency with the coach page's own header, keep the freshest year.
    const keep = cur.name.length <= name.length ? cur.name : name;
    bySlug.set(s, { name: keep, info: { team: info.year >= cur.info.year ? info.team : cur.info.team, year: active } });
  }
}
const coachEntries = [...bySlug.entries()]
  .map(([s, { name, info }]) => ({
    t: "c",
    n: name,
    s,
    tm: info.team,
    a: info.year === LATEST_YEAR ? 1 : 0, // active flag
  }))
  .sort((a, b) => a.n.localeCompare(b.n));

/**
 * INTERNED SCHOOL NAMES. `tm` is a school name on every one of ~26k player and
 * coach rows, drawn from a set of ~400 — so the same few hundred strings are
 * written out tens of thousands of times, and they were the single largest
 * thing in this file. They are emitted once in `schools` and referenced by
 * index, which is a pure encoding change: the dialog resolves `tm` through
 * that array at load, where it already walks every entry once to stamp the
 * lowercased match keys.
 *
 * Shape: { schools: [...names], e: [...entries] }, `tm` an int index.
 */
const schools = [];
const schoolIx = new Map();
function internSchool(name) {
  if (name == null) return -1;
  let i = schoolIx.get(name);
  if (i === undefined) { i = schools.length; schools.push(name); schoolIx.set(name, i); }
  return i;
}
const entries = [...teamEntries, ...coachEntries, ...playerEntries].map((e) =>
  e.tm === undefined ? e : { ...e, tm: internSchool(e.tm) },
);
fs.writeFileSync(OUT, JSON.stringify({ schools, e: entries }));
const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT}`);
console.log(`  ${teamEntries.length.toLocaleString()} teams + ${coachEntries.length.toLocaleString()} coaches + ${playerEntries.length.toLocaleString()} players = ${entries.length.toLocaleString()} entries`);
console.log(`  ${schools.length} interned school names`);
console.log(`  file size: ${sizeKb} KB`);

/**
 * SIDECAR: the stat lines the palette shows, in their own file.
 *
 * They are deliberately NOT in search-index.json. Matching needs names and
 * nothing else, and that file is fetched on the first ⌘K and blocks the first
 * result — folding the numbers in took it from 1.0 MB to 2.3 MB, i.e. it more
 * than doubled the wait before anything can be typed against, to decorate at
 * most eight visible rows. Split, the index loads exactly as fast as it did
 * before this feature existed and the numbers arrive on their own schedule;
 * a row renders with an em dash until they land.
 *
 * Shape: { p: { <bartId>: [ppg*10, rpg*10, apg*10, ts*1000, tsPctile] },
 *          t: { <teamName>: [rank, wins, losses, net*10] } }
 * Ints, ×10/×1000 fixed-point: 26k rows of float keys is most of a megabyte on
 * its own. -1 means unknown.
 */
const STATS_OUT = path.join(ROOT, "search-stats.json");
const statsDoc = { p: {}, t: {} };
for (const p of playerEntries) {
  const line = statLineByBart.get(p.b);
  // Only a line from the season the row itself names — a stale one would
  // caption 25-26 next to numbers from an earlier stop.
  if (line && line.year === p.y) statsDoc.p[p.b] = line.x;
}
for (const t of teamEntries) {
  const tv = byName.get(t.n);
  if (tv && tv.rank != null) {
    statsDoc.t[t.n] = [tv.rank, tv.wins ?? 0, tv.losses ?? 0, tv.net != null ? Math.round(tv.net * 10) : -9999];
  }
}
fs.writeFileSync(STATS_OUT, JSON.stringify(statsDoc));
console.log(`Wrote ${STATS_OUT}`);
console.log(`  ${Object.keys(statsDoc.p).length.toLocaleString()} player lines + ${Object.keys(statsDoc.t).length.toLocaleString()} team lines`);
console.log(`  file size: ${(fs.statSync(STATS_OUT).size / 1024).toFixed(0)} KB`);
