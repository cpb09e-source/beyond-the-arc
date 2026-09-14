import { useVirtualizer } from "@tanstack/react-virtual";
import { ClipboardCopy, FileDown } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ACTIONS, runAction } from "~/objects/actions";
import { beginDrag } from "~/objects/drag";
import { objectDrag, type DragSpec, type Obj } from "~/objects/object";
import { PeekActions } from "~/objects/object-surfaces";
import { useActionEnv, useObjectMenu } from "~/objects/use-object-actions";
import { usePeek } from "~/peek/use-peek";
import { useIsActive } from "~/shell/active";
import { signalOnboarding } from "~/shell/onboarding";
import { useShell } from "~/shell/shell-context";
import { useContextMenu } from "~/ui/context-menu";
import type { SelectMode } from "~/selection/selection";
import type { MenuEntry } from "~/ui/menu";
import { usePersisted } from "~/ui/persisted";
import { lensMenuEntry, useStatLens, type LensTarget } from "~/lens/stat-lens";
import { PEEK_W, PeekPanel } from "./peek-panel";
import { delimited, TableExportContext } from "./table-export";

export type { DragSpec } from "~/objects/object";

/**
 * The one table every object in the app is shown in: teams, players, games.
 *
 * ONE COMPONENT, SO ONE BEHAVIOUR. Sorting, the keyboard model, pointer focus,
 * virtualization and Peek live here and nowhere else. A reader who learns that
 * ↓ moves, Space previews and a header click sorts better-first on teams never
 * meets a table that does it slightly differently on game logs.
 *
 * A ROW IS AN OBJECT when the view says what object it is (`object`). Then the
 * row's right-click menu, its keys (C, F, and . for the menu), its drag and its
 * Peek's buttons all come from the object's actions (~/objects/actions.tsx),
 * the same list Ctrl K and the record pages read, and a view writes none of it.
 *
 * FIXED ROW HEIGHT, per table. Peek anchors to a row, the pointer maps to a row
 * by arithmetic, and the virtualizer never has to measure: all three depend on
 * every row being exactly `rowHeight` tall. A cell that wraps is a bug.
 *
 * THE HEADER SITS OUTSIDE THE SCROLL AREA and follows horizontal scroll by
 * transform, so the virtualizer's offsets start at the first row with no
 * sticky-header correction to get wrong. A right-click on a header sorts either
 * way, and on a table with an `id` hides the column, remembered.
 *
 * PINNED COLUMNS stay put when a wide table scrolls sideways: rank and name on
 * a game log with thirty stats, so a row never loses the thing it is about.
 * They must lead the column list. Their backgrounds are opaque, because a
 * translucent sticky cell shows the columns scrolling underneath it; the site
 * hit exactly that twice.
 *
 * BANDS, when columns carry them, caption groups of columns in a row above the
 * headers ("Four Factors" over four columns), the site's two-tier header. Each
 * band's first column draws a rule down the table, so the groups hold together
 * as the rows scroll.
 */

export type Align = "left" | "right" | "center";
export type Dir = 1 | -1;

export type Column<R> = {
  key: string;
  label: string;
  title?: string;
  width: number;
  align: Align;
  /** Direction of the first click: the better end first, so lower-is-better sorts ascending. */
  first: Dir;
  /** Stays in place on horizontal scroll. Pinned columns must come first. */
  pin?: boolean;
  /** Omit for a column that is not an attribute of the row, such as its position. */
  sortValue?: (row: R) => number | string | null;
  /** `index` is the row's position in the current sort, from 0. */
  cell: (row: R, index: number) => ReactNode;
  /** The group this column is captioned under. Consecutive columns with one band share a caption. */
  band?: string;
  /** Captions the band in the accent: the group a view is really about. */
  bandAccent?: boolean;
  /** How the cell reads in a spreadsheet, when what it draws does not say (./table-export.ts): a full date for "Nov 3". */
  text?: (row: R, index: number) => string | number | null;
};

export type PeekSpec<R> = {
  label: (row: R) => string;
  body: (row: R) => ReactNode;
};

type Props<R> = {
  rows: R[];
  columns: Column<R>[];
  /** Must be a stable, module-level function: focus is tracked by this key. */
  rowKey: (row: R) => string | number;
  rowHeight?: number;
  defaultSort: { key: string; dir: Dir };
  /** Orders rows the chosen column calls equal. Also stable and module-level. */
  tieBreak?: (a: R, b: R) => number;
  /**
   * Blocks that lead every sort, lowest first: the top-100 players ahead of
   * everyone else on the portal, whatever column is picked. The chosen sort
   * runs inside each block. Stable and module-level.
   */
  group?: (row: R) => number;
  /** The object a row is: its menu, keys, drag, Peek buttons and, absent onOpen, how it opens. */
  object?: (row: R) => Obj | null;
  /** What dragging a row carries, when it is not the row's object. Null: not draggable. */
  drag?: (row: R) => DragSpec | null;
  /** Single-key commands of the view's own, on the focused row. They win over the object's keys. */
  keys?: Record<string, (row: R) => void>;
  /** Names the table for what it remembers about itself: hidden columns. */
  id?: string;
  ariaLabel: string;
  empty: ReactNode;
  peek?: PeekSpec<R>;
  /**
   * A row to land on: focused, scrolled to the middle, its Peek pinned. Each
   * nonce lands once, whether the table is mounting or already open.
   */
  landOn?: { key: string | number; nonce: number };
  /** Told when a landing has happened, so whoever asked can stop asking. */
  onLanded?: (nonce: number) => void;
  /**
   * Opens the row's own page: Enter (from the table or its filter box), a
   * double-click, or Enter while Peeking. `newTab` is true with Ctrl held;
   * `side` with Shift, for split view. Absent, the row's object opens.
   */
  onOpen?: (row: R, how: { newTab: boolean; side?: boolean }) => void;
  /**
   * Rows picked together, usually the shared selection (~/selection/selection.tsx):
   * Ctrl-click toggles, Shift-click takes a range, X toggles the focused row,
   * Shift with the arrows carries it along, Ctrl+A takes every row, Esc lets go.
   */
  selection?: {
    isSelected: (row: R) => boolean;
    change: (rows: R[], mode: SelectMode) => void;
    clear: () => void;
    size: number;
  };
  /** The key of a row another view is pointing at (the linked hover): outlined, not focused. */
  echo?: string | number | null;
  /** Told when the reader moves to a row (pointer or keys), and undefined when the pointer leaves. */
  onFocusRow?: (row: R | undefined) => void;
  /**
   * A row the rest step back from, for Focus (~/focus/focus-mode.tsx): lit, the
   * others dimmed, scrolled into view while it lasts and the scroll put back after.
   */
  spotlight?: string | number | null;
  /**
   * The number in a cell as something the Stat Lens can break down
   * (~/lens/stat-lens.tsx): Alt-click the cell, or right-click it for
   * "Break down …" at the top of the row's menu. Null for a cell with no lens.
   */
  statLens?: (row: R, columnKey: string) => LensTarget | null;
};

const HEAD_H = 32;
const BAND_H = 22;

const ALIGN: Record<Align, string> = {
  left: "justify-start text-left",
  right: "justify-end text-right",
  center: "justify-center text-center",
};

const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.every((k) => typeof k === "string");

/** Missing values sort last in BOTH directions; a dash at the top of a sort reads as a winner. */
function compare(a: number | string | null, b: number | string | null, dir: Dir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" || typeof b === "string") return dir * String(a).localeCompare(String(b));
  return dir * (a - b);
}

export function DataTable<R>({
  rows,
  columns: allColumns,
  rowKey,
  rowHeight = 42,
  defaultSort,
  tieBreak,
  group,
  object,
  drag,
  keys,
  id,
  ariaLabel,
  empty,
  peek,
  landOn,
  onLanded,
  onOpen,
  selection,
  echo,
  onFocusRow,
  spotlight,
  statLens,
}: Props<R>) {
  const [sort, setSort] = useState(defaultSort);
  // A table in a tab that is not in front keeps its state but not the keyboard.
  const active = useIsActive();
  const { filterRef } = useShell();
  const env = useActionEnv();
  const objectMenu = useObjectMenu();
  const openMenu = useContextMenu();
  const openLens = useStatLens();
  const exportCtx = useContext(TableExportContext);

  const [hidden, setHidden] = usePersisted<string[]>(`bta.table.hidden.${id ?? "_"}`, [], isKeyList);
  const columns = useMemo(
    () => (id && hidden.length > 0 ? allColumns.filter((c) => c.pin || !hidden.includes(c.key)) : allColumns),
    [allColumns, hidden, id],
  );

  const sorted = useMemo(() => {
    // A sort outlives its column being hidden: the rows keep the order the reader chose.
    const value = allColumns.find((c) => c.key === sort.key)?.sortValue;
    if (!value && !group) return tieBreak ? [...rows].sort(tieBreak) : rows;
    return [...rows].sort(
      (a, b) =>
        (group ? group(a) - group(b) : 0) ||
        (value ? compare(value(a), value(b), sort.dir) : 0) ||
        (tieBreak?.(a, b) ?? 0),
    );
  }, [rows, allColumns, sort, tieBreak, group]);

  const layout = useMemo(() => {
    let x = 0;
    const pinLeft = columns.map((c) => {
      if (!c.pin) return null;
      const left = x;
      x += c.width;
      return left;
    });
    const bands: Array<{ label: string; start: number; span: number; accent: boolean }> = [];
    columns.forEach((c, i) => {
      if (!c.band) return;
      const last = bands[bands.length - 1];
      if (last && last.label === c.band && last.start + last.span === i) last.span += 1;
      else bands.push({ label: c.band, start: i, span: 1, accent: !!c.bandAccent });
    });
    return {
      // A trailing flexible track, so a row's tint runs to the edge on wide windows.
      template: `${columns.map((c) => `${c.width}px`).join(" ")} minmax(0, 1fr)`,
      totalWidth: columns.reduce((sum, c) => sum + c.width, 0),
      pinLeft,
      pinnedWidth: x,
      lastPin: columns.reduce((last, c, i) => (c.pin ? i : last), -1),
      bands,
      bandStarts: new Set(bands.map((b) => b.start)),
    };
  }, [columns]);
  const headH = HEAD_H + (layout.bands.length > 0 ? BAND_H : 0);

  // FOCUS IS A ROW'S KEY, NOT ITS POSITION. Sorting and filtering move rows;
  // a position would silently hand the focus to whatever now sits there.
  const indexByKey = useMemo(() => new Map(sorted.map((r, i) => [rowKey(r), i])), [sorted, rowKey]);
  const [focusKey, setFocusKey] = useState<string | number | null>(null);
  // LANDING IS DECIDED DURING RENDER, not in an effect, so the first frame of a
  // table opened from Ctrl K already shows the right row focused.
  const [landed, setLanded] = useState<number | null>(null);
  if (landOn && landOn.nonce !== landed && indexByKey.has(landOn.key)) {
    setLanded(landOn.nonce);
    setFocusKey(landOn.key);
  }
  const found = focusKey == null ? undefined : indexByKey.get(focusKey);
  const index = found ?? (sorted.length > 0 ? 0 : -1);
  const focused = index >= 0 ? sorted[index] : undefined;
  // Where a Shift-click range starts: the row last picked or clicked.
  const anchor = useRef<string | number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 14,
  });

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [peekH, setPeekH] = useState(0);
  const [scrolledX, setScrolledX] = useState(false);
  const scrolledXRef = useRef(false);
  const frame = useRef(0);

  const peekState = usePeek(active);
  const { pin } = peekState;
  const local = useMemo(() => (peek ? { peek: pin } : {}), [peek, pin]);

  // What a row does when it is only an object: open as the object opens, drag as the object.
  const openRow = useMemo(
    () =>
      onOpen ??
      (object
        ? (row: R, how: { newTab: boolean; side?: boolean }) => {
            const o = object(row);
            if (o) runAction("open", o, env, how);
          }
        : undefined),
    [onOpen, object, env],
  );
  const dragRow = drag ?? (object ? (row: R) => {
    const o = object(row);
    return o ? objectDrag(o) : null;
  } : undefined);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The header follows horizontal scroll directly, with no render per event:
    // its own transform and its pinned cells both read this one variable.
    headRef.current?.style.setProperty("--sl", `${el.scrollLeft}px`);
    const sx = el.scrollLeft > 0;
    if (sx !== scrolledXRef.current) {
      scrolledXRef.current = sx;
      setScrolledX(sx);
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setViewW(el.clientWidth);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const move = useCallback(
    (to: number): R | undefined => {
      if (sorted.length === 0) return undefined;
      const i = Math.max(0, Math.min(sorted.length - 1, to));
      const row = sorted[i]!;
      setFocusKey(rowKey(row));
      virtual.scrollToIndex(i, { align: "auto" });
      onFocusRow?.(row);
      return row;
    },
    [sorted, rowKey, virtual, onFocusRow],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === "Enter" && openRow && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
        // From a field, only the table's own filter box opens a row. Enter in any
        // other field (a question being asked, a value being typed) is that field's.
        if (t?.tagName === "INPUT" && t !== filterRef.current) return;
        const row = index >= 0 ? sorted[index] : undefined;
        if (!row) return;
        e.preventDefault();
        openRow(row, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey });
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      // Every row the table shows, as Ctrl+A takes everything in a list.
      if (selection && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyA" && !inField) {
        e.preventDefault();
        selection.change(sorted, "replace");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const row = index >= 0 ? sorted[index] : undefined;
      // Esc lets the selection go, once any Peek is closed.
      if (selection && !inField && e.key === "Escape" && selection.size > 0 && !peekState.open) {
        e.preventDefault();
        selection.clear();
        return;
      }
      // X picks the focused row, as Linear's lists do.
      if (selection && !inField && row && !e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        selection.change([row], "toggle");
        anchor.current = rowKey(row);
        return;
      }

      // The row's menu from the keyboard: . as Superhuman and Linear offer, and Windows' own two.
      if (!inField && row && object && (e.key === "." || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
        const o = object(row);
        const el = scrollRef.current;
        if (o && el) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          const x = r.left + Math.min(layout.pinnedWidth || 240, 280);
          const y = r.top + index * rowHeight - el.scrollTop + rowHeight;
          objectMenu({ x, y: Math.min(Math.max(y, r.top), r.bottom) }, o, local);
          return;
        }
      }

      if (!inField && row && !e.shiftKey && e.key.length === 1) {
        // The view's own single-key commands first, then the object's.
        const run = keys?.[e.key.toLowerCase()];
        if (run) {
          e.preventDefault();
          run(row);
          return;
        }
        const o = object?.(row);
        const action = o ? ACTIONS.find((a) => a.rowKey === e.key.toLowerCase() && a.when(o, env, local)) : undefined;
        if (o && action) {
          e.preventDefault();
          action.run(o, env, { newTab: false }, local);
          return;
        }
      }
      const page = Math.max(1, Math.floor(viewH / rowHeight) - 1);
      let to: number | null = null;
      // Arrows work from the filter box too, so filtering and moving is one motion,
      // but not from other fields, where they belong to the field.
      if (inField && target !== filterRef.current) return;
      if (e.key === "ArrowDown") to = index + 1;
      else if (e.key === "ArrowUp") to = index - 1;
      else if (!inField) {
        if (e.key === "j") to = index + 1;
        else if (e.key === "k") to = index - 1;
        else if (e.key === "PageDown") to = index + page;
        else if (e.key === "PageUp") to = index - page;
        else if (e.key === "Home") to = 0;
        else if (e.key === "End") to = sorted.length - 1;
      }
      if (to == null) return;
      e.preventDefault();
      const next = move(to);
      // Shift with the arrows carries the selection along from the row the move started on.
      if (selection && e.shiftKey && row && next && (e.key === "ArrowDown" || e.key === "ArrowUp")) selection.change([row, next], "add");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, index, move, sorted, viewH, rowHeight, openRow, keys, filterRef, object, env, local, objectMenu, layout.pinnedWidth, selection, peekState.open, rowKey]);

  // THE POINTER MOVES FOCUS, but only when the pointer itself moves. Chromium
  // sends synthetic mouse moves when content scrolls under a still cursor, and
  // treating those as intent would yank focus away from a keyboard user mid-scroll.
  const lastPointer = useRef({ x: -1, y: -1 });
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.clientX === lastPointer.current.x && e.clientY === lastPointer.current.y) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const i = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / rowHeight);
    const row = sorted[i];
    if (row && (focused === undefined || rowKey(row) !== rowKey(focused))) {
      setFocusKey(rowKey(row));
      onFocusRow?.(row);
    }
  };

  useEffect(() => {
    if (peekState.open) signalOnboarding("peek");
  }, [peekState.open]);

  // The parts of a landing that reach outside render: the scroll and the Peek.
  useEffect(() => {
    if (landed == null) return;
    const i = focusKey == null ? undefined : indexByKey.get(focusKey);
    // A frame later, so a table mounting on this landing has measured itself.
    const raf = requestAnimationFrame(() => {
      if (i != null) virtual.scrollToIndex(i, { align: "center" });
    });
    pin();
    onLanded?.(landed);
    return () => cancelAnimationFrame(raf);
    // Once per landing; everything else is read as it stands at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  // FOCUS (~/focus/focus-mode.tsx): the lit row into view when it is out of sight,
  // and the scroll put back where the reader had it once the focus lets go.
  const spotIndex = spotlight == null ? undefined : indexByKey.get(spotlight);
  const scrollBeforeSpot = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (spotIndex != null) {
      if (scrollBeforeSpot.current == null) scrollBeforeSpot.current = el.scrollTop;
      const top = spotIndex * rowHeight;
      if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) virtual.scrollToIndex(spotIndex, { align: "center" });
    } else if (scrollBeforeSpot.current != null) {
      el.scrollTop = scrollBeforeSpot.current;
      scrollBeforeSpot.current = null;
    }
    // Only when the lit row changes; the virtualizer and row height are read as they stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotIndex]);

  // Beside its row, clamped inside the visible table so a row near the bottom
  // never pushes the panel off screen.
  const rowTop = headH + index * rowHeight - scrollTop;
  const maxTop = Math.max(headH + 8, headH + viewH - peekH - 12);
  const peekTop = Math.min(Math.max(rowTop - 6, headH + 8), maxTop);
  // Beside the name the row is known by: just past the pinned columns, which
  // hold the name in place however far the stats scroll. Inside the right edge
  // when the table is too narrow for that, and at the edge when nothing is pinned.
  const edgeLeft = Math.max(8, viewW - PEEK_W - 16);
  const peekLeft = layout.pinnedWidth > 0 ? Math.min(layout.pinnedWidth + 8, edgeLeft) : edgeLeft;

  // EXPORT (./table-export.ts): what is on screen, as text a spreadsheet takes. Built when asked, from the
  // table as it stands then, so offering it costs nothing while the reader scrolls and types.
  const latest = useRef({ columns, sorted, selection, indexByKey });
  useEffect(() => {
    latest.current = { columns, sorted, selection, indexByKey };
  });
  const tableText = useCallback(
    (kind: "csv" | "tsv", only?: "selected") => {
      const { columns: cols, sorted: all, selection: sel, indexByKey: at } = latest.current;
      const list = only === "selected" && sel ? all.filter((r) => sel.isSelected(r)) : all;
      return delimited(cols, list, (r) => at.get(rowKey(r)) ?? 0, kind);
    },
    [rowKey],
  );
  const picked = selection && selection.size > 0 ? sorted.reduce((n, r) => n + (selection.isSelected(r) ? 1 : 0), 0) : 0;
  const register = exportCtx?.register;
  useEffect(() => {
    if (!register) return;
    register({ name: ariaLabel, rows: sorted.length, selected: picked, tsv: (only) => tableText("tsv", only), csv: (only) => tableText("csv", only) });
    return () => register(null);
  }, [register, ariaLabel, sorted.length, picked, tableText]);
  const fileName = exportCtx?.fileName ?? ariaLabel;
  const rowsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`;
  const exportEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [
      {
        kind: "item",
        id: "copy-table",
        label: `Copy ${rowsWord(sorted.length)} for a spreadsheet`,
        icon: <ClipboardCopy size={14} strokeWidth={2} />,
        onSelect: () => env.copyTable(tableText("tsv"), sorted.length),
      },
      {
        kind: "item",
        id: "save-table",
        label: `Save ${rowsWord(sorted.length)} as CSV…`,
        icon: <FileDown size={14} strokeWidth={2} />,
        onSelect: () => env.saveCsv(tableText("csv"), fileName, sorted.length),
      },
    ];
    if (picked > 1) {
      out.push(
        { kind: "separator", id: "sep:picked" },
        {
          kind: "item",
          id: "copy-picked",
          label: `Copy the ${rowsWord(picked)} selected`,
          icon: <ClipboardCopy size={14} strokeWidth={2} />,
          onSelect: () => env.copyTable(tableText("tsv", "selected"), picked),
        },
        {
          kind: "item",
          id: "save-picked",
          label: `Save the ${rowsWord(picked)} selected as CSV…`,
          icon: <FileDown size={14} strokeWidth={2} />,
          onSelect: () => env.saveCsv(tableText("csv", "selected"), `${fileName} selected`, picked),
        },
      );
    }
    return out;
  };

  const sortBy = (col: Column<R>) =>
    col.sortValue &&
    setSort((s) => (s.key === col.key ? { key: col.key, dir: (s.dir * -1) as Dir } : { key: col.key, dir: col.first }));

  /** A header's right-click: sort either way, reset, and hide or bring back columns. */
  const headerMenu = (e: ReactMouseEvent, col: Column<R>) => {
    e.preventDefault();
    const entries: MenuEntry[] = [];
    if (col.sortValue) {
      const sample = sorted.find((r) => col.sortValue!(r) != null);
      const text = sample != null && typeof col.sortValue(sample) === "string";
      const on = sort.key === col.key;
      entries.push(
        { kind: "item", id: "asc", label: text ? "Sort A to Z" : "Sort low to high", checked: on && sort.dir === 1, onSelect: () => setSort({ key: col.key, dir: 1 }) },
        { kind: "item", id: "desc", label: text ? "Sort Z to A" : "Sort high to low", checked: on && sort.dir === -1, onSelect: () => setSort({ key: col.key, dir: -1 }) },
      );
    }
    if (sort.key !== defaultSort.key || sort.dir !== defaultSort.dir) {
      entries.push({ kind: "item", id: "reset", label: "Reset sort", checked: false, onSelect: () => setSort(defaultSort) });
    }
    if (id) {
      const tail: MenuEntry[] = [];
      if (!col.pin) tail.push({ kind: "item", id: "hide", label: `Hide ${col.title ?? col.label}`, checked: false, onSelect: () => setHidden((h) => [...h, col.key]) });
      if (hidden.length > 0) {
        tail.push({
          kind: "item",
          id: "show",
          label: `Show ${hidden.length} hidden ${hidden.length === 1 ? "column" : "columns"}`,
          checked: false,
          onSelect: () => setHidden([]),
        });
      }
      if (tail.length > 0 && entries.length > 0) entries.push({ kind: "separator", id: "s1" });
      entries.push(...tail);
    }
    if (sorted.length > 0) {
      if (entries.length > 0) entries.push({ kind: "separator", id: "s-export" });
      entries.push(...exportEntries());
    }
    openMenu({ x: e.clientX, y: e.clientY, label: `${col.label} column`, entries });
  };

  const edge = (i: number) => (scrolledX && i === layout.lastPin ? "var(--pin-edge)" : undefined);
  const pinnedCell = (i: number, background: string): CSSProperties | undefined => {
    const left = layout.pinLeft[i];
    if (left == null) return undefined;
    return { position: "sticky", left, zIndex: 1, background, boxShadow: edge(i) };
  };
  // With bands the header is two grid rows; the column labels take the second.
  const headRow = layout.bands.length > 0 ? 2 : undefined;
  const focusedObj = focused && object ? object(focused) : null;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 overflow-hidden border-b border-hairline bg-paper" style={{ height: headH }}>
        <div
          ref={headRef}
          role="row"
          className="grid h-full"
          style={{
            gridTemplateColumns: layout.template,
            gridTemplateRows: headRow ? `${BAND_H}px ${HEAD_H}px` : undefined,
            width: layout.totalWidth,
            minWidth: "100%",
            transform: "translateX(calc(-1 * var(--sl, 0px)))",
          }}
        >
          {layout.bands.length > 0 && layout.lastPin >= 0 && (
            <div
              aria-hidden
              style={{
                gridRow: 1,
                gridColumn: `1 / span ${layout.lastPin + 1}`,
                position: "relative",
                zIndex: 2,
                transform: "translateX(var(--sl, 0px))",
                background: "var(--paper)",
              }}
            />
          )}
          {layout.bands.map((b) => (
            <div
              key={`${b.label}:${b.start}`}
              role="presentation"
              title={b.label}
              className={`flex min-w-0 items-end border-l border-hairline px-2.5 pb-px text-[10px] font-semibold uppercase tracking-[0.08em] ${
                b.accent ? "text-accent" : "text-ink-muted"
              }`}
              style={{ gridRow: 1, gridColumn: `${b.start + 1} / span ${b.span}` }}
            >
              <span className="truncate">{b.label}</span>
            </div>
          ))}
          {columns.map((c, i) => {
            const active = sort.key === c.key;
            const pinned = layout.pinLeft[i] != null;
            const className = `flex min-w-0 items-center gap-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] transition-colors ${ALIGN[c.align]} ${
              layout.bandStarts.has(i) ? "border-l border-hairline" : ""
            }`;
            const style: CSSProperties = pinned
              ? {
                  position: "relative",
                  zIndex: 2,
                  transform: "translateX(var(--sl, 0px))",
                  background: "var(--paper)",
                  boxShadow: edge(i),
                  gridRow: headRow,
                }
              : { gridRow: headRow };
            // A column with nothing to sort by is a label, not a control.
            if (!c.sortValue) {
              return (
                <div
                  key={c.key}
                  role="columnheader"
                  title={c.title}
                  onContextMenu={id ? (e) => headerMenu(e, c) : undefined}
                  className={`${className} text-ink-muted`}
                  style={style}
                >
                  <span className="truncate">{c.label}</span>
                </div>
              );
            }
            return (
              <button
                key={c.key}
                type="button"
                role="columnheader"
                title={c.title}
                aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                // Sorting must not take keyboard focus, or the next Space
                // would press this button instead of opening Peek.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => sortBy(c)}
                onContextMenu={(e) => headerMenu(e, c)}
                className={`${className} ${active ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                style={style}
              >
                <span className="truncate">{c.label}</span>
                {active && (
                  <span aria-hidden className="text-accent">
                    {sort.dir === 1 ? "↑" : "↓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={sorted.length}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {sorted.length === 0 ? (
          empty
        ) : (
          <div
            onPointerMove={onPointerMove}
            onPointerLeave={onFocusRow ? () => onFocusRow(undefined) : undefined}
            className="relative"
            style={{ height: virtual.getTotalSize(), width: layout.totalWidth, minWidth: "100%" }}
          >
            {virtual.getVirtualItems().map((item) => {
              const row = sorted[item.index]!;
              const isFocus = item.index === index;
              const picked = selection?.isSelected(row) ?? false;
              // Focus lights one row and steps the rest back.
              const lit = spotIndex != null && item.index === spotIndex;
              const stepBack = spotIndex != null && !lit;
              // Picked rows carry the accent more strongly than focus alone, so a selection reads at a glance.
              const background =
                picked || lit
                  ? `color-mix(in oklab, var(--accent) ${isFocus || lit ? 22 : 14}%, var(--paper))`
                  : isFocus
                    ? "var(--row-focus)"
                    : "var(--paper)";
              const echoed = echo != null && rowKey(row) === echo;
              // What Focus reads from under the pointer: the row's object, and whether it is the focused row.
              const obj = object?.(row) ?? null;
              return (
                <div
                  key={rowKey(row)}
                  role="row"
                  data-obj={obj ? JSON.stringify(obj) : undefined}
                  data-row-focus={isFocus ? "" : undefined}
                  aria-selected={selection ? picked : isFocus}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    // Alt-click a number: its Stat Lens.
                    if (e.altKey && statLens && openLens) {
                      const col = (e.target as HTMLElement).closest<HTMLElement>("[data-col]")?.dataset.col;
                      const lens = col ? statLens(row, col) : null;
                      if (lens) {
                        e.preventDefault();
                        openLens(lens, { x: e.clientX, y: e.clientY });
                        return;
                      }
                    }
                    const key = rowKey(row);
                    if (selection && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      selection.change([row], "toggle");
                      anchor.current = key;
                    } else if (selection && e.shiftKey) {
                      // A range from the row last picked or clicked (or the focused one) to this one.
                      e.preventDefault();
                      const from = indexByKey.get(anchor.current ?? focusKey ?? key) ?? item.index;
                      const [lo, hi] = from < item.index ? [from, item.index] : [item.index, from];
                      selection.change(sorted.slice(lo, hi + 1), "add");
                    } else {
                      anchor.current = key;
                    }
                    setFocusKey(key);
                  }}
                  onDoubleClick={openRow ? (e) => openRow(row, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey }) : undefined}
                  onContextMenu={
                    object
                      ? (e) => {
                          setFocusKey(rowKey(row));
                          const o = object(row);
                          const col = (e.target as HTMLElement).closest<HTMLElement>("[data-col]")?.dataset.col;
                          const lens = col && statLens ? statLens(row, col) : null;
                          const at = { x: e.clientX, y: e.clientY };
                          const lead = lens && openLens ? [lensMenuEntry(lens, () => openLens(lens, at))] : [];
                          const tail: MenuEntry[] = [{ kind: "item", id: "sub:export", label: "Export", icon: <FileDown size={14} strokeWidth={2} />, submenu: exportEntries() }];
                          if (o) objectMenu(e, o, local, lead, tail);
                          else e.preventDefault();
                        }
                      : undefined
                  }
                  draggable={dragRow ? true : undefined}
                  onDragStart={dragRow ? (e) => beginDrag(e, dragRow(row)) : undefined}
                  className="absolute left-0 top-0 grid w-full items-center border-b border-hairline/50"
                  style={{
                    gridTemplateColumns: layout.template,
                    height: rowHeight,
                    transform: `translateY(${item.start}px)`,
                    background,
                    // Drawn over the pinned cells, which paint their own opaque ground.
                    outline: lit ? "2px solid var(--accent)" : echoed ? "1.5px solid var(--accent)" : undefined,
                    outlineOffset: lit ? "-2px" : echoed ? "-1.5px" : undefined,
                    opacity: stepBack ? 0.4 : undefined,
                  }}
                >
                  {columns.map((c, i) => (
                    <div
                      key={c.key}
                      role="gridcell"
                      data-col={c.key}
                      className={`flex h-full min-w-0 items-center px-2.5 text-[13px] ${ALIGN[c.align]} ${
                        layout.bandStarts.has(i) ? "border-l border-hairline/60" : ""
                      }`}
                      style={pinnedCell(i, background)}
                    >
                      {c.cell(row, item.index)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {peek && peekState.open && focused && (
        <PeekPanel
          label={peek.label(focused)}
          pinned={peekState.pinned}
          top={peekTop}
          left={peekLeft}
          onHeight={setPeekH}
          position={index + 1}
          total={sorted.length}
          canOpen={!!openRow}
          actions={focusedObj ? <PeekActions obj={focusedObj} local={{}} /> : undefined}
        >
          {peek.body(focused)}
        </PeekPanel>
      )}
    </div>
  );
}
