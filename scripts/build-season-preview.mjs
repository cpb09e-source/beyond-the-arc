/**
 * build-season-preview.mjs — builds the 2026-27 "next season" preview artifact.
 *
 * Pulls Bart Torvik's living offseason data for the upcoming season:
 *   - getadvstats.php?year=2027  → projected rosters (returners + transfers on
 *     their NEW teams, with last season's stat line carried)
 *   - 2027_team_results.csv      → preseason T-Rank projections (rank, proj W/L,
 *     adj OE/DE, barthag)
 * joins it against OUR frozen 2026 data (players-by-year/2026 + player-ranks)
 * to tag each player returning / transfer / newcomer and attach their BTA PRTG,
 * then writes ONE self-contained file:
 *
 *   public/data/season-preview.json
 *
 * Deliberately OUTSIDE the main pipeline: the 2027 rows carry 2026 stats, so
 * feeding them into export/ranks would duplicate seasons and corrupt cohorts.
 * The team page renders this via a client fetch, which means a daily refresh is
 * just: node scripts/build-season-preview.mjs && netlify deploy --prod
 * (single-file upload, ~30s, no site rebuild). See scripts/daily-refresh.mjs.
 *
 * Run: node scripts/build-season-preview.mjs
 */

import fs from "node:fs";
import path from "node:path";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};
const YEAR = 2027; // Bart's year key for the 2026-27 season
const LABEL = "2026-27";
const PREV_YEAR = 2026;
const DATA = path.resolve("public/data");
const OUT = path.join(DATA, "season-preview.json");

// Minimal CSV parser (quoted fields, embedded commas — e.g. hometowns).
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Class handling. Bart's 2027 feed (and On3 eligibility) carry LAST season's
// class, so a 2025-26 freshman still reads "Fr" — advance everyone who played in
// 2026 by one year for the 26-27 season. Incoming newcomers stay Fr and are
// never passed through here.
const CLASS_NEXT = { Fr: "So", So: "Jr", Jr: "Sr", Sr: "Gr", Gr: "Gr" };
function normClass(s) {
  const t = (s ?? "").toLowerCase();
  if (t.startsWith("fr")) return "Fr";
  if (t.startsWith("so")) return "So";
  if (t.startsWith("ju") || t.startsWith("jr")) return "Jr";
  if (t.startsWith("se") || t.startsWith("sr")) return "Sr";
  if (t.startsWith("gr")) return "Gr";
  return null;
}
const advanceClass = (s) => { const c = normClass(s); return c ? CLASS_NEXT[c] : null; };

async function main() {
  console.log(`🔮 season preview build — ${LABEL} (Bart year ${YEAR})\n`);

  // ---- 1. Upcoming-season rosters (Bart, living feed) ----
  const advText = await (await fetch(`https://barttorvik.com/getadvstats.php?year=${YEAR}&csv=1`, { headers: UA })).text();
  const adv = parseCsv(advText);
  console.log(`  Bart ${YEAR} roster rows: ${adv.length}`);

  // ---- 2. Preseason team projections ----
  const teamText = await (await fetch(`https://barttorvik.com/${YEAR}_team_results.csv`, { headers: UA })).text();
  const teamRows = parseCsv(teamText);
  const th = teamRows[0];
  const tIdx = (name) => th.findIndex((h) => h.trim().toLowerCase() === name);
  const iRank = tIdx("rank"), iTeam = tIdx("team"), iConf = tIdx("conf"),
    iAdjOe = tIdx("adjoe"), iAdjDe = tIdx("adjde"), iBart = tIdx("barthag"),
    iPW = th.findIndex((h) => /proj\.? w/i.test(h)), iPL = th.findIndex((h) => /proj\.? l/i.test(h));
  const teams = {};
  for (const r of teamRows.slice(1)) {
    const name = r[iTeam];
    if (!name) continue;
    teams[name] = {
      rank: num(r[iRank]),
      conf: r[iConf] ?? null,
      proj_w: num(r[iPW]) != null ? Math.round(num(r[iPW])) : null,
      proj_l: num(r[iPL]) != null ? Math.round(num(r[iPL])) : null,
      adjoe: num(r[iAdjOe]), adjde: num(r[iAdjDe]), barthag: num(r[iBart]),
      roster: [],
    };
  }
  console.log(`  Bart ${YEAR} team projections: ${Object.keys(teams).length}`);

  // ---- 3. Our frozen 2026 data — prior team + BTA PRTG per bart id ----
  const prev = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${PREV_YEAR}.json`), "utf8"));
  const prevTeamById = new Map();
  for (const p of prev) {
    if (p.bart_player_id != null) {
      const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      prevTeamById.set(p.bart_player_id, t?.name ?? null);
    }
  }
  // Height (Bart raw_row[26], e.g. "6-5") by bart id, most-recent season wins.
  // Portal-added and official-added rows carry no height; a transfer whose last
  // D-I season predates 2026 (Gehrig Normand, last played 2025) isn't in the
  // 2026 feed either, so scan a few recent years to backfill.
  const heightById = new Map();
  for (const yr of [PREV_YEAR - 3, PREV_YEAR - 2, PREV_YEAR - 1, PREV_YEAR]) {
    let list;
    try { list = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${yr}.json`), "utf8")); }
    catch { continue; }
    for (const p of list) {
      if (p.bart_player_id == null) continue;
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      const h = Array.isArray(st?.raw_row) ? st.raw_row[26] : null;
      if (h) heightById.set(p.bart_player_id, h); // ascending years → latest overwrites
    }
  }
  // Which bart ids have a profile page (so the roster can link their name).
  // Mirrors readRankedPlayerIds: a rank file, OR their latest (2026) season was
  // a freshman year, OR a manual include. Every preview roster player last
  // played 2026, so the 2027 row's class (carryover) === "Fr" ⇒ freshman page.
  const rankedSet = new Set(
    fs.readdirSync(path.join(DATA, "player-ranks"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseInt(f.replace(".json", ""), 10))
      .filter(Number.isFinite),
  );
  const MANUAL_PAGE_IDS = new Set([73737]); // keep in sync with static-data.ts
  const hasPage = (bartId, cls) =>
    bartId != null && (rankedSet.has(bartId) || cls === "Fr" || MANUAL_PAGE_IDS.has(bartId));

  // Last-season (2026) stat line + percentiles from the rank file, so the
  // preview roster fills the SAME columns as a normal roster table (BTA PRTG,
  // PIR, PPG, RPG, APG, 3P%, FT% + percentile chips). Percentages are stored
  // 0-1 (the table multiplies ×100). null if the player has no rank file.
  const round1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);
  // Rank files that still carry only the retired BTA PRTG column. Reported at
  // the end as a coverage figure, not a warning — see the note there.
  let prtgOnly = 0;
  const NULL_STATS = {
    epm: null, epmP: null, pir: null, pirP: null, pts: null, ptsP: null,
    reb: null, rebP: null, ast: null, astP: null, fg3: null, fg3P: null, ft: null, ftP: null,
    ts: null, tsP: null, usg: null, usgP: null,
  };
  const statsFor = (bartId) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DATA, "player-ranks", `${bartId}.json`), "utf8"));
      const s = ((j.seasonRanks || []).find((x) => x.year === PREV_YEAR) || {}).stats || {};
      const v = (k) => (typeof s[k]?.value === "number" ? s[k].value : null);
      const p = (k) => (typeof s[k]?.percentile === "number" ? s[k].percentile : null);
      // The impact column is EPM now. This script used to read `bta_portg`,
      // which the rank pipeline stopped writing: sampled 259 players with a
      // 2026 season, 220 carried `epm`, 26 carried `bta_portg`, and ZERO
      // carried both — so the old read returned null for ~90% of the roster.
      if (v("epm") === null && v("bta_portg") !== null) prtgOnly++;
      const asFrac = (k) => { const x = v(k); return x == null ? null : x > 1.5 ? x / 100 : x; }; // → 0-1
      return {
        epm: round1(v("epm")), epmP: p("epm"),
        pir: round1(v("pir")), pirP: p("pir"),
        pts: round1(v("pts_pg")), ptsP: p("pts_pg"),
        reb: round1(v("reb_pg")), rebP: p("reb_pg"),
        ast: round1(v("ast_pg")), astP: p("ast_pg"),
        fg3: asFrac("fg3_pct"), fg3P: p("fg3_pct"),
        ft: asFrac("ft_pct"), ftP: p("ft_pct"),
        // The rank files key usage as `usage`, not `usage_pct` — sampled 259
        // players with a 2026 season: 259 carried ts_pct, ZERO carried
        // usage_pct. Both are stored 0-100 and the table wants 0-1.
        ts: asFrac("ts_pct"), tsP: p("ts_pct"),
        usg: asFrac("usage"), usgP: p("usage"),
      };
    } catch { return null; }
  };

  // ---- 4. Build rosters with status tags ----
  // Bart adv columns (same 67-col layout as every season): 0 name, 1 school,
  // 2 conf, 25 class, 26 height, 32 bart id; per-game tail: pts@-4, reb@-8,
  // ast@-7 (see sync-bart.mts COL notes).
  let ret = 0, xfer = 0, newc = 0, unmatchedTeam = 0;
  for (const r of adv) {
    const teamName = r[1];
    const t = teams[teamName];
    if (!t) { unmatchedTeam++; continue; }
    const bartId = num(r[32]);
    const L = r.length;
    const prevTeam = bartId != null ? (prevTeamById.get(bartId) ?? null) : null;
    const status = prevTeam == null ? "newcomer" : prevTeam === teamName ? "returning" : "transfer";
    if (status === "returning") ret++; else if (status === "transfer") xfer++; else newc++;
    const st = bartId != null ? statsFor(bartId) : null;
    t.roster.push({
      name: r[0],
      bart_id: bartId,
      cls: advanceClass(r[25]),    // last season's class (Bart carryover) → 26-27
      ht: r[26] || null,
      status,
      link: hasPage(bartId, r[25]),
      ...(status === "transfer" ? { from: prevTeam } : {}),
      // last-season line (carryover — no 2026-27 games yet). Rank file when we
      // have it, else the raw Bart row for the box-score basics.
      ...(st ?? { ...NULL_STATS, pts: num(r[L - 4]), reb: num(r[L - 8]), ast: num(r[L - 7]) }),
    });
  }
  console.log(`  roster tags (pre-overlay): ${ret} returning / ${xfer} transfers / ${newc} newcomers (${unmatchedTeam} rows w/o team match)`);

  // ---- 5. Portal overlay ----
  // Bart's offseason feed lags on transfer placement (players sit on their OLD
  // school until he processes the move). Our portal.json (On3 pull) already
  // knows the committed destination, so relocate those players now — this makes
  // the preview more current than Bart's raw feed. Names: On3 says "Iowa State",
  // Bart says "Iowa St." — normalize both to join.
  const normTeam = (s) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\buniversity\b|\bthe\b/g, "")
      .replace(/\bstate\b/g, "st")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  const bartTeamByNorm = new Map(Object.keys(teams).map((n) => [normTeam(n), n]));
  const normName = (s) =>
    (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  let moved = 0, addedFromPortal = 0, destMiss = 0, lowSampleSuppressed = 0;
  try {
    const portal = JSON.parse(fs.readFileSync(path.join(DATA, "portal.json"), "utf8"));
    const entries = Array.isArray(portal) ? portal : portal.entries ?? portal.players ?? [];
    for (const e of entries) {
      if (e?.status !== "Transferred" || !e.team_to || e.bart_player_id == null) continue;
      const destName = bartTeamByNorm.get(normTeam(e.team_to));
      if (!destName) { destMiss++; continue; }
      const dest = teams[destName];
      // Find + remove them from whichever Bart roster they currently sit on.
      let carried = null, fromTeam = null;
      for (const [tn, t] of Object.entries(teams)) {
        const i = t.roster.findIndex((p) => p.bart_id === e.bart_player_id);
        if (i >= 0) { carried = t.roster[i]; fromTeam = tn; t.roster.splice(i, 1); break; }
      }
      if (fromTeam === destName && carried) { dest.roster.push(carried); continue; } // already placed
      if (carried) {
        dest.roster.push({ ...carried, status: "transfer", from: fromTeam });
        moved++;
      } else {
        // Not in Bart's feed (dropped or non-D1 last year) — build from portal
        // stats. On3's stat line can be an OLD season (a player who sat out last
        // year keeps his prior line), so a tiny sample (<8 gp or <5 mpg) yields a
        // junk rating like -25 off garbage-time minutes. Suppress those → "—".
        const lowSample = (e.gp ?? 0) < 8 || (e.mpg ?? 0) < 5;
        if (lowSample) lowSampleSuppressed++;
        dest.roster.push({
          name: e.name, bart_id: e.bart_player_id, cls: advanceClass(e.eligibility), ht: null,
          status: "transfer", from: e.team_from ?? e.last_team ?? null,
          link: hasPage(e.bart_player_id, e.eligibility === "Freshman" ? "Fr" : null),
          ...NULL_STATS,
          ...(lowSample ? {} : {
            pts: e.ppg ?? null, reb: e.rpg ?? null, ast: e.apg ?? null,
            pir: round1(e.pir), epm: round1(e.epm),
          }),
        });
        addedFromPortal++;
      }
    }
  } catch (err) {
    console.log(`  ⚠ portal overlay skipped: ${err.message}`);
  }
  console.log(`  portal overlay: ${moved} relocated + ${addedFromPortal} added from portal (${destMiss} destinations unmatched, ${lowSampleSuppressed} low-sample stats suppressed)`);

  // ---- 5b. Incoming-freshmen overlay (recruits-2026.json) ----
  // Bart's stat feed only lists players with prior D-I production, so true HS
  // freshmen (Bryson Howard, etc.) never appear. Add committed recruits from the
  // one-time On3 pull (scripts/scrape-recruits.mjs) as newcomers — no stats yet
  // (they've played zero college games), so they slot in with a "New" badge and
  // empty box score, exactly like the other newcomers. Static: the daily refresh
  // does NOT re-scrape recruits (recruiting is closed).
  let recruitsAdded = 0, recruitsDup = 0, recruitsNoTeam = 0;
  let recruitAttribution = null;
  try {
    const rj = JSON.parse(fs.readFileSync(path.join(DATA, "recruits-2026.json"), "utf8"));
    const recruits = Array.isArray(rj) ? rj : rj.recruits ?? [];
    recruitAttribution = rj.attribution ?? null;
    for (const rc of recruits) {
      const destName = bartTeamByNorm.get(normTeam(rc.team));
      if (!destName) { recruitsNoTeam++; continue; }
      const t = teams[destName];
      // Skip anyone already on the roster (Bart/portal may already carry a
      // reclassified recruit) — match on normalized name.
      const nn = normName(rc.name);
      if (t.roster.some((p) => normName(p.name) === nn)) { recruitsDup++; continue; }
      t.roster.push({
        name: rc.name, bart_id: null, cls: "Fr", ht: rc.ht ?? null,
        status: "newcomer", link: false, rsci: rc.rsci ?? null, ...NULL_STATS,
      });
      recruitsAdded++;
    }
  } catch (err) {
    console.log(`  ⚠ recruit overlay skipped: ${err.message}`);
  }
  console.log(`  recruit overlay: ${recruitsAdded} freshmen added (${recruitsDup} already on roster, ${recruitsNoTeam} teams unmatched)`);

  // ---- 6. NBA-departure filter ----
  // Bart's offseason feed also lags on draft entrants (Lendeborg, Boozer, …
  // still listed on their college teams weeks after the draft). Drop anyone in
  // this June's draft class. Matched on normalized name AND college (so an
  // unrelated same-name player elsewhere isn't nuked). Undrafted pro departures
  // aren't covered — Bart prunes those over the offseason and the daily refresh
  // picks it up. Run scrape:nba-draftees after each draft to keep this fresh.
  const DRAFT_YEAR = PREV_YEAR; // June 2026 draft ends the 2025-26 college season
  let drafted = 0;
  try {
    const draftees = JSON.parse(fs.readFileSync(path.join(DATA, "nba-draftees.json"), "utf8"));
    const clsOf = new Map(); // normName -> normCollege
    for (const [n, v] of Object.entries(draftees)) {
      if (v.year === DRAFT_YEAR) clsOf.set(normName(n), normTeam(v.college ?? ""));
    }
    for (const [tn, t] of Object.entries(teams)) {
      t.roster = t.roster.filter((p) => {
        const college = clsOf.get(normName(p.name));
        if (college == null) return true;
        // College must corroborate: their preview team or (for overlaid
        // transfers) the team they came from.
        const here = normTeam(tn), from = normTeam(p.from ?? "");
        if (college === "" || college === here || college === from) { drafted++; return false; }
        return true;
      });
    }
  } catch (err) {
    console.log(`  ⚠ draftee filter skipped: ${err.message}`);
  }
  console.log(`  NBA-departure filter: removed ${drafted} drafted players`);

  // ---- 7. Official-roster reconciliation ----
  // Bart AND ESPN both keep departed players on offseason rosters, so a team can
  // show 21 names when the real roster is 14. official-rosters-2026.json (from
  // scripts/audit-rosters.mjs — each school's live athletics-site roster) is the
  // only current source. Where a school has posted a COMPLETE roster
  // (≥ MIN_OFFICIAL), we prune anyone not on it (departed) and add anyone we're
  // missing (walk-ons / late adds / players Bart never had) as plain newcomers.
  // Partial/unposted official rosters (offseason) are skipped — pruning against a
  // half-posted page would wrongly drop real returners; we keep Bart's list.
  const MIN_OFFICIAL = 9;
  // Slug → display name, fixing the two artifacts Title-casing gets wrong: roman
  // suffixes (iii → III) and vowel-less initials (cj → CJ, aj → AJ, tj → TJ).
  const cleanSlugName = (slug) =>
    slug.split("-").map((tk) =>
      /^(ii|iii|iv|v|vi|vii)$/i.test(tk) ? tk.toUpperCase()
      : (tk.length <= 3 && !/[aeiou]/i.test(tk)) ? tk.toUpperCase()
      : tk.charAt(0).toUpperCase() + tk.slice(1)).join(" ");
  // Suffix-insensitive match key — the athletics site and Bart disagree on
  // Jr/Sr/II/III (e.g. Bart "Patrick Ngongba" vs site "Patrick Ngongba II").
  // Without stripping, a returning player with stats would get pruned and
  // re-added as a stats-less newcomer.
  const matchName = (s) => normName(s).replace(/\s+(jr|sr|ii|iii|iv|v|vi)$/g, "").trim();
  const ilKey = (nn) => { const t = nn.split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : ""; };
  let teamsReconciled = 0, prunedDeparted = 0, addedOfficial = 0;
  try {
    const off = JSON.parse(fs.readFileSync(path.join(DATA, "official-rosters-2026.json"), "utf8"));
    for (const [teamName, o] of Object.entries(off.teams)) {
      const t = teams[teamName];
      if (!t || !Array.isArray(o.players) || o.players.length < MIN_OFFICIAL) continue;
      // Official name index (suffix-stripped normName + first-initial/last fuzzy
      // for nickname/spelling drift between Bart and the athletics site).
      const offFull = new Set(), offIL = new Set();
      for (const p of o.players) { const nn = matchName(p.name); if (!nn) continue; offFull.add(nn); const il = ilKey(nn); if (il) offIL.add(il); }
      const onOfficial = (name) => { const nn = matchName(name); if (offFull.has(nn)) return true; const il = ilKey(nn); return !!il && offIL.has(il); };
      // Prune anyone not on the official roster (departed / graduated).
      const kept = t.roster.filter((p) => onOfficial(p.name));
      prunedDeparted += t.roster.length - kept.length;
      t.roster = kept;
      // Add official players we don't already carry (no stats — plain newcomer;
      // NO rsci field so they show only a "New" badge, not a recruit "UR" chip).
      const prevFull = new Set(), prevIL = new Set();
      for (const p of t.roster) { const nn = matchName(p.name); prevFull.add(nn); const il = ilKey(nn); if (il) prevIL.add(il); }
      for (const p of o.players) {
        const nn = matchName(p.name); if (!nn) continue; const il = ilKey(nn);
        if (prevFull.has(nn) || (il && prevIL.has(il))) continue;
        t.roster.push({ name: cleanSlugName(p.slug), bart_id: null, cls: null, ht: null, status: "newcomer", link: false, ...NULL_STATS });
        addedOfficial++;
      }
      teamsReconciled++;
    }
  } catch (err) {
    console.log(`  ⚠ official reconcile skipped: ${err.message}`);
  }
  console.log(`  official reconcile: ${teamsReconciled} teams · pruned ${prunedDeparted} departed · added ${addedOfficial} official-only`);

  // Height backfill — fill any bart-id player still missing a height from the
  // most-recent season we have for them.
  let heightFilled = 0;
  for (const t of Object.values(teams)) {
    for (const p of t.roster) {
      if ((!p.ht || p.ht === "") && p.bart_id != null && heightById.has(p.bart_id)) {
        p.ht = heightById.get(p.bart_id);
        heightFilled++;
      }
    }
  }
  console.log(`  height backfill: ${heightFilled} players`);

  // Best player first, now by EPM. The previous sort on `prtg` did work — 1,136
  // players still carried it — so this changes the order rather than fixing an
  // absence, and it changes it a lot: PRTG is a volume-weighted composite where
  // EPM is per-possession impact, which is why Michigan's second name goes from
  // L.J. Cason (PRTG 8.0) to Trey McKenney (EPM 4.9, 98th pct).
  for (const t of Object.values(teams)) {
    t.roster.sort((a, b) => (b.epm ?? -99) - (a.epm ?? -99));
  }

  const out = {
    season: YEAR,
    label: LABEL,
    built_at: new Date().toISOString(),
    source: "barttorvik.com offseason feed (living data — refreshed by scripts/daily-refresh.mjs)",
    recruit_attribution: recruitAttribution,
    teams,
  };
  const allRoster = Object.values(teams).flatMap((t) => t.roster);
  const withEpm = allRoster.filter((r) => r.epm != null).length;
  const returning = allRoster.filter((r) => r.status === "returning").length;
  console.log(`  impact column: ${withEpm} of ${allRoster.length} players carry EPM (${returning} returning)`);
  if (prtgOnly > 0) {
    console.log(`  · ${prtgOnly} rank files still carry only the retired bta_portg and were skipped`);
  }

  // ABORT rather than warn. The old code warned and wrote anyway, which is how
  // the talent column sat empty through several builds without anyone noticing
  // — a green log over a file that had quietly lost a column. There is no
  // rescale to do (EPM is already a per-100 impact number on its own scale, and
  // the roster table formats it as such), so the only way this trips is the
  // rank pipeline changing keys again. Better to stop than to ship blanks.
  if (withEpm === 0 && allRoster.length > 0) {
    console.error(
      `\n  ABORTED: not one of ${allRoster.length} preview players carries an \`epm\` value.\n` +
      `    The rank files have presumably changed keys again. Check what\n` +
      `    public/data/player-ranks/<id>.json now calls the impact stat before\n` +
      `    rerunning — writing this file would blank the preview's talent column.\n`,
    );
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(out));
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
  console.log(`\n✓ wrote ${OUT} (${mb} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
