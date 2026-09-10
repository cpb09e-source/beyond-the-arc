"use client";

import { useEffect, useMemo, useState } from "react";
import { hexbin as d3hexbin } from "d3-hexbin";
import { cn } from "@/lib/utils";
import { dataUrl } from "@/lib/data-url";
import { teamSlug } from "@/lib/team-slug";
import {
  Court, volColor, diffColor, COLD_HEX, HOT_HEX, DIFF_DOMAIN,
} from "@/components/shot/court";
import { W, H, RIM_X, RIM_Y, THREE_R, CORNER_X, CORNER_Y, ZONES, zoneOf } from "@/lib/shot-zones";

/**
 * Where a team shoots, where it lets you shoot, and the gap between the two.
 *
 * TWO VIEWS: what this team shoots, and what it lets you shoot. Both are
 * colored against the D-I rate AT THAT SPOT rather than a single league
 * average, so a hex says "better than the field is from here" instead of
 * "better than the field is on average", which at the rim are very different
 * sentences.
 *
 * WHY HEXES FOR ACCURACY HERE, WHEN THE PLAYER PAGE USES ZONES. That card
 * abandoned hex-level accuracy for a good reason: a player's ~400 shots
 * scatter so thin that most cells were mostly prior, and "cold in this hex" is
 * not a sentence about basketball. A team side is ~2,100 shots — five times
 * the support in the same 205 cells — so the cells carry real signal, and at
 * team level the question genuinely is about patches of floor rather than
 * about a shooter's habits.
 *
 * EVERY VIEW IS SHRUNK TOWARD THE LEAGUE at the same spot. Without it the
 * loudest cells are the emptiest: 2-for-2 from the corner would paint bright
 * red. See SHRINK_K.
 *
 * The filters exist because the underlying rows carry more than a location:
 * shot type, value, result and venue all narrow the court to a question, and
 * every panel on the card recomputes against them.
 */

// Tuple positions in public/data/team-shots/<season>/<slug>.json. Identical to
// the player shot files; see scripts/build-team-shots.mts.
const CX = 0, CY = 1, MADE = 2, TYPE = 3, IS3 = 4, WON = 5, LOC = 6;

type Row = number[];
type File = { team: string; season: number; off: Row[]; def: Row[] };
type Baselines = { r: number; seasons: Record<string, Record<"G" | "F" | "C", Record<string, [number, number]>>> };

/** Bin radius. MUST match shot-baselines.json's `r` — the league comparison is
 *  keyed by hex centre, so a different radius would compare a cell against a
 *  patch of floor that is not the same patch of floor. */
const HEX_R = 22;

/**
 * Beta-prior strength, in attempts, centred on the league rate at that spot.
 * Carried over from the player card, where it was sized from the spread it
 * models rather than picked by eye. A team cell has more attempts behind it,
 * so the prior bites less often — which is the correct behaviour, not a reason
 * to lower it.
 */
const SHRINK_K = 25;

type Side = "off" | "def";
type Metric = "volume" | "accuracy";

type Filters = {
  types: [boolean, boolean, boolean, boolean]; // jump, layup, dunk, tip
  pts2: boolean; pts3: boolean;
  win: boolean; loss: boolean;
  home: boolean; away: boolean; neutral: boolean;
};

const ALL: Filters = {
  types: [true, true, true, true],
  pts2: true, pts3: true,
  win: true, loss: true,
  home: true, away: true, neutral: true,
};

const isDefault = (f: Filters) =>
  f.types.every(Boolean) && f.pts2 && f.pts3 &&
  f.win && f.loss && f.home && f.away && f.neutral;

function applyFilters(rows: Row[], f: Filters): Row[] {
  if (isDefault(f)) return rows;
  return rows.filter((s) => {
    if (!f.types[s[TYPE]!]) return false;
    if (s[IS3] === 1 ? !f.pts3 : !f.pts2) return false;
    if (s[WON] === 1 ? !f.win : s[WON] === 0 ? !f.loss : false) return false;
    const loc = s[LOC];
    if (loc === 0 ? !f.home : loc === 1 ? !f.away : !f.neutral) return false;
    return true;
  });
}

type Cell = {
  key: string; x: number; y: number;
  att: number; made: number;
  /** Shrunk FG% for this cell. */
  fg: number;
  /** League FG% at this spot, or null where the league has too little of it. */
  league: number | null;
  /** Shrunk rate minus the league rate at this spot, or null with no baseline. */
  diff: number | null;
};

/**
 * Is this point beyond the arc? A shot row carries its own 3PT flag and that is
 * always authoritative, but a HEX CENTRE has no flag, so the readout derives
 * the band from the same geometry the court is drawn from: the straight corner
 * segments below where they meet the arc, the arc everywhere else.
 */
const is3At = (x: number, y: number) =>
  y <= CORNER_Y ? x <= CORNER_X || x >= W - CORNER_X : Math.hypot(x - RIM_X, y - RIM_Y) >= THREE_R;

export function TeamShotChart({ team, season }: { team: string; season: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [base, setBase] = useState<Map<string, [number, number]> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  const [side, setSide] = useState<Side>("off");
  const [metric, setMetric] = useState<Metric>("accuracy");
  const [f, setF] = useState<Filters>(ALL);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the request
       is the effect. Switching team or season has to put the card back into
       loading before the fetch resolves, or it shows the previous team's
       court under the new team's name for as long as the network takes. */
    setState("loading");
    Promise.all([
      fetch(dataUrl(`/data/team-shots/${season}/${teamSlug(team)}.json`)).then((r) => (r.ok ? r.json() : null)),
      fetch(dataUrl("/data/shot-baselines.json")).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([shots, baselines]: [File | null, Baselines | null]) => {
        if (!live) return;
        if (!shots || (!shots.off?.length && !shots.def?.length)) { setState("missing"); return; }
        setFile(shots);
        // The league rate at a spot is every shot taken there, so the three
        // position buckets sum. They are disjoint and exhaustive by
        // construction — checked against the archive at 44.8% overall and
        // 63.9% at the rim, which are the D-I numbers.
        const s = baselines?.seasons?.[String(season)];
        if (s) {
          const m = new Map<string, [number, number]>();
          for (const bucket of ["G", "F", "C"] as const) {
            for (const [k, [made, att]] of Object.entries(s[bucket] ?? {})) {
              const cur = m.get(k) ?? [0, 0];
              m.set(k, [cur[0] + made, cur[1] + att]);
            }
          }
          setBase(m);
        }
        setState("ready");
      })
      .catch(() => { if (live) setState("missing"); });
    return () => { live = false; };
  }, [team, season]);

  const offRows = useMemo(() => applyFilters(file?.off ?? [], f), [file, f]);
  const defRows = useMemo(() => applyFilters(file?.def ?? [], f), [file, f]);
  const shown = side === "def" ? defRows : offRows;

  const cells = useMemo(
    () => buildCells(offRows, defRows, side, base),
    [offRows, defRows, side, base],
  );

  const hexPath = useMemo(() => d3hexbin().radius(HEX_R).hexagon(), []);
  const maxAtt = useMemo(() => cells.reduce((m, c) => Math.max(m, c.att), 0), [cells]);
  // Cap well below the max so a team's favourite spots all saturate — that is
  // what makes a shot diet read as a region rather than one hottest cell.
  const volCap = Math.max(3, maxAtt * 0.45);

  /**
   * THE HEX LAYER IS MEMOISED WITHOUT `hover` ON PURPOSE.
   *
   * Hovering used to set state on this component, which re-rendered all ~85
   * paths — each carrying its own hover stroke — and with them the SVG holding
   * a feTurbulence grain filter. That is an expensive thing to reconcile on
   * every pointer move across a court, and it felt like exactly what it was:
   * lag.
   *
   * Now the marks depend only on the data, so moving the pointer reconciles
   * nothing here; the highlight ring is drawn once in the overlay layer above
   * the line work, from `active`. One path changes instead of eighty-five.
   */
  const hexLayer = useMemo(() => (
    // One attempt is not a shooting percentage. Drawing it invites the reader
    // to read a color off a cell that has none.
    cells.filter((c) => c.att >= 2).map((c) => {
      const fill = metric === "accuracy"
        ? (c.diff === null ? "rgba(255,255,255,0.35)" : diffColor(c.diff))
        : volColor(c.att / volCap);
      /**
       * HEXES TILE. VOLUME IS OPACITY, NOT SIZE.
       *
       * Scaling each hex by its attempt count left gaps between them, and a
       * court of small detached shapes reads as scatter — confetti with a
       * basketball court behind it — rather than as a map of anything. It also
       * made the perimeter, which is mostly two- and three-shot cells, the
       * busiest-looking part of the picture while saying the least.
       *
       * Full-size hexes tessellate into one continuous surface. Volume moves
       * to opacity instead, so heavily-shot floor is vivid, lightly-shot floor
       * sinks toward the court, and the eye lands on the parts with something
       * behind them. Color still means exactly one thing.
       */
      const weight = Math.sqrt(Math.min(1, c.att / Math.max(4, maxAtt * 0.55)));
      const opacity = metric === "accuracy" ? 0.10 + 0.90 * weight : 1;
      return (
        <path
          key={c.key}
          d={hexPath}
          transform={`translate(${c.x},${c.y})`}
          fill={fill}
          opacity={opacity}
          onPointerEnter={() => setHover(c.key)}
          onClick={() => setHover(c.key)}
          style={{ cursor: "pointer" }}
        />
      );
    })
  ), [cells, metric, volCap, maxAtt, hexPath]);

  const active = hover ? cells.find((c) => c.key === hover) ?? null : null;
  const totals = useMemo(() => summarize(offRows, defRows, side), [offRows, defRows, side]);

  if (state === "loading") {
    return <Shell><p className="py-16 text-center text-sm text-ink-muted">Loading shot locations…</p></Shell>;
  }
  if (state === "missing") {
    return (
      <Shell>
        <p className="py-12 text-center text-sm text-ink-muted">
          No shot locations for {team} in {season - 1}-{String(season).slice(2)}.
        </p>
        <p className="pb-12 text-center text-xs text-ink-muted/80">
          Shot charts start with the 2021-22 season, where the play-by-play first
          carries coordinates for most attempts.
        </p>
      </Shell>
    );
  }

  const sideLabel = side === "off" ? "Shots taken" : side === "def" ? "Shots allowed" : "Offense − defense";

  return (
    <Shell>
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-hairline">
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            value={side}
            onChange={(v) => setSide(v as Side)}
            options={[["off", "Offense"], ["def", "Defense"]]}
          />
          <Seg
            value={metric}
            onChange={(v) => setMetric(v as Metric)}
            options={[["accuracy", "Accuracy"], ["volume", "Volume"]]}
          />
          {/* Venue rides the top row rather than the filter bar. It is the one
              filter that changes WHICH GAMES are on the court rather than
              which shots within them, which puts it closer to the view
              toggles than to shot type. */}
          <VenueChips f={f} setF={setF} />
          {!isDefault(f) && (
            <button
              type="button"
              onClick={() => setF(ALL)}
              className="ml-auto text-[0.68rem] uppercase tracking-wider font-semibold text-coral hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <FilterBar f={f} setF={setF} />
      </div>

      {/* THE CARD STACKS, because it now shares a row with the Shooting panel
          and is half the page wide. Splitting that half again put the court in
          about 21rem and the readouts in less — both too narrow to be worth
          looking at. Full card width for the court, everything else beneath it
          in a row that wraps. */}
      <div className="p-4 sm:p-5">
        <div className="w-full">
          <Court
            label={`${team} ${sideLabel.toLowerCase()} by court location`}
            onPointerLeave={() => setHover(null)}
            overlay={active ? (
              <g pointerEvents="none">
                <path
                  d={hexPath}
                  transform={`translate(${active.x},${active.y})`}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth={2.5}
                />
              </g>
            ) : null}
          >
            {hexLayer}
          </Court>
          <Legend side={side} metric={metric} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Headline side={side} totals={totals} count={shown.length} />
          <Readout cell={active} />
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------- binning ---------------------------------- */

function bin(rows: Row[]) {
  const gen = d3hexbin<Row>().x((s) => s[CX]!).y((s) => s[CY]!).radius(HEX_R).extent([[0, 0], [W, H]]);
  const out = new Map<string, { x: number; y: number; att: number; made: number }>();
  for (const b of gen(rows)) {
    out.set(`${Math.round(b.x)},${Math.round(b.y)}`, {
      x: b.x, y: b.y, att: b.length, made: b.reduce((n, s) => n + s[MADE]!, 0),
    });
  }
  return out;
}

/** League rate at a hex, snapping to the nearest baseline key within a cell. */
function leagueAt(base: Map<string, [number, number]> | null, x: number, y: number): number | null {
  if (!base) return null;
  const exact = base.get(`${Math.round(x)},${Math.round(y)}`);
  if (exact && exact[1] > 200) return exact[0] / exact[1];
  let best: [number, number] | null = null, bestD = Infinity;
  for (const [k, v] of base) {
    const [bx, by] = k.split(",").map(Number) as [number, number];
    const d = Math.hypot(bx - x, by - y);
    if (d < bestD && d <= HEX_R) { bestD = d; best = v; }
  }
  return best && best[1] > 200 ? best[0] / best[1] : null;
}

/** Shrink a rate toward a prior centred on `prior` with strength SHRINK_K. */
const shrink = (made: number, att: number, prior: number) =>
  (made + SHRINK_K * prior) / (att + SHRINK_K);

function buildCells(
  off: Row[], def: Row[], side: Side, base: Map<string, [number, number]> | null,
): Cell[] {
  const primary = bin(side === "def" ? def : off);
  const out: Cell[] = [];

  for (const [key, b] of primary) {
    const league = leagueAt(base, b.x, b.y);
    const prior = league ?? 0.45;
    const fg = shrink(b.made, b.att, prior);

    const diff = league === null ? null : fg - league;

    out.push({ key, x: b.x, y: b.y, att: b.att, made: b.made, fg, league, diff });
  }
  return out;
}

function summarize(off: Row[], def: Row[], side: Side) {
  const of = (rows: Row[]) => {
    const att = rows.length;
    const made = rows.reduce((n, s) => n + s[MADE]!, 0);
    const three = rows.filter((s) => s[IS3] === 1);
    const t3m = three.reduce((n, s) => n + s[MADE]!, 0);
    return {
      att, made,
      fg: att ? made / att : 0,
      // eFG% over field goals only — free throws carry no location and are not
      // in this file, so this is the shot-chart eFG%, not the box score's.
      efg: att ? (made + 0.5 * t3m) / att : 0,
      rate3: att ? three.length / att : 0,
    };
  };
  return { off: of(off), def: of(def), side };
}

/* ------------------------------- chrome ----------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-hairline bg-card overflow-hidden">{children}</section>;
}

function Seg({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-paper-deep/60 p-0.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={k === value}
          className={cn(
            "px-2.5 h-7 rounded text-[0.7rem] font-semibold transition-colors whitespace-nowrap",
            k === value ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "px-2 h-6 rounded border text-[0.62rem] uppercase tracking-wider font-semibold transition-colors",
        on ? "border-ink/25 bg-ink/[0.06] text-ink" : "border-hairline text-ink-muted/70 hover:text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

function VenueChips({ f, setF }: { f: Filters; setF: (f: Filters) => void }) {
  const venue = (k: "home" | "away" | "neutral") => {
    const next = { ...f, [k]: !f[k] };
    // Never let the group empty itself — no venue means no shots, which is
    // never what the tap meant.
    if (next.home || next.away || next.neutral) setF(next);
  };
  return (
    <Group label="Venue">
      <Chip on={f.home} onClick={() => venue("home")}>Home</Chip>
      <Chip on={f.away} onClick={() => venue("away")}>Away</Chip>
      <Chip on={f.neutral} onClick={() => venue("neutral")}>Neutral</Chip>
    </Group>
  );
}

function FilterBar({ f, setF }: { f: Filters; setF: (f: Filters) => void }) {
  const t = (i: number) => {
    const types = [...f.types] as Filters["types"];
    types[i] = !types[i];
    if (types.some(Boolean)) setF({ ...f, types });
  };
  // Every group refuses to empty itself — an all-off group means "no shots",
  // which is never what the tap meant.
  const pair = (a: keyof Filters, b: keyof Filters) => (k: keyof Filters) => {
    const next = { ...f, [k]: !f[k] } as Filters;
    if (next[a] || next[b]) setF(next);
  };
  const shotSide = pair("pts2", "pts3");
  const wlSide = pair("win", "loss");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Group label="Type">
        <Chip on={f.types[1]!} onClick={() => t(1)}>Layup</Chip>
        <Chip on={f.types[2]!} onClick={() => t(2)}>Dunk</Chip>
        <Chip on={f.types[0]!} onClick={() => t(0)}>Jumper</Chip>
        <Chip on={f.types[3]!} onClick={() => t(3)}>Tip</Chip>
      </Group>
      <Group label="Value">
        <Chip on={f.pts2} onClick={() => shotSide("pts2")}>2PT</Chip>
        <Chip on={f.pts3} onClick={() => shotSide("pts3")}>3PT</Chip>
      </Group>
      <Group label="Result">
        <Chip on={f.win} onClick={() => wlSide("win")}>Wins</Chip>
        <Chip on={f.loss} onClick={() => wlSide("loss")}>Losses</Chip>
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[0.55rem] uppercase tracking-[0.14em] font-bold text-ink-muted/70">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

const pct = (v: number) => (100 * v).toFixed(1) + "%";
const signed = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(100 * v).toFixed(1);

function Headline({ side, totals, count }: {
  side: Side; totals: ReturnType<typeof summarize>; count: number;
}) {
  const t = side === "def" ? totals.def : totals.off;
  const label = side === "off" ? "Shots taken" : side === "def" ? "Shots allowed" : "Both sides";
  return (
    <div className="rounded-lg border border-hairline bg-paper-deep/30 p-3">
      <p className="text-[0.55rem] uppercase tracking-[0.16em] font-bold text-ink-muted">{label}</p>
      <>
          <p className="mt-1 text-2xl font-bold tabular leading-none text-ink">{pct(t.fg)}</p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-[0.68rem]">
            <Stat k="Attempts" v={count.toLocaleString()} />
            <Stat k="eFG%" v={pct(t.efg)} />
            <Stat k="3PA rate" v={pct(t.rate3)} />
          </dl>
      </>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[0.55rem] uppercase tracking-wider text-ink-muted/80">{k}</dt>
      <dd className="tabular font-semibold text-ink">{v}</dd>
    </div>
  );
}

/** The hovered cell, spelled out. Replaces a floating tooltip so it works the
 *  same under a finger as under a cursor. */
function Readout({ cell }: { cell: Cell | null }) {
  if (!cell) {
    return (
      <p className="rounded-lg border border-dashed border-hairline p-3 text-[0.7rem] text-ink-muted leading-snug">
        Hover or tap any hex for its attempts, shooting percentage, and how that
        compares.
      </p>
    );
  }
  const ft = Math.hypot(cell.x - RIM_X, cell.y - RIM_Y) / 10;
  const zone = ZONES.find((z) => z.id === zoneOf(cell.x, cell.y, is3At(cell.x, cell.y)));
  return (
    <div className="rounded-lg border border-hairline p-3 space-y-1.5">
      <p className="text-[0.55rem] uppercase tracking-[0.16em] font-bold text-ink-muted">
        {zone?.label ?? "Court"} · {ft.toFixed(0)} ft
      </p>
      <p className="text-lg font-bold tabular leading-none text-ink">
        {cell.made}/{cell.att} <span className="text-sm text-ink-muted">({pct(cell.att ? cell.made / cell.att : 0)})</span>
      </p>
      {cell.diff !== null ? (
        <p className="text-[0.7rem] text-ink-muted leading-snug">
          D-I shoots {pct(cell.league ?? 0)} from here.{" "}
          <span className="font-semibold" style={{ color: cell.diff >= 0 ? HOT_HEX : COLD_HEX }}>
            {signed(cell.diff)} pts
          </span>{" "}
          after shrinkage.
        </p>
      ) : (
        <p className="text-[0.7rem] text-ink-muted leading-snug">No league baseline for this spot.</p>
      )}
    </div>
  );
}

function Legend({ side, metric }: { side: Side; metric: Metric }) {
  const steps = 9;
  if (metric === "volume") {
    return (
      <LegendRow left="Fewer shots" right="More shots">
        {Array.from({ length: steps }, (_, i) => volColor(i / (steps - 1)))}
      </LegendRow>
    );
  }
  const left = side === "def" ? "Defends it well" : "Below D-I";
  const right = side === "def" ? "Gets scored on" : "Above D-I";
  return (
    <LegendRow
      left={left}
      right={right}
      note={`±${(100 * DIFF_DOMAIN).toFixed(0)} pts of FG%`}
    >
      {Array.from({ length: steps }, (_, i) => diffColor(DIFF_DOMAIN * (2 * (i / (steps - 1)) - 1)))}
    </LegendRow>
  );
}

function LegendRow({ left, right, note, children }: {
  left: string; right: string; note?: string; children: string[];
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="text-[0.58rem] text-ink-muted whitespace-nowrap">{left}</span>
      <span className="flex-1 flex h-2.5 rounded-full overflow-hidden ring-1 ring-ink/10">
        {children.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
      </span>
      <span className="text-[0.58rem] text-ink-muted whitespace-nowrap">{right}</span>
      {note && <span className="hidden sm:inline text-[0.55rem] text-ink-muted/70 whitespace-nowrap">{note}</span>}
    </div>
  );
}
