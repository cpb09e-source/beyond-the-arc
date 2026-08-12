#!/usr/bin/env node
/**
 * fetch-rsci-history.mjs — pull the RSCI Final top-100 for every recruiting
 * class we hold a freshman season for, and write one file per class.
 *
 *   out: public/data/rsci/<classYear>.json
 *        { class_year, source, sheet, attribution, fetched_at,
 *          players: [{ rank, name, pos, ht, college }] }
 *
 * WHY. We hold 5,009 freshman-seasons carrying an EPM (2014-2026) and recruit
 * ranks for exactly one class. Without the ranks there is no way to ask the
 * question the projection model needs answered — what does a top-5 recruit
 * actually do as a freshman, versus a 40th, versus an unranked one — so this
 * backfills the missing axis.
 *
 * WHY RSCI RATHER THAN A SERVICE RANKING. Already decided and already
 * documented in docs/TODO-legal-sources.md: RSCI is a *consensus* index built
 * to be reproduced with attribution, which is the legally safest recruit-rank
 * source for a product heading behind a paywall. 247/ESPN/On3/Rivals rank
 * numbers are deliberately not used. Same rule applies here.
 *
 * CLASS YEAR vs SEASON. A class enrolling in the autumn of year N plays its
 * freshman season in N/N+1, which our data labels N+1. Class 2013 -> season
 * 2014. The default range covers seasons 2014-2026, i.e. classes 2013-2025.
 * 2026 is fetched too so the existing recruits-2026.json can be reconciled
 * against a file built by this same code path.
 *
 * HOW THE SHEET IS FOUND. rscihoops.com is a Google Sites page per class
 * (.../rankings/<year>-final) that embeds a Google Sheet. The sheet id is in
 * the page HTML, so it is discovered per year rather than hard-coded — the ids
 * are unrelated between classes and there is no pattern to guess. Verified:
 * the id this finds for 2026 is the one scrape-recruits.mjs already hard-codes.
 *
 * Polite by construction: one page fetch plus one CSV fetch per class, with a
 * pause between, and it skips any class already on disk unless --force.
 *
 *   Run: node scripts/fetch-rsci-history.mjs [--from 2013] [--to 2026] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DATA = path.resolve("public/data");
const OUT_DIR = path.join(DATA, "rsci");
const ATTRIBUTION = "Recruit rankings: RSCI (Recruiting Services Consensus Index), rscihoops.com";

const args = process.argv.slice(2);
const argNum = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const FROM = argNum("--from", 2013);
const TO = argNum("--to", 2026);
const FORCE = args.includes("--force");

const get = (url) =>
  execFileSync("curl", ["-sL", "-H", `user-agent: ${UA}`, url], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Same parser scrape-recruits.mjs uses — quoted fields, embedded commas in
// hometowns ("Fort Lauderdale, FL").
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

/**
 * Column layout drifts across 28 years of sheets, so nothing is read by fixed
 * index. The rank is the leading integer of the row; the name is the first
 * cell after it that looks like a person rather than a number or a service
 * score. Height/position/college are matched by shape where present.
 */
function extractPlayers(csv) {
  const rows = parseCsv(csv);
  const out = [];
  for (const r of rows) {
    const rank = parseInt((r[0] ?? "").trim(), 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 150) continue;
    // First cell that has two alphabetic tokens and isn't a numeric/score field.
    const name = r.slice(1).find((c) => {
      const t = (c ?? "").trim();
      if (t.length < 4 || /^[\d.\-+]+$/.test(t)) return false;
      return /^[A-Za-z][A-Za-z'.\- ]+\s+[A-Za-z][A-Za-z'.\-]+/.test(t);
    });
    if (!name) continue;
    // TIES ARE REAL AND MUST BE KEPT. RSCI averages several services, so equal
    // averages tie and the next rank is skipped: 2018 has two #10s and jumps to
    // #12, three #20s and jumps to #23. Deduping by rank — which this did at
    // first — silently dropped the second and third of every tie and cost ~15%
    // of each recent class, biased toward exactly the crowded middle of the
    // top 100 where the tiers need the most support.
    const cells = r.map((c) => (c ?? "").trim());
    // Height is 6-11 in the older sheets and 6'11" with curly quotes in the
    // newer ones. Accept either, and normalise to the 6-11 form our roster
    // data already uses.
    const rawHt = cells.find((c) => /^[5-7]\s*[-'’]\s*\d{1,2}\s*["”]?$/.test(c)) ?? null;
    const ht = rawHt ? rawHt.replace(/\s|["”]/g, "").replace(/['’]/, "-") : null;
    const pos = cells.find((c) => /^(PG|SG|SF|PF|C|G|F|CG|WG|WF|PF\/C|G\/F|F\/C)$/i.test(c)) ?? null;
    // College is the last non-empty cell that isn't the name/ht/pos.
    const tail = cells.filter((c) => c && c !== name.trim() && c !== rawHt && c !== pos);
    const college = tail.length ? tail[tail.length - 1] : null;
    out.push({ rank, name: name.trim(), pos, ht, college: /^[\d.\-+%]+$/.test(college ?? "") ? null : college });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let wrote = 0, skipped = 0;
const summary = [];

for (let year = FROM; year <= TO; year++) {
  const outFile = path.join(OUT_DIR, `${year}.json`);
  if (fs.existsSync(outFile) && !FORCE) { skipped++; summary.push([year, "skip (on disk)"]); continue; }

  const pageUrl = `https://sites.google.com/site/rscihoops/home/rankings/${year}-final`;
  let sheet = null;
  try {
    const html = get(pageUrl);
    sheet = (html.match(/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) ?? [])[1] ?? null;
  } catch (e) {
    summary.push([year, `page fetch failed: ${e.message.slice(0, 60)}`]);
    continue;
  }
  if (!sheet) { summary.push([year, "no embedded sheet id found"]); continue; }

  sleep(900); // one page + one CSV per class, spaced out
  let players = [];
  try {
    players = extractPlayers(get(`https://docs.google.com/spreadsheets/d/${sheet}/export?format=csv`));
  } catch (e) {
    summary.push([year, `csv fetch failed: ${e.message.slice(0, 60)}`]);
    continue;
  }

  if (players.length < 50) {
    // A Final top-100 that yields under 50 parsed rows means the layout beat
    // the reader. Report it rather than writing a half list that would quietly
    // bias every tier built on top of it.
    summary.push([year, `PARSED ONLY ${players.length} — not written`]);
    continue;
  }

  fs.writeFileSync(outFile, JSON.stringify({
    class_year: year,
    source: pageUrl,
    sheet,
    attribution: ATTRIBUTION,
    fetched_at: new Date().toISOString(),
    players,
  }));
  wrote++;
  const withCollege = players.filter((p) => p.college).length;
  summary.push([year, `${players.length} players (${withCollege} with a college), top: ${players[0].name}`]);
  sleep(900);
}

console.log("RSCI Final backfill\n");
for (const [y, msg] of summary) console.log(`  ${y}  ${msg}`);
console.log(`\n${wrote} written, ${skipped} skipped → ${OUT_DIR}`);
