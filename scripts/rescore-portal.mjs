/**
 * rescore-portal.mjs — re-rank the transfer portal on EPM.
 *
 * Rewrites public/data/portal.json in place: attaches `epm` and `pvs` to every
 * entry, recomputes `stars`, and rebuilds `transfer_classes`. Reads only what's
 * already on disk — no On3 call, no Supabase — so it's safe to re-run and it
 * respects the data freeze.
 *
 *   node scripts/rescore-portal.mjs
 *
 * ---------------------------------------------------------------------------
 * THE SCORE
 *
 * Portal Value Score (PVS) = EPM × role weight.
 *
 *   EPM   points per 100 possessions the player adds over an average D-I
 *         player. Real play-by-play fit (epm-<year>.json) where we have it,
 *         box-score estimate (box-epm-<year>.json) filling the rest — the same
 *         precedence readImpactForYear and compute-player-ranks use, so the
 *         portal can never quote a different EPM than the player's own page.
 *
 *   role  min(1, MPG / 28) ^ 0.7. A rate stat alone would rank a 9-minute
 *         bench player off a hot 200-possession sample above a 32-minute
 *         starter. The exponent softens the taper: 14 MPG keeps ~62% of its
 *         weight rather than 50%, because a half-time contributor is worth
 *         appreciably more than half a starter, not exactly half.
 *
 * Negative EPM times a big role goes further negative, which is correct — a
 * below-average player who played 30 minutes did more damage than one who
 * played 12.
 *
 * NO CONFERENCE MULTIPLIER, and that's a measured decision rather than an
 * omission. Across all 4,953 ranked 2026 players, power-conference EPM averages
 * 1.65 against 0.37 for everyone else (p90: 3.85 vs 1.89) on effectively
 * identical possession counts. EPM already separates the tiers on its own, so
 * layering conf-tiers.ts on top — as BTA PRTG did — would count level of
 * competition twice and inflate every power-conference transfer.
 *
 * STAR TIERS are fixed cutoffs, not percentiles, so a player's tier doesn't
 * drift as other players enter or leave the portal. Chosen against the current
 * distribution to land roughly 2 / 12 / 28 / 32 / 27 percent.
 *
 * CLASS NET is a straight sum: Σ PVS(in) − Σ PVS(out) over 2★-and-up moves.
 * The old formula added a flat +8 per 5★ and +5 per 4★ on top of summed BTA
 * PRTG. Those constants were sized for PRTG's 0–50 range; against PVS, which
 * tops out near 5.5, a single +8 would outweigh an entire recruiting class. The
 * sum already rewards star power — an elite transfer contributes 5 where a
 * fringe starter contributes 1.
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const PORTAL = path.join(DATA, "portal.json");

// Minutes that count as a full-time role. A 28+ MPG player carries full weight.
const FULL_MPG = 28;
const ROLE_EXP = 0.7;

// Same production baseline the portal table filters on, so a player can't be
// starred without also being visible.
const MIN_GP = 10, MIN_MPG = 12, MIN_PPG = 4;

/**
 * RECALIBRATED when EPM's zero point moved (export-epm-json.mjs, 2026-08).
 *
 * These are fixed cutoffs on a PVS built from EPM, so they are only meaningful
 * relative to where EPM's zero sits — and EPM's zero was wrong by +1.18 to
 * +1.31 depending on the season. Re-running the rescore against the corrected
 * scale without touching these took the distribution from
 *
 *     12 / 64 / 156 / 177 / 149      (2.2 / 11.5 / 28.0 / 31.7 / 26.7 %)
 * to  8 / 21 /  74 / 103 / 331       (1.5 /  3.9 / 13.8 / 19.2 / 61.6 %)
 *
 * — 328 players demoted and 10 promoted, none of whom had played a game in
 * between. The old numbers were calibrated against an inflated scale; leaving
 * them would have silently marked most of the portal down.
 *
 * Re-chosen against the corrected PVS to restore the distribution this file
 * already documents as the intent (2 / 12 / 28 / 32 / 27), which lands at
 * 1.9 / 12.7 / 27.6 / 30.7 / 27.2. Still FIXED, not percentiles, so a player's
 * tier does not drift as others enter or leave the portal — the calibration is
 * a one-off against a corrected scale, not a change of method.
 *
 * If EPM's zero point ever moves again, these move with it. That is the tell
 * that they are scale-bound constants rather than free parameters.
 */
function starsForPvs(v) {
  if (v >= 3.1) return 5;
  if (v >= 1.7) return 4;
  if (v >= 0.5) return 3;
  if (v >= -0.4) return 2;
  return 1;
}

// ---- EPM, real fit first then box estimate ----
const epmCache = new Map();
function epmForYear(year) {
  if (epmCache.has(year)) return epmCache.get(year);
  const out = new Map();
  for (const [file, fillOnly] of [[`epm-${year}.json`, false], [`box-epm-${year}.json`, true]]) {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const [id, v] of Object.entries(j.players ?? {})) {
      if (typeof v?.epm !== "number" || !Number.isFinite(v.epm)) continue;
      const k = Number(id);
      if (fillOnly && out.has(k)) continue;
      out.set(k, v.epm);
    }
  }
  epmCache.set(year, out);
  return out;
}

const portal = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
const entries = portal.entries ?? [];

let joined = 0, scored = 0;
for (const e of entries) {
  const epm =
    e.last_year != null && e.bart_player_id != null
      ? epmForYear(e.last_year).get(e.bart_player_id) ?? null
      : null;
  e.epm = epm;
  const eligible =
    epm !== null && (e.gp ?? 0) >= MIN_GP && (e.mpg ?? 0) >= MIN_MPG && (e.ppg ?? 0) >= MIN_PPG;
  if (epm !== null) joined++;
  if (eligible) {
    const role = Math.pow(Math.min(1, (e.mpg ?? 0) / FULL_MPG), ROLE_EXP);
    e.pvs = Math.round(epm * role * 1000) / 1000;
    e.stars = starsForPvs(e.pvs);
    scored++;
  } else {
    e.pvs = null;
    e.stars = 0;
  }
}

// ---- transfer classes ----
const perSchool = new Map();
function bucket(name, conf) {
  let b = perSchool.get(name);
  if (!b) { b = { school: name, conference: conf ?? null, in_players: [], out_players: [] }; perSchool.set(name, b); }
  return b;
}
for (const e of entries) {
  if (!e.team_from || !e.team_to) continue;
  if (typeof e.pvs !== "number" || e.stars < 2) continue;
  const base = {
    cbba_player_id: e.cbba_player_id,
    bart_player_id: e.bart_player_id,
    name: e.name,
    epm: e.epm,
    pvs: e.pvs,
    stars: e.stars,
  };
  bucket(e.team_from, e.conf_from).out_players.push({ ...base, counter_team: e.team_to, counter_conf: e.conf_to });
  bucket(e.team_to, e.conf_to).in_players.push({ ...base, counter_team: e.team_from, counter_conf: e.conf_from });
}

const POWER = new Set(["ACC", "B10", "B12", "SEC", "BE"]);
const allRows = [];
for (const b of perSchool.values()) {
  const sum = (a) => a.reduce((s, p) => s + (p.pvs ?? 0), 0);
  b.in_players.sort((x, y) => (y.pvs ?? 0) - (x.pvs ?? 0));
  b.out_players.sort((x, y) => (y.pvs ?? 0) - (x.pvs ?? 0));
  allRows.push({
    school: b.school,
    conference: b.conference,
    net: Math.round((sum(b.in_players) - sum(b.out_players)) * 100) / 100,
    in_count: b.in_players.length,
    out_count: b.out_players.length,
    in_players: b.in_players,
    out_players: b.out_players,
  });
}
const top_overall = [...allRows].sort((a, b) => b.net - a.net).slice(0, 10);
const worst_power = allRows
  .filter((r) => r.conference && POWER.has(r.conference))
  .sort((a, b) => a.net - b.net)
  .slice(0, 10);
const by_school = {};
for (const r of allRows) by_school[r.school] = r;

portal.transfer_classes = { top_overall, worst_power, by_school };
portal.scoring = {
  metric: "pvs",
  formula: "EPM * min(1, MPG/28)^0.7",
  star_cutoffs: [-0.4, 0.5, 1.7, 3.1],
  rescored_at: new Date().toISOString(),
};
fs.writeFileSync(PORTAL, JSON.stringify(portal));

const tiers = [0, 0, 0, 0, 0, 0];
for (const e of entries) tiers[e.stars ?? 0]++;
console.log(`portal rescored on EPM`);
console.log(`  ${entries.length.toLocaleString()} entries · ${joined.toLocaleString()} joined an EPM · ${scored.toLocaleString()} cleared the baseline and were starred`);
console.log(`  tiers  5★ ${tiers[5]}  4★ ${tiers[4]}  3★ ${tiers[3]}  2★ ${tiers[2]}  1★ ${tiers[1]}  unrated ${tiers[0]}`);
console.log(`  ${allRows.length} schools ranked · best ${top_overall[0]?.school} ${top_overall[0]?.net.toFixed(1)} · worst power ${worst_power[0]?.school} ${worst_power[0]?.net.toFixed(1)}`);
