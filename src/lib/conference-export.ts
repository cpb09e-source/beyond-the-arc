/**
 * Conference Power Rankings' download: who each row is, and which columns go on a sheet.
 *
 * Moved out of src/components/conferences/conferences-client.tsx, unchanged, so
 * the desktop app writes the same file. It reads the table, not the file: the
 * caller's reader carries the split and its percentiles.
 */
import { confDisplay } from "@/lib/conf-display";
import { numField, type ExportCol, type ExportEntity } from "@/lib/table-export";
import { confViewBands, confViewCols, type ConfCol, type ConfView } from "@/lib/conference-views";
import type { ConfRow } from "@/lib/conference-rankings";

const seasonLabel = (y: number) => `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;

export function conferenceExportEntity(
  readValue: (r: ConfRow, key: string) => number | null,
  pcts: Map<string, Map<string, number>>,
): ExportEntity<ConfRow> {
  return {
    title: "Conference Power Rankings",
    sheetName: "Conferences",
    wideHeader: "Conference",
    fileStem: "conferences",
    identity: [
      { header: "Conference", width: 22, get: (r) => confDisplay(r.conf) || r.conf },
      { header: "Season", get: (r) => seasonLabel(r.year) },
      { header: "Teams", get: (r) => r.kept },
      { header: "Of", get: (r) => r.teams },
      { header: "Dropped", width: 28, get: (r) => r.dropped.join(", ") },
    ],
    num: (r, key) => (key ? readValue(r, key) : numField(r, key)),
    pctOf: (r, key) => pcts.get(key)?.get(`${r.year}|${r.conf}`) ?? null,
  };
}

export function conferenceExportCols(v: ConfView, split: string): ExportCol[] {
  return confViewBands(v, split).flatMap((b) =>
    b.keys
      .map((k) => confViewCols(v, split).find((c) => c.key === k))
      .filter((c): c is ConfCol => !!c)
      .map((c) => ({
        label: c.label,
        total: c.key,
        pct: c.key,
        // The workbook has no num2; a second decimal is display polish.
        fmt: c.fmt === "num2" ? "num1" : c.fmt,
        band: b.label,
      })),
  );
}
