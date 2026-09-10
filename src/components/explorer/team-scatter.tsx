"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confDisplay } from "@/lib/conf-display";
import { Select } from "@/components/select";
import { POWER_CONFS } from "@/lib/conf-tiers";
import {
  METRICS, METRIC_BY_KEY, METRIC_GROUPS, METRIC_PRESETS,
  fmtMetric, niceTicks, type Metric,
} from "@/lib/team-scatter-metrics";

/**
 * Any two team metrics against each other, with school crests as the marks.
 *
 * WHY THE SELECTION IS HALF THE DESIGN. A dot is 6px and a crest is 24px, so a
 * logo carries sixteen times the area — and there are 365 of them, thickest
 * exactly where the cloud is already thickest. Drawing every crest at once is a
 * pile, not a chart. So the reader picks, and ONLY the picked teams are drawn.
 *
 * The whole D-I field used to sit behind them as faint dots. At 365 of those
 * it was most of the ink on the page, and a small selection read as a handful
 * of crests dropped on a field of static. The national context they carried is
 * now the D-I median crosshair, which costs two lines instead of 365 marks —
 * and it matters more than before, because the axes fit the selection.
 *
 * BETTER IS ALWAYS UP AND TO THE RIGHT. Adjusted defensive rating is better
 * when it is low, turnover rate is better when it is low, and once the axes are
 * configurable a reader cannot be asked to remember which of the two they
 * picked runs backwards. So an axis whose metric is `lowerBetter` is drawn
 * inverted, and the axis label says which way better runs. Metrics with no good
 * direction — tempo, three-point rate — say nothing and are not inverted.
 *
 * THE TABLE IS THE SAME SELECTION, SORTED. It is not a second view bolted on:
 * a scatter answers "what is the shape" and cannot answer "who is fourth", and
 * pointing at a crest to find out is the slowest possible way to read a
 * ranking. Hovering either one lights the other.
 *
 * There is deliberately no "select every conference" control. The reader can
 * get there by hand if they insist, and the crest ramp copes, but offering it
 * as a button would advertise the one view this chart is worst at.
 */

export type ScatterTeam = {
  name: string;
  conf: string;
  rank: number;
  id: number | null;
  record: string;
  m: Record<string, number | null>;
};

/** Individually-picked teams, capped. Conference picks are not — that is how
 *  the mid-major preset is able to be the biggest selection of all. */
const MAX_TEAMS = 25;

/**
 * Crest size against how many are on the plate.
 *
 * The mid-major preset is ~286 teams and is meant to be: the point of it is the
 * shape of a whole tier, not reading individual schools.
 *
 * 12 IS THE FLOOR, and it is a floor rather than a formula. Below it a crest
 * stops being a crest: the light-on-light schools disappear into the paper and
 * the rest read as smudges, which is strictly worse than the plain dot it
 * replaced. Overlap at 250 teams is the better failure — the tier's shape still
 * reads, and leaning in still identifies a school.
 */
function crestSize(n: number): number {
  if (n <= 20) return 26;
  if (n <= 50) return 20;
  if (n <= 100) return 16;
  if (n <= 180) return 14;
  return 12;
}

type SortKey = "rank" | "name" | "x" | "y";

/** Rows per page. Chosen to end level with the plot beside it, not for a round
 *  number — see the note on the table. */
const PER_PAGE = 25;

/**
 * The two panes are the same height, always.
 *
 * Measured off a rendered 25-row table: a row is 33px and the sticky head is
 * 45. The plot takes that same box whether two teams are selected or
 * twenty-five, and the table holds it when a page is short — otherwise the
 * chart grew and shrank as the reader paged, which is the one thing a fixed
 * frame is for.
 */
const ROW_H = 33;
const HEAD_H = 45;
const PANE_H = HEAD_H + PER_PAGE * ROW_H;

export function TeamScatter({ teams, season }: { teams: ScatterTeam[]; season: number }) {
  const [confs, setConfs] = useState<Set<string>>(() => new Set(["ACC"]));
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [xKey, setXKey] = useState("adjoe");
  const [yKey, setYKey] = useState("adjde");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });

  const xM = METRIC_BY_KEY[xKey]!, yM = METRIC_BY_KEY[yKey]!;

  const allConfs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of teams) counts.set(t.conf, (counts.get(t.conf) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => {
        const pa = POWER_CONFS.has(a[0]) ? 0 : 1, pb = POWER_CONFS.has(b[0]) ? 0 : 1;
        return pa - pb || confDisplay(a[0]).localeCompare(confDisplay(b[0]));
      })
      .map(([code, n]) => ({ code, n }));
  }, [teams]);

  // SPLIT, not just sorted. Thirty-one chips in one unbroken ribbon is a wall —
  // the power leagues were already first but nothing said so, which made the
  // order look arbitrary and left the reader scanning all thirty-one to find
  // the six they wanted. Two labelled groups is the same information, findable.
  const powerConfs = useMemo(() => allConfs.filter((c) => POWER_CONFS.has(c.code)), [allConfs]);
  const midConfs = useMemo(() => allConfs.filter((c) => !POWER_CONFS.has(c.code)), [allConfs]);

  const shown = useMemo(
    () => teams
      .filter((t) => confs.has(t.conf) || picked.has(t.name))
      .sort((a, b) => a.rank - b.rank),
    [teams, confs, picked],
  );

  const sorted = useMemo(() => {
    const val = (t: ScatterTeam) => {
      if (sort.key === "rank") return t.rank;
      if (sort.key === "x") return t.m[xKey] ?? Number.POSITIVE_INFINITY;
      if (sort.key === "y") return t.m[yKey] ?? Number.POSITIVE_INFINITY;
      return 0;
    };
    return [...shown].sort((a, b) =>
      sort.key === "name"
        ? sort.dir * a.name.localeCompare(b.name)
        : sort.dir * (val(a) - val(b)));
  }, [shown, sort, xKey, yKey]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return teams.filter((t) => t.name.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank).slice(0, 8);
  }, [teams, query]);

  const toggleConf = (code: string) =>
    setConfs((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const togglePick = (name: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else if (next.size < MAX_TEAMS) next.add(name);
      return next;
    });

  const preset = (kind: "power" | "mid" | "top25" | "clear") => {
    if (kind === "clear") { setConfs(new Set()); setPicked(new Set()); return; }
    if (kind === "top25") {
      setConfs(new Set());
      setPicked(new Set(teams.filter((t) => t.rank <= MAX_TEAMS).map((t) => t.name)));
      return;
    }
    setConfs(new Set(allConfs
      .filter(({ code }) => (kind === "power" ? POWER_CONFS.has(code) : !POWER_CONFS.has(code)))
      .map(({ code }) => code)));
    setPicked(new Set());
  };

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  return (
    <div>
      {/* ONE TOOLBAR, FOUR LABELLED ROWS. These were loose rows of controls
          floating on the page with nothing holding them together and nothing
          saying which did what — the chips in particular read as a ribbon of
          debris. A frame and a row label each is the whole fix. */}
      <div className="rounded-lg border border-hairline bg-paper-deep/40 divide-y divide-hairline mb-3">
        <Row label="Plot">
          <Picker label="X" value={xKey} onChange={setXKey} />
          <Picker label="Y" value={yKey} onChange={setYKey} />
          <Btn onClick={() => { setXKey(yKey); setYKey(xKey); }} title="Swap the two axes">Flip</Btn>
          {/* Presets resolve to an X/Y pair and then clear themselves — the
              control is a shortcut, not a mode, and leaving one selected after
              the reader edits an axis by hand would make it a label that lies. */}
          <Select value="" onChange={(v) => {
            const p = METRIC_PRESETS.find((q) => q.label === v);
            if (p) { setXKey(p.x); setYKey(p.y); }
          }} compact ariaLabel="Metric presets" className="w-40">
            <option value="">Presets…</option>
            {METRIC_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </Select>
        </Row>

        <Row label="Show">
          <Btn onClick={() => preset("power")}>Power 6</Btn>
          <Btn onClick={() => preset("mid")}>All mid-majors</Btn>
          <Btn onClick={() => preset("top25")}>Top {MAX_TEAMS}</Btn>
          <Btn onClick={() => preset("clear")}>Clear</Btn>
          <span className="text-xs text-ink-muted tabular ml-auto pl-2 shrink-0">
            {shown.length} of {teams.length}
          </span>
        </Row>

        <Row label="Leagues">
          {powerConfs.map(({ code, n }) => (
            <Chip key={code} on={confs.has(code)} onClick={() => toggleConf(code)}
              title={`${confDisplay(code)} — ${n} teams`}>{confDisplay(code)}</Chip>
          ))}
          <span className="w-px self-stretch bg-hairline mx-1" aria-hidden />
          {midConfs.map(({ code, n }) => (
            <Chip key={code} on={confs.has(code)} onClick={() => toggleConf(code)}
              title={`${confDisplay(code)} — ${n} teams`}>{confDisplay(code)}</Chip>
          ))}
        </Row>

        <Row label="Teams">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={picked.size >= MAX_TEAMS ? "25 is the limit" : "Add a team…"}
              disabled={picked.size >= MAX_TEAMS}
              className="text-sm rounded-full border border-hairline bg-paper px-3 py-1 w-36 focus:w-44 transition-[width] outline-none focus:border-coral disabled:opacity-50"
            />
            {matches.length > 0 && (
              <ul className="absolute z-30 mt-1 w-56 rounded-md border border-hairline bg-paper shadow-lg overflow-hidden">
                {matches.map((t) => (
                  <li key={t.name}>
                    <button type="button" onClick={() => { togglePick(t.name); setQuery(""); }}
                      className="w-full text-left text-sm px-2.5 py-1.5 hover:bg-paper-deep/60 flex justify-between gap-2">
                      <span className="truncate">{t.name}</span>
                      <span className="tabular text-ink-muted shrink-0">#{t.rank}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {[...picked].map((name) => (
            <button key={name} type="button" onClick={() => togglePick(name)} title="Remove"
              className="text-xs rounded-full pl-2.5 pr-2 py-1 border border-coral/50 bg-coral/10 text-coral inline-flex items-center gap-1 hover:border-coral">
              {name}<span aria-hidden className="opacity-60">×</span>
            </button>
          ))}
          {picked.size > 0 && (
            <span className="text-xs text-ink-muted tabular ml-auto pl-2 shrink-0">
              {picked.size} of {MAX_TEAMS}
            </span>
          )}
        </Row>
      </div>

      <h2 className="text-base text-ink mb-2">
        <span className="tabular font-semibold">{shown.length}</span> teams
      </h2>

      {/* Table first in the DOM and on a phone, where a wide plot is the worse
          of the two. Side by side from lg, table fixed and plot elastic. */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <TeamTable
          rows={sorted} xM={xM} yM={yM} sort={sort} onSort={sortBy}
          hover={hover} setHover={setHover}
        />
        <div className="flex-1 min-w-0 w-full">
          <Plot
            teams={teams} shown={shown} xM={xM} yM={yM}
            hover={hover} setHover={setHover}
          />
          <p className="mt-2 text-xs text-ink-muted leading-snug">
            {season - 1}-{String(season).slice(2)} season. The axes fit the teams shown, so the
            dashed crosshair — the D-I median — is the fixed reference. Where a metric has a
            good direction the axis is turned so that better is up and to the right.
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- controls -------------------------------- */

/** A labelled row of the toolbar. The label is a fixed width so all four line
 *  up down the left — that alignment is what makes it read as one panel. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-2">
      <span className="text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted shrink-0 w-[4.2rem] pt-1">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Btn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="text-[0.68rem] uppercase tracking-[0.08em] rounded-full border border-hairline px-3 py-1 text-ink-soft hover:border-ink-muted hover:text-ink transition-colors">
      {children}
    </button>
  );
}

function Chip({ on, onClick, title, children }: {
  on: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
        on ? "border-coral bg-coral/12 text-coral font-semibold"
           : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink"
      }`}>
      {children}
    </button>
  );
}

/** Axis metric picker. A native select, grouped — twenty-two options is past
 *  what a row of chips can carry, and the browser's own list is better at this
 *  than anything hand-rolled would be on a phone. */
function Picker({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted shrink-0">{label}</span>
      <Select value={value} onChange={onChange} compact ariaLabel={`${label} axis metric`} className="w-52">
        {METRIC_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {METRICS.filter((m) => m.group === g).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

/* --------------------------------- table ---------------------------------- */

function TeamTable({
  rows, xM, yM, sort, onSort, hover, setHover,
}: {
  rows: ScatterTeam[]; xM: Metric; yM: Metric;
  sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void;
  hover: string | null; setHover: (v: string | null) => void;
}) {
  const [page, setPage] = useState(0);

  // CLAMPED RATHER THAN RESET. Changing the sort should leave the reader where
  // they were; shrinking the selection while on page 8 must not leave them
  // staring at an empty table. Deriving the page from the current row count
  // instead of resetting it on every change does both.
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pages - 1);
  const from = safePage * PER_PAGE;
  const pageRows = rows.slice(from, from + PER_PAGE);

  if (!rows.length) {
    return (
      <div className="w-full lg:w-[22rem] shrink-0 rounded-lg border border-hairline p-4 text-sm text-ink-muted">
        Nothing selected. Pick a league or a team above.
      </div>
    );
  }

  // The arrow points the way the column is sorted, not the way "better" runs —
  // it is a control, and a control that lies about its own state is worse than
  // one that says nothing.
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const th = "px-2 py-1.5 text-xs uppercase tracking-wide text-ink-muted font-semibold cursor-pointer hover:text-ink select-none";

  return (
    <div className="w-full lg:w-[22rem] shrink-0 rounded-lg border border-hairline overflow-hidden">
      {/* PAGED, NOT SCROLLED. 286 rows in a scrolling box next to a fixed-height
          plot leaves the chart stranded at the top of a very long column, and a
          reader who scrolls the list loses the plot from view entirely. Twenty
          five rows is about the height of the chart beside it, so the two panes
          end level and the whole tool fits one screen. */}
      <div style={{ height: PANE_H }} className="overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-paper-deep z-10">
            <tr className="border-b border-hairline">
              <th className={`${th} text-right w-8`} onClick={() => onSort("rank")}>#{arrow("rank")}</th>
              <th className={`${th} text-left`} onClick={() => onSort("name")}>Team{arrow("name")}</th>
              <th className={`${th} text-right`} onClick={() => onSort("x")} title={xM.label}>
                {xM.short}{arrow("x")}
              </th>
              <th className={`${th} text-right`} onClick={() => onSort("y")} title={yM.label}>
                {yM.short}{arrow("y")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => (
              <tr
                key={t.name}
                onPointerEnter={() => setHover(t.name)}
                onPointerLeave={() => setHover(null)}
                className={`border-b border-hairline/60 last:border-b-0 cursor-default ${
                  hover === t.name ? "bg-coral/10" : "hover:bg-paper-deep/50"
                }`}
              >
                <td className="px-2 py-1.5 text-right text-xs tabular text-ink-muted">{t.rank}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {t.id != null && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/ttz-logos/${t.id}.png`} alt="" width={14} height={14}
                        loading="lazy" className="object-contain shrink-0" style={{ width: 14, height: 14 }} />
                    )}
                    <span className="text-sm text-ink truncate">{t.name}</span>
                    <span className="text-[0.65rem] tabular text-ink-muted shrink-0 ml-auto">{t.record}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-sm tabular text-ink-soft">
                  {fmtMetric(xM, t.m[xM.key] ?? null)}
                </td>
                <td className="px-2 py-1.5 text-right text-sm tabular text-ink-soft">
                  {fmtMetric(yM, t.m[yM.key] ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-hairline px-2 py-1.5">
          <span className="text-xs text-ink-muted tabular">
            {from + 1}–{Math.min(from + PER_PAGE, rows.length)} of {rows.length}
          </span>
          <span className="flex items-center gap-1">
            <Pager onClick={() => setPage(0)} disabled={safePage === 0} label="First">«</Pager>
            <Pager onClick={() => setPage(safePage - 1)} disabled={safePage === 0} label="Previous">‹</Pager>
            <span className="text-xs text-ink-soft tabular px-1">{safePage + 1} / {pages}</span>
            <Pager onClick={() => setPage(safePage + 1)} disabled={safePage >= pages - 1} label="Next">›</Pager>
            <Pager onClick={() => setPage(pages - 1)} disabled={safePage >= pages - 1} label="Last">»</Pager>
          </span>
        </div>
      )}
    </div>
  );
}

function Pager({ onClick, disabled, label, children }: {
  onClick: () => void; disabled: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="w-6 h-6 rounded border border-hairline text-sm leading-none text-ink-soft hover:border-ink-muted hover:text-ink disabled:opacity-30 disabled:hover:border-hairline">
      {children}
    </button>
  );
}

/* ---------------------------------- plot ---------------------------------- */

function Plot({
  teams, shown, xM, yM, hover, setHover,
}: {
  teams: ScatterTeam[]; shown: ScatterTeam[]; xM: Metric; yM: Metric;
  hover: string | null; setHover: (v: string | null) => void;
}) {
  const L = 52, R = 20, T = 16, B = 44;
  const H = PANE_H;

  /**
   * THE viewBox IS THE PIXEL BOX, measured rather than assumed.
   *
   * This used to be a fixed 760x470 viewBox in a box sized by aspect-ratio,
   * and capping that box's height broke it: aspect-ratio computes height from
   * width, max-height then clamps the USED height and leaves the width alone,
   * so the box went 704x416 against a 760x470 viewBox. The SVG letterboxed to
   * 622px wide and centred itself — while the crests, which are HTML absolutely
   * positioned as a percentage of the BOX, stayed on the full 704. Every crest
   * slid outward off its own gridlines, some of them past the edge entirely.
   *
   * Measuring means the viewBox and the box are the same number, so there is no
   * scale factor to disagree about. It also renders every label at its true
   * size instead of ~7% under.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(700);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setW(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    // THE FRAME FITS THE SELECTION, NOT THE COUNTRY. It used to be the full D-I
    // extent, which was only readable because every unselected team was on the
    // plot as a faint dot filling the space. With those gone an 18-team league
    // sat in one corner of a mostly empty box. Fitting the axes to what is
    // actually drawn is also what makes two crests near each other separable,
    // which is the whole reason to narrow a selection in the first place.
    //
    // The cost is real and worth naming: the axis range now moves when the
    // selection does, so two screenshots of this page are not comparable
    // unless the ticks are read. The D-I median crosshair below is the guard
    // against that — it is the one fixed landmark, and it is drawn from ALL
    // teams rather than from the selection for exactly that reason.
    const pick = (src: ScatterTeam[], k: string) =>
      src.map((t) => t.m[k]).filter((v): v is number => v != null);
    const base = shown.length ? shown : teams;
    const xs = pick(base, xM.key), ys = pick(base, yM.key);
    const pad = (a: number[]) => {
      const lo = Math.min(...a), hi = Math.max(...a);
      const m = (hi - lo) * 0.07 || 1;
      return [lo - m, hi + m] as const;
    };
    const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
    const mid = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
    const allX = pick(teams, xM.key), allY = pick(teams, yM.key);

    // INVERTED WHEN LOWER IS BETTER, so better is always right and always up.
    const X = (v: number) => {
      const t = (v - x0) / (x1 - x0);
      return L + (xM.lowerBetter ? 1 - t : t) * (W - L - R);
    };
    const Y = (v: number) => {
      const t = (v - y0) / (y1 - y0);
      // Screen y grows downward, so the un-inverted case already flips once.
      return T + (yM.lowerBetter ? t : 1 - t) * (H - T - B);
    };
    return { X, Y, x0, x1, y0, y1, mx: mid(allX), my: mid(allY) };
  }, [teams, shown, xM, yM, W, H]);

  const { X, Y } = geo;
  const size = crestSize(shown.length);

  /**
   * Nudge crests apart only while the selection is small.
   *
   * Under about forty marks a vertical push plus a leader line keeps every
   * crest legible at almost no cost in accuracy. Past that the pushes compound
   * — a tight cluster of a hundred would end up as a column bearing no relation
   * to the numbers — so above the threshold the crests sit where the data puts
   * them and are allowed to overlap. Shrinking is the honest answer at that
   * size; relocating is not.
   */
  const placed = useMemo(() => {
    const dodge = shown.length <= 40;
    const taken: { x: number; y: number }[] = [];
    return shown
      .filter((p) => p.m[xM.key] != null && p.m[yM.key] != null)
      .map((p) => {
        const bx = X(p.m[xM.key]!), base = Y(p.m[yM.key]!);
        let by = base;
        if (dodge) {
          let step = 0;
          while (step < 14 && taken.some((q) => Math.abs(q.x - bx) < size * 0.8 && Math.abs(q.y - by) < size * 0.8)) {
            step++;
            by = base + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * size * 0.85;
          }
          by = Math.max(T + size / 2, Math.min(H - B - size / 2, by));
          taken.push({ x: bx, y: by });
        }
        return { p, x: bx, y: by, base };
      });
  }, [shown, X, Y, size, xM, yM, H]);

  // The DODGED position, not the data position — the card has to sit against
  // the crest the pointer is actually over, which for a nudged mark is not
  // where its numbers put it.
  const hoveredMark = hover ? placed.find((m) => m.p.name === hover) ?? null : null;

  // Empty for a metric with no good direction — a "better" arrow on tempo or
  // three-point rate would be an editorial claim the data does not make.
  const axisNote = (m: Metric) => (m.neutral ? "" : "— BETTER");

  // A reference line only means something inside the frame — see the note on
  // the crosshair below.
  const inRange = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);

  return (
    // Fixed height, matching a full page of the table beside it. Width comes
    // from the column; the viewBox above follows both, so nothing scales.
    <div ref={boxRef} className="relative w-full" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" role="img"
        aria-label={`Teams by ${xM.label} against ${yM.label}`}>
        {niceTicks(geo.x0, geo.x1).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} y1={T} x2={X(v)} y2={H - B} stroke="var(--hairline)" />
            <text x={X(v)} y={H - B + 12} textAnchor="middle" fontSize={11.5}
              fill="var(--ink-muted)" className="tabular">{fmtMetric(xM, v)}</text>
          </g>
        ))}
        {niceTicks(geo.y0, geo.y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="var(--hairline)" />
            <text x={L - 6} y={Y(v) + 3} textAnchor="end" fontSize={11.5}
              fill="var(--ink-muted)" className="tabular">{fmtMetric(yM, v)}</text>
          </g>
        ))}

        {/* THE D-I MEDIAN, from every team rather than from the selection, and
            drawn only when it falls inside the frame. With the background dots
            gone this is the only national context left on the plot, and the
            axes now move with the selection — so without it a reader has no way
            to tell "good" from "good for this league". Skipped rather than
            clamped to an edge, because a reference line pinned to the border
            would claim the median is at the edge of the range. */}
        {inRange(geo.mx, geo.x0, geo.x1) && (
          <g>
            <line x1={X(geo.mx)} y1={T} x2={X(geo.mx)} y2={H - B}
              stroke="var(--ink-muted)" strokeDasharray="3 3" opacity={0.5} />
            <text x={X(geo.mx) + 3} y={H - B - 4} fontSize={9.5} fill="var(--ink-muted)" letterSpacing="0.06em">
              D-I MED
            </text>
          </g>
        )}
        {inRange(geo.my, geo.y0, geo.y1) && (
          <g>
            <line x1={L} y1={Y(geo.my)} x2={W - R} y2={Y(geo.my)}
              stroke="var(--ink-muted)" strokeDasharray="3 3" opacity={0.5} />
            <text x={L + 3} y={Y(geo.my) - 3} fontSize={9.5} fill="var(--ink-muted)" letterSpacing="0.06em">
              D-I MED
            </text>
          </g>
        )}

        {/* Corner captions only where both axes actually have a direction —
            "strong both ways" is a lie about a plot of tempo against 3PA rate. */}
        {!xM.neutral && !yM.neutral && (
          <>
            <text x={W - R - 5} y={T + 11} textAnchor="end" fontSize={10} fill="var(--ink-muted)" letterSpacing="0.08em">
              STRONG BOTH
            </text>
            <text x={L + 5} y={H - B - 6} fontSize={10} fill="var(--ink-muted)" letterSpacing="0.08em">
              WEAK BOTH
            </text>
          </>
        )}

        {/* NOTHING UNSELECTED IS DRAWN. The whole D-I field used to sit behind
            the selection as faint dots; at 365 of them that is most of the ink
            on the page, and it made a small selection look like a handful of
            crests dropped on a field of static. The national context it carried
            is now the median crosshair above, which costs two lines. */}
        {placed.map(({ p, x, y, base }) => (
          Math.abs(y - base) > 1
            ? <line key={`ld${p.name}`} x1={x} y1={base} x2={x} y2={y} stroke="var(--ink-muted)" strokeWidth={0.7} opacity={0.55} />
            : null
        ))}

        <text x={(L + W - R) / 2} y={H - 5} textAnchor="middle" fontSize={11.5}
          fill="var(--ink-muted)" letterSpacing="0.08em">
          {[xM.label.toUpperCase(), axisNote(xM), "→"].filter(Boolean).join(" ")}
        </text>
        <text x={11} y={(T + H - B) / 2} fontSize={11.5} fill="var(--ink-muted)" letterSpacing="0.08em"
          textAnchor="middle" transform={`rotate(-90 11 ${(T + H - B) / 2})`}>
          {[yM.label.toUpperCase(), axisNote(yM), "↑"].filter(Boolean).join(" ")}
        </text>
      </svg>

      {/* PAINTED WORST-FIRST so the best teams end up on top. Placement still
          runs best-first — the dodge has to give the top of the sport its
          natural position — but at 250 crests the later ones occlude the
          earlier ones, and the reader is not looking for the 280th team. */}
      {[...placed].reverse().map(({ p, x, y }) => {
        const lit = hover === p.name;
        const pad = size <= 16 ? 3 : 2;
        return (
          <div
            key={p.name}
            className="absolute cursor-pointer rounded-full"
            style={{
              left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`,
              transform: `translate(-50%,-50%) scale(${lit ? 1.5 : 1})`,
              zIndex: lit ? 50 : 1,
              // A paper disc behind every crest. Several schools' marks are
              // white or near-white and vanish into the page without it, and at
              // the dense sizes it also gives overlapping crests an edge so a
              // pile reads as many things rather than one smear.
              width: size + pad * 2, height: size + pad * 2,
              background: "color-mix(in oklab, var(--paper) 88%, transparent)",
              boxShadow: lit ? "0 0 0 1.5px var(--coral)" : "0 0 0 0.5px var(--hairline)",
            }}
            onPointerEnter={() => setHover(p.name)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="absolute inset-0 flex items-center justify-center">
              {p.id == null ? (
                <span className="inline-flex items-center justify-center text-ink-soft font-semibold"
                  style={{ width: size, height: size, fontSize: size * 0.42 }} title={p.name}>
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/ttz-logos/${p.id}.png`} alt={p.name} width={size} height={size}
                  loading="eager" className="object-contain motion-safe:transition-transform"
                  style={{ width: size, height: size }} />
              )}
            </span>
          </div>
        );
      })}

      {hover && <Card team={teams.find((t) => t.name === hover)!} X={X} Y={Y} xM={xM} yM={yM}
        mark={hoveredMark} W={W} H={H} />}
    </div>
  );
}

/**
 * The hovered team's numbers, anchored on its mark.
 *
 * ANCHORED, NOT PARKED UNDER THE PLOT. A readout in a strip below makes the
 * reader look away from the mark they are pointing at and then back again to
 * check which one it was, which is most of the work of reading the chart.
 *
 * It flips rather than clips. The card is a few inches of unwrapping text and
 * the plot's most interesting corner is the top right, which is exactly where a
 * card drawn down-and-right would run off the edge — so it swaps to the other
 * side of the mark past 60% across, and drops below near the top.
 *
 * pointer-events-none throughout: the card can cover neighbouring crests, and a
 * tooltip that eats the hover of the thing behind it makes a dense cluster
 * impossible to explore.
 */
function Card({
  team, X, Y, xM, yM, mark, W, H,
}: {
  team: ScatterTeam; X: (v: number) => number; Y: (v: number) => number;
  xM: Metric; yM: Metric; mark: { x: number; y: number } | null; W: number; H: number;
}) {
  const vx = team.m[xM.key], vy = team.m[yM.key];
  if (vx == null || vy == null) return null;
  // The mark's DODGED position when it has one — hovering a table row has no
  // mark in hand, so fall back to where the data puts it.
  const x = mark?.x ?? X(vx), y = mark?.y ?? Y(vy);
  const flipX = x / W > 0.6;
  const flipY = y / H < 0.22;

  return (
    <div className="absolute z-[60] pointer-events-none"
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}>
      <div
        className="absolute rounded-lg border border-hairline bg-paper shadow-xl px-2.5 py-1.5 whitespace-nowrap"
        style={{ [flipX ? "right" : "left"]: "1rem", [flipY ? "top" : "bottom"]: "0.85rem" }}
      >
        <div className="flex items-center gap-1.5">
          {team.id != null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/ttz-logos/${team.id}.png`} alt="" width={16} height={16}
              className="object-contain" style={{ width: 16, height: 16 }} />
          )}
          <span className="text-sm font-semibold text-ink">{team.name}</span>
          <span className="text-xs tabular text-ink-muted">
            {team.record} · #{team.rank} · {confDisplay(team.conf)}
          </span>
        </div>
        <div className="text-xs text-ink-soft mt-1">
          <span className="text-ink-muted">{xM.short}</span>{" "}
          <span className="tabular">{fmtMetric(xM, vx)}</span>
          <span className="text-ink-muted"> · {yM.short}</span>{" "}
          <span className="tabular">{fmtMetric(yM, vy)}</span>
        </div>
      </div>
    </div>
  );
}
