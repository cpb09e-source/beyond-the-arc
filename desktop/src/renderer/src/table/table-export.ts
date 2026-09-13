import { createContext, isValidElement, type ReactNode } from "react";
import type { Column } from "./data-table";

/**
 * A table, out of the app and into a spreadsheet: copied as tab-separated text
 * (Excel and Sheets paste it into cells) or saved as a CSV file.
 *
 * WHAT IS ON SCREEN. The columns showing, in their order; the rows the filter
 * left, in the sort chosen; or only the rows picked. Nothing the reader cannot
 * already see.
 *
 * THE CELL'S OWN TEXT. A column can say how it reads as text (`text`); most
 * never need to, because a cell's text is read off what it draws: a stat
 * cell's value, a name, a date. Its percentile chip is left out, and so is
 * anything drawn aria-hidden. The real minus sign becomes "-" and the dash
 * for no value becomes an empty cell, so a spreadsheet can sum the column.
 *
 * AN ESCAPE HATCH, NOT A FEATURE OF EVERY TABLE: it lives in the menus a table
 * already has (right-click a row or a header) and in Ctrl K, with no button.
 */

export type TableExport = {
  /** How the table names itself: "Teams", "Michigan games". */
  name: string;
  rows: number;
  selected: number;
  tsv: (only?: "selected") => string;
  csv: (only?: "selected") => string;
};

/** Given to each tab by the app: how its table offers itself to Ctrl K, and what the file is called. */
export const TableExportContext = createContext<{ register: (exp: TableExport | null) => void; fileName: string } | null>(null);

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(" ");
  if (isValidElement(node)) {
    const p = node.props as { children?: ReactNode; value?: unknown; "aria-hidden"?: unknown };
    if (p["aria-hidden"]) return "";
    // A stat cell draws its value over a percentile chip: the value is the text.
    if (typeof p.value === "string") return p.value;
    return nodeText(p.children);
  }
  return "";
}

export function cellText<R>(c: Column<R>, row: R, index: number): string {
  const raw = c.text ? c.text(row, index) : nodeText(c.cell(row, index));
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/−/g, "-");
  return /^[–—-]$/.test(s) ? "" : s;
}

export const headerText = <R>(c: Column<R>): string => (c.label === "#" ? (c.title ?? "Rank") : c.label);

export const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const tsvField = (s: string) => s.replace(/[\t\r\n]+/g, " ");

export function delimited<R>(columns: Column<R>[], rows: R[], indexOf: (row: R) => number, kind: "csv" | "tsv"): string {
  const field = kind === "csv" ? csvField : tsvField;
  const sep = kind === "csv" ? "," : "\t";
  const lines = [columns.map((c) => field(headerText(c))).join(sep)];
  for (const r of rows) lines.push(columns.map((c) => field(cellText(c, r, indexOf(r)))).join(sep));
  return lines.join(kind === "csv" ? "\r\n" : "\n");
}
