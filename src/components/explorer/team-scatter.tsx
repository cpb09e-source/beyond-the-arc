"use client";

import { useMemo, useState } from "react";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";

/**
 * Adjusted offense against adjusted defense, for whichever teams the reader
 * asks for, with school crests as the marks.
 *
 * WHY THE SELECTION IS THE WHOLE DESIGN. A dot is 6px and a crest is 24px, so a
 * logo carries sixteen times the area — and there are 365 of them, thickest
 * exactly where the cloud is already thickest. Drawing every crest at once is a
 * pile, not a chart. So the reader picks, and everything unpicked stays on the
 * plot as a faint dot: a selection is read against the whole country rather
 * than against its own panel's edges, which is what stops the ACC and the
 * Patriot League producing identical-looking pictures.
 *
 * THE DEFENSIVE AXIS IS INVERTED. Adjusted defensive efficiency is a number you
 * want LOW, and a plot where down is good on one axis and up is good on the
 * other cannot be read at a glance by anybody. Better is always up and to the
 * right here.
 *
 * There is deliberately no "select every conference" control. The reader can
 * get there by hand if they insist, and the crest ramp below will cope, but
 * offering it as a button would advertise the one view this chart is worst at.
 */

export type ScatterTeam = {
  name: string;
  conf: string;
  rank: number;
  oe: number;
  de: number;
  id: number | null;
  record: string;
};

/** Individually-picked teams, capped. Conference picks are not — that is how
 *  the mid-major preset is able to be the biggest selection of all. */
const MAX_TEAMS = 25;

/**
 * Crest size against how many are on the plate.
 *
 * The mid-major preset is ~250 teams and is meant to be: the point of it is the
 * shape of a whole tier, not reading individual schools. So the crests shrink
 * rather than the selection being refused, and by ~180 they are small enough to
 * behave like colored dots that happen to be identifiable when you lean in.
 */
function crestSize(n: number): number {
  if (n <= 20) return 26;
  if (n <= 50) return 20;
  if (n <= 100) return 16;
  if (n <= 180) return 14;
  // 12 IS THE FLOOR, and it is a floor rather than a formula. Below it a crest
  // stops being a crest: the light-on-light schools disappear into the paper
  // entirely and the rest read as smudges, which is strictly worse than the
  // plain dot it replaced. Overlap at 250 teams is the better failure — you
  // can still see the tier's shape, and leaning in still identifies a school.
  return 12;
}

export function TeamScatter({ teams, season }: { teams: ScatterTeam[]; season: number }) {
  const [confs, setConfs] = useState<Set<string>>(() => new Set(["ACC"]));
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);

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

  const selected = useMemo(() => {
    const out = new Set<string>();
    for (const t of teams) if (confs.has(t.conf) || picked.has(t.name)) out.add(t.name);
    return out;
  }, [teams, confs, picked]);

  const shown = useMemo(
    () => teams.filter((t) => selected.has(t.name)).sort((a, b) => a.rank - b.rank),
    [teams, selected],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return teams
      .filter((t) => t.name.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8);
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
    const want = allConfs
      .filter(({ code }) => (kind === "power" ? POWER_CONFS.has(code) : !POWER_CONFS.has(code)))
      .map(({ code }) => code);
    setConfs(new Set(want));
    setPicked(new Set());
  };

  const hovered = hover ? teams.find((t) => t.name === hover) ?? null : null;

  return (
    <div>
      {/* ONE TOOLBAR, THREE LABELLED ROWS. These were three loose rows of
          controls floating on the page with nothing holding them together and
          nothing saying which did what — the chips in particular read as a
          ribbon of debris. A frame and a row label each is the whole fix. */}
      <div className="rounded-lg border border-hairline bg-paper-deep/40 divide-y divide-hairline mb-3">
        <Row label="Show">
          <Btn onClick={() => preset("power")}>Power 6</Btn>
          <Btn onClick={() => preset("mid")}>All mid-majors</Btn>
          <Btn onClick={() => preset("top25")}>Top {MAX_TEAMS}</Btn>
          <Btn onClick={() => preset("clear")}>Clear</Btn>
          <span className="text-[0.62rem] text-ink-muted tabular ml-auto pl-2 shrink-0">
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
              className="text-[0.7rem] rounded-full border border-hairline bg-paper px-2.5 py-0.5 w-32 focus:w-40 transition-[width] outline-none focus:border-coral disabled:opacity-50"
            />
            {matches.length > 0 && (
              <ul className="absolute z-20 mt-1 w-56 rounded-md border border-hairline bg-paper shadow-lg overflow-hidden">
                {matches.map((t) => (
                  <li key={t.name}>
                    <button
                      type="button"
                      onClick={() => { togglePick(t.name); setQuery(""); }}
                      className="w-full text-left text-[0.72rem] px-2.5 py-1 hover:bg-paper-deep/60 flex justify-between gap-2"
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="tabular text-ink-muted shrink-0">#{t.rank}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {[...picked].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => togglePick(name)}
              title="Remove"
              className="text-[0.62rem] rounded-full pl-2 pr-1.5 py-0.5 border border-coral/50 bg-coral/10 text-coral inline-flex items-center gap-1 hover:border-coral"
            >
              {name}<span aria-hidden className="opacity-60">×</span>
            </button>
          ))}
          {picked.size > 0 && (
            <span className="text-[0.62rem] text-ink-muted tabular ml-auto pl-2 shrink-0">
              {picked.size} of {MAX_TEAMS}
            </span>
          )}
        </Row>
      </div>

      <Plot teams={teams} shown={shown} hover={hover} setHover={setHover} />

      {/* Fixed height, so the plot does not jump as the pointer crosses crests. */}
      <div className="mt-2 min-h-[2.1rem] rounded-md border border-hairline bg-paper-deep/30 px-2.5 py-1.5">
        {hovered ? (
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[0.75rem] text-ink truncate">{hovered.name}</span>
            <span className="text-[0.62rem] text-ink-muted tabular">
              {hovered.record} · #{hovered.rank} · {confDisplay(hovered.conf)}
            </span>
            <span className="text-[0.62rem] tabular text-ink-soft ml-auto shrink-0">
              {hovered.oe.toFixed(1)} off · {hovered.de.toFixed(1)} def ·{" "}
              {hovered.oe - hovered.de >= 0 ? "+" : "−"}{Math.abs(hovered.oe - hovered.de).toFixed(1)} margin
            </span>
          </div>
        ) : (
          <div className="text-[0.62rem] text-ink-muted leading-snug">
            {season - 1}-{String(season).slice(2)} adjusted efficiency, points per 100 possessions.
            Unselected teams stay on as faint dots so a selection is read against the whole country.
          </div>
        )}
      </div>
    </div>
  );
}

/** A labelled row of the toolbar. The label is what stops the controls reading
 *  as loose debris — it is 4.6rem wide so all three line up down the left. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-2">
      <span className="text-[0.52rem] uppercase tracking-[0.16em] text-ink-muted shrink-0 w-[3.6rem] pt-1">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="text-[0.6rem] uppercase tracking-[0.1em] rounded-full border border-hairline px-2.5 py-0.5 text-ink-soft hover:border-ink-muted hover:text-ink transition-colors">
      {children}
    </button>
  );
}

function Chip({ on, onClick, title, children }: {
  on: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className={`text-[0.62rem] rounded-full px-2 py-0.5 border transition-colors ${
        on ? "border-coral bg-coral/12 text-coral font-semibold"
           : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink"
      }`}>
      {children}
    </button>
  );
}

function Plot({
  teams, shown, hover, setHover,
}: {
  teams: ScatterTeam[]; shown: ScatterTeam[];
  hover: string | null; setHover: (v: string | null) => void;
}) {
  const W = 800, H = 520, L = 46, R = 18, T = 16, B = 40;

  const geo = useMemo(() => {
    const oe = teams.map((t) => t.oe), de = teams.map((t) => t.de);
    const x0 = Math.min(...oe) - 1, x1 = Math.max(...oe) + 1;
    const y0 = Math.max(...de) + 1, y1 = Math.min(...de) - 1;
    const mid = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
    return {
      X: (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R),
      Y: (v: number) => T + ((v - y1) / (y0 - y1)) * (H - T - B),
      x0, x1, y0, y1, mOe: mid(oe), mDe: mid(de),
    };
  }, [teams]);
  const { X, Y, x0, x1, y0, y1 } = geo;

  const size = crestSize(shown.length);

  /**
   * Nudge crests apart only while the selection is small.
   *
   * Under about forty marks a vertical push plus a leader line keeps every
   * crest legible at almost no cost in accuracy. Past that the pushes compound
   * — a tight cluster of a hundred would end up as a column bearing no relation
   * to the numbers — so above the threshold the crests are drawn where the data
   * actually puts them and are allowed to overlap. Shrinking is the honest
   * answer at that size; relocating is not.
   */
  const placed = useMemo(() => {
    const dodge = shown.length <= 40;
    const taken: { x: number; y: number }[] = [];
    return shown.map((p) => {
      const bx = X(p.oe), base = Y(p.de);
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
  }, [shown, X, Y, size]);

  const sel = useMemo(() => new Set(shown.map((t) => t.name)), [shown]);

  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" role="img"
        aria-label="Teams by adjusted offensive and defensive efficiency">
        {[95, 100, 105, 110, 115, 120, 125, 130].filter((v) => v > x0 && v < x1).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} y1={T} x2={X(v)} y2={H - B} stroke="var(--hairline)" />
            <text x={X(v)} y={H - B + 12} textAnchor="middle" fontSize={8.5}
              fill="var(--ink-muted)" className="tabular">{v}</text>
          </g>
        ))}
        {[95, 100, 105, 110, 115, 120, 125].filter((v) => v > y1 && v < y0).map((v) => (
          <g key={`y${v}`}>
            <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="var(--hairline)" />
            <text x={L - 6} y={Y(v) + 3} textAnchor="end" fontSize={8.5}
              fill="var(--ink-muted)" className="tabular">{v}</text>
          </g>
        ))}

        <line x1={X(geo.mOe)} y1={T} x2={X(geo.mOe)} y2={H - B} stroke="var(--ink-muted)" strokeDasharray="3 3" opacity={0.5} />
        <line x1={L} y1={Y(geo.mDe)} x2={W - R} y2={Y(geo.mDe)} stroke="var(--ink-muted)" strokeDasharray="3 3" opacity={0.5} />

        <text x={W - R - 5} y={T + 11} textAnchor="end" fontSize={8} fill="var(--ink-muted)" letterSpacing="0.08em">
          ELITE BOTH WAYS
        </text>
        <text x={L + 5} y={T + 11} fontSize={8} fill="var(--ink-muted)" letterSpacing="0.08em">
          DEFENSE CARRIES THEM
        </text>
        <text x={L + 5} y={H - B - 6} fontSize={8} fill="var(--ink-muted)" letterSpacing="0.08em">
          BAD BOTH WAYS
        </text>
        <text x={W - R - 5} y={H - B - 6} textAnchor="end" fontSize={8} fill="var(--ink-muted)" letterSpacing="0.08em">
          OUTSCORE EVERYBODY
        </text>

        {/* Only the UNSELECTED teams get a dot. A selected team already has a
            crest at that spot, and drawing a gray dot under it made the two
            compete — at the small sizes the dot was winning, so the picked
            teams read as fainter than the ones the reader did not pick. */}
        {teams.filter((t) => !sel.has(t.name)).map((t) => (
          <circle key={t.name} cx={X(t.oe)} cy={Y(t.de)} r={2.6} fill="var(--ink-muted)" fillOpacity={0.16} />
        ))}

        {placed.map(({ p, x, y, base }) => (
          Math.abs(y - base) > 1
            ? <line key={`ld${p.name}`} x1={x} y1={base} x2={x} y2={y} stroke="var(--ink-muted)" strokeWidth={0.7} opacity={0.55} />
            : null
        ))}

        <text x={(L + W - R) / 2} y={H - 5} textAnchor="middle" fontSize={8.5}
          fill="var(--ink-muted)" letterSpacing="0.08em">ADJUSTED OFFENSE — POINTS PER 100 →</text>
        <text x={11} y={(T + H - B) / 2} fontSize={8.5} fill="var(--ink-muted)" letterSpacing="0.08em"
          textAnchor="middle" transform={`rotate(-90 11 ${(T + H - B) / 2})`}>
          ← ADJUSTED DEFENSE — BETTER IS UP
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
              left: `${(x / W) * 100}%`,
              top: `${(y / H) * 100}%`,
              transform: `translate(-50%,-50%) scale(${lit ? 1.5 : 1})`,
              zIndex: lit ? 50 : 1,
              // A paper disc behind every crest. Several schools' marks are
              // white or near-white and vanish into the page without it, and at
              // the dense sizes it also gives overlapping crests an edge so a
              // pile reads as many things rather than one smear.
              width: size + pad * 2,
              height: size + pad * 2,
              background: "color-mix(in oklab, var(--paper) 88%, transparent)",
              boxShadow: lit ? "0 0 0 1.5px var(--coral)" : "0 0 0 0.5px var(--hairline)",
            }}
            onPointerEnter={() => setHover(p.name)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="absolute inset-0 flex items-center justify-center">
              {p.id == null ? (
                <span className="inline-flex items-center justify-center rounded-sm text-ink-soft font-semibold"
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
    </div>
  );
}
