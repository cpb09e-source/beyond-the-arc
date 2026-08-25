#!/usr/bin/env node
/**
 * build-clock-splits.mjs — shot selection and efficiency by where a possession
 * sat on the shot clock, per team-season, from the CBBD play-by-play archive.
 *
 *   public/data/clock-splits.json  →  { "<team>|<year>": {...} }
 *
 * WHAT IS BEING MEASURED. There is no shot-clock field in the feed — the only
 * time signal is `secondsRemaining`, the GAME clock, counting down within a
 * period. So the clock position of a shot is reconstructed: hold the time at
 * which the current possession began, and subtract.
 *
 * THE RESET RULE IS THE WHOLE MODEL. Time is measured from the last shot-clock
 * RESET, not from the possession's first touch, and an offensive rebound is a
 * reset. NCAA men's rules put the clock back to 20 on an offensive board, so a
 * shot twenty-five seconds into a possession that included one is an early-clock
 * shot, not a late one. Measuring from possession start instead would file every
 * second-chance putback under "late" and invert the finding.
 *
 * WHAT ENDS A POSSESSION — the same vocabulary build-second-chance.mjs walks,
 * deliberately, so the two reconcile:
 *   - a made field goal        (the ball changes hands)
 *   - a defensive rebound
 *   - a turnover
 *   - the end of a period      (a possession cannot span the break)
 *
 * FREE THROWS ARE NOT AN ENDING EVENT and are excluded from the tally outright.
 * The feed gives no way to tell an and-one from the last of two, so treating
 * `MadeFreeThrow` as a change of possession would end possessions that are still
 * live. They are skipped on both sides: never counted as a shot, never used as a
 * boundary. The cost is that a trip ending in free throws has no clock bucket,
 * which is honest — a foul is not a shot selection.
 *
 * THE GUARD RAIL. Any reconstructed elapsed time outside 0–40s is dropped
 * rather than clamped. Those come from a missed change-of-possession in the
 * feed, and clamping would pile every one of them onto the "late" bucket — the
 * exact bucket the stat exists to talk about. `dropped_rate` reports how often
 * it happened so a thin or broken season is visible instead of silent.
 *
 * SHOT-CLOCK ERA. NCAA men's went 35s → 30s for 2015-16. The buckets are fixed
 * in seconds, so 2014 and 2015 are on a 35-second clock and their "late" bucket
 * means something slightly different. Cross-era comparison is the consumer's
 * problem to caveat; the raw seconds are what is stored.
 *
 * Usage:
 *   node scripts/build-clock-splits.mjs
 *   node scripts/build-clock-splits.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/clock-splits.json");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

const isTurnover = (t) => typeof t === "string" && /turnover/i.test(t);
const isOffReb = (t) => t === "Offensive Rebound";
const isDefReb = (t) => t === "Defensive Rebound";
const isPeriodEnd = (t) => t === "End Period" || t === "End Game";

/** Regulation halves are 20:00; every overtime is 5:00. */
const periodStart = (period) => (period <= 2 ? 1200 : 300);

/** Where a shot sits on the clock. Three buckets, because a fourth splits the
 *  sample thinner than a mid-major season can carry. */
function bucket(elapsed) {
  if (elapsed <= 10) return "early";
  if (elapsed <= 20) return "mid";
  return "late";
}

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const share = (n, d) => (d > 0 ? r3(n / d) : null);

function eligibleGameIds(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) return null;
  const ids = new Set();
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    const prefix = String(g.game_id ?? "").split("-")[0];
    if (prefix) ids.add(Number(prefix));
  }
  return ids;
}

/** Same ordering rule as build-second-chance: period asc, game clock desc. */
function chronological(plays) {
  return plays
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = a.p.period ?? 0, pb = b.p.period ?? 0;
      if (pa !== pb) return pa - pb;
      const sa = a.p.secondsRemaining, sb = b.p.secondsRemaining;
      if (typeof sa === "number" && typeof sb === "number" && sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map((x) => x.p);
}

function blank() {
  const side = () => ({
    early: 0, mid: 0, late: 0,
    early_pts: 0, mid_pts: 0, late_pts: 0,
    early_fgm: 0, mid_fgm: 0, late_fgm: 0,
  });
  return { off: side(), def: side(), games: new Set(), kept: 0, dropped: 0 };
}

function run(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz"));
  if (files.length === 0) {
    console.log(`${season}: no play-by-play on disk — skipped`);
    return {};
  }

  const eligible = eligibleGameIds(season);
  const totals = new Map();
  let shots = 0, dropped = 0;

  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
    } catch (e) {
      console.warn(`   ! ${f}: ${e.message}`);
      continue;
    }

    // Group by game, projected down to the fields the walk needs. The raw rows
    // for a whole season do not fit in memory — build-second-chance learned
    // that at 3.5M plays and an OOM.
    const byGame = new Map();
    for (const p of rows) {
      if (eligible && !eligible.has(p.gameId)) continue;
      let g = byGame.get(p.gameId);
      if (!g) { g = []; byGame.set(p.gameId, g); }
      g.push({
        playType: p.playType,
        teamId: p.teamId,
        opponentId: p.opponentId,
        period: p.period,
        secondsRemaining: p.secondsRemaining,
        range: p.shotInfo?.range ?? null,
        made: p.shotInfo?.made ?? false,
        gameId: p.gameId,
      });
    }
    rows = null;

    for (const [, raw] of byGame) {
      const plays = chronological(raw);
      let period = null;
      let clockStart = null;   // secondsRemaining at the last shot-clock reset

      for (const p of plays) {
        if (p.period !== period) {
          period = p.period;
          clockStart = periodStart(period ?? 1);
        }
        const type = p.playType;

        if (isPeriodEnd(type)) { clockStart = null; continue; }

        const secs = p.secondsRemaining;

        // A shot: measure it BEFORE applying its own reset.
        if (p.range && p.range !== "free_throw") {
          if (typeof secs === "number" && typeof clockStart === "number") {
            const elapsed = clockStart - secs;
            if (elapsed >= 0 && elapsed <= 40) {
              const b = bucket(elapsed);
              const pts = p.made ? (p.range === "three_pointer" ? 3 : 2) : 0;
              const off = TEAM_MAP[p.teamId];
              const def = TEAM_MAP[p.opponentId];
              shots++;

              for (const [team, side] of [[off, "off"], [def, "def"]]) {
                if (!team?.name) continue;
                const key = `${team.name}|${season}`;
                let a = totals.get(key);
                if (!a) { a = blank(); totals.set(key, a); }
                a.games.add(p.gameId);
                a[side][b]++;
                a[side][`${b}_pts`] += pts;
                if (p.made) a[side][`${b}_fgm`]++;
                if (side === "off") a.kept++;
              }
            } else {
              dropped++;
              const off = TEAM_MAP[p.teamId];
              if (off?.name) {
                const key = `${off.name}|${season}`;
                let a = totals.get(key);
                if (!a) { a = blank(); totals.set(key, a); }
                a.dropped++;
              }
            }
          }
          // A made field goal ends the possession; a miss leaves it live for
          // the rebound that follows to decide.
          if (p.made && typeof secs === "number") clockStart = secs;
          continue;
        }

        // Resets and endings.
        if (isOffReb(type) || isDefReb(type) || isTurnover(type)) {
          if (typeof secs === "number") clockStart = secs;
        }
      }
    }
  }

  const out = {};
  for (const [key, a] of totals) {
    const off = a.off, def = a.def;
    const offN = off.early + off.mid + off.late;
    const defN = def.early + def.mid + def.late;
    if (offN === 0 && defN === 0) continue;

    // eFG counts a three as 1.5 makes; points/2 per attempt is the same number
    // and avoids carrying a separate three-make tally.
    const efg = (pts, n) => (n > 0 ? r3(pts / 2 / n) : null);

    out[key] = {
      clock_games: a.games.size,
      dropped_rate: share(a.dropped, a.kept + a.dropped),

      early_rate: share(off.early, offN),
      mid_rate: share(off.mid, offN),
      late_rate: share(off.late, offN),
      early_efg: efg(off.early_pts, off.early),
      mid_efg: efg(off.mid_pts, off.mid),
      late_efg: efg(off.late_pts, off.late),

      early_rate_def: share(def.early, defN),
      mid_rate_def: share(def.mid, defN),
      late_rate_def: share(def.late, defN),
      early_efg_def: efg(def.early_pts, def.early),
      mid_efg_def: efg(def.mid_pts, def.mid),
      late_efg_def: efg(def.late_pts, def.late),
    };
  }

  console.log(
    `${season}: ${Object.keys(out).length} team-seasons from ${files.length} slates  ` +
    `(${shots.toLocaleString()} shots placed on the clock, ` +
    `${dropped.toLocaleString()} dropped out of range)`,
  );
  return out;
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Reconstructing clock splits for ${list.length} season(s)…\n`);
const all = {};
for (const s of list) Object.assign(all, run(s));

let existing = {};
if (fs.existsSync(OUT)) {
  try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { existing = {}; }
}
const merged = { ...existing, ...all };
fs.writeFileSync(OUT, JSON.stringify(merged));
console.log(`\n✓ ${Object.keys(merged).length} team-seasons → ${path.relative(ROOT, OUT)}`);
