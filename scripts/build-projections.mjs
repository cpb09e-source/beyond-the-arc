#!/usr/bin/env node
/**
 * build-projections.mjs — assemble the 2026-27 team projection from the four
 * measured pieces, and write public/data/projections-2027.json.
 *
 * No network. Reads season-preview.json (rosters, already frozen) plus the
 * corrected EPM the rest of the site now runs on.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL, and where each number came from
 *
 * Every constant below was measured, and the study that measured it is named.
 * Nothing here is a guess dressed as a parameter.
 *
 * 1. PROJECT EACH PLAYER'S EPM
 *
 *    returning    0.715 x last + 0.23     study-returning-players.mjs
 *    transfer     0.503 x last + 0.27     same — a transfer keeps barely half
 *                                         his number, which is the single
 *                                         largest correction in the model
 *    freshman     tier prior by RSCI rank, adjusted by position
 *                                         study-freshman-impact.mjs
 *
 *    NO CLASS BUMPS. Bart applies +40%/+15%/+10% for So/Jr/Sr. The raw data
 *    supports that and conditioning on where the player started destroys it:
 *    below-average players gain ~+0.8 whatever their class (mean reversion,
 *    not development) while good juniors and seniors DECLINE (-0.46, -0.49).
 *    The persistence slopes above already encode the reversion correctly, so
 *    a bump on top would double-count it and inflate exactly the players about
 *    to get worse.
 *
 * 2. FRESHMAN PRIORS, by tier and position. Bigs are markedly more
 *    freshman-ready than guards at every tier — top-5 bigs averaged +3.09
 *    against +1.63 for top-5 guards, and the gap holds all the way down. EPM
 *    is two-way and rim protection translates from high school immediately;
 *    shot creation does not.
 *
 * 3. ALLOCATE MINUTES by projected EPM, using the measured share curve
 *    (study-minutes-allocation.mjs). Minutes are strictly zero-sum, so this is
 *    a ranking problem: the Nth-best man on a roster gets the Nth share.
 *
 * 4. TEAM RATING. Five men are on the floor at all times, so
 *
 *        projected net = 5 x SUM(projected EPM x minutes share)
 *
 *    That identity is not assumed — it is the one verified when EPM's zero
 *    point was corrected: aggregating a team's real players this way reproduced
 *    its schedule-adjusted net rating to within 0.2 pts/100 in all three
 *    fitted seasons.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It has no coaching term, no momentum term, no home-court term and no
 * defensive model separate from EPM. Bart carries all four. It also inherits
 * whatever the 31 July roster snapshot says, and Bart's feed has since gone
 * BACKWARDS — seniors returned to rosters, transfers reverted to their old
 * schools — so the rosters are the weakest input here, not the model.
 *
 * And the honest ceiling: recruit rank explains about a sixth of freshman
 * variance, and returning EPM about a third of next-season EPM. This projects
 * a central case, not a forecast anyone should bet into.
 *
 *   Run: node scripts/build-projections.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const OUT = path.join(DATA, "projections-2027.json");

// ---- measured constants -----------------------------------------------------
const PERSIST = {
  returning: { slope: 0.715, intercept: 0.23 },
  transfer:  { slope: 0.503, intercept: 0.27 },
};
// Freshman prior by RSCI tier (study-freshman-impact.mjs, mean freshman EPM).
const FR_TIER = { "1-5": 2.25, "6-15": 1.33, "16-40": 0.69, "41-60": 0.13, "61-100": -0.08, UR: -0.30 };
// Position multiplier on top of the tier prior, from the tier x position table.
// Bigs run roughly +0.45 EPM above the tier mean and guards roughly -0.20.
const FR_POS = { B: 0.45, W: 0.00, G: -0.20 };

/**
 * Prior for a roster player who carries no EPM at all — a returner or transfer
 * who did not clear the 15 mpg gate last season.
 *
 * These cannot be left unprojected. The first cut of this script skipped them,
 * which quietly broke the whole model: Liberty has six players with an EPM and
 * nine without, so the six absorbed all 200 minutes and its best player was
 * projected for 37.6 mpg while Duke's, on a fully-rated roster of fifteen, got
 * 21.0. Teams were being ranked by how much of their roster happened to clear a
 * minutes threshold last season, which is why Yale, Liberty and UNC Wilmington
 * turned up in the top 13.
 *
 * Measured rather than assumed: players below the gate in one season who
 * surface above it the next average -0.35 EPM (n=4,870, median -0.40). That is
 * conditional on emerging at all, so it flatters the pool — most never emerge —
 * which makes it a safely generous floor.
 */
const BENCH_PRIOR = -0.35;

/**
 * Minutes by rotation slot, as a share of 200. MEASURED from the actual
 * distribution over 1,812 team-seasons, 2022-2026 — mean mpg by minutes rank
 * was 32.7 / 30.6 / 28.5 / 26.2 / 23.6 / 20.7 / 17.7 / 14.8 / 12.2 / 9.6 /
 * 7.3 / 5.3, normalised here to sum to 200.
 *
 * Deliberately NOT the share curve from study-minutes-allocation.mjs. That one
 * ranks by pre-season EPM and so is flattened by every case where the ranking
 * was wrong; it is the right tool for asking whether the prior orders minutes,
 * and the wrong one for asking what a rotation looks like. A real rotation is
 * steep — the top man plays three times the tenth — and using the flat version
 * would have understated every star's contribution to his team's rating.
 */
const SLOT_SHARE = [28.5, 26.7, 24.9, 22.8, 20.6, 18.0, 15.4, 13.0, 10.7, 8.4, 6.4, 4.6];

const tierOf = (r) => r == null ? "UR" : r <= 5 ? "1-5" : r <= 15 ? "6-15" : r <= 40 ? "16-40" : r <= 60 ? "41-60" : "61-100";
const inches = (h) => { const m = /^(\d+)-(\d+)/.exec(h ?? ""); return m ? +m[1] * 12 + +m[2] : null; };
const posBucket = (ht) => { const i = inches(ht); if (i == null) return "W"; return i >= 81 ? "B" : i <= 75 ? "G" : "W"; };
const r2 = (x) => x == null ? null : Math.round(x * 100) / 100;

const preview = JSON.parse(fs.readFileSync(path.join(DATA, "season-preview.json"), "utf8"));

const teams = [];
for (const [teamName, t] of Object.entries(preview.teams ?? {})) {
  const roster = (t.roster ?? []).map((p) => {
    let proj = null, basis = null;
    if (typeof p.epm === "number" && (p.status === "returning" || p.status === "transfer")) {
      const k = PERSIST[p.status];
      proj = k.slope * p.epm + k.intercept;
      basis = p.status === "returning" ? "returning EPM" : "transfer EPM (discounted)";
    } else if (p.status === "newcomer" || p.cls === "Fr") {
      const tier = tierOf(p.rsci);
      proj = FR_TIER[tier] + FR_POS[posBucket(p.ht)];
      basis = `freshman prior (RSCI ${p.rsci ?? "unranked"})`;
    } else if (typeof p.epm === "number") {
      // Has a number but an unexpected status — treat as a returner rather than
      // discard a real measurement.
      proj = PERSIST.returning.slope * p.epm + PERSIST.returning.intercept;
      basis = "returning EPM";
    } else {
      // On the roster, no EPM: below last season's minutes gate. See BENCH_PRIOR.
      proj = BENCH_PRIOR;
      basis = "bench prior (under the minutes gate)";
    }
    return { ...p, proj_epm: proj, basis };
  });

  // EVERY player is ranked, so a roster is never credited for the minutes of
  // the teammates it happens to be missing a number for.
  const ranked = [...roster].sort((a, b) => b.proj_epm - a.proj_epm);
  const shares = SLOT_SHARE.slice(0, ranked.length);
  const tot = shares.reduce((s, x) => s + x, 0) || 1;
  ranked.forEach((p, i) => {
    // Beyond the rotation there are no minutes to give.
    p.min_share = i < SLOT_SHARE.length ? shares[i] / tot : 0;
    p.mpg = r2(p.min_share * 200);
  });
  const rankable = ranked;

  // 5 x minutes-weighted mean EPM — the identity verified when the zero point
  // was corrected.
  const net = 5 * rankable.reduce((s, p) => s + p.proj_epm * p.min_share, 0);

  teams.push({
    team: teamName,
    conf: t.conf ?? null,
    bart_rank: t.rank ?? null,
    bart_proj_w: t.proj_w ?? null,
    bart_proj_l: t.proj_l ?? null,
    proj_net: r2(net),
    // Split the same sum into what returns vs what arrives — the most useful
    // single thing about a 2026-27 roster.
    from_returning: r2(5 * rankable.filter((p) => p.status === "returning").reduce((s, p) => s + p.proj_epm * p.min_share, 0)),
    from_transfer: r2(5 * rankable.filter((p) => p.status === "transfer").reduce((s, p) => s + p.proj_epm * p.min_share, 0)),
    from_freshman: r2(5 * rankable.filter((p) => p.status === "newcomer").reduce((s, p) => s + p.proj_epm * p.min_share, 0)),
    ret_min_share: r2(rankable.filter((p) => p.status === "returning").reduce((s, p) => s + p.min_share, 0)),
    roster: roster
      .map((p) => ({
        name: p.name, bart_id: p.bart_id, cls: p.cls, ht: p.ht,
        status: p.status, from: p.from ?? null, rsci: p.rsci ?? null,
        link: p.link === true,
        last_epm: r2(p.epm), proj_epm: r2(p.proj_epm), mpg: p.mpg ?? null,
        min_share: p.min_share == null ? null : Math.round(p.min_share * 1000) / 1000,
        basis: p.basis,
      }))
      .sort((a, b) => (b.proj_epm ?? -99) - (a.proj_epm ?? -99)),
  });
}

teams.sort((a, b) => b.proj_net - a.proj_net);
teams.forEach((t, i) => { t.rank = i + 1; });

const out = {
  season: 2027,
  label: preview.label ?? "2026-27",
  built_at: new Date().toISOString(),
  roster_snapshot: preview.built_at ?? null,
  method: {
    returning: "0.715 x last EPM + 0.23",
    transfer: "0.503 x last EPM + 0.27",
    freshman: "RSCI tier prior, adjusted by position (bigs +0.45, guards -0.20)",
    minutes: "measured share-by-slot curve, ranked on projected EPM",
    team: "5 x sum(projected EPM x minutes share)",
  },
  teams,
};
fs.writeFileSync(OUT, JSON.stringify(out));

console.log(`✓ wrote ${OUT} — ${teams.length} teams`);
console.log(`\ntop 15 by projected net rating:\n`);
console.log("  rk  team               conf   proj net   ret/xfer/fr      Bart rk");
for (const t of teams.slice(0, 15)) {
  console.log(
    `  ${String(t.rank).padStart(2)}  ${t.team.padEnd(18)} ${String(t.conf ?? "").padEnd(5)}  ` +
    `${String(t.proj_net).padStart(7)}   ${String(t.from_returning).padStart(5)}/${String(t.from_transfer).padStart(5)}/${String(t.from_freshman).padStart(5)}   ${t.bart_rank ?? "-"}`,
  );
}
const withBart = teams.filter((t) => t.bart_rank != null);
const mx = withBart.reduce((s, t) => s + t.rank, 0) / withBart.length;
const my = withBart.reduce((s, t) => s + t.bart_rank, 0) / withBart.length;
let sxy = 0, sxx = 0, syy = 0;
for (const t of withBart) { sxy += (t.rank - mx) * (t.bart_rank - my); sxx += (t.rank - mx) ** 2; syy += (t.bart_rank - my) ** 2; }
console.log(`\nagreement with Bart's preseason T-Rank order: r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} over ${withBart.length} teams`);
