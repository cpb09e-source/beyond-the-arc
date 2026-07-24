/**
 * scrape-recruits.mjs — ONE-TIME pull of the 2026 HS recruiting class (incoming
 * freshmen) so team preview rosters show their committed newcomers (Bryson
 * Howard, etc.). Bart's offseason feed only lists players with prior D-I stats,
 * so true HS freshmen never appear there.
 *
 * TWO sources, chosen with a paywalled/commercial site in mind:
 *   1. MEMBERSHIP (who committed where) — On3's public industry list. These are
 *      plain facts (name + committed school), reported everywhere.
 *        https://www.on3.com/db/rankings/industry-player/basketball/2026/?page=N
 *      SSR page embeds __NEXT_DATA__ with playerData.list. 404 recruits / 9 pages.
 *   2. NATIONAL RANK (the "#13 in class" badge) — RSCI, the Recruiting Services
 *      Consensus Index (rscihoops.com). RSCI is a *consensus* index built to be
 *      cited/reproduced with attribution (Sports-Reference, DraftExpress, etc.
 *      all republish it) — the safest rank source vs. the proprietary single
 *      services (247/ESPN/On3/Rivals). A rank number is a fact (not
 *      copyrightable). We pull the primary origin: RSCI's published Google Sheet.
 *      Show it attributed. Top-100 only → recruits outside it get rsci:null (UR).
 *
 *   public/data/recruits-2026.json → { attribution, recruits:[{ name, team,
 *                                       cls:"Fr", pos, ht, rsci }] }
 *
 * Committing IS final for this class (recruiting is closed), so this is a
 * one-time static pull — the daily refresh does NOT re-run it. Re-run manually
 * only if a late reclass/decommit needs picking up:  node scripts/scrape-recruits.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CLASS_YEAR = 2026; // recruiting class enrolling for the 2026-27 season
const DATA = path.resolve("public/data");
const OUT = path.join(DATA, `recruits-${CLASS_YEAR}.json`);
// RSCI 2026 Final — the consensus-index Google Sheet published by rscihoops.com
// (https://sites.google.com/site/rscihoops/home/rankings/2026-final). CSV export.
const RSCI_SHEET = "1neBv9U0fBIbMbWLh0v3oZ_7XX9BGGj5d3jp7VtI7DSk";
const RSCI_ATTRIBUTION = "Recruit rankings: RSCI (Recruiting Services Consensus Index), rscihoops.com";

function normName(s) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}

// Minimal CSV parser (quoted fields, embedded commas — hometowns like "Fort
// Lauderdale, FL").
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

// Fetch the RSCI Final top-100 and index it by normalized name. Value carries
// the college too, so a common name can be corroborated against the commit.
// RSCI columns: RSCI,Chg,Avg,Dev,,Player,ESPN,Rivals/On3,247Sports,Total,,Ht,Pos,City,College
function fetchRsci() {
  const csv = execFileSync("curl", [
    "-sL", "-H", `user-agent: ${UA}`,
    `https://docs.google.com/spreadsheets/d/${RSCI_SHEET}/export?format=csv`,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const rows = parseCsv(csv);
  const byName = new Map(); // normName -> [{ rank, college }]
  const byIL = new Map();   // "first-initial lastname" -> [{ rank, college }] (fuzzy)
  for (const r of rows.slice(1)) {
    const rank = parseInt(r[0], 10);
    const name = r[5];
    if (!Number.isFinite(rank) || !name) continue;
    const key = normName(name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ rank, college: r[14] ?? "" });
    const toks = key.split(" ");
    if (toks.length >= 2) {
      const il = `${toks[0][0]} ${toks[toks.length - 1]}`;
      if (!byIL.has(il)) byIL.set(il, []);
      byIL.get(il).push({ rank, college: r[14] ?? "" });
    }
  }
  return { byName, byIL };
}

function normTeam(s) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\buniversity\b|\bthe\b/g, "")
    .replace(/\bstate\b/g, "st")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// On3 slugs that the token-drop resolver can't reach (nickname/abbrev schools
// or state-suffixed dupes). Mapped straight to our team name.
const SLUG_ALIASES = {
  "miami-hurricanes": "Miami FL",
  "ole-miss-rebels": "Mississippi",
  "college-of-charleston-cougars": "Charleston",
  "loyola-chi-ramblers": "Loyola Chicago",
  "usf-bulls": "South Florida",
};

// On3 commit slug ("miami-hurricanes", "michigan-state-spartans") → our team
// name. Drop trailing mascot tokens one at a time until the leading school
// tokens normalize to a team we know. Prefer the longest school prefix that
// resolves (so "michigan-state" wins over "michigan").
function buildResolver(teamNames) {
  const byNorm = new Map(teamNames.map((n) => [normTeam(n), n]));
  return (slug) => {
    if (SLUG_ALIASES[slug]) return SLUG_ALIASES[slug];
    const toks = (slug ?? "").split("-").filter(Boolean);
    for (let take = toks.length; take >= 1; take--) {
      const cand = byNorm.get(normTeam(toks.slice(0, take).join(" ")));
      if (cand) return cand;
    }
    return null;
  };
}

// On3 sits behind bot protection that 403s Node's fetch (undici TLS/HTTP2
// fingerprint) but passes curl. Shell out to curl — every dev box here has it.
function fetchPage(page) {
  const url = `https://www.on3.com/db/rankings/industry-player/basketball/${CLASS_YEAR}/?page=${page}`;
  const html = execFileSync("curl", [
    "-sL", "-H", `user-agent: ${UA}`, "-H", "accept: text/html",
    "-H", "accept-language: en-US,en;q=0.9", url,
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`page ${page}: no __NEXT_DATA__ (blocked?)`);
  return JSON.parse(m[1]).props.pageProps.playerData;
}

async function main() {
  console.log(`🎓 On3 recruit scrape — ${CLASS_YEAR} class (incoming freshmen)\n`);

  const teams = JSON.parse(fs.readFileSync(path.join(DATA, "teams-all.json"), "utf8"));
  const teamArr = Array.isArray(teams) ? teams : teams.teams ?? [];
  const resolve = buildResolver([...new Set(teamArr.map((t) => t.name))]);

  const first = await fetchPage(1);
  const pageCount = first.pagination?.pageCount ?? 1;
  console.log(`  ${first.pagination?.count ?? "?"} ranked recruits over ${pageCount} pages`);

  const rows = [...first.list];
  for (let p = 2; p <= pageCount; p++) {
    const pd = await fetchPage(p);
    rows.push(...pd.list);
    process.stdout.write(`\r  fetched page ${p}/${pageCount}`);
  }
  console.log(`\n  ${rows.length} total rows`);

  // RSCI consensus top-100 — the source for the displayed national rank.
  const { byName: rsciByName, byIL: rsciByIL } = fetchRsci();
  console.log(`  RSCI top-100 loaded: ${rsciByName.size} names`);

  // Resolve a recruit's RSCI rank. Exact normalized name first; if a name is
  // duplicated, corroborate with the committed college. On an exact miss, fall
  // back to first-initial+lastname (catches On3↔RSCI spelling/nickname drift:
  // Obinna↔Obina, Tay↔Taylen, Aidan↔Aiden) — but ONLY when the college also
  // matches, so we never guess across unrelated same-lastname players. Returns
  // null when outside the top-100 (→ "UR").
  const rsciRankFor = (name, team) => {
    const nt = normTeam(team);
    const exact = rsciByName.get(normName(name));
    if (exact && exact.length) {
      if (exact.length === 1) return exact[0].rank;
      return (exact.find((c) => normTeam(c.college) === nt) ?? exact[0]).rank;
    }
    const toks = normName(name).split(" ");
    if (toks.length >= 2) {
      const il = rsciByIL.get(`${toks[0][0]} ${toks[toks.length - 1]}`);
      const hit = il?.find((c) => normTeam(c.college) === nt);
      if (hit) return hit.rank;
    }
    return null;
  };

  const out = [];
  let uncommitted = 0, unresolved = 0, ranked = 0;
  const misses = new Set();
  for (const r of rows) {
    const person = r.person ?? {};
    const st = person.status ?? {};
    if (!st.isCommitted || !st.committedOrganizationSlug) { uncommitted++; continue; }
    const team = resolve(st.committedOrganizationSlug);
    if (!team) { unresolved++; misses.add(st.committedOrganizationSlug); continue; }
    const rating = person.rating ?? {};
    const rsci = rsciRankFor(person.name, team);
    if (rsci != null) ranked++;
    out.push({
      name: person.name ?? null,
      team,
      cls: "Fr",
      pos: r.positionAbbreviation ?? rating.positionAbbr ?? null,
      ht: person.formattedHeight ?? null,
      rsci, // RSCI consensus national rank (top-100) or null = UR
    });
  }

  // Best recruit first within each write (RSCI asc; unranked last).
  out.sort((a, b) => (a.rsci ?? 9999) - (b.rsci ?? 9999));

  fs.writeFileSync(OUT, JSON.stringify({
    class_year: CLASS_YEAR,
    membership_source: "on3 industry rankings (committed players + school)",
    rank_source: "RSCI Final — rscihoops.com (consensus top-100)",
    attribution: RSCI_ATTRIBUTION,
    generated_at: new Date().toISOString(),
    recruits: out,
  }));
  console.log(`\n✓ wrote ${OUT} — ${out.length} committed recruits (${ranked} with an RSCI top-100 rank)`);
  console.log(`  (${uncommitted} uncommitted skipped · ${unresolved} unresolved school${unresolved ? " → " + [...misses].join(", ") : ""})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
