import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PercentileChip } from "@/components/percentile-chip";
import type { Season, Team } from "~/data/team-model";
import { TeamPeek } from "~/peek/team-peek";
import { usePeek } from "~/peek/use-peek";
import { num1, pct1, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";

/**
 * The team table: every team in a season, sorted, filtered, keyboard-driven,
 * and every stat carrying its percentile in the site's ramp.
 *
 * FIXED ROW HEIGHT, on purpose. Peek anchors to a row, the pointer maps to a row
 * by arithmetic, and the virtualizer never has to measure: all three depend on
 * a row being exactly ROW_H tall. A cell that wraps is a bug, not a variant.
 *
 * 42px, NOT 34, BECAUSE OF THE CHIPS. Each stat stacks its value over its
 * percentile chip, the way the explorer does. Side by side would need about 94px
 * a column and push a 1440 window into horizontal scroll; stacked, the columns
 * keep their width and the table gives up three rows of height instead.
 *
 * THE HEADER SITS OUTSIDE THE SCROLL AREA and follows horizontal scroll by
 * transform. Keeping it out of the scroller means the virtualizer's offsets
 * start at the first row with no sticky-header correction to get wrong.
 */

const ROW_H = 42;
const HEAD_H = 32;

type SortKey =
  | "rank" | "name" | "conf" | "record" | "adjO" | "adjD" | "adjNet"
  | "tempo" | "efg" | "efgDef" | "tov" | "orb" | "fg3" | "sos" | "zone";
type Dir = 1 | -1;
type Align = "left" | "right" | "center";

type Col = {
  key: SortKey;
  label: string;
  title?: string;
  width: number;
  align: Align;
  /** The direction of the first click: the better end first, so lower-is-better stats sort ascending. */
  first: Dir;
  value: (t: Team) => number | string | null;
  cell: (t: Team) => ReactNode;
};

/**
 * A number over its percentile chip.
 *
 * The chip is the site's own component and the percentile is the explorer's own
 * (direction handled there: a low Adj D is green). `pctKey` is the explorer's key
 * for the stat. A missing entry draws no chip rather than a gray one, which is
 * how the explorer says "this number is not a judgment".
 */
function Stat({
  value,
  pct,
  strong = false,
  neutral = false,
}: {
  value: string;
  pct: number | null | undefined;
  strong?: boolean;
  neutral?: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-[3px] leading-none">
      <span className={strong ? "font-semibold text-ink tabular" : "text-ink-soft tabular"}>{value}</span>
      <PercentileChip pct={pct ?? null} neutral={neutral} className="min-w-[26px] px-1 py-[2px] text-[10.5px]" />
    </span>
  );
}

const COLS: Col[] = [
  {
    key: "rank", label: "#", title: "BTA rank", width: 48, align: "right", first: 1,
    value: (t) => t.btaRank,
    cell: (t) => <span className="text-ink-muted tabular">{t.btaRank ?? "–"}</span>,
  },
  {
    key: "name", label: "Team", width: 224, align: "left", first: 1,
    value: (t) => t.name,
    cell: (t) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={t.logoId} name={t.name} size={20} />
        <span className="truncate font-medium text-ink">{t.name}</span>
      </span>
    ),
  },
  {
    key: "conf", label: "Conf", width: 100, align: "left", first: 1,
    value: (t) => t.confLabel,
    cell: (t) => <span className="block truncate text-ink-soft">{t.confLabel}</span>,
  },
  {
    key: "record", label: "W-L", width: 64, align: "right", first: -1,
    value: (t) => t.wins - t.losses,
    cell: (t) => <Stat value={`${t.wins}-${t.losses}`} pct={t.pct.win_pct} />,
  },
  {
    key: "adjO", label: "Adj O", title: "Adjusted offensive rating", width: 64, align: "right", first: -1,
    value: (t) => t.adjO,
    cell: (t) => <Stat value={num1(t.adjO)} pct={t.pct.a_ortg} />,
  },
  {
    key: "adjD", label: "Adj D", title: "Adjusted defensive rating (lower is better)", width: 64, align: "right", first: 1,
    value: (t) => t.adjD,
    cell: (t) => <Stat value={num1(t.adjD)} pct={t.pct.a_drtg} />,
  },
  {
    key: "adjNet", label: "Net", title: "Adjusted net rating", width: 64, align: "right", first: -1,
    value: (t) => t.adjNet,
    cell: (t) => <Stat value={signed1(t.adjNet)} pct={t.pct.a_net} strong />,
  },
  {
    // NEUTRAL, deliberately. Pace has no good end, so the chip still says how
    // unusual a team is but is painted in the ramp's middle band instead of
    // calling a fast team green, as percentile-chip.tsx prescribes.
    key: "tempo", label: "Tempo", title: "Adjusted tempo", width: 64, align: "right", first: -1,
    value: (t) => t.tempo,
    cell: (t) => <Stat value={num1(t.tempo)} pct={t.pct.adjt} neutral />,
  },
  {
    key: "efg", label: "eFG%", title: "Effective field goal %", width: 62, align: "right", first: -1,
    value: (t) => t.efg,
    cell: (t) => <Stat value={pct1(t.efg)} pct={t.pct.cbb_efg} />,
  },
  {
    key: "efgDef", label: "Opp eFG%", title: "Opponent effective field goal % (lower is better)", width: 80, align: "right", first: 1,
    value: (t) => t.efgDef,
    cell: (t) => <Stat value={pct1(t.efgDef)} pct={t.pct.cbb_efg_def} />,
  },
  {
    key: "tov", label: "TOV%", title: "Turnover rate (lower is better)", width: 62, align: "right", first: 1,
    value: (t) => t.tov,
    cell: (t) => <Stat value={pct1(t.tov)} pct={t.pct.cbb_tov} />,
  },
  {
    key: "orb", label: "OREB%", title: "Offensive rebound rate", width: 68, align: "right", first: -1,
    value: (t) => t.orb,
    cell: (t) => <Stat value={pct1(t.orb)} pct={t.pct.cbb_orb} />,
  },
  {
    key: "fg3", label: "3P%", title: "Three-point %", width: 60, align: "right", first: -1,
    value: (t) => t.fg3,
    cell: (t) => <Stat value={pct1(t.fg3)} pct={t.pct.cbb_fg3} />,
  },
  {
    key: "sos", label: "SOS", title: "Strength of schedule", width: 60, align: "right", first: -1,
    value: (t) => t.sos,
    cell: (t) => <Stat value={num1(t.sos)} pct={t.pct.adj_sos} />,
  },
  {
    key: "zone", label: "Zone", title: "Inside the contender trapezoid", width: 60, align: "center", first: -1,
    value: (t) => (t.inZone == null ? null : t.inZone ? 1 : 0),
    cell: (t) =>
      t.inZone == null ? null : t.inZone ? (
        <span role="img" aria-label="Inside the trapezoid" className="inline-block h-[7px] w-[7px] rounded-full bg-good" />
      ) : (
        <span role="img" aria-label="Outside the trapezoid" className="inline-block h-[5px] w-[5px] rounded-full bg-hairline" />
      ),
  },
];

/** A trailing flexible track, so the focus tint runs to the edge on wide windows. */
const TEMPLATE = `${COLS.map((c) => `${c.width}px`).join(" ")} minmax(0, 1fr)`;
const TOTAL_W = COLS.reduce((sum, c) => sum + c.width, 0);

const ALIGN: Record<Align, string> = {
  left: "justify-start text-left",
  right: "justify-end text-right",
  center: "justify-center text-center",
};

/**
 * Folds a name and a query into the same shape before matching.
 *
 * NUMBER WORDS BECOME DIGITS. The site labels conferences "Big 10", "Big 12",
 * "Atlantic 10", while people type "big ten". Folding the words into digits on
 * both sides matches either spelling against either label, without a
 * hand-kept alias list that would need a new entry every time a conference
 * is renamed.
 */
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => NUMBER_WORDS[w] ?? w)
    .replace(/\s+/g, " ")
    .trim();

/** Missing values sort last in BOTH directions; a dash at the top of a sort reads as a winner. */
function compare(a: number | string | null, b: number | string | null, dir: Dir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" || typeof b === "string") return dir * String(a).localeCompare(String(b));
  return dir * (a - b);
}

export function TeamTable({
  season,
  query,
  onCount,
}: {
  season: Season;
  query: string;
  onCount: (n: number) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "rank", dir: 1 });

  const rows = useMemo(() => {
    const q = normalize(query);
    const list = q
      ? season.teams.filter((t) => normalize(t.name).includes(q) || normalize(t.confLabel).includes(q))
      : season.teams;
    const col = COLS.find((c) => c.key === sort.key) ?? COLS[0]!;
    return [...list].sort(
      (a, b) => compare(col.value(a), col.value(b), sort.dir) || (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9),
    );
  }, [season, query, sort]);

  useEffect(() => onCount(rows.length), [rows.length, onCount]);

  // FOCUS IS A TEAM, NOT A ROW NUMBER. Sorting and filtering move rows around;
  // an index would silently hand the focus to whichever team now sits there.
  const [focusId, setFocusId] = useState<number | null>(null);
  const found = focusId == null ? -1 : rows.findIndex((t) => t.id === focusId);
  const index = found >= 0 ? found : rows.length > 0 ? 0 : -1;
  const focused = index >= 0 ? rows[index] : undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
  });

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [peekH, setPeekH] = useState(0);
  const frame = useRef(0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The header tracks horizontal scroll directly, with no render per event.
    if (headRef.current) headRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
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
      if (rows.length === 0) return;
      const i = Math.max(0, Math.min(rows.length - 1, to));
      setFocusId(rows[i]!.id);
      virtual.scrollToIndex(i, { align: "auto" });
    },
    [rows, virtual],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const page = Math.max(1, Math.floor(viewH / ROW_H) - 1);
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
        else if (e.key === "End") to = rows.length - 1;
      }
      if (to == null) return;
      e.preventDefault();
      move(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, move, rows.length, viewH]);

  // THE POINTER MOVES FOCUS, but only when the pointer itself moves. Chromium
  // sends synthetic mouse moves when content scrolls under a still cursor, and
  // treating those as intent would yank focus away from a keyboard user mid-scroll.
  const lastPointer = useRef({ x: -1, y: -1 });
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.clientX === lastPointer.current.x && e.clientY === lastPointer.current.y) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const i = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H);
    const t = rows[i];
    if (t && t.id !== focused?.id) setFocusId(t.id);
  };

  const peek = usePeek();
  // Beside its row, clamped inside the visible table so a team near the bottom
  // never pushes the panel off screen.
  const rowTop = HEAD_H + index * ROW_H - scrollTop;
  const maxTop = Math.max(HEAD_H + 8, HEAD_H + viewH - peekH - 12);
  const peekTop = Math.min(Math.max(rowTop - 6, HEAD_H + 8), maxTop);

  const sortBy = (col: Col) =>
    setSort((s) => (s.key === col.key ? { key: col.key, dir: (s.dir * -1) as Dir } : { key: col.key, dir: col.first }));

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 overflow-hidden border-b border-hairline bg-paper" style={{ height: HEAD_H }}>
        <div
          ref={headRef}
          role="row"
          className="grid h-full"
          style={{ gridTemplateColumns: TEMPLATE, width: TOTAL_W, minWidth: "100%" }}
        >
          {COLS.map((c) => {
            const active = sort.key === c.key;
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
        aria-label="Teams"
        aria-rowcount={rows.length}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-[13px] text-ink-muted">
            No team or conference matches &ldquo;{query.trim()}&rdquo;. <span className="text-ink-soft">Esc</span> clears the filter.
          </p>
        ) : (
          <div
            onPointerMove={onPointerMove}
            className="relative"
            style={{ height: virtual.getTotalSize(), width: TOTAL_W, minWidth: "100%" }}
          >
            {virtual.getVirtualItems().map((item) => {
              const t = rows[item.index]!;
              const isFocus = item.index === index;
              return (
                <div
                  key={t.id}
                  role="row"
                  aria-selected={isFocus}
                  onMouseDown={(e) => {
                    if (e.button === 0) setFocusId(t.id);
                  }}
                  className={`absolute left-0 top-0 grid w-full items-center border-b border-hairline/50 ${
                    isFocus ? "bg-[var(--row-focus)]" : ""
                  }`}
                  style={{ gridTemplateColumns: TEMPLATE, height: ROW_H, transform: `translateY(${item.start}px)` }}
                >
                  {COLS.map((c) => (
                    <div key={c.key} role="gridcell" className={`flex min-w-0 items-center px-2.5 text-[13px] ${ALIGN[c.align]}`}>
                      {c.cell(t)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {peek.open && focused && (
        <TeamPeek season={season} team={focused} pinned={peek.pinned} top={peekTop} onHeight={setPeekH} />
      )}
    </div>
  );
}
