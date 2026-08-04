"use client";

import { useState } from "react";
import type { PlayerRanksSeason } from "@/lib/static-data";
import { STAT_META, fmtValue, type StatFormat } from "./where-they-rank";
import { StatInfo } from "./stat-info";
import type { Shooting } from "./player-shot-impact";
import { PercentileChip } from "@/components/percentile-chip";
import { Select } from "@/components/select";
import { StatLabel } from "@/components/explorer/sortable-th";
import {
  BASIS_OPTIONS, SPLIT_OPTIONS, type Basis, type Cell, type SplitSeason,
} from "./player-splits";

/**
 * Player Overview — the same card treatment the team dossier uses, now with
 * the same slicing.
 *
 * This was a bento wall of percentile-tinted tiles showing one view: full
 * season, per game, about twenty stats. The team panel has had eight splits and
 * a far wider list for a while, and the asymmetry was never principled — we
 * hold every player's game log back to 2014, so the same slicing was always
 * sitting there unused.
 *
 * Two controls now: a SPLIT (the team panel's eight, on the same definitions)
 * and a BASIS (per game or per 40 minutes). Percentiles move with both, so a
 * player's away numbers are ranked against every other player's away numbers
 * rather than against the full-season field.
 *
 * PER-40 APPLIES TO COUNTING STATS ONLY. A percentage is already a rate, so
 * "TS% per 40 minutes" is not a quantity; those live in the `m` block and read
 * the same under either basis. Publishing a second copy of every shooting
 * number under a meaningless label would have been the easy mistake here.
 */

type Ctx = { season: SplitSeason | null; split: string; basis: Basis };

/** A stat's home block, which decides whether the basis toggle touches it. */
type Block = "m" | "g" | "f" | "impact";

type Def = { key: string; label: string; block: Block; fmt: Fmt; info?: string };
type Fmt = "int" | "num1" | "num2" | "pct1" | "signed1";

const CARDS: Array<{ title: string; stats: Def[] }> = [
  {
    title: "Impact",
    stats: [
      { key: "epm", label: "EPM", block: "impact", fmt: "signed1",
        info: "Estimated Plus-Minus — points per 100 possessions versus an average D-I player, offence and defence combined. Fit over a whole season of play-by-play, so it does not split; this stays the full-season figure whatever slice is selected." },
      { key: "off_epm", label: "Off EPM", block: "impact", fmt: "signed1" },
      { key: "def_epm", label: "Def EPM", block: "impact", fmt: "signed1" },
      { key: "ewins", label: "eWins", block: "impact", fmt: "num2",
        info: "Estimated wins added over an average player, across the minutes he actually played. Season-level, like EPM." },
      // Usage sits with impact rather than in a card of its own: it is the
      // denominator the impact numbers are earned against, and reading EPM
      // without knowing whether he ended 15% or 30% of possessions is reading
      // half the sentence. It DOES split, unlike the four above it.
      { key: "on_off", label: "On/Off", block: "impact", fmt: "signed1",
        info: "Team net rating per 100 possessions with him on the floor minus off it, luck-adjusted. Unregularized and shown only above a possession floor, so treat it as the weakest number here: it barely repeats year to year, and on a rotation that never splits up it is really a statement about the lineup. Season-level, like EPM." },
      { key: "usage_pct", label: "Usage%", block: "m", fmt: "pct1",
        info: "Share of team possessions that end with this player's shot, turnover or trip to the line. Unlike EPM and eWins, this one does follow the selected split." },
      // ORtg and DRtg came from the retired Advanced card. They are per-100
      // efficiency, which is the same family as EPM, so they read better here
      // than under Shooting. (Game Score went with the card: it is a box-score
      // composite of numbers already listed two cards over.)
      { key: "ortg", label: "ORtg", block: "m", fmt: "num1",
        info: "Offensive rating: points produced per 100 possessions, averaged over the games in this split." },
      { key: "drtg", label: "DRtg", block: "m", fmt: "num1",
        info: "Defensive rating: points allowed per 100 possessions. Ranked so lower is better." },
    ],
  },
  {
    title: "Playing Time",
    stats: [
      { key: "gp", label: "GP", block: "m", fmt: "int" },
      { key: "gs", label: "GS", block: "m", fmt: "int" },
      { key: "mpg", label: "MPG", block: "m", fmt: "num1" },
    ],
  },
  // Labels are ABBREVIATIONS on purpose. "Def Rebounds /40" was ellipsizing to
  // "Def Rebound…", and an abbreviation a hoops reader already knows by heart
  // beats a truncated word. Rendered upper-case, with StatLabel keeping the
  // deliberate lower-case initials in eWins and eFG% from being shouted.
  {
    title: "Box Score",
    stats: [
      { key: "pts", label: "PTS", block: "g", fmt: "num1" },
      { key: "reb", label: "REB", block: "g", fmt: "num1" },
      { key: "orb", label: "Off Reb", block: "g", fmt: "num1" },
      { key: "drb", label: "Def Reb", block: "g", fmt: "num1" },
      { key: "ast", label: "AST", block: "g", fmt: "num1" },
      { key: "stl", label: "STL", block: "g", fmt: "num1" },
      { key: "blk", label: "BLK", block: "g", fmt: "num1" },
      { key: "tov", label: "TO", block: "g", fmt: "num1",
        info: "Ranked so fewer is better: a high percentile means he gives it away less than his position group." },
      { key: "pf", label: "PF", block: "g", fmt: "num1",
        info: "Ranked so fewer is better." },
    ],
  },
  {
    title: "Volume",
    stats: [
      { key: "fgm", label: "FGM", block: "g", fmt: "num1" },
      { key: "fga", label: "FGA", block: "g", fmt: "num1" },
      { key: "fgm3", label: "3PM", block: "g", fmt: "num1" },
      { key: "fga3", label: "3PA", block: "g", fmt: "num1" },
      { key: "ftm", label: "FTM", block: "g", fmt: "num1" },
      { key: "fta", label: "FTA", block: "g", fmt: "num1" },
    ],
  },
  {
    title: "Shooting",
    stats: [
      { key: "fg_pct", label: "FG%", block: "m", fmt: "pct1" },
      { key: "fg3_pct", label: "3P%", block: "m", fmt: "pct1" },
      { key: "ft_pct", label: "FT%", block: "m", fmt: "pct1" },
      { key: "efg_pct", label: "eFG%", block: "m", fmt: "pct1",
        info: "Effective Field Goal % — adjusts FG% so a 3-pointer counts 1.5× a 2-pointer." },
      { key: "ts_pct", label: "TS%", block: "m", fmt: "pct1",
        info: "True Shooting % — points per scoring attempt, weighting 2s, 3s and free throws together." },
    ],
  },
];

function fmt(v: number | null, f: Fmt): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (f) {
    case "int": return String(Math.round(v));
    case "pct1": return v.toFixed(1) + "%";
    case "num2": return v.toFixed(2);
    case "signed1": return (v >= 0 ? "+" : "") + v.toFixed(1);
    default: return v.toFixed(1);
  }
}

/** Where a stat's [value, percentile] lives for the current split and basis. */
function read(ctx: Ctx, d: Def): Cell | null {
  if (!ctx.season) return null;
  if (d.block === "impact") return ctx.season.impact?.[d.key] ?? null;
  const blk = ctx.season.splits[ctx.split];
  if (!blk) return null;
  // Counting stats follow the basis toggle; meta and rates never do.
  const src = d.block === "m" ? blk.m : ctx.basis === "f" ? blk.f : blk.g;
  return src?.[d.key] ?? null;
}

export function PlayerStatsGrid({
  season,
  shooting,
  splitSeason,
}: {
  season: PlayerRanksSeason;
  /** Zone splits for the same year, when we have them. Drives Shot Diet. */
  shooting?: Shooting | null;
  /** Split payload for the selected year; null falls back to the rank stats. */
  splitSeason?: SplitSeason | null;
}) {
  const [split, setSplit] = useState("full");
  const [basis, setBasis] = useState<Basis>("g");

  // 2021 has no game logs, and neither does anyone below the cohort floor, so
  // the panel has to work without splits rather than render empty cards.
  if (!splitSeason) {
    return <LegacyGrid season={season} shooting={shooting} />;
  }

  // Only offer splits this player actually has games in — a player who never
  // lost should not have a Losses option that renders dashes.
  const available = SPLIT_OPTIONS.filter((s) => (splitSeason.splits[s.key]?.n ?? 0) > 0);
  const active = splitSeason.splits[split] ? split : "full";
  const ctx: Ctx = { season: splitSeason, split: active, basis };
  const n = splitSeason.splits[active]?.n ?? 0;
  const suffix = basis === "f" ? "/40" : "/G";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <span className="text-sm text-ink-muted tabular">
          {n} game{n === 1 ? "" : "s"} in this split
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Split</span>
            <Select value={active} onChange={setSplit} ariaLabel="Stat split" compact className="w-52">
              {available.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Basis</span>
            <Select value={basis} onChange={(v) => setBasis(v as Basis)} ariaLabel="Per game or per 40 minutes" compact className="w-40">
              {BASIS_OPTIONS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </Select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 lg:gap-6">
        {CARDS.map((card) => (
          <Card key={card.title} title={card.title}>
            {card.stats.map((d) => {
              const cell = read(ctx, d);
              // The basis suffix is part of the label, not decoration: "Points"
              // means nothing without saying per what.
              const label = d.block === "g" ? d.label + " " + suffix : d.label;
              return (
                <Row
                  key={d.key}
                  label={label}
                  definition={d.info}
                  value={fmt(cell?.[0] ?? null, d.fmt)}
                  pct={cell?.[1] ?? null}
                  note={d.block === "impact" && active !== "full" ? "full season" : undefined}
                />
              );
            })}
          </Card>
        ))}
        {shooting && active === "full" && <ShotDietPanel s={shooting} />}
      </div>

      <p className="mt-3 text-[0.65rem] text-ink-muted">
        Chips are percentiles within the selected split against{" "}
        {splitSeason.cohort ? splitSeason.cohort.toLocaleString() + " " : ""}
        players at the same position — a player&rsquo;s away numbers are ranked against every other
        player&rsquo;s away numbers. Splits under four games show values without a percentile.
        EPM and eWins come from a season-long fit and do not split.
      </p>
    </div>
  );
}

/** The card shell, in one place, so the treatment changes everywhere at once. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-paper-deep/25 -mx-6 md:mx-0 rounded-none md:rounded-xl border-y border-x-0 md:border-x border-hairline shadow-sm px-5 lg:px-6 py-4">
      <h3 className="text-xs uppercase tracking-widest text-coral font-medium mb-3">{title}</h3>
      <ul className="divide-y divide-hairline/40">{children}</ul>
    </section>
  );
}

function Row({
  label, definition, value, pct, sub, note,
}: {
  label: string;
  definition?: string;
  value: string;
  pct: number | null;
  sub?: string;
  note?: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2 px-1 -mx-1 rounded transition-colors hover:bg-[var(--accent-tint)]">
      <span className="flex-1 min-w-0">
        {/* The label owns this line by itself. A "full season" badge used to sit
            beside it and, being flex-none, ate the label's width instead of its
            own: on the Away split "Off EPM" rendered as "O…". Notes ride
            underneath now, where nothing competes with them. */}
        <span className="flex items-center gap-1 text-ink-soft text-sm uppercase tracking-wide">
          <span className="truncate"><StatLabel label={label} /></span>
          {definition && <StatInfo definition={definition} />}
        </span>
        {(sub || note) && (
          <span className="block text-[0.6rem] text-ink-muted tabular truncate">
            {sub ?? note}
          </span>
        )}
      </span>
      <span className="flex-none font-medium text-ink tabular text-sm w-16 text-right">{value}</span>
      {pct !== null ? (
        <PercentileChip pct={pct} className="flex-none w-9 justify-center">{pct}</PercentileChip>
      ) : (
        <span className="flex-none w-9 text-center text-[0.65rem] text-ink-muted">—</span>
      )}
    </li>
  );
}

function ShotDietPanel({ s }: { s: Shooting }) {
  const f1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const zones = [
    { key: "Rim", pct: s.rim_pct, rate: s.rim_rate, ptile: s.rim_ptile },
    { key: "Mid", pct: s.mid_pct, rate: s.mid_rate, ptile: s.mid_ptile },
    { key: "3PT", pct: s.tp_pct, rate: s.tp_rate, ptile: s.tp_ptile },
  ].filter((z) => z.pct != null || z.rate != null);

  if (zones.length === 0 && s.asst == null) return null;
  return (
    <Card title="Shot Diet">
      {zones.map((z) => (
        <Row
          key={z.key}
          label={z.key}
          value={z.pct == null ? "—" : `${f1(z.pct)}%`}
          pct={z.ptile ?? null}
          sub={z.rate == null ? undefined : `${f1(z.rate)}% of shots`}
        />
      ))}
      {s.asst != null && (
        // No percentile on purpose. Assisted rate is a role descriptor, not a
        // graded stat — a centre at 80% assisted is ordinary and a point guard
        // at 80% is not, so ranking it inside one cohort would assert a verdict
        // the number does not carry. The sub-line says which way is which.
        <Row label="Assisted" value={`${f1(s.asst)}%`} pct={null} sub="lower = self-created" />
      )}
    </Card>
  );
}

/* ----------------------------- fallback view ------------------------------ */

const LEGACY_PANELS: Array<{ title: string; keys: string[] }> = [
  { title: "Box Score", keys: ["pts_pg", "reb_pg", "ast_pg", "stl_pg", "blk_pg", "fta_pg", "pir", "epm"] },
  { title: "Shooting", keys: ["efg_pct", "ts_pct", "fg2_pct", "fg3_pct", "tpar", "ft_pct", "ftr"] },
  { title: "Advanced", keys: ["usage", "ast_pct", "tov_pct", "orb_pct", "hkm_pct"] },
];

/**
 * What the panel shows when there is no game log to slice: 2021, which has
 * none at all, and any season before a player cleared the cohort floor. Same
 * cards, no controls — an honest single view rather than eight empty ones.
 */
function LegacyGrid({ season, shooting }: { season: PlayerRanksSeason; shooting?: Shooting | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 lg:gap-6">
      {LEGACY_PANELS.map((p) => {
        const rows = p.keys
          .map((k) => {
            const cell = season.stats[k];
            const meta = STAT_META[k];
            if (!cell || !meta) return null;
            return { key: k, label: meta.label, format: meta.format as StatFormat, value: cell.value, percentile: cell.percentile };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        return (
          <Card key={p.title} title={p.title}>
            {rows.length === 0
              ? <li className="py-2 text-sm text-ink-muted">No data.</li>
              : rows.map((r) => (
                <Row key={r.key} label={r.label} value={fmtValue(r.value, r.format)} pct={r.percentile} />
              ))}
          </Card>
        );
      })}
      {shooting && <ShotDietPanel s={shooting} />}
    </div>
  );
}

/**
 * Mini circular percentile gauge — track ring + coloured arc filling clockwise.
 *
 * The chip replaced it on this page, but player-shot-impact.tsx still renders
 * it, so it stays exported here rather than moving and breaking that import.
 */
export function PercentileGauge({ pct }: { pct: number }) {
  const size = 30;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fill = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - fill / 100);
  return (
    <span className="stat-tile-color relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-ink/10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[0.55rem] font-bold tabular tabular-nums"
        aria-label={`${pct}th percentile`}
      >
        {pct}
      </span>
    </span>
  );
}
