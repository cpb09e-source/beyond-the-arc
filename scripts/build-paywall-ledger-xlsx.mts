/**
 * Turn the Paywall Ledger into a spreadsheet with an empty decision column.
 *
 * The web version is for reading and clicking; this is for the case where the
 * decision wants to be made in a spreadsheet, shared, or kept alongside other
 * planning. Same content either way.
 *
 * ONE SOURCE, PARSED NOT RETYPED. The page and this file would drift within a
 * week if the rows were copied, so the DATA array is lifted out of the
 * published HTML and evaluated. If the page changes, re-run this and the sheet
 * follows.
 *
 * Usage:  npx tsx scripts/build-paywall-ledger-xlsx.mts <ledger.html> [out.xlsx]
 */
import fs from "node:fs";
import path from "node:path";
import { buildXlsx, type XlsxRow, type XlsxStyle } from "../src/lib/xlsx";

const htmlPath = process.argv[2];
const outPath = process.argv[3] ?? "paywall-ledger.xlsx";
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error("usage: tsx scripts/build-paywall-ledger-xlsx.mts <ledger.html> [out.xlsx]");
  process.exit(1);
}

type Feat = { t: string; w?: string; n?: string; sub?: boolean; s: string };
type Page = { name: string; route: string; note?: string; feats: Feat[] };
type Section = { section: string; pages: Page[] };

const html = fs.readFileSync(htmlPath, "utf8");
const start = html.indexOf("var DATA = [");
if (start < 0) throw new Error("DATA array not found in the page");
const from = html.indexOf("[", start);
// Walk the brackets rather than regexing: the array holds prose with brackets
// in it, and a lazy match would stop at the first one.
let depth = 0, end = -1;
for (let i = from; i < html.length; i++) {
  if (html[i] === "[") depth++;
  else if (html[i] === "]" && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error("DATA array never closes");
const DATA = eval(html.slice(from, end)) as Section[];

const PALETTE = {
  ink: "1A2238", muted: "6B7280", paperDeep: "F1ECE2", zebra: "F7F3EA",
  accent: "0C6BD6", paid: "A8551B", paidBg: "FBEEDF", tbd: "6D4FB0", tbdBg: "EFEAFA",
  freeBg: "ECEEF0", free: "5A6672",
};
const LABEL: Record<string, string> = { free: "Free", paid: "Paid", tbd: "TBD" };
const flagStyle = (s: string): XlsxStyle =>
  s === "paid" ? { align: "center", size: 10, bold: true, color: PALETTE.paid, fill: PALETTE.paidBg }
    : s === "tbd" ? { align: "center", size: 10, bold: true, color: PALETTE.tbd, fill: PALETTE.tbdBg }
    : { align: "center", size: 10, bold: true, color: PALETTE.free, fill: PALETTE.freeBg };

const head: XlsxStyle = { bold: true, size: 10, fill: PALETTE.paperDeep, color: PALETTE.ink, underline: true, align: "left" };
const sectionStyle: XlsxStyle = { bold: true, size: 11, color: PALETTE.accent, fill: PALETTE.paperDeep, align: "left" };
const pageStyle: XlsxStyle = { bold: true, size: 10, color: PALETTE.ink, align: "left" };
const cell = (z: boolean): XlsxStyle => ({ size: 10, color: PALETTE.ink, align: "left", fill: z ? PALETTE.zebra : undefined });
const soft = (z: boolean): XlsxStyle => ({ size: 9, color: PALETTE.muted, align: "left", fill: z ? PALETTE.zebra : undefined });

const rows: XlsxRow[] = [
  [
    { v: "Section", s: head }, { v: "Page", s: head }, { v: "Route", s: head },
    { v: "Feature", s: head }, { v: "Why / note", s: head },
    { v: "Current", s: { ...head, align: "center" } },
    { v: "YOUR CALL", s: { ...head, align: "center", color: PALETTE.accent } },
  ],
];

let z = false;
let count = 0;
for (const sec of DATA) {
  rows.push([{ v: sec.section.toUpperCase(), s: sectionStyle }, {v:"",s:sectionStyle}, {v:"",s:sectionStyle},
             {v:"",s:sectionStyle}, {v:"",s:sectionStyle}, {v:"",s:sectionStyle}, {v:"",s:sectionStyle}]);
  for (const pg of sec.pages) {
    z = !z;
    for (const f of pg.feats) {
      count++;
      rows.push([
        { v: sec.section, s: soft(z) },
        { v: pg.name, s: pageStyle },
        { v: pg.route, s: soft(z) },
        // Sub-features are indented rather than given their own column: the
        // nesting is only ever one deep and a column would be blank for most rows.
        { v: (f.sub ? "    – " : "") + f.t + (f.n ? "  (new)" : ""), s: cell(z) },
        { v: f.w ?? "", s: soft(z) },
        { v: LABEL[f.s] ?? f.s, s: flagStyle(f.s) },
        // Deliberately empty — this is the column to fill in.
        { v: null, s: { align: "center", fill: z ? PALETTE.zebra : undefined } },
      ]);
    }
  }
}

const sheet = {
  name: "Ledger",
  rows,
  widths: [18, 24, 24, 46, 62, 11, 13],
  freeze: { x: 0, y: 1 },
  autoFilterRow: 1,
  showGridLines: false,
  rowHeights: { 1: 22 },
};

// A second tab so the file explains itself if it is opened in six weeks.
const note: XlsxStyle = { size: 10, color: PALETTE.ink, align: "left", wrap: true };
const label: XlsxStyle = { bold: true, size: 10, color: PALETTE.muted, align: "left" };
const about = {
  name: "About",
  rows: [
    [{ v: "Beyond the Arc — what is free and what is paid", s: { bold: true, size: 13, color: PALETTE.ink } }],
    [],
    [{ v: "Features", s: label }, { v: count, s: { ...note, numFmt: "#,##0" } }],
    [{ v: "Fill in", s: label }, { v: "Column G, YOUR CALL. Free / Paid / TBD.", s: note }],
    [{ v: "Current", s: label }, { v: "Column F is what /pricing promises today — the site's own claim, not a recommendation. Where it is silent the row reads TBD, and those are the real open questions.", s: note }],
    [],
    [{ v: "Watch for", s: label }, { v: "Anything marked Paid leaves Google's index. Free traffic is what sells the archive, so keeping the current season free matters more than any single feature.", s: note }],
    [{ v: "Built", s: label }, { v: "Season gating exists and is switched off. Narrowing FREE_SEASONS in src/lib/access.ts turns it on for the Team Explorer. Everything else marked Paid still needs building.", s: note }],
  ] as XlsxRow[],
  widths: [14, 96],
  showGridLines: false,
};

const blob = await buildXlsx([sheet, about]);
const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync(outPath, buf);
console.log(`${count} features -> ${path.resolve(outPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
