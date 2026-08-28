/**
 * export-epm-json.mjs — join the EPM fit (data/cbbd/<season>/epm.csv, CBBD
 * player ids) onto OUR Bart player ids and write public/data/epm-<season>.json
 * for the players grid to fetch.
 *
 * Join: normalized name (+ suffix-stripped) corroborated by team name. Same
 * cascade philosophy as refresh-portal's matchBart: exact name+team → exact
 * name unique → first-initial+last+team. Unmatched EPM rows are listed (usually
 * walk-ons who never appear in Bart's stat feed — harmless).
 *
 * Out shape: { season, built_at, zero_point, players: { <bart_player_id>: {
 *             epm, off, def, poss, rk, ewins, on_off } },
 *             meta: { matched, unmatched } }
 * RK = rank by EPM among players with >= MIN_POSS.
 *
 * This is also where EPM's ZERO POINT is set — the fit does not pin it, so it
 * is re-centred on the average possession here and eWins is recomputed from the
 * corrected value. See the long note in main(). Consequence for anyone changing
 * this file: epm.csv is left exactly as the fit produced it, so the prior chain
 * (build-epm-priors.mjs -> compute-epm.py --priors) never sees a corrected
 * number fed back into itself. Only the published copy moves.
 *
 * AFTER RUNNING THIS, re-run export-box-epm-json.mjs. Its arc scaling regresses
 * real EPM on the box estimate, so its intercept has to be re-fit against the
 * new zero point or every pre-2024 season floats ~1.3 above the corrected ones.
 *
 * Run: node scripts/export-epm-json.mjs --season 2026
 */

import fs from "node:fs";
import path from "node:path";
import { midrankPercentiles } from "./lib/percentile.mjs";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf("--season") + 1] || 2026);
const MIN_POSS = 300; // below this the RAPM is mostly shrinkage — exclude from RK
/**
 * Minutes floor for being given an EPM at all. Matches MIN_PG in
 * export-box-epm-json.mjs — the two must agree, or a player would get a real
 * EPM in one season and a suppressed one in another for the same role.
 *
 * Below this the fit is essentially the prior, and the prior is essentially
 * "how good is your team". Emitting that as a number invited exactly the wrong
 * reading; emitting nothing lets the UI say "—", which is the truth.
 */
/**
 * eWins RELIABILITY SHRINKAGE for low-usage players.
 *
 * eWins is EPM x possessions, and EPM for a low-usage player rests much more
 * heavily on the box prior — he simply does not end enough possessions for the
 * on-court half to say much about him specifically, and what the prior knows
 * about a 12%-usage role player is thin. The estimate is not wrong so much as
 * UNDER-EVIDENCED, and the honest response to a weak estimate is to move it
 * toward the average rather than to publish it at full confidence.
 *
 * So below the 34th percentile in usage, eWins is scaled toward zero on a ramp:
 * full weight at the 34th, LOW_USG_FLOOR at the 0th, linear between.
 *
 * TOWARD ZERO, NOT DOWNWARD — this is shrinkage, not a penalty. A low-usage
 * player with NEGATIVE eWins moves UP, because less confidence should pull an
 * estimate in from both tails, not just the flattering one. A punishment would
 * only ever subtract, and would be a claim about a player's worth rather than
 * about how much we know.
 *
 * Usage percentile is computed over the players who actually receive an EPM
 * (post minutes gate), so it ranks against the same population the column is
 * read against.
 */
const LOW_USG_PCTILE = Number(process.env.BTA_LOW_USG_PCTILE ?? 34);
const LOW_USG_FLOOR = Number(process.env.BTA_LOW_USG_FLOOR ?? 0.85);

/**
 * College points of margin per marginal win. Mirrors PTS_PER_WIN in
 * compute-epm-extras.py — eWins is recomputed here from the re-centred EPM, so
 * the two must agree or the column would change meaning depending on which
 * script last touched it.
 */
const PTS_PER_WIN = 30.0;

const MIN_PG = Number(args.includes("--min-pg") ? args[args.indexOf("--min-pg") + 1] : 15);
// Which fit to read and where to write it. Defaults are the shipped metric; the
// CALIBRATION pass overrides both so the prior-free fit lands in its own file.
const IN_CSV = args.includes("--in") ? args[args.indexOf("--in") + 1] : "epm.csv";
const OUT_JSON = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
import { playerKey } from "./lib/cbbd-join.mjs";

const DATA = path.resolve("public/data");

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

// Shared suffix/initial-tolerant person key. `norm` above only strips the
// literal Roman numerals, so it misses Bart's lowercase-L homoglyph ("Ace
// Glass lll") and it never reunites "J.J." with "JJ". Worse, the initial-last
// fallback below reads that homoglyph as the SURNAME — "Ace Glass lll" becomes
// "a lll" and can never meet CBBD's "a glass". Consulted as a last tier so no
// match that already worked can move.
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st")
  .replace(/[^a-z0-9]+/g, "");

/**
 * CSV line split that respects quoted fields.
 *
 * This used to be `l.split(",")`, on the stated assumption that our fields
 * never contain a comma. One does. 2024's fit carries
 *
 *     16908,"Kevin Cross, Jr.",Tulane,1570.2,1.1,0.82,1.92
 *
 * and a bare split turns that into eight fields, shifting every column one to
 * the right: his TEAM became " Jr.", his possessions became "Tulane" (NaN) and
 * his offensive EPM became 1570.2. The mangled name still matched a Bart id, so
 * epm-2024.json has been shipping bart 71281 with off +1570.2 and a null
 * possession count — visible on his profile page.
 *
 * One row in three seasons, but it is the row that would poison the new
 * possession-weighted zero point if the guard there ever lapsed, and a 1,570
 * on a per-100 metric is not a rounding matter.
 */
function parseCsvLine(l) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (inQ) {
      if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  // 1. EPM rows.
  const epmCsv = fs.readFileSync(path.resolve(`data/cbbd/${SEASON}/${IN_CSV}`), "utf8").trim().split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
  const head = parseCsvLine(epmCsv[0]);
  const col = (n) => head.indexOf(n);
  const iId = col("playerId"), iN = col("name"), iT = col("team"), iP = col("poss"),
    iO = col("offEpm"), iD = col("defEpm"), iE = col("epm");
  const rows = epmCsv.slice(1).map(parseCsvLine).map((r) => ({
    name: r[iN], team: r[iT], poss: +r[iP], off: +r[iO], def: +r[iD], epm: +r[iE],
  }));

  // ---- ZERO POINT: re-centre on the average POSSESSION ----
  //
  // EPM claims to be "impact vs. an average player", and it wasn't. Over the
  // full fit the possession-weighted mean was +1.18 (2024), +1.25 (2025) and
  // +1.31 (2026) — so the average player read as a clearly positive one, and
  // eWins, which is EPM times possessions, handed out ~1,600 wins that nobody
  // earned.
  //
  // WHY IT DRIFTS. Each observation carries five offensive and five defensive
  // coefficients plus a home indicator, against an efficiency already centred
  // on the league mean. That identifies offense MINUS defense — one team's
  // offense is the other's defense, so the difference is pinned by the data.
  // Nothing pins offense PLUS defense, and EPM is the sum. Its zero point is
  // therefore wherever ridge shrinkage happens to leave it, which is why it has
  // drifted upward three seasons running and why the bias sits mostly on the
  // defensive half (+0.96 of the 2026 +1.31).
  //
  // WHY POSSESSION-WEIGHTED AND NOT THE PLAIN MEAN. The plain mean is already
  // near zero (+0.23) because ridge centres the unweighted coefficient vector.
  // But good players play more, so the average POSSESSION is played by someone
  // at +1.31, and a possession is the unit the metric is denominated in. The
  // identity that has to hold is per-possession: five men's offensive impact is
  // five other men's defensive impact, so summed over every possession the two
  // net to zero.
  //
  // VERIFIED AT TEAM LEVEL, which is where a zero point can be checked against
  // something external. Aggregating each team's players (x5) against its
  // schedule-adjusted net rating — adj_net, which averages exactly 0.00 by
  // construction — the bias this removes and the bias actually present agree to
  // within 0.2 pts/100 in all three fitted seasons:
  //
  //          implied (5 x mean)   measured team bias   residual
  //   2024        5.92                  5.95             0.03
  //   2025        6.24                  6.38             0.14
  //   2026        6.54                  6.73             0.19
  //
  // (Checking against RAW net instead says the correction overshoots by ~2.1.
  // It doesn't — raw net averages +2.0 to +2.3 across D-I because of games
  // against non-D-I opponents. RAPM already controls for opponent, so adj_net
  // is the comparable target.)
  //
  // OFF AND DEF SEPARATELY, because each carries its own claim: an average
  // offensive player adds nothing on offense, an average defender nothing on
  // defense. Re-centring only the total would leave both halves wrong in a way
  // that happens to cancel.
  //
  // NOT CORRECTED HERE: the spread. Team-aggregated EPM has a slope of ~1.3-1.7
  // against adj_net, i.e. it is compressed relative to reality. That is ridge
  // shrinkage doing its job, and stretching it back out would inflate the noise
  // along with the signal — the same argument export-box-epm-json.mjs makes for
  // leaving the box estimate's raw fields alone. Fix the level, keep the scale.
  //
  // Computed over EVERY row, before the minutes gate below. The identity holds
  // over the whole population that played, not over the subset we publish.
  const round2 = (x) => Math.round(x * 100) / 100;
  const zero = (() => {
    let w = 0, so = 0, sd = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.poss) || !Number.isFinite(r.off) || !Number.isFinite(r.def)) continue;
      w += r.poss; so += r.off * r.poss; sd += r.def * r.poss;
    }
    return w > 0 ? { off: so / w, def: sd / w } : { off: 0, def: 0 };
  })();
  // EPM is shifted from the fit's OWN epm, not recomputed as off+def. The fit
  // rounds all three to 2dp independently, so off+def already disagrees with
  // epm by up to 0.01 in about a quarter of rows. Rebuilding epm from the
  // halves would import that rounding into the headline number and flip
  // near-ties for no reason — the check on this said the qualified pool's rank
  // order changed, which a constant shift must never do. Shifting epm directly
  // makes the order provably identical and leaves the pre-existing 0.01
  // off/def-vs-epm slack exactly where it already was.
  const epmShift = zero.off + zero.def;
  for (const r of rows) {
    r.off = round2(r.off - zero.off);
    r.def = round2(r.def - zero.def);
    r.epm = round2(r.epm - epmShift);
  }
  console.log(`  zero point: off -${zero.off.toFixed(3)}, def -${zero.def.toFixed(3)} `
    + `(EPM -${(zero.off + zero.def).toFixed(3)}) — possession-weighted over ${rows.length.toLocaleString()} fitted players`);

  // EPM-extras, keyed by name|team so it merges through the same join.
  // Optional — only present once compute-epm-extras.py has run.
  //
  // ON/OFF is taken from here. eWINS IS NOT, any more: compute-epm-extras.py
  // derives it as (epm / 100) * poss / PTS_PER_WIN from the RAW fit, so the
  // column on disk still carries the un-centred zero point. Shifting EPM is not
  // enough to fix it either — the correction is multiplied by possessions, so a
  // 2,100-possession starter was being credited ~0.9 wins he did not earn and a
  // 400-possession reserve ~0.17. That is a real reordering, not an offset: it
  // was paying players twice for minutes, once honestly and once through the
  // bias. So eWins is recomputed below from the re-centred EPM.
  //
  // On/off needs no such treatment. It is measured, not fitted — a difference
  // of two observed net ratings — so it has no ridge zero point to be wrong.
  const extras = new Map();
  const extrasPath = path.resolve(`data/cbbd/${SEASON}/epm-extras.csv`);
  if (fs.existsSync(extrasPath)) {
    const ex = fs.readFileSync(extrasPath, "utf8").trim().split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
    const eh = ex[0].split(",");
    const eN = eh.indexOf("name"), eT = eh.indexOf("team"), eW = eh.indexOf("ewins");
    const eOO = eh.indexOf("on_off"), eOOA = eh.indexOf("on_off_adj");
    for (const line of ex.slice(1)) {
      const r = parseCsvLine(line);
      const ewins = r[eW] === "" ? null : +r[eW];
      // Ship the LUCK-ADJUSTED on/off where we have it. Raw on/off carries
      // whatever the ball did while a player stood there; restating each side's
      // points at its own season three-point and free-throw rates lifts
      // year-over-year stability from r=0.072 to r=0.098 on 1,676 players with
      // 400+ possessions in both seasons, and tightens the spread ~20%.
      // The raw column stays in epm-extras.csv for diagnostics.
      const adj = eOOA >= 0 && r[eOOA] !== "" && r[eOOA] != null ? +r[eOOA] : null;
      const raw = eOO >= 0 && r[eOO] !== "" ? +r[eOO] : null;
      extras.set(`${norm(r[eN])}|${normTeam(r[eT])}`, { ewins, on_off: adj ?? raw });
    }
  }

  // 2. Bart players for the season → name/team indices.
  const bart = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${SEASON}.json`), "utf8"));
  const byKey = new Map();
  const byNameTeam = new Map(), byName = new Map(), byIL = new Map();
  // Minutes per game by bart id — Bart's raw_row column 54, the same one the
  // explorer reads. Needed for the MIN_PG gate; epm.csv only carries possessions.
  const mpgByBart = new Map();
  const usgByBart = new Map();
  for (const p of bart) {
    if (p.bart_player_id == null) continue;
    {
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      const u = st?.raw_row?.[6];      // Bart usage %
      const un = typeof u === "number" ? u : typeof u === "string" ? Number(u) : NaN;
      if (Number.isFinite(un)) usgByBart.set(p.bart_player_id, un);
      const v = st?.raw_row?.[54];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) mpgByBart.set(p.bart_player_id, n);
    }
    const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const nn = norm(p.name), nt = normTeam(t?.name);
    byNameTeam.set(`${nn}|${nt}`, p.bart_player_id);
    // Suffix/initial-tolerant key. null marks an ambiguous key (two players on
    // one team collapsing to the same stripped name) so it is never guessed.
    const pk = `${playerKey(p.name)}|${nt}`;
    if (!byKey.has(pk)) byKey.set(pk, p.bart_player_id);
    else if (byKey.get(pk) !== p.bart_player_id) byKey.set(pk, null);
    if (!byName.has(nn)) byName.set(nn, []);
    byName.get(nn).push(p.bart_player_id);
    const toks = nn.split(" ");
    if (toks.length >= 2) {
      const il = `${toks[0][0]} ${toks[toks.length - 1]}|${nt}`;
      if (!byIL.has(il)) byIL.set(il, p.bart_player_id);
    }
  }

  // 3. Join.
  const players = {};
  let matched = 0, suppressed = 0;
  const unmatched = [];
  const ewinsWas = [];
  // RK over qualified rows first (CBBD universe), then attach to matches.
  const qual = rows.filter((r) => r.poss >= MIN_POSS).sort((a, b) => b.epm - a.epm);
  const rkByNameTeam = new Map(qual.map((r, i) => [`${norm(r.name)}|${normTeam(r.team)}`, i + 1]));

  for (const r of rows) {
    const nn = norm(r.name), nt = normTeam(r.team);
    let bid = byNameTeam.get(`${nn}|${nt}`);
    if (bid == null) {
      const cands = byName.get(nn);
      if (cands && cands.length === 1) bid = cands[0];
    }
    if (bid == null) {
      const toks = nn.split(" ");
      if (toks.length >= 2) bid = byIL.get(`${toks[0][0]} ${toks[toks.length - 1]}|${nt}`);
    }
    if (bid == null) bid = byKey.get(`${playerKey(r.name)}|${nt}`) ?? null;
    if (bid == null) { unmatched.push(`${r.name} (${r.team})`); continue; }
    // Below the minutes floor we publish nothing rather than a shrunk-to-zero
    // number the reader would take at face value.
    const mpg = mpgByBart.get(bid);
    if (!Number.isFinite(mpg) || mpg < MIN_PG) { suppressed++; continue; }
    matched++;
    const ex = extras.get(`${nn}|${nt}`);
    // eWins from the re-centred EPM, on compute-epm-extras.py's own formula.
    // Derivable from epm.csv alone, so it no longer depends on epm-extras.csv
    // having been produced; on/off still does, because nothing here can
    // reconstruct it.
    const ewins = Number.isFinite(r.epm) && Number.isFinite(r.poss)
      ? Math.round((r.epm / 100) * r.poss / PTS_PER_WIN * 100) / 100
      : null;
    if (ex && typeof ex.ewins === "number") ewinsWas.push([ex.ewins, ewins]);
    players[bid] = {
      epm: r.epm, off: r.off, def: r.def, poss: r.poss,
      rk: rkByNameTeam.get(`${nn}|${nt}`) ?? null,
      ewins,
      ...(ex ? { on_off: ex.on_off } : {}),
    };
  }
  // Sanity line, not a gate: with the zero point removed the recomputed eWins
  // should differ from the shipped column by almost exactly (shift/100 * poss
  // / PTS_PER_WIN) and never by less. A near-zero mean delta here would mean
  // the re-centring silently didn't happen.
  if (ewinsWas.length) {
    const d = ewinsWas.map(([a, b]) => b - a);
    const mean = d.reduce((s, x) => s + x, 0) / d.length;
    console.log(`  eWins recomputed for ${ewinsWas.length.toLocaleString()} players — `
      + `mean change ${mean.toFixed(2)} wins, total ${d.reduce((s, x) => s + x, 0).toFixed(0)}`);
  }

  // ---- eWins reliability shrinkage (see LOW_USG_* above) ----
  // Ranked over the players who actually got an EPM, so the percentile matches
  // the population a reader compares them against.
  let shrunk = 0, minFactor = 1;
  {
    const withUsg = Object.keys(players)
      .map((bid) => ({ bid, u: usgByBart.get(Number(bid)) }))
      .filter((x) => Number.isFinite(x.u))
      .sort((a, b) => a.u - b.u);
    const n = withUsg.length;
    // Ties share a midrank, as everywhere else. Usage is a float so exact ties
    // are vanishingly rare and this changes essentially nothing today — it is
    // here so there is ONE convention in the codebase rather than one plus an
    // exception nobody remembers is an exception.
    const usgPct = midrankPercentiles(withUsg.map((x) => x.u), true);
    withUsg.forEach((x, i) => {
      const pct = n <= 1 ? 100 : (usgPct[i] ?? 0);
      if (pct >= LOW_USG_PCTILE) return;
      const factor = LOW_USG_FLOOR + (1 - LOW_USG_FLOOR) * (pct / LOW_USG_PCTILE);
      const p = players[x.bid];
      if (typeof p.ewins !== "number") return;
      p.ewins = Math.round(p.ewins * factor * 100) / 100;
      p.usg_shrink = Math.round(factor * 1000) / 1000;
      shrunk++;
      if (factor < minFactor) minFactor = factor;
    });
  }
  console.log(`  eWins shrinkage: ${shrunk.toLocaleString()} players under the `
    + `${LOW_USG_PCTILE}th usage percentile, factor ${minFactor.toFixed(3)}–1.000`);

  const out = {
    season: SEASON,
    built_at: new Date().toISOString(),
    min_poss: MIN_POSS,
    min_pg: MIN_PG,
    // What was subtracted to put zero at the average possession, so a reader of
    // this file can recover the raw fit and see that it was done at all.
    zero_point: { off: round2(zero.off), def: round2(zero.def), epm: round2(zero.off + zero.def) },
    players,
    meta: { matched, unmatched: unmatched.length, suppressed },
  };
  const fp = path.join(DATA, OUT_JSON ?? `epm-${SEASON}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log(`✓ wrote ${fp} — ${matched.toLocaleString()} matched, ${unmatched.length} unmatched, ${suppressed.toLocaleString()} below ${MIN_PG} mpg (suppressed)`);
  if (unmatched.length) console.log("  sample unmatched:", unmatched.slice(0, 10).join(" | "));
}

main();
