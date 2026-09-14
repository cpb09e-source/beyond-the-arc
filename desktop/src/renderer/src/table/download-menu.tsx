import { ArrowLeft, ChevronRight, ClipboardCopy, Download, FileSpreadsheet, FileText, Layers, Star } from "lucide-react";
import { useMemo, useRef, useState, type ComponentType } from "react";
import {
  buildAllViewsWorkbook,
  buildCsv,
  buildWorkbook,
  exportFilename,
  type ExportInput,
  type MultiExportInput,
} from "@/lib/table-export";
import { recordStep } from "~/shell/research-history";
import { Popover } from "~/ui/popover";
import { useToast } from "~/ui/toast";

export type DownloadView = { key: string; label: string; group?: string; desc?: string };

/**
 * The site's Download menu, writing the site's files.
 *
 *   Excel workbook          this view, formatted, percentile colors, an About sheet
 *   Excel, select views     one tab per view over the same rows in the same order
 *   CSV                     raw values: rates as decimals, nothing rounded
 *
 * THE SAME BUILDERS AS THE WEBSITE (src/lib/table-export.ts), so a workbook
 * saved here and one downloaded there are the same file. What the app adds is
 * where it lands: a Save dialog, then "Show in folder".
 *
 * WHAT IS EXPORTED IS THE WHOLE RESULT, every row the filter keeps and every
 * column of the view with the reader's own columns leading, not what happens to
 * be scrolled into sight.
 */
export function DownloadMenu<R>({
  rows,
  columns,
  views,
  buildExport,
  buildExportAll,
  copyTable,
}: {
  rows: number;
  columns: number;
  /** The table's column views, for one tab each. Absent for a table with one set of columns. */
  views?: DownloadView[];
  buildExport: () => ExportInput<R>;
  buildExportAll?: (keys: string[]) => MultiExportInput<R> | Promise<MultiExportInput<R>>;
  /** The app's own extra: the table as it reads, tab-separated, for pasting. */
  copyTable?: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<"menu" | "views">("menu");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const groups = useMemo(() => {
    const out: Array<[string, DownloadView[]]> = [];
    for (const v of views ?? []) {
      const g = v.group ?? "Views";
      const last = out[out.length - 1];
      if (last && last[0] === g) last[1].push(v);
      else out.push([g, [v]]);
    }
    return out;
  }, [views]);

  const deliver = async (what: string, make: () => Promise<{ data: Uint8Array | string; name: string }>) => {
    setBusy(what);
    setFailed(false);
    try {
      const { data, name } = await make();
      setOpen(false);
      const saved = await window.bta.files.saveFile(data, name);
      if (saved.ok && saved.path) {
        const path = saved.path;
        toast({ title: `Saved ${path.split(/[\\/]/).pop()}`, action: { label: "Show in folder", run: () => window.bta.files.reveal(path) } });
        recordStep({ kind: "export", title: `Downloaded ${name}`, export: { format: what === "views" ? "xlsx-views" : what === "csv" ? "csv" : "xlsx", rows, name } });
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const workbook = () =>
    deliver("xlsx", async () => {
      const input = buildExport();
      const blob = await buildWorkbook(input);
      return { data: new Uint8Array(await blob.arrayBuffer()), name: exportFilename(input.meta, "xlsx", undefined, input.entity.fileStem) };
    });
  const csv = () =>
    deliver("csv", async () => {
      const input = buildExport();
      return { data: buildCsv(input), name: exportFilename(input.meta, "csv", undefined, input.entity.fileStem) };
    });
  const tabs = () =>
    deliver("views", async () => {
      const input = await buildExportAll!(views!.filter((v) => picked.includes(v.key)).map((v) => v.key));
      const blob = await buildAllViewsWorkbook(input);
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        name: exportFilename(input.meta, "xlsx", input.slug ?? "views", input.entity.fileStem),
      };
    });

  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={rows === 0}
        title="Download this table"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setScreen("menu");
          setFailed(false);
          setOpen((o) => !o);
        }}
        className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-card px-2 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-50"
      >
        <Download size={13} strokeWidth={2} />
        Download
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={336} align="right" label="Download">
          {screen === "menu" ? (
            <div className="flex flex-col">
              <div className="border-b border-hairline px-3 py-2">
                <p className="text-[12.5px] font-medium text-ink">This table</p>
                <p className="mt-0.5 text-[11.5px] text-ink-muted tabular">
                  {rows.toLocaleString()} {rows === 1 ? "row" : "rows"} · {columns} columns
                </p>
              </div>
              <div className="p-1">
                <Item
                  icon={FileSpreadsheet}
                  title="Excel workbook"
                  desc="This view, formatted, with percentile colors and a sheet describing the export"
                  busy={busy === "xlsx"}
                  disabled={busy != null}
                  onClick={workbook}
                  autoFocus
                />
                {views && views.length > 1 && buildExportAll && (
                  <Item
                    icon={Layers}
                    title="Excel, select views"
                    desc="One tab per view. Same rows, same order, same filters on every tab."
                    disabled={busy != null}
                    onClick={() => {
                      setPicked(views.map((v) => v.key));
                      setScreen("views");
                    }}
                    trailing={<ChevronRight size={14} className="mt-[2px] shrink-0 text-ink-muted" />}
                  />
                )}
                <Item
                  icon={FileText}
                  title="CSV"
                  desc="Raw values: rates as decimals, nothing rounded for display"
                  busy={busy === "csv"}
                  disabled={busy != null}
                  onClick={csv}
                />
                {copyTable && (
                  <>
                    <div className="mx-2 my-1 h-px bg-hairline" />
                    <Item
                      icon={ClipboardCopy}
                      title="Copy for a spreadsheet"
                      desc="The table as it reads, ready to paste"
                      disabled={busy != null}
                      onClick={() => {
                        setOpen(false);
                        copyTable();
                      }}
                    />
                  </>
                )}
              </div>
              {failed && <p className="border-t border-hairline px-3 py-2 text-[11.5px] text-bad">Could not build the file. Try fewer tabs.</p>}
            </div>
          ) : (
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-hairline px-2 py-1.5">
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setScreen("menu")}
                  className="grid size-[26px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--menu-active)] hover:text-ink"
                >
                  <ArrowLeft size={14} />
                </button>
                <p className="flex-1 text-[12.5px] font-medium text-ink">Tabs in the workbook</p>
                <button
                  type="button"
                  onClick={() => setPicked(picked.length === views!.length ? [] : views!.map((v) => v.key))}
                  className="px-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
                >
                  {picked.length === views!.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                {groups.map(([group, list]) => (
                  <div key={group}>
                    {groups.length > 1 && <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-ink-muted">{group}</p>}
                    {list.map((v) => (
                      <label
                        key={v.key}
                        title={v.desc}
                        className="flex h-[28px] cursor-default items-center gap-2 rounded-md px-2 text-[12.5px] text-ink-soft transition-colors hover:bg-[var(--menu-active)] hover:text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={picked.includes(v.key)}
                          onChange={() => setPicked((p) => (p.includes(v.key) ? p.filter((k) => k !== v.key) : [...p, v.key]))}
                          className="size-[13px] accent-[var(--accent)]"
                        />
                        {v.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2">
                <span className="text-[11.5px] text-ink-muted tabular">{rows.toLocaleString()} rows on every tab</span>
                <button
                  type="button"
                  disabled={picked.length === 0 || busy != null}
                  onClick={tabs}
                  className="h-[28px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
                >
                  {busy === "views" ? "Building…" : `Download ${picked.length} ${picked.length === 1 ? "tab" : "tabs"}`}
                </button>
              </div>
              {failed && <p className="border-t border-hairline px-3 py-2 text-[11.5px] text-bad">Could not build the file. Try fewer tabs.</p>}
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

function Item({
  icon: Icon,
  title,
  desc,
  onClick,
  busy = false,
  disabled = false,
  trailing,
  autoFocus,
}: {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  desc: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  trailing?: React.ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--menu-active)] focus-visible:bg-[var(--menu-active)] disabled:opacity-60"
    >
      <Icon size={15} strokeWidth={1.75} className="mt-[1px] shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{busy ? `${title}: building…` : title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">{desc}</span>
      </span>
      {trailing}
    </button>
  );
}

/** Star this table, its filter and its columns, as a favorite: the site's Save Filter View. */
export function SaveViewButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={saved}
      title={saved ? "In your favorites. Click to remove it." : "Save this table, with its filter and columns, to your favorites (Ctrl D)"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className={`inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors ${
        saved
          ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)] text-ink"
          : "border-hairline bg-card text-ink-soft hover:border-ink-muted hover:text-ink"
      }`}
    >
      <Star size={13} strokeWidth={2} className={saved ? "fill-current text-accent" : ""} />
      {saved ? "Saved" : "Save view"}
    </button>
  );
}
