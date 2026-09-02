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

type Def = {
  key: string;
  label: string;
  block: Block;
  fmt: Fmt;
  info?: string;
  /**
   * Computed from other cells rather than read from one.
   *
   * NO PERCENTILE, DELIBERATELY. The chip means "this many percent of players
   * at this position did worse in this split", and that requires the cohort's
   * distribution for the stat — which is published for the stats we store and
   * not for arithmetic done in the browser. A derived row shows its number and
   * no chip, which is honest; inventing a percentile from the stats we happen
   * to hold would be a different and much worse claim.
   */
  derive?: (ctx: Ctx) => number | null;
};

/** Views a card belongs to. `everything` is implicit — every card is in it. */
type View = "overview" | "scoring" | "creation" | "defense";
type Fmt = "int" | "num1" | "num2" | "pct1" | "signed1";

/**
 * The views, in the order they are offered.
 *
 * GROUPED BY THE QUESTION, NOT BY THE DATA SOURCE. "Advanced" and "Box Score"
 * describe where a number came from, which is the site's problem and not the
 * reader's; someone opening a player page wants to know whether he can score,
 * whether he creates, or what he does when the other team has the ball. Each
 * view is one of those questions and carries every card that helps answer it,
 * including cards that appear in more than one — Role is context for all three,
 * and repeating it beats making someone switch views to find out he played 22
 * minutes a night.
 *
 * OVERVIEW IS UNCHANGED AND STAYS THE DEFAULT. It is the view that was here
 * before, and anyone who never touches this control sees exactly the page they
 * saw yesterday.
 *
 * `everything` has no card list because it is not a selection — it is the
 * absence of one, and filtering for it would mean maintaining a list that has
 * to be updated every time a card is added.
 */
const VIEW_OPTIONS: Array<{ key: View | "everything"; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "scoring", label: "Scoring & shooting" },
  { key: "creation", label: "Creation & handling" },
  { key: "defense", label: "Defense & rebounding" },
  { key: "everything", label: "Everything" },
];

const CARDS: Array<{ title: string; views: View[]; stats: Def[] }> = [
  {
    title: "Impact",
    views: ["overview"],
    stats: [
      { key: "epm", label: "EPM", block: "impact", fmt: "signed1",
        info: "Estimated Plus-Minus — points per 100 possessions versus an average D-I player, offense and defense combined. Fit over a whole season of play-by-play, so it does not split; this stays the full-season figure whatever slice is selected." },
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
      // Sits beside ORtg on purpose — the contrast is the point. ORtg credits
      // the possessions a player HELPED (assists, offensive boards); PPP counts
      // only what he scored on possessions he ended himself. Across 1,891
      // players at 20+ mpg the two correlate 0.879 and differ by a mean of
      // 0.124, so neither stands in for the other.
      { key: "ppp", label: "PPP", block: "m", fmt: "num2",
        info: "Points Per Possession — points scored per possession the player USED: PTS / (FGA + 0.44·FTA + TOV). Same numerator as TS%, but turnovers are in the denominator, so a possession ended with a giveaway still counts as one spent." },
    ],
  },
  // Playing Time (GP / GS / MPG) used to sit here. It now lives in the career
  // table, where it reads per season next to the rest of the line rather than
  // as three rows of a card. The split payload still carries all three.
  //
  // Labels are ABBREVIATIONS on purpose. "Def Rebounds /40" was ellipsizing to
  // "Def Rebound…", and an abbreviation a hoops reader already knows by heart
  // beats a truncated word. Rendered upper-case, with StatLabel keeping the
  // deliberate lower-case initials in eWins and eFG% from being shouted.
  {
    title: "Box Score",
    views: ["overview"],
    stats: [
      { key: "pts", label: "PTS", block: "g", fmt: "num1" },
      { key: "reb", label: "REB", block: "g", fmt: "num1" },
      { key: "orb", label: "Off Reb", block: "g", fmt: "num1" },
      { key: "ast", label: "AST", block: "g", fmt: "num1" },
      { key: "stl", label: "STL", block: "g", fmt: "num1" },
      { key: "blk", label: "BLK", block: "g", fmt: "num1" },
      // Sits under STL and BLK because it is the two of them added together.
      // Season-level, like EPM: both halves are rates against OPPONENT volume
      // (blocks per opponent 2PA, steals per opponent possession) and the game
      // logs carry neither, so it cannot honestly be split home/away.
      { key: "hkm_pct", label: "HKM%", block: "impact", fmt: "pct1",
        info: "Hakeem % — BLK% + STL% added together, named after Hakeem Olajuwon. A single number for how often a player ends an opponent possession with his hands. Season-level, so it does not follow the selected split." },
      // No tooltips on these two. "Ranked so fewer is better" is the same
      // sentence twice, and the footnote under the grid already says it for
      // every stat that inverts.
      { key: "tov", label: "TO", block: "g", fmt: "num1" },
      { key: "pf", label: "PF", block: "g", fmt: "num1" },
    ],
  },
  {
    title: "Volume",
    views: ["overview"],
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
    views: ["overview"],
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

  /* ------------------------------- Scoring -------------------------------
   *
   * The question is "how does he get his points", which Overview answers only
   * in aggregate. The two-point figures are DERIVED: the archive stores total
   * and three-point shooting, and the inside game is the difference between
   * them — the number that actually separates two players with the same FG%.
   */
  {
    title: "Scoring",
    views: ["scoring"],
    stats: [
      { key: "pts", label: "PTS", block: "g", fmt: "num1" },
      { key: "fg2m", label: "2PM", block: "g", fmt: "num1",
        derive: (c) => sub(cellOf(c, "g", "fgm"), cellOf(c, "g", "fgm3")) },
      { key: "fg2a", label: "2PA", block: "g", fmt: "num1",
        derive: (c) => sub(cellOf(c, "g", "fga"), cellOf(c, "g", "fga3")) },
      { key: "fgm3", label: "3PM", block: "g", fmt: "num1" },
      { key: "fga3", label: "3PA", block: "g", fmt: "num1" },
      { key: "ftm", label: "FTM", block: "g", fmt: "num1" },
      { key: "fta", label: "FTA", block: "g", fmt: "num1" },
    ],
  },
  {
    title: "Efficiency",
    views: ["scoring"],
    stats: [
      { key: "fg_pct", label: "FG%", block: "m", fmt: "pct1" },
      { key: "fg2_pct", label: "2P%", block: "m", fmt: "pct1",
        info: "Two-point percentage, derived from total makes and attempts less the three-point ones. It is where a rim or mid-range game shows up, which FG% blends away.",
        derive: (c) => pctOf(sub(cellOf(c, "g", "fgm"), cellOf(c, "g", "fgm3")), sub(cellOf(c, "g", "fga"), cellOf(c, "g", "fga3"))) },
      { key: "fg3_pct", label: "3P%", block: "m", fmt: "pct1" },
      { key: "ft_pct", label: "FT%", block: "m", fmt: "pct1" },
      { key: "efg_pct", label: "eFG%", block: "m", fmt: "pct1" },
      { key: "ts_pct", label: "TS%", block: "m", fmt: "pct1" },
      { key: "ppp", label: "PPP", block: "m", fmt: "num2" },
    ],
  },
  {
    title: "Shot Mix",
    views: ["scoring"],
    stats: [
      { key: "tpar", label: "3PA rate", block: "m", fmt: "pct1",
        info: "Share of shots taken from three. High is a spacer, low an interior scorer — neither is better, and it is the fastest read of what kind of scorer someone is.",
        derive: (c) => pctOf(cellOf(c, "g", "fga3"), cellOf(c, "g", "fga")) },
      { key: "ftr", label: "FT rate", block: "m", fmt: "pct1",
        info: "Free throws attempted per field-goal attempt. The clearest measure of how often a player gets to the line rather than settling.",
        derive: (c) => pctOf(cellOf(c, "g", "fta"), cellOf(c, "g", "fga")) },
      { key: "pps", label: "Pts / shot", block: "m", fmt: "num2",
        info: "Points per field-goal attempt, free throws included. A blunter cousin of true shooting that reads in the units the scoreboard uses.",
        derive: (c) => ratio(cellOf(c, "g", "pts"), cellOf(c, "g", "fga")) },
    ],
  },

  /* ------------------------------ Creation -------------------------------
   *
   * Passing and ball security are one question read as two cards: an assist
   * total means something different at two turnovers than at five.
   */
  {
    title: "Creation",
    views: ["creation"],
    stats: [
      { key: "ast", label: "AST", block: "g", fmt: "num1" },
      { key: "usage_pct", label: "Usage%", block: "m", fmt: "pct1" },
      { key: "ortg", label: "ORtg", block: "m", fmt: "num1" },
      { key: "ppp", label: "PPP", block: "m", fmt: "num2" },
      { key: "off_epm", label: "Off EPM", block: "impact", fmt: "signed1" },
    ],
  },
  {
    title: "Ball Security",
    views: ["creation"],
    stats: [
      { key: "tov", label: "TO", block: "g", fmt: "num1" },
      { key: "ast_to", label: "AST / TO", block: "m", fmt: "num2",
        info: "Assists per turnover. Reads the same under either basis, because both halves scale with minutes together.",
        derive: (c) => ratio(cellOf(c, "g", "ast"), cellOf(c, "g", "tov")) },
      { key: "pf", label: "PF", block: "g", fmt: "num1" },
    ],
  },

  /* -------------------------- Defense and the glass ----------------------
   *
   * The half of the game Overview compresses into three rows. Defensive
   * rebounds are in the archive and were shown nowhere — REB and ORB were,
   * which left the reader to do the subtraction.
   */
  {
    title: "Rebounding",
    views: ["defense"],
    stats: [
      { key: "reb", label: "REB", block: "g", fmt: "num1" },
      { key: "orb", label: "Off Reb", block: "g", fmt: "num1" },
      { key: "drb", label: "Def Reb", block: "g", fmt: "num1" },
      { key: "orb_share", label: "Off Reb share", block: "m", fmt: "pct1",
        info: "What share of a player's own rebounds come at the offensive end. High marks a crasher; low marks someone who secures the defensive glass and goes.",
        derive: (c) => pctOf(cellOf(c, "g", "orb"), cellOf(c, "g", "reb")) },
    ],
  },
  {
    title: "Defense",
    views: ["defense"],
    stats: [
      { key: "stl", label: "STL", block: "g", fmt: "num1" },
      { key: "blk", label: "BLK", block: "g", fmt: "num1" },
      { key: "def_epm", label: "Def EPM", block: "impact", fmt: "signed1" },
      { key: "drtg", label: "DRtg", block: "m", fmt: "num1" },
      { key: "pf", label: "PF", block: "g", fmt: "num1" },
    ],
  },

  /* -------------------------------- Role ---------------------------------
   *
   * Games, starts and minutes were in the archive and shown nowhere. They are
   * the context every other number here is read against: 15 points is a
   * different player at 22 minutes than at 36. Carried by all three of the
   * non-Overview views for that reason.
   */
  {
    title: "Role",
    views: ["scoring", "creation", "defense"],
    stats: [
      { key: "gp", label: "Games", block: "m", fmt: "int" },
      { key: "gs", label: "Starts", block: "m", fmt: "int" },
      { key: "mpg", label: "Minutes /G", block: "m", fmt: "num1" },
      { key: "usage_pct", label: "Usage%", block: "m", fmt: "pct1" },
      { key: "game_score", label: "Game Score", block: "m", fmt: "num1",
        info: "Hollinger's one-number summary of a box-score line, averaged. Roughly: 10 is a solid starter's night, 20 a very good one." },
    ],
  },
];

/* --------------------------- derive helpers ------------------------------
 *
 * Each reads a raw cell for the CURRENT split and basis, so a derived stat
 * respects both controls without knowing they exist. They return null rather
 * than NaN or Infinity on a missing or zero denominator, which is what makes
 * fmt() print an em-dash instead of a number nobody can defend.
 */
function cellOf(ctx: Ctx, block: "g" | "m", key: string): number | null {
  if (!ctx.season) return null;
  const blk = ctx.season.splits[ctx.split];
  if (!blk) return null;
  const src = block === "m" ? blk.m : ctx.basis === "f" ? blk.f : blk.g;
  return src?.[key]?.[0] ?? null;
}
const sub = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a - b;
const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;
const pctOf = (a: number | null, b: number | null): number | null => {
  const r = ratio(a, b);
  return r === null ? null : r * 100;
};

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
  if (d.derive) {
    const v = d.derive(ctx);
    return v === null ? null : [v, null];
  }
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
  const [view, setView] = useState<View | "everything">("overview");

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
        {/* Desktop only. On a phone this row wraps, so the count took a whole
            line of its own above the two pickers — and the same figure is in
            the GP column of the career table directly above this card. */}
        <span className="hidden sm:inline text-sm text-ink-muted">
          {n} game{n === 1 ? "" : "s"} in this split
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {/* FIRST OF THE THREE, because the row then reads in the order the
              questions are asked: which stats, then which games, then in what
              units. Putting it after Split would have meant choosing a slice
              of a panel you had not chosen yet. */}
          <label className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">View</span>
            <Select
              value={view}
              onChange={(v) => setView(v as View | "everything")}
              ariaLabel="Which stats to show"
              compact
              className="w-52"
            >
              {VIEW_OPTIONS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </Select>
          </label>
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
        {CARDS.filter((c) => view === "everything" || c.views.includes(view)).map((card) => (
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
        {/* Shot Diet is zone data rather than a card, so it is filtered here
            rather than by the list above. It answers a scoring question, so it
            rides with Overview and Scoring and sits out the other two. Still
            full-season only: the zones are not split. */}
        {shooting && active === "full"
          && (view === "overview" || view === "scoring" || view === "everything")
          && <ShotDietPanel s={shooting} />}
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
