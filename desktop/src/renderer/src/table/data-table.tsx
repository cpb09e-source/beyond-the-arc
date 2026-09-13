import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { usePeek } from "~/peek/use-peek";
import { PeekPanel } from "./peek-panel";

/**
 * The one table every object in the app is shown in: teams, players, games.
 *
 * ONE COMPONENT, SO ONE BEHAVIOUR. Sorting, the keyboard model, pointer focus,
 * virtualization and Peek live here and nowhere else. A reader who learns that
 * ↓ moves, Space previews and a header click sorts better-first on teams never
 * meets a table that does it slightly differently on game logs.
 *
 * FIXED ROW HEIGHT, per table. Peek anchors to a row, the pointer maps to a row
 * by arithmetic, and the virtualizer never has to measure: all three depend on
 * every row being exactly `rowHeight` tall. A cell that wraps is a bug.
 *
 * THE HEADER SITS OUTSIDE THE SCROLL AREA and follows horizontal scroll by
 * transform, so the virtualizer's offsets start at the first row with no
 * sticky-header correction to get wrong.
 *
 * PINNED COLUMNS stay put when a wide table scrolls sideways: rank and name on
 * a game log with thirty stats, so a row never loses the thing it is about.
 * They must lead the column list. Their backgrounds are opaque, because a
 * translucent sticky cell shows the columns scrolling underneath it; the site
 * hit exactly that twice.
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
  sortValue: (row: R) => number | string | null;
  cell: (row: R) => ReactNode;
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
  ariaLabel: string;
  empty: ReactNode;
  peek?: PeekSpec<R>;
};

const HEAD_H = 32;

const ALIGN: Record<Align, string> = {
  left: "justify-start text-left",
  right: "justify-end text-right",
  center: "justify-center text-center",
};

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
  columns,
  rowKey,
  rowHeight = 42,
  defaultSort,
  tieBreak,
  ariaLabel,
  empty,
  peek,
}: Props<R>) {
  const [sort, setSort] = useState(defaultSort);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    if (!col) return rows;
    return [...rows].sort((a, b) => compare(col.sortValue(a), col.sortValue(b), sort.dir) || (tieBreak?.(a, b) ?? 0));
  }, [rows, columns, sort, tieBreak]);

  const layout = useMemo(() => {
    let x = 0;
    const pinLeft = columns.map((c) => {
      if (!c.pin) return null;
      const left = x;
      x += c.width;
      return left;
    });
    return {
      // A trailing flexible track, so a row's tint runs to the edge on wide windows.
      template: `${columns.map((c) => `${c.width}px`).join(" ")} minmax(0, 1fr)`,
      totalWidth: columns.reduce((sum, c) => sum + c.width, 0),
      pinLeft,
      lastPin: columns.reduce((last, c, i) => (c.pin ? i : last), -1),
    };
  }, [columns]);

  // FOCUS IS A ROW'S KEY, NOT ITS POSITION. Sorting and filtering move rows;
  // a position would silently hand the focus to whatever now sits there.
  const indexByKey = useMemo(() => new Map(sorted.map((r, i) => [rowKey(r), i])), [sorted, rowKey]);
  const [focusKey, setFocusKey] = useState<string | number | null>(null);
  const found = focusKey == null ? undefined : indexByKey.get(focusKey);
  const index = found ?? (sorted.length > 0 ? 0 : -1);
  const focused = index >= 0 ? sorted[index] : undefined;

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
  const [peekH, setPeekH] = useState(0);
  const [scrolledX, setScrolledX] = useState(false);
  const scrolledXRef = useRef(false);
  const frame = useRef(0);

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
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const move = useCallback(
    (to: number) => {
      if (sorted.length === 0) return;
      const i = Math.max(0, Math.min(sorted.length - 1, to));
      setFocusKey(rowKey(sorted[i]!));
      virtual.scrollToIndex(i, { align: "auto" });
    },
    [sorted, rowKey, virtual],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const page = Math.max(1, Math.floor(viewH / rowHeight) - 1);
      let to: number | null = null;
      // Arrows work from the filter box too, so filtering and moving is one motion.
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
      move(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, move, sorted.length, viewH, rowHeight]);

  // THE POINTER MOVES FOCUS, but only when the pointer itself moves. Chromium
  // sends synthetic mouse moves when content scrolls under a still cursor, and
  // treating those as intent would yank focus away from a keyboard user mid-scroll.
  const lastPointer = useRef({ x: -1, y: -1 });
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.clientX === lastPointer.current.x && e.clientY === lastPointer.current.y) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const i = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / rowHeight);
    const row = sorted[i];
    if (row && (focused === undefined || rowKey(row) !== rowKey(focused))) setFocusKey(rowKey(row));
  };

  const peekState = usePeek();
  // Beside its row, clamped inside the visible table so a row near the bottom
  // never pushes the panel off screen.
  const rowTop = HEAD_H + index * rowHeight - scrollTop;
  const maxTop = Math.max(HEAD_H + 8, HEAD_H + viewH - peekH - 12);
  const peekTop = Math.min(Math.max(rowTop - 6, HEAD_H + 8), maxTop);

  const sortBy = (col: Column<R>) =>
    setSort((s) => (s.key === col.key ? { key: col.key, dir: (s.dir * -1) as Dir } : { key: col.key, dir: col.first }));

  const edge = (i: number) => (scrolledX && i === layout.lastPin ? "var(--pin-edge)" : undefined);
  const pinnedCell = (i: number, background: string): CSSProperties | undefined => {
    const left = layout.pinLeft[i];
    if (left == null) return undefined;
    return { position: "sticky", left, zIndex: 1, background, boxShadow: edge(i) };
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 overflow-hidden border-b border-hairline bg-paper" style={{ height: HEAD_H }}>
        <div
          ref={headRef}
          role="row"
          className="grid h-full"
          style={{
            gridTemplateColumns: layout.template,
            width: layout.totalWidth,
            minWidth: "100%",
            transform: "translateX(calc(-1 * var(--sl, 0px)))",
          }}
        >
          {columns.map((c, i) => {
            const active = sort.key === c.key;
            const pinned = layout.pinLeft[i] != null;
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
                className={`flex min-w-0 items-center gap-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] transition-colors ${ALIGN[c.align]} ${
                  active ? "text-ink" : "text-ink-muted hover:text-ink"
                }`}
                style={
                  pinned
                    ? {
                        position: "relative",
                        zIndex: 2,
                        transform: "translateX(var(--sl, 0px))",
                        background: "var(--paper)",
                        boxShadow: edge(i),
                      }
                    : undefined
                }
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
            className="relative"
            style={{ height: virtual.getTotalSize(), width: layout.totalWidth, minWidth: "100%" }}
          >
            {virtual.getVirtualItems().map((item) => {
              const row = sorted[item.index]!;
              const isFocus = item.index === index;
              const background = isFocus ? "var(--row-focus)" : "var(--paper)";
              return (
                <div
                  key={rowKey(row)}
                  role="row"
                  aria-selected={isFocus}
                  onMouseDown={(e) => {
                    if (e.button === 0) setFocusKey(rowKey(row));
                  }}
                  className="absolute left-0 top-0 grid w-full items-center border-b border-hairline/50"
                  style={{
                    gridTemplateColumns: layout.template,
                    height: rowHeight,
                    transform: `translateY(${item.start}px)`,
                    background,
                  }}
                >
                  {columns.map((c, i) => (
                    <div
                      key={c.key}
                      role="gridcell"
                      className={`flex h-full min-w-0 items-center px-2.5 text-[13px] ${ALIGN[c.align]}`}
                      style={pinnedCell(i, background)}
                    >
                      {c.cell(row)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {peek && peekState.open && focused && (
        <PeekPanel label={peek.label(focused)} pinned={peekState.pinned} top={peekTop} onHeight={setPeekH}>
          {peek.body(focused)}
        </PeekPanel>
      )}
    </div>
  );
}
