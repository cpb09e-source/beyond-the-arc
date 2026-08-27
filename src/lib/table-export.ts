/**
 * Downloading the team explorer's table — the raw CSV and the formatted
 * workbook.
 *
 * TWO FILES, BECAUSE THEY ARE FOR TWO DIFFERENT JOBS. The CSV is the values
 * exactly as we hold them: eFG% is 0.563, not "56.3%", and a signed margin is
 * -242, not "-242". That is what you want when the next step is pandas or a
 * join against your own data, and formatting it would mean every consumer
 * writing a parser to undo us. The workbook is the opposite — it is the table
 * as it reads on screen, percentile fills included, because the next step there
 * is a human looking at it.
 *
 * WHAT GETS EXPORTED IS THE WHOLE RESULT SET, not the visible page. The page
 * size is a reading convenience; nobody wants rows 101-365 silently missing
 * from a file they are about to analyse. The menu says the row count out loud
 * so this is never a surprise.
 *
 * PERCENTILES ARE THEIR OWN COLUMNS. On screen the chip sits under the value
 * and reads as part of it. A spreadsheet has no "under", and merging the two
 * into "71.8 (89)" would make both unsortable — so each stat contributes a
 * value column and a `Pctl` column beside it, in the same order as the table.
 *
 * The percentile is per season and per cohort, the same figure the chip shows,
 * which is worth stating in the file itself: the About sheet carries it, along
 * with the exact filters the export was taken under. A spreadsheet outlives the
 * URL that produced it.
 */
import { buildXlsx, saveBlob, colLetter, safeSheetName, type XlsxCell, type XlsxRow, type XlsxSheet, type XlsxStyle } from "@/lib/xlsx";
import type { TeamRow } from "@/lib/team-filters";

/** One table column, flattened out of the explorer's view/band model. */
export type ExportCol = {
  label: string;
  /** Field on TeamRow holding the season total. */
  total: string;
  /** Field holding the per-game figure, where the column has both. */
  perGame?: string;
  /** Key into `row.pct`. */
  pct: string;
  fmt: "num1" | "signed" | "pct1" | "int";
  /** Band caption this column sits under, for the workbook's top row. */
  band: string;
};

/** Everything the About sheet and the filename need to describe the export. */
export type ExportMeta = {
  viewLabel: string;
  seasons: string;
  conference: string;
  teams: string;
  filters: string[];
  sort: string;
  search: string;
  url: string;
};

export type ExportInput = {
  cols: ExportCol[];
  rows: TeamRow[];
  meta: ExportMeta;
};

/** One tab: a name and the columns that go on it. */
export type ExportSheetSpec = { name: string; cols: ExportCol[] };

/**
 * Every view in one workbook, over ONE set of rows.
 *
 * The rows are shared deliberately, and so is their order. A workbook where
 * each tab re-sorted by its own view's default would put a different team on
 * row 12 of every sheet, which destroys the one thing tabs are good for —
 * reading the same team across them. The reader's filters and sort are the
 * constant; the columns are what varies.
 */
export type MultiExportInput = {
  sheets: ExportSheetSpec[];
  rows: TeamRow[];
  meta: ExportMeta;
  /** Filename stem — the caller knows whether this is all the views or three. */
  slug?: string;
};

// ---------------------------------------------------------------------------
// column model
// ---------------------------------------------------------------------------

type Field = {
  header: string;
  band: string;
  kind: "text" | "num1" | "signed" | "pct1" | "int" | "pgSigned" | "pctl";
  /** Pulls the raw value out of a row. */
  get: (r: TeamRow) => string | number | null;
};

const IDENTITY_BAND = "";

function seasonLabel(y: number): string {
  return `${y - 1}-${y.toString().slice(-2)}`;
}

function num(r: TeamRow, key: string): number | null {
  const v = (r as unknown as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Flatten the table into export fields.
 *
 * A stat with a per-game sub-figure becomes TWO columns rather than one. On
 * screen the small "/g" number under the total is unambiguous; in a
 * spreadsheet a single column that sometimes holds a season total and
 * sometimes a per-game average — which is what the table's fallback does when
 * the total is untrustworthy — would be a column with two units in it, and no
 * way for the reader to tell which cell is which.
 *
 * HEADERS ARE DEDUPED. Two views can name the same label for different stats
 * (Opp eFG% and eFG% both shorten to "eFG%" in some bands), and a spreadsheet
 * with two identically-named columns breaks every lookup written against it.
 */
export function exportFields(cols: ExportCol[]): Field[] {
  const out: Field[] = [
    { header: "Team", band: IDENTITY_BAND, kind: "text", get: (r) => r.team_name },
    { header: "Conference", band: IDENTITY_BAND, kind: "text", get: (r) => r.team_conference ?? "" },
  ];
  // Always present in the file, even on a single-season table: a saved CSV
  // that does not say which season it is from is a trap the moment it is
  // opened next to another one.
  out.push({ header: "Season", band: IDENTITY_BAND, kind: "text", get: (r) => seasonLabel(r.team_year) });
  out.push({ header: "Record", band: IDENTITY_BAND, kind: "text", get: (r) => r.record ?? "" });

  for (const c of cols) {
    out.push({
      header: c.label,
      band: c.band,
      kind: c.fmt,
      get: (r) => num(r, c.total),
    });
    if (c.perGame) {
      out.push({
        header: `${c.label} /g`,
        band: c.band,
        kind: "pgSigned",
        get: (r) => num(r, c.perGame!),
      });
    }
    out.push({
      header: `${c.label} Pctl`,
      band: c.band,
      kind: "pctl",
      get: (r) => r.pct[c.pct] ?? null,
    });
  }

  const seen = new Map<string, number>();
  for (const f of out) {
    const n = seen.get(f.header) ?? 0;
    seen.set(f.header, n + 1);
    if (n > 0) f.header = `${f.header} (${n + 1})`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  // Quote anything a parser could misread, and double any embedded quote.
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The values as we hold them, with a UTF-8 BOM.
 *
 * The BOM is there for Excel alone: without it Excel reads a CSV as the system
 * codepage, and every accented team name arrives mojibaked. Every other
 * consumer skips it.
 */
export function buildCsv(input: ExportInput): string {
  const fields = exportFields(input.cols);
  const lines = [fields.map((f) => csvCell(f.header)).join(",")];
  for (const r of input.rows) {
    lines.push(fields.map((f) => csvCell(f.get(r))).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// workbook
// ---------------------------------------------------------------------------

const PALETTE = {
  paper: "FAF7F2",
  paperDeep: "F1ECE2",
  ink: "1A2238",
  inkMuted: "6B7280",
  accent: "0C6BD6",
  hairline: "E7E2D5",
};

/**
 * The seven percentile bands, lifted verbatim from the light ramp in
 * globals.css.
 *
 * Duplicated rather than read from CSS because a spreadsheet has no theme: the
 * file is a light document wherever it is opened, so it takes the light values
 * even when the site is showing dark. The thresholds must stay in step with
 * percentile-chip.tsx — if that ramp is ever retuned, retune this with it.
 */
const PCT_BANDS: Array<{ upto: number; bg: string; fg: string }> = [
  { upto: 14, bg: "FF9C91", fg: "7D231F" },
  { upto: 29, bg: "FFC1A2", fg: "8D3A0C" },
  { upto: 43, bg: "FCE1C3", fg: "814600" },
  { upto: 57, bg: "F4F1E7", fg: "6D5400" },
  { upto: 71, bg: "DFECC8", fg: "486100" },
  { upto: 86, bg: "B4E3A9", fg: "2A661B" },
  { upto: 101, bg: "7DD591", fg: "00591E" },
];

function pctStyle(pct: number): XlsxStyle {
  const v = Math.max(0, Math.min(100, pct));
  const band = PCT_BANDS.find((b) => v < b.upto) ?? PCT_BANDS[PCT_BANDS.length - 1]!;
  return { numFmt: "0", align: "center", size: 9, color: band.fg, fill: band.bg };
}

/**
 * Excel number formats, one per column kind.
 *
 * The signed formats spell the plus sign out as a literal because Excel's
 * default positive section has no sign at all — and a margins column where
 * +343 and -89 are told apart only by a minus is exactly the column where the
 * sign is the information.
 */
const NUM_FMT: Record<Field["kind"], string | undefined> = {
  text: undefined,
  num1: "0.0",
  signed: '"+"#,##0;"-"#,##0;0',
  pct1: "0.0%",
  int: "#,##0",
  pgSigned: '"+"0.0;"-"0.0;0.0',
  pctl: "0",
};

/**
 * The alternating row tint.
 *
 * The site stripes with paper against card, two warm off-whites three points
 * apart — a difference that works on screen, where a row is also separated by
 * a hairline and a hover state, and vanishes entirely in a spreadsheet that
 * has had its gridlines turned off. This is the same hue pushed far enough to
 * read across forty columns, and still lighter than the header band so the
 * top of the sheet keeps its place in the hierarchy.
 */
const ZEBRA = "F7F3EA";

function bodyStyle(kind: Field["kind"], striped: boolean): XlsxStyle {
  const fill = striped ? ZEBRA : undefined;
  if (kind === "text") return { align: "left", size: 10, color: PALETTE.ink, fill };
  return { numFmt: NUM_FMT[kind], align: "right", size: 10, color: PALETTE.ink, fill };
}

/**
 * Wide enough for the header to sit on ONE line.
 *
 * Excel measures width in characters of the default font, and the autofilter
 * button covers about three of them at the right of the header cell — so a
 * column sized to its VALUES wraps its title the moment the filter is turned
 * on, which is how "Record" came to read "Recor / d". Sizing from the header
 * plus that allowance, with a floor for the numbers underneath, means neither
 * can be clipped.
 *
 * The cost is real and accepted: a view with long stat names (Returner
 * Rotation %) produces wide columns. A wide column can be dragged narrower; a
 * wrapped header has to be found and fixed on every sheet.
 */
const FILTER_BUTTON_WIDTH = 3.2;

function columnWidth(f: Field): number {
  const header = f.header.length + FILTER_BUTTON_WIDTH;
  const values =
    f.header === "Team" ? 22
      : f.header === "Conference" ? 15
      : f.kind === "text" ? 10
      : f.kind === "pctl" ? 5
      : 8;
  return Math.round(Math.max(header, values) * 10) / 10;
}

/** Band captions as {label, span} in column order, identity columns included. */
function bandRuns(fields: Field[]): Array<{ label: string; span: number }> {
  const runs: Array<{ label: string; span: number }> = [];
  for (const f of fields) {
    const last = runs[runs.length - 1];
    if (last && last.label === f.band) last.span++;
    else runs.push({ label: f.band, span: 1 });
  }
  return runs;
}

function aboutSheet(
  meta: ExportMeta,
  rowCount: number,
  colCount: number,
  /** Tab names, when the workbook carries one per view. */
  tabs?: string[],
): XlsxSheet {
  const label: XlsxStyle = { bold: true, size: 10, color: PALETTE.inkMuted, align: "left" };
  const value: XlsxStyle = { size: 10, color: PALETTE.ink, align: "left", wrap: true };
  const head: XlsxStyle = { bold: true, size: 13, color: PALETTE.ink, align: "left" };
  const note: XlsxStyle = { size: 9, color: PALETTE.inkMuted, align: "left", wrap: true };

  const rows: XlsxRow[] = [
    [{ v: "Beyond the Arc — Team Ratings", s: head }],
    [],
    [{ v: "Exported", s: label }, { v: new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }), s: value }],
    [{ v: "View", s: label }, { v: tabs ? `${tabs.length} views, one per tab` : meta.viewLabel, s: value }],
    [{ v: "Seasons", s: label }, { v: meta.seasons, s: value }],
    [{ v: "Conference", s: label }, { v: meta.conference, s: value }],
    [{ v: "Team", s: label }, { v: meta.teams, s: value }],
    [{ v: "Sorted by", s: label }, { v: meta.sort, s: value }],
    [{ v: "Rows", s: label }, { v: rowCount, s: { ...value, numFmt: "#,##0" } }],
    [{ v: tabs ? "Columns (widest tab)" : "Columns", s: label }, { v: colCount, s: { ...value, numFmt: "#,##0" } }],
  ];
  if (meta.search) rows.push([{ v: "Table search", s: label }, { v: meta.search, s: value }]);

  rows.push([]);
  rows.push([{ v: "Filters", s: label }, { v: meta.filters.length ? meta.filters[0]! : "None", s: value }]);
  for (const f of meta.filters.slice(1)) rows.push([{ v: "", s: label }, { v: f, s: value }]);

  // The tab list, with a word on why the rows do not move between them.
  if (tabs && tabs.length) {
    rows.push([]);
    rows.push([{ v: "Tabs", s: label }, { v: tabs[0]!, s: value }]);
    for (const t of tabs.slice(1)) rows.push([{ v: "", s: label }, { v: t, s: value }]);
    rows.push([{ v: "", s: label }, {
      v: "Every tab holds the same teams in the same order — only the columns change. Sort or filter one tab and the others keep their order, so a row number is comparable across all of them until you do.",
      s: note,
    }]);
  }

  rows.push([]);
  rows.push([{ v: "Percentiles", s: label }, {
    v: "Each Pctl column ranks that stat within its own season, against every Division I team — the same figure the coloured chip shows on the site. 100 is best; on stats where lower is better (defensive rating, turnovers) the rank is already flipped, so 100 always means good.",
    s: note,
  }]);
  rows.push([{ v: "Source", s: label }, { v: meta.url, s: note }]);
  rows.push([{ v: "", s: label }, {
    v: "Adjusted ratings, tempo, WAB and schedule strength are Beyond the Arc's own, fitted from game logs. Box-score rates come from CBBD.",
    s: note,
  }]);

  return {
    name: "About",
    rows,
    widths: [16, 92],
    showGridLines: false,
    rowHeights: { 1: 24 },
  };
}

/**
 * One tab of teams: band row, header row, then the data.
 *
 * Pulled out of buildWorkbook so the all-views workbook can call it thirteen
 * times over the same rows. Everything that makes the sheet readable — the
 * merged band captions, the frozen pane, the stripe, the percentile fills —
 * belongs to the sheet rather than to the workbook, so every tab gets it.
 */
function teamsSheet(name: string, cols: ExportCol[], teamRows: TeamRow[]): XlsxSheet {
  const fields = exportFields(cols);

  const bandStyle = (label: string): XlsxStyle => ({
    bold: true, size: 9, align: "center", fill: PALETTE.paperDeep,
    color: label === "Your columns" ? PALETTE.accent : PALETTE.inkMuted,
  });
  // NO WRAPPING. A header that breaks mid-word ("Recor / d") is harder to
  // scan than a wider column, and columnWidth below guarantees there is room.
  const headStyle = (f: Field): XlsxStyle => ({
    bold: true, size: 10, fill: PALETTE.paperDeep, color: PALETTE.ink,
    align: f.kind === "text" ? "left" : f.kind === "pctl" ? "center" : "right",
    underline: true,
  });

  const rows: XlsxRow[] = [];

  // Row 1 — band captions. Written into the first cell of each run and merged
  // across it, which is why the run lengths are computed rather than assumed.
  const runs = bandRuns(fields);
  const merges: string[] = [];
  const bandRow: XlsxRow = [];
  let at = 0;
  for (const run of runs) {
    for (let i = 0; i < run.span; i++) {
      bandRow.push({ v: i === 0 ? run.label.toUpperCase() : "", s: bandStyle(run.label) });
    }
    if (run.span > 1 && run.label) {
      merges.push(`${colLetter(at)}1:${colLetter(at + run.span - 1)}1`);
    }
    at += run.span;
  }
  rows.push(bandRow);

  // Row 2 — column headers.
  rows.push(fields.map((f) => ({ v: f.header, s: headStyle(f) }) as XlsxCell));

  // Rows 3+ — the data, striped in pairs.
  teamRows.forEach((r, i) => {
    const striped = i % 2 === 1;
    rows.push(fields.map((f) => {
      const v = f.get(r);
      if (f.kind === "pctl") {
        // A percentile cell keeps its OWN colour on every row. The stripe is
        // there to help the eye track across; the ramp is carrying meaning,
        // and tinting it by row parity would corrupt the one thing on the
        // sheet whose colour is data.
        return typeof v === "number"
          ? { v, s: pctStyle(v) }
          : { v: null, s: { align: "center", fill: striped ? ZEBRA : undefined } as XlsxStyle };
      }
      return { v, s: bodyStyle(f.kind, striped) } as XlsxCell;
    }));
  });

  return {
    name,
    rows,
    widths: fields.map(columnWidth),
    // Column A and both header rows stay put — scrolling right without the
    // team name is the single fastest way to make a wide table useless.
    freeze: { x: 1, y: 2 },
    autoFilterRow: 2,
    merges,
    showGridLines: false,
    rowHeights: { 1: 16, 2: 20 },
  };
}

/** The formatted workbook: the table as it reads, plus a sheet saying what it is. */
export async function buildWorkbook(input: ExportInput): Promise<Blob> {
  return buildXlsx([
    teamsSheet("Teams", input.cols, input.rows),
    aboutSheet(input.meta, input.rows.length, exportFields(input.cols).length),
  ]);
}

/**
 * Every view as its own tab, over the reader's current selection.
 *
 * WHY THIS EXISTS. Switching view, downloading, switching, downloading is
 * thirteen files that all describe the same teams and cannot be compared
 * without a join. One workbook makes the comparison a click on a tab.
 *
 * Sheet names are sanitised and de-duplicated because Excel refuses the file
 * outright — not gracefully — for a name over 31 characters, one containing
 * \ / ? * [ ] :, or two sheets sharing a name.
 */
export async function buildAllViewsWorkbook(input: MultiExportInput): Promise<Blob> {
  const taken = new Set<string>(["About"]);
  const sheets = input.sheets.map((spec) => {
    const name = safeSheetName(spec.name, taken);
    return teamsSheet(name, spec.cols, input.rows);
  });
  const widest = input.sheets.reduce((n, spec) => Math.max(n, exportFields(spec.cols).length), 0);
  return buildXlsx([...sheets, aboutSheet(input.meta, input.rows.length, widest, sheets.map((s) => s.name))]);
}

/** `bta-teams-overview-2026-08-27.csv` — view and date, both of which matter later. */
export function exportFilename(meta: ExportMeta, ext: "csv" | "xlsx", slugOverride?: string): string {
  const slug = (slugOverride ?? meta.viewLabel).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `bta-teams-${slug}-${stamp}.${ext}`;
}

export function downloadCsv(input: ExportInput): void {
  const blob = new Blob([buildCsv(input)], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, exportFilename(input.meta, "csv"));
}

export async function downloadWorkbook(input: ExportInput): Promise<void> {
  const blob = await buildWorkbook(input);
  saveBlob(blob, exportFilename(input.meta, "xlsx"));
}

export async function downloadAllViews(input: MultiExportInput): Promise<void> {
  const blob = await buildAllViewsWorkbook(input);
  saveBlob(blob, exportFilename(input.meta, "xlsx", input.slug ?? "views"));
}
