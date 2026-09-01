/**
 * A small XLSX writer, and the zip container it needs.
 *
 * WHY NOT A LIBRARY. The obvious choice is exceljs, which is ~900 KB of
 * browser bundle for a feature one reader in fifty will ever press, and which
 * expects Node's `stream` and `Buffer` — a fight with the bundler on a site
 * that has no server at all. SheetJS's free build cannot write cell styles,
 * and styles are the entire point here: an export whose percentiles are bare
 * numbers is a worse artefact than the screenshot it replaced.
 *
 * What we actually need is narrow — inline strings, numbers, number formats,
 * solid fills, frozen panes, an autofilter and merged band headers — and that
 * is a few hundred lines of XML plus a zip. Deflate comes from the platform:
 * CompressionStream("deflate-raw") has been in every major engine since Safari
 * 16.4, and where it is missing we store the entries uncompressed, which is
 * still a valid archive and only costs bytes.
 *
 * The XML is deliberately written by hand rather than through a DOM: every
 * part is a fixed shape, the escaping is one function, and a template literal
 * is far easier to check against the OOXML spec than a tree of createElement
 * calls.
 *
 * ELEMENT ORDER IN A WORKSHEET IS NOT ADVISORY. CT_Worksheet is a sequence, so
 * Excel rejects the file outright if `cols` follows `sheetData`, or if
 * `autoFilter` precedes it. The order below — sheetPr, dimension, sheetViews,
 * sheetFormatPr, cols, sheetData, autoFilter, mergeCells — is the schema's,
 * and moving any of it will produce the "unreadable content" dialog rather
 * than a graceful degradation.
 */

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Raw DEFLATE via the platform, or null when the engine has no CompressionStream. */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

type ZipEntry = { name: string; data: Uint8Array };

/**
 * MS-DOS date/time, which is what a zip local header carries.
 *
 * Seconds have one bit less than they need, hence the halving — the format
 * stores them in two-second units and has since 1980.
 */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(new Date());
  const locals: BlobPart[] = [];
  const centrals: BlobPart[] = [];
  let offset = 0;
  let count = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const raw = entry.data;
    const packed = await deflateRaw(raw);
    // Method 8 is deflate, 0 is "stored". Falling back to stored keeps the
    // archive valid on an engine without CompressionStream; Excel does not
    // care which it gets.
    const method = packed ? 8 : 0;
    const body = packed ?? raw;
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0, true);           // flags
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);          // extra length
    locals.push(local.buffer, nameBytes as BlobPart, body as BlobPart);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);        // version made by
    central.setUint16(6, 20, true);        // version needed
    central.setUint16(8, 0, true);
    central.setUint16(10, method, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);        // extra
    central.setUint16(32, 0, true);        // comment
    central.setUint16(34, 0, true);        // disk
    central.setUint16(36, 0, true);        // internal attrs
    central.setUint32(38, 0, true);        // external attrs
    central.setUint32(42, offset, true);
    centrals.push(central.buffer, nameBytes as BlobPart);

    offset += 30 + nameBytes.length + body.length;
    count++;
  }

  const centralSize = centrals.reduce(
    (n, part) => n + (part instanceof ArrayBuffer ? part.byteLength : (part as Uint8Array).length),
    0,
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, end.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// sheet model
// ---------------------------------------------------------------------------

export type XlsxStyle = {
  /** Excel format code, e.g. "0.0" or "0.0%". Omit for General. */
  numFmt?: string;
  bold?: boolean;
  size?: number;
  /** "RRGGBB" — no alpha, no leading hash. */
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  /** Hairline under the cell, used on the header row. */
  underline?: boolean;
  wrap?: boolean;
};

export type XlsxCell = {
  v: string | number | null;
  s?: XlsxStyle;
  /**
   * An external URL this cell links to.
   *
   * A REAL RELATIONSHIP, NOT A HYPERLINK() FORMULA. The formula is one line
   * cheaper here and worse everywhere it lands: the cell reads as a formula
   * in the bar, it breaks if the file is opened somewhere that does not
   * evaluate it, and it survives a copy-paste as text rather than as a link.
   * A relationship is what a spreadsheet someone was handed should contain.
   */
  link?: string;
};
export type XlsxRow = XlsxCell[];

export type XlsxSheet = {
  name: string;
  rows: XlsxRow[];
  /** Character widths, one per column, in order. */
  widths?: number[];
  /** Columns and rows to freeze — {x: 1, y: 2} pins column A and the top two rows. */
  freeze?: { x: number; y: number };
  /** 1-based row carrying the filter buttons. */
  autoFilterRow?: number;
  /** "A1:D1" ranges. */
  merges?: string[];
  /** Explicit heights for 1-based rows. */
  rowHeights?: Record<number, number>;
  showGridLines?: boolean;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
};
/**
 * Control characters are illegal in XML 1.0 even when escaped, so they are
 * dropped rather than encoded — a stray 0x1F in a scraped team name would
 * otherwise produce a file Excel refuses to open at all.
 */
const XML_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!).replace(XML_CONTROL, "");
}

/**
 * A sheet name Excel will actually accept, unique within the workbook.
 *
 * The rules are not advisory and the failure is not graceful: a name longer
 * than 31 characters, one containing \\ / ? * [ ] or a colon, one wrapped in
 * apostrophes, or two sheets sharing a name (case-insensitively) all produce
 * the "unreadable content" dialog rather than a renamed tab.
 *
 * Collisions are resolved by appending " 2", " 3" and so on, with the trim
 * recomputed each time so the suffix cannot itself push the name over the
 * limit. `taken` is mutated — pass one set through a whole workbook.
 */
export function safeSheetName(name: string, taken: Set<string>): string {
  const clean = (name || "Sheet")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Excel rejects a name that begins or ends with an apostrophe.
    .replace(/^'+|'+$/g, "")
    .slice(0, 31) || "Sheet";

  let out = clean;
  let n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` ${n}`;
    out = clean.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  taken.add(out.toLowerCase());
  return out;
}

export function colLetter(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Interns fonts/fills/formats and hands back a cellXfs index per distinct style. */
class StyleTable {
  private numFmts = new Map<string, number>();
  private fonts = new Map<string, number>();
  private fills = new Map<string, number>();
  private borders = new Map<string, number>();
  private xfs = new Map<string, number>();
  private xfList: string[] = [];

  constructor() {
    // Index 0 is the default font; fills 0 and 1 are reserved by the format
    // (none and gray125) and Excel misreads solid fills if they are reassigned.
    this.fonts.set("", 0);
    this.fills.set("none", 0);
    this.fills.set("gray125", 1);
    this.borders.set("", 0);
    this.xfs.set("", 0);
    this.xfList.push(`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`);
  }

  private fontId(s: XlsxStyle): number {
    const key = `${s.bold ? "b" : ""}|${s.size ?? 11}|${s.color ?? ""}`;
    if (key === "|11|") return 0;
    const hit = this.fonts.get(key);
    if (hit !== undefined) return hit;
    const id = this.fonts.size;
    this.fonts.set(key, id);
    return id;
  }

  private fillId(s: XlsxStyle): number {
    if (!s.fill) return 0;
    const hit = this.fills.get(s.fill);
    if (hit !== undefined) return hit;
    const id = this.fills.size;
    this.fills.set(s.fill, id);
    return id;
  }

  private borderId(s: XlsxStyle): number {
    if (!s.underline) return 0;
    const hit = this.borders.get("under");
    if (hit !== undefined) return hit;
    const id = this.borders.size;
    this.borders.set("under", id);
    return id;
  }

  private numFmtId(s: XlsxStyle): number {
    if (!s.numFmt) return 0;
    const hit = this.numFmts.get(s.numFmt);
    if (hit !== undefined) return hit;
    // Custom formats must start at 164; everything below is built in.
    const id = 164 + this.numFmts.size;
    this.numFmts.set(s.numFmt, id);
    return id;
  }

  id(s: XlsxStyle | undefined): number {
    if (!s) return 0;
    const key = JSON.stringify([s.numFmt, s.bold, s.size, s.color, s.fill, s.align, s.underline, s.wrap]);
    const hit = this.xfs.get(key);
    if (hit !== undefined) return hit;
    const numFmtId = this.numFmtId(s);
    const fontId = this.fontId(s);
    const fillId = this.fillId(s);
    const borderId = this.borderId(s);
    const alignment = s.align || s.wrap
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""}${s.wrap ? ` wrapText="1"` : ""} vertical="center"/>`
      : "";
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${alignment ? ` applyAlignment="1"` : ""}>` +
      `${alignment}</xf>`;
    const id = this.xfList.length;
    this.xfList.push(xf);
    this.xfs.set(key, id);
    return id;
  }

  xml(): string {
    const numFmts = [...this.numFmts.entries()]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
    const fonts = [...this.fonts.keys()].map((key) => {
      const [b, size, color] = key.split("|");
      return `<font>${b ? "<b/>" : ""}<sz val="${size || 11}"/>` +
        `${color ? `<color rgb="FF${color}"/>` : `<color theme="1"/>`}` +
        `<name val="Calibri"/><family val="2"/></font>`;
    }).join("");
    const fills = [...this.fills.keys()].map((key) => {
      if (key === "none") return `<fill><patternFill patternType="none"/></fill>`;
      if (key === "gray125") return `<fill><patternFill patternType="gray125"/></fill>`;
      return `<fill><patternFill patternType="solid"><fgColor rgb="FF${key}"/><bgColor indexed="64"/></patternFill></fill>`;
    }).join("");
    const borders = [...this.borders.keys()].map((key) =>
      key === "under"
        ? `<border><left/><right/><top/><bottom style="thin"><color rgb="FFCBC4B4"/></bottom><diagonal/></border>`
        : `<border><left/><right/><top/><bottom/><diagonal/></border>`,
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      (numFmts ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : "") +
      `<fonts count="${this.fonts.size}">${fonts}</fonts>` +
      `<fills count="${this.fills.size}">${fills}</fills>` +
      `<borders count="${this.borders.size}">${borders}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfList.length}">${this.xfList.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;
  }
}

function sheetXml(sheet: XlsxSheet, styles: StyleTable, links: Array<{ ref: string; target: string }>): string {
  const width = sheet.rows.reduce((n, r) => Math.max(n, r.length), 0);
  const lastCol = colLetter(Math.max(0, width - 1));
  const rowsXml = sheet.rows.map((row, ri) => {
    const r = ri + 1;
    const cells = row.map((cell, ci) => {
      const ref = `${colLetter(ci)}${r}`;
      if (cell.link) links.push({ ref, target: cell.link });
      const s = styles.id(cell.s);
      const sAttr = s ? ` s="${s}"` : "";
      // An empty cell that carries a style is still written: it is what paints
      // the band strip across the identity columns, and what fills the rest of
      // a merged range if Excel ever reads past the top-left cell.
      if (cell.v === null || cell.v === "") return s ? `<c r="${ref}"${sAttr}/>` : "";
      if (typeof cell.v === "number") {
        // A non-finite number has no XML representation; write it as blank
        // rather than emitting `NaN`, which Excel reads as a corrupt cell.
        if (!Number.isFinite(cell.v)) return `<c r="${ref}"${sAttr}/>`;
        return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
      }
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
    }).join("");
    const h = sheet.rowHeights?.[r];
    return `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");

  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const pane = sheet.freeze
    ? `<pane${sheet.freeze.x ? ` xSplit="${sheet.freeze.x}"` : ""}${sheet.freeze.y ? ` ySplit="${sheet.freeze.y}"` : ""}` +
      ` topLeftCell="${colLetter(sheet.freeze.x)}${sheet.freeze.y + 1}" activePane="bottomRight" state="frozen"/>` +
      `<selection pane="bottomRight" activeCell="${colLetter(sheet.freeze.x)}${sheet.freeze.y + 1}" sqref="${colLetter(sheet.freeze.x)}${sheet.freeze.y + 1}"/>`
    : "";
  const filter = sheet.autoFilterRow
    ? `<autoFilter ref="A${sheet.autoFilterRow}:${lastCol}${sheet.rows.length}"/>`
    : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  // AFTER autoFilter and BEFORE mergeCells. The schema fixes this order and
  // Excel refuses to open a file that gets it wrong, offering to "repair" it
  // by dropping the sheet.
  const hyperlinks = links.length
    ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rIdL${i + 1}"/>`).join("")}</hyperlinks>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastCol}${Math.max(1, sheet.rows.length)}"/>` +
    `<sheetViews><sheetView${sheet.showGridLines === false ? ` showGridLines="0"` : ""} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${rowsXml}</sheetData>` +
    filter +
    hyperlinks +
    merges +
    `</worksheet>`;
}

/** Build an .xlsx blob from one or more sheets. */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Blob> {
  const enc = new TextEncoder();
  const styles = new StyleTable();
  // Sheet XML is rendered first so every style it uses is interned before
  // styles.xml is serialised.
  const sheetLinks: Array<Array<{ ref: string; target: string }>> = sheets.map(() => []);
  const sheetXmls = sheets.map((s, i) => sheetXml(s, styles, sheetLinks[i]!));

  const rels = sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");

  const files: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        ).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        rels +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
      ),
    },
    { name: "xl/styles.xml", data: enc.encode(styles.xml()) },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(xml) })),
    /**
     * One rels part per sheet that actually has links.
     *
     * TargetMode="External" is what makes these URLs rather than references
     * into the package; without it Excel looks for a part named
     * "https://..." inside the zip, finds nothing, and repairs the file by
     * deleting the sheet. Sheets with no links get no part at all — an empty
     * Relationships document is legal but is one more thing to be wrong.
     */
    ...sheetLinks.flatMap((links, i) => (links.length ? [{
      name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        links.map((l, n) =>
          `<Relationship Id="rIdL${n + 1}"` +
          ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"` +
          ` Target="${esc(l.target)}" TargetMode="External"/>`,
        ).join("") +
        `</Relationships>`,
      ),
    }] : [])),
  ];

  return makeZip(files);
}

/** Hand a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a later tick: Safari cancels the download if the URL dies in
  // the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
