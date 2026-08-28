/**
 * Measure a plausible range for EVERY filterable stat, and write it into
 * team-stat-filters.ts.
 *
 * The value box shows its stat's range as a placeholder — "55–85" under Pace —
 * because a bare box tells a reader nothing about what a normal number looks
 * like. That hint is the last surviving piece of the slider drawer, and it was
 * inherited with the drawer's coverage: 28 stats had sliders, so 28 stats had
 * ranges, and the ~100 added since had none. Most of the picker offered no clue
 * what to type.
 *
 * SAME METHOD AS THE ORIGINAL 28: the 1st and 99th percentile of the real
 * distribution across every team-season we hold, in DISPLAY units, rounded
 * outward to a round number. The 1st/99th rather than min/max because one
 * broken season should not define "normal" — and outward rather than nearest so
 * the hint never excludes a value that genuinely occurs.
 *
 * Usage:  npx tsx scripts/build-stat-bounds.mts [--write]
 * Without --write it prints the block and changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FILTER_COLUMNS, parseSpec, processTeams, teamStatColumn,
  type RawTeamSeason, type TeamRow,
} from "../src/lib/team-filters";
import { EXPLORER_SEASONS, PREVIEW_SEASON } from "../src/lib/seasons";

const ROOT = "c:/Users/Colin/websites/beyond-the-arc";
const TARGET = path.join(ROOT, "src/components/explorer/team-stat-filters.tsx");

// Played seasons only. The preview season is all nulls by construction and
// would drag every range toward nothing.
const YEARS = EXPLORER_SEASONS.filter((y) => y !== PREVIEW_SEASON);

const raw: RawTeamSeason[] = [];
for (const y of YEARS) {
  const f = path.join(ROOT, "public/data/teams-by-year", `${y}.json`);
  if (fs.existsSync(f)) raw.push(...(JSON.parse(fs.readFileSync(f, "utf8")) as RawTeamSeason[]));
}
const { rows } = processTeams(raw, { ...parseSpec({ ys: YEARS.join(",") }), limit: -1 });
console.log(`measuring over ${rows.length.toLocaleString()} team-seasons`);

// The preview season, kept separate: it is all nulls except the preseason
// stats, so it must not dilute anything it does not own.
const previewRaw: RawTeamSeason[] = (() => {
  const f = path.join(ROOT, "public/data/teams-by-year", `${PREVIEW_SEASON}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
})();
const previewRows: TeamRow[] = previewRaw.length
  ? processTeams(previewRaw, { ...parseSpec({ ys: String(PREVIEW_SEASON) }), limit: -1 }).rows
  : [];
console.log(`plus ${previewRows.length} preview rows for preseason-only stats`);

function pct(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Round outward to a step the span justifies, so hints read as round numbers. */
function stepFor(span: number): number {
  if (span >= 500) return 50;
  if (span >= 100) return 10;
  if (span >= 20) return 5;
  if (span >= 5) return 1;
  if (span >= 1) return 0.5;
  return 0.1;
}
const tidy = (n: number) => Math.round(n * 100) / 100;

const out: Array<[string, number, number]> = [];
const missing: string[] = [];

for (const col of FILTER_COLUMNS) {
  const isPct = (col.format ?? "").startsWith("pct");
  const vals: number[] = [];
  for (const r of rows) {
    const v = (r as unknown as Record<string, unknown>)[col.key];
    if (typeof v === "number" && Number.isFinite(v)) vals.push(isPct ? v * 100 : v);
  }
  // A stat with no coverage on played seasons may be a PRESEASON one —
  // transfer minutes in, proven minutes — which exists only on the preview
  // season. Measure those there rather than leaving the two newest columns
  // as the only ones with no hint.
  if (vals.length < 200) {
    for (const r of previewRows) {
      const v = (r as unknown as Record<string, unknown>)[col.key];
      if (typeof v === "number" && Number.isFinite(v)) vals.push(isPct ? v * 100 : v);
    }
  }
  // Still nothing measurable: a genuinely empty column, reported not invented.
  if (vals.length < 200) { missing.push(`${col.key} (${vals.length})`); continue; }
  vals.sort((a, b) => a - b);

  const lo = pct(vals, 0.01);
  const hi = pct(vals, 0.99);
  const step = stepFor(hi - lo);
  out.push([col.key, tidy(Math.floor(lo / step) * step), tidy(Math.ceil(hi / step) * step)]);
}

console.log(`ranges for ${out.length} stats; ${missing.length} skipped for thin coverage`);
if (missing.length) console.log("  skipped:", missing.join(", "));

// Rendered a few per line, grouped the way the registry is, so the block stays
// readable in review rather than becoming one wall of numbers.
const byGroup = new Map<string, string[]>();
for (const [key, lo, hi] of out) {
  const g = teamStatColumn(key)?.group ?? "other";
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g)!.push(`${key}: [${lo}, ${hi}]`);
}
const lines: string[] = [];
for (const [g, entries] of byGroup) {
  lines.push(`  // ${g}`);
  for (let i = 0; i < entries.length; i += 3) {
    lines.push("  " + entries.slice(i, i + 3).join(", ") + ",");
  }
}
const block = `const STAT_BOUNDS: Record<string, [number, number]> = {\n${lines.join("\n")}\n};`;

if (!process.argv.includes("--write")) {
  console.log("\n" + block.slice(0, 1200) + "\n… (--write to apply)");
  process.exit(0);
}

const src = fs.readFileSync(TARGET, "utf8");
const crlf = src.includes("\r\n");
const startMark = "const STAT_BOUNDS: Record<string, [number, number]> = {";
const start = src.indexOf(startMark);
if (start < 0) throw new Error("STAT_BOUNDS not found");
const end = src.indexOf("\n};", start) + (crlf ? 4 : 3);
const replacement = crlf ? block.split("\n").join("\r\n") : block;
fs.writeFileSync(TARGET, src.slice(0, start) + replacement + src.slice(end));
console.log(`\nwrote ${out.length} ranges into ${path.basename(TARGET)}`);
