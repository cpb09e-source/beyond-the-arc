import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { TopHundredSeal } from "@/components/players/top-hundred-seal";
import type { StatLine } from "@/lib/player-stat-line";
import { NbaTeamLogo } from "@/components/nba-team-logo";
import { PercentileChip, pctBg, pctColor } from "@/components/percentile-chip";
import { GameBars } from "@/components/players/game-bars";
import { opponentOf } from "@/lib/game-log";
import type { PlayerGameRow, PlayerRanksSeason } from "@/lib/static-data";
import { cn } from "@/lib/utils";
import { formatHeight } from "@/lib/height";

/**
 * Player hero — "Atlas".
 *
 * Small multiples instead of a stat line. Six modules, each carrying one
 * headline number and one picture of it: scoring and playmaking as the season's
 * game-by-game columns, efficiency as a curve against the season average, the
 * rate stats as bars on the site percentile ramp, and impact split into its
 * offensive and defensive halves.
 *
 * The reason for the change: a row of figures can say a player averaged 19.5,
 * but not that he averaged 5.7 the year before, or that he cleared 25 in six
 * games and was held under 12 in five. Both of those are already in the data we
 * ship; they were just never drawn. Every delta chip and every chart here comes
 * from files the page already had open.
 *
 * Degrades in one direction only. No game log (a pre-2024 season, or a roster
 * addition who has not played) drops the three charts and leaves the numbers
 * and their percentiles; a single-season player loses the delta chips; an
 * unranked season loses the percentile chips and the rings. The grid keeps its
 * six modules in every case, because which ones survive varies by player and a
 * reflowing hero reads as broken rather than as adaptive.
 */

export type AtlasLine = {
  g: number;
  min: number;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg: number | null;
  fg3: number | null;
  ft: number | null;
  efg: number | null;
  ts: number | null;
  epm: number | null;
  onOff: number | null;
};

function fmt(x: number | null, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
function fmtSigned(x: number | null, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Season-over-season change, as a chip.
 *
 * Rendered only when a prior season exists AND both values are present — a
 * chip reading "+19.5" against a missing baseline would claim a jump that is
 * really a gap in the record. `pctPoints` switches the unit: a shooting rate
 * moves in percentage POINTS, and printing "+0.069" for a seven-point jump in
 * true shooting is unreadable.
 */
function Delta({
  now,
  was,
  pctPoints = false,
  digits = 1,
}: {
  now: number | null;
  was: number | null | undefined;
  pctPoints?: boolean;
  digits?: number;
}) {
  if (now === null || was === null || was === undefined) return null;
  if (!Number.isFinite(now) || !Number.isFinite(was)) return null;
  const raw = pctPoints ? (now - was) * 100 : now - was;
  if (Math.abs(raw) < (pctPoints ? 0.05 : 0.05)) return null;
  const up = raw > 0;
  const tone = up ? "var(--good)" : "var(--bad)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full pl-1 pr-1.5 py-0.5 tabular text-[0.625rem] font-semibold whitespace-nowrap leading-none"
      style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
      title="Change from the previous season"
    >
      {/* A stroked arrow rather than the ▲/▼ glyphs: those are filled triangles
          at whatever weight the system font happens to draw them, which sat
          heavier than the figure beside them and differed per platform. */}
      <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
        <path
          d={up ? "M5 8.5V2M5 2L2 5M5 2l3 3" : "M5 1.5V8M5 8l-3-3M5 8l3-3"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {Math.abs(raw).toFixed(digits)}
    </span>
  );
}

/** Module shell — eyebrow, optional right-hand note, body. */
function Module({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-hairline rounded-lg bg-paper-deep/45 px-4 py-3.5 flex flex-col gap-3 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label" style={{ color: "var(--court-ink)" }}>
          {title}
        </span>
        {note && (
          <span className="tabular text-[0.625rem] text-ink-muted truncate min-w-0">{note}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Headline figure for a module: value, unit, season delta, percentile chip. */
function BigStat({
  value,
  unit,
  delta,
  pct,
  accent = false,
}: {
  value: string;
  unit: string;
  delta?: React.ReactNode;
  pct?: number | null;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span
        className={cn(
          "font-display tabular text-[1.75rem] sm:text-[2rem] leading-none",
          accent ? "text-coral" : "text-ink",
        )}
      >
        {value}
      </span>
      <span className="text-[0.6875rem] text-ink-muted">{unit}</span>
      {delta}
      {pct != null && <PercentileChip pct={pct} className="ml-auto shrink-0" />}
    </div>
  );
}

/**
 * One rate on the percentile ramp.
 *
 * `fill` is the bar's own length (a shooting percentage fills by its value, so
 * 85% FT reads as a long bar) while the COLOR comes from the percentile, which
 * is the part that says whether the number is any good. Rows with no percentile
 * — a stat the cohort file doesn't rank — keep the bar in hairline and show a
 * dash, rather than borrowing a colour they haven't earned.
 */
function RateRow({
  label,
  value,
  fill,
  pct,
}: {
  label: string;
  value: string;
  fill: number | null;
  pct: number | null;
}) {
  const width = fill === null ? 0 : Math.max(0, Math.min(100, fill * 100));
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="text-[0.6875rem] font-semibold text-ink-muted w-11 shrink-0">{label}</span>
      <span className="tabular text-[0.8125rem] text-ink w-12 text-right shrink-0">{value}</span>
      <span className="flex-1 h-2 bg-paper-deep rounded-[2px] overflow-hidden min-w-0">
        <span
          className="block h-full rounded-[2px]"
          style={{
            width: `${width}%`,
            // An unranked row still draws its bar — FG% has no cohort file of
            // its own — but in neutral ink rather than a ramp colour it hasn't
            // earned. Hairline was invisible against the module ground and read
            // as a missing value rather than a missing rank.
            background: pct === null ? "color-mix(in oklab, var(--ink-muted) 30%, transparent)" : pctBg(pct),
            // The ramp's middle bands are near-paper ON PURPOSE — as a chip
            // background with dark text on top, "average" is supposed to recede.
            // With nothing written on it, a 70th-percentile bar was a pale
            // yellow-green shape on a pale ground and a 50th was invisible. A
            // hairline in the band's own text colour gives every band an edge
            // without touching the fill the chips use.
            boxShadow:
              pct === null
                ? undefined
                : `inset 0 0 0 1px color-mix(in oklab, ${pctColor(pct)} 42%, transparent)`,
          }}
        />
      </span>
      {/* The figure takes the band's text colour too — it is the one part of
          the row that reads at any band, so it carries the ranking when the
          fill is too pale to. */}
      <span
        className="tabular text-[0.6875rem] w-5 text-right shrink-0 font-semibold"
        style={{ color: pct === null ? "var(--ink-muted)" : pctColor(pct) }}
      >
        {pct === null ? "—" : pct}
      </span>
    </div>
  );
}

/** A split of EPM (or on/off) drawn against the total, so the halves compare. */
function ImpactBar({ label, value, scale, tone }: { label: string; value: number | null; scale: number; tone: string }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, (Math.abs(value) / scale) * 100));
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="text-[0.6875rem] text-ink-muted w-14 shrink-0">{label}</span>
      <span className="flex-1 h-2.5 bg-paper-deep rounded-[2px] overflow-hidden min-w-0">
        <span className="block h-full rounded-[2px]" style={{ width: `${width}%`, background: tone }} />
      </span>
      <span className="tabular text-[0.6875rem] text-ink w-10 text-right shrink-0">
        {fmtSigned(value, 2)}
      </span>
    </div>
  );
}

/** The cohort a player is ranked in, spelled out. Bart's own role notes
 *  ("Stretch 4", "Wing G") are finer but they are his vocabulary, not the
 *  site's, and the percentiles beside them are cohorted by these three. */
const POSITION_LABEL: Record<"G" | "F" | "C", string> = {
  G: "Guard",
  F: "Forward",
  C: "Center",
};

/**
 * Position and class, as badges rather than two more entries in the vitals run.
 *
 * Both answer "what kind of player is this" before any number does, and in a
 * dot-separated run they read as the same weight as a hometown. A badge is also
 * how the rest of the site already marks a category — the tournament seed chip,
 * the transfer chip, the draft chip beside these very vitals.
 *
 * POSITION IS HUED BY BUCKET, not by the accent. Three positions want three
 * colours, and there are exactly three tokens on the site that carry meaning
 * without being the accent: the hardwood, the chart green and the chart red.
 * Guard takes the accent because guards are the largest bucket and the accent
 * is the most neutral of the four in this palette.
 *
 * CLASS REUSES THE PLAYERS EXPLORER'S FOUR, by token. A reader who has just
 * filtered the explorer by class should meet the same amber on the junior they
 * clicked through to.
 */
const POSITION_BADGE: Record<"G" | "F" | "C", { bg: string; border: string; fg: string }> = {
  // The text mixes its hue 66% toward --ink, which is navy on the light theme
  // and cream on the dark one — so one expression darkens or lightens as the
  // theme needs. The raw tokens are chart and accent colours and do not clear
  // AA as small text on their own tints: --coral measured 3.95 and --good 3.73
  // on paper. Mixed, they clear 5.6-6.7 on both grounds.
  //
  // Centre is the exception: --court is a light tan and mixing it toward navy
  // still does not darken enough (3.4). --court-ink exists for exactly this —
  // hardwood dark enough to set text on a hardwood tint — and clears 4.6.
  G: {
    bg: "color-mix(in oklab, var(--color-coral) 16%, transparent)",
    border: "color-mix(in oklab, var(--color-coral) 40%, transparent)",
    fg: "color-mix(in oklab, var(--color-coral) 66%, var(--ink))",
  },
  F: {
    bg: "color-mix(in oklab, var(--good) 16%, transparent)",
    border: "color-mix(in oklab, var(--good) 42%, transparent)",
    fg: "color-mix(in oklab, var(--good) 66%, var(--ink))",
  },
  C: {
    bg: "color-mix(in oklab, var(--court) 16%, transparent)",
    border: "color-mix(in oklab, var(--court) 50%, transparent)",
    fg: "var(--court-ink)",
  },
};

const CLASS_LABEL: Record<string, string> = {
  Fr: "Freshman",
  So: "Sophomore",
  Jr: "Junior",
  Sr: "Senior",
};

/**
 * The same four the players explorer uses, by token, so a junior is the same
 * amber on both surfaces. Defined in globals.css with a dark set — see the note
 * beside CLASS_BADGE in players-client.
 */
const CLASS_BADGE: Record<string, { bg: string; fg: string }> = {
  Fr: { bg: "var(--cls-fr-bg)", fg: "var(--cls-fr-fg)" },
  So: { bg: "var(--cls-so-bg)", fg: "var(--cls-so-fg)" },
  Jr: { bg: "var(--cls-jr-bg)", fg: "var(--cls-jr-fg)" },
  Sr: { bg: "var(--cls-sr-bg)", fg: "var(--cls-sr-fg)" },
};

function Badge({
  children, bg, border, fg, title,
}: {
  children: React.ReactNode;
  bg: string; border: string; fg: string; title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: bg, borderColor: border, color: fg }}
    >
      {children}
    </span>
  );
}

type DraftChip = { team: string; logo: string | null; round: number; pick: number };

/** The vitals run, rendered once and placed twice — under the name on desktop,
 *  full width under the photo on a phone. */
/**
 * The stat band — six figures for the season on screen, with the career line
 * for each sitting under it.
 *
 * The masthead used to say who a player was and the modules below said how he
 * played, and the two never met: there was no line anywhere on the page that
 * read "39 games, 13.3, 3.4, 4.4". The career was further off still, down in
 * the season table past six modules and a shot chart, so learning that Bradley
 * is a fourth-year player averaging 9.7 across 149 games took a scroll.
 *
 * THE CAREER IS A SUBORDINATE, NOT A PEER. It sets at 13px against the season's
 * 32px and takes muted ink, which ranks the two without either needing a word
 * of explanation. That is the whole argument for this layout over a two-row
 * table: a table gives both rows the same column and invites the comparison,
 * which is right when the career is the subject and wrong when it is context.
 *
 * A one-season player gets no second line at all. His career and his season are
 * the same six numbers, and printing them twice reads as a bug.
 */
function StatBand({ now, career, seasons }: { now: StatLine; career: StatLine; seasons: number }) {
  const showCareer = seasons > 1;
  const cells: Array<{ unit: string; now: string; career: string }> = [
    { unit: "Games", now: int(now.games), career: int(career.games) },
    { unit: "PPG", now: one(now.ppg), career: one(career.ppg) },
    { unit: "RPG", now: one(now.rpg), career: one(career.rpg) },
    { unit: "APG", now: one(now.apg), career: one(career.apg) },
    { unit: "FG%", now: one(now.fgPct), career: one(career.fgPct) },
    { unit: "3P%", now: one(now.fg3Pct), career: one(career.fg3Pct) },
  ];

  return (
    <div
      // Rules only at lg, where all six sit on one line. Below that the band
      // wraps to three columns and then two, and a left border on a cell that
      // has become the first of its row draws a rule down the middle of the
      // block. Gaps carry the separation there instead.
      className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 lg:gap-0"
    >
      {cells.map((c) => (
        <div
          key={c.unit}
          className="lg:border-l lg:border-ink/10 lg:first:border-l-0 lg:px-[1.125rem] lg:first:pl-0"
        >
          <div className="label">{c.unit}</div>
          <div className="tabular text-ink leading-[1.1] mt-1 text-[1.75rem] sm:text-[2rem] font-medium tracking-[-0.035em]">
            {c.now}
          </div>
          {showCareer && (
            <div className="tabular text-ink-muted text-[0.8125rem] mt-1.5">
              {c.career}
              <span className="label ml-1.5 align-baseline">Career</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function int(x: number | null): string {
  return x === null || x === undefined ? "—" : Math.round(x).toLocaleString("en-US");
}
function one(x: number | null): string {
  return x === null || x === undefined
    ? "—"
    : x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function Vitals({
  vitals, draft, bucket, playerClass,
}: {
  vitals: string[];
  draft: DraftChip | null;
  bucket: "G" | "F" | "C";
  /** Fr | So | Jr | Sr, from the most recent season. Null before 2014. */
  playerClass: string | null;
}) {
  const pos = POSITION_BADGE[bucket];
  const cls = playerClass && CLASS_LABEL[playerClass] ? playerClass : null;
  return (
    <>
      <Badge bg={pos.bg} border={pos.border} fg={pos.fg} title={POSITION_LABEL[bucket]}>
        {POSITION_LABEL[bucket]}
      </Badge>
      {cls && (
        <Badge
          title={`${CLASS_LABEL[cls]} — most recent season`}
          bg={CLASS_BADGE[cls]!.bg}
          border="transparent"
          fg={CLASS_BADGE[cls]!.fg}
        >
          {CLASS_LABEL[cls]}
        </Badge>
      )}
      {vitals.map((v, i) => (
        <span key={v} className="flex items-center gap-2">
          {i > 0 && <span className="text-ink-muted/60">·</span>}
          {v}
        </span>
      ))}
      {draft && (
        <span className="inline-flex items-center gap-2 rounded-md bg-court/15 border border-court/40 px-2 py-0.5">
          <span className="label" style={{ color: "var(--court-ink)" }}>
            Drafted
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink font-medium whitespace-nowrap">
            <NbaTeamLogo src={draft.logo} name={draft.team} size={18} />
            {draft.team}
          </span>
          <span className="tabular text-[0.6875rem] text-ink-muted whitespace-nowrap">
            Round {draft.round} · Pick {draft.pick}
          </span>
        </span>
      )}
    </>
  );
}

export function PlayerAtlas({
  bartId,
  name,
  year,
  teamName,
  conference,
  height,
  weight,
  hometown,
  highSchool,
  rsci,
  playerClass,
  statNow,
  statCareer,
  seasonCount,
  draft,
  heroRanks,
  bucket,
  current,
  prev,
  games,
  impact,
  banner,
}: {
  bartId: number;
  name: string;
  year: number;
  teamName: string;
  conference: string | null;
  height: string | null;
  /**
   * Weight and high school are not in any dataset the site ships — not Bart's
   * 67-column row, not players-index, not official-rosters (names and slugs
   * only). They are declared here because the athletics roster pages that
   * `patch-preview-additions.mjs` already parses carry both, so wiring them is
   * a scrape away rather than a redesign. Null until that lands; the line just
   * omits them.
   */
  weight: string | null;
  hometown: string | null;
  highSchool: string | null;
  /** RSCI consensus recruiting rank, 1-100. The one recruiting ranking the site
   *  is cleared to print, and only worth stating when it is a top-100 one. */
  rsci: number | null;
  /** Fr | So | Jr | Sr for the season on screen. Null where the source has none. */
  playerClass: string | null;
  /** The six-figure line for the season on screen, and for every season. */
  statNow: StatLine;
  statCareer: StatLine;
  /** How many seasons the career line covers. One means it says nothing new. */
  seasonCount: number;
  /** Rendered as a chip beside the vitals — being drafted is a permanent fact
   *  about the player, so it belongs with the identity rather than in a banner
   *  that reads as news. */
  draft: DraftChip | null;
  heroRanks: PlayerRanksSeason | null;
  /** Position cohort the season was ranked in. Decides which counting stat
   *  leads the second module. */
  bucket: "G" | "F" | "C";
  current: AtlasLine;
  prev: AtlasLine | null;
  games: PlayerGameRow[];
  impact: { off: number | null; def: number | null; onOff: number | null } | null;
  banner?: React.ReactNode;
}) {
  const pct = (k: string) => heroRanks?.stats?.[k]?.percentile ?? null;
  const val = (k: string) => heroRanks?.stats?.[k]?.value ?? null;

  const pts = games.map((g) => g.pts_scored ?? 0);
  // Null preserved rather than zeroed: ~12% of logged games have no true
  // shooting because the player attempted no shot, which is a different
  // statement from shooting 0%.
  const ts = games.map((g) => (g.ts_pct === null || g.ts_pct === undefined ? null : g.ts_pct * 100));
  const hasLog = games.length >= 2;

  /**
   * The second module follows the position bucket. A guard's signature counting
   * stat is assists and a big's is rebounds, and drawing the same one for both
   * wasted the slot on whoever it didn't fit — a centre's 0.9 assists per game
   * is 36 one-unit stubs. The stat this module takes is swapped OUT of the
   * defensive module below, so nothing is shown twice and nothing is dropped.
   */
  const big = bucket === "F" || bucket === "C";
  const second = big
    ? {
        title: "Rebounding",
        unit: "REB",
        rankKey: "reb_pg",
        value: current.reb,
        prev: prev?.reb,
        series: games.map((g) => g.reb ?? 0),
        fallbackKey: "drb_pct",
        fallbackLabel: "DRB%",
      }
    : {
        title: "Playmaking",
        unit: "AST",
        rankKey: "ast_pg",
        value: current.ast,
        prev: prev?.ast,
        series: games.map((g) => g.ast ?? 0),
        fallbackKey: "ast_pct",
        fallbackLabel: "AST%",
      };

  /** "high 35 vs Indiana St." — the question a per-game average cannot answer. */
  function highNote(series: number[]): string | null {
    if (!series.length) return hasLog ? `${games.length} games` : null;
    const i = series.indexOf(Math.max(...series));
    const g = games[i];
    return g?.opp_team_market ? `high ${series[i]} ${opponentOf(g)}` : `${games.length} games`;
  }
  const bestNote = highNote(pts);
  const secondNote = second.series.length ? highNote(second.series) : null;
  // The efficiency chart's high is a rate, so it wants the decimal the counting
  // charts don't. Stated as a count of nights instead — "how often was he better
  // than himself" is the reading the colours give.
  const tsAbove = current.ts === null ? null : ts.filter((v) => v !== null && v >= current.ts! * 100).length;
  const tsNote =
    tsAbove === null ? "true shooting" : `${tsAbove} of ${ts.filter((v) => v !== null).length} above`;

  // Only the fields we actually hold. An empty vitals line renders as a single
  // em dash rather than a row of orphaned separators.
  // Position is a badge now and no longer belongs in the dotted run.
  const vitals = [
    formatHeight(height),
    weight,
    hometown,
    highSchool,
    rsci !== null ? `RSCI #${rsci}` : null,
  ].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (vitals.length === 0) vitals.push("—");


  const hasSplit =
    (impact?.off ?? null) !== null || (impact?.def ?? null) !== null || current.onOff !== null;

  /**
   * The two halves share one scale so they are comparable to each other and to
   * the EPM they sum to. On/off is deliberately NOT on it: it is a raw point
   * differential per 100 possessions, so a +10.8 on/off against a +2.8 EPM
   * pinned the bar at full width and squashed the halves it was meant to sit
   * beside. It reads as a figure below the bars instead.
   */
  const impactScale = Math.max(
    1,
    Math.abs(current.epm ?? 0),
    Math.abs(impact?.off ?? 0),
    Math.abs(impact?.def ?? 0),
  );

  return (
    <section className="mx-auto max-w-[88rem] px-0 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-5 sm:pb-6">
      <div className="bg-[color-mix(in_oklab,var(--card)_55%,var(--paper-deep))] border-y sm:border border-ink/10 sm:rounded-xl shadow-md overflow-hidden ring-0 sm:ring-1 ring-ink/5 px-5 sm:px-7 lg:px-9 py-6 sm:py-7">
        {/* Masthead. One band: who, where, and where he ranks. The vitals that
            used to be a ruled mini-table run inline here — the modules below
            need the width more than the biography does. */}
        <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-7 pb-5 border-b-2 border-ink/85">
          {/* Photo and name ride the same row at every width. Stacked, the photo
              ate the top of a phone screen before the name had been read. */}
          <div className="flex items-center md:items-end gap-4 md:gap-7 min-w-0">
            <PlayerPhoto bartPlayerId={bartId} name={name} size={84} />

            <div className="min-w-0 flex flex-col gap-1.5 md:gap-2">
            {/* No accent rule ahead of the crest. A 20px hairline immediately
                left of a round logo and a school name does not read as the
                editorial rule it is elsewhere on the site — it reads as a
                hyphen joined to the word, as though the school were called
                "-Iowa St." The rule earns its place above a heading, where
                nothing follows it on the same line; here the crest already
                marks where the line starts. */}
            <div className="flex items-center gap-2 label min-w-0 flex-nowrap whitespace-nowrap" style={{ color: "var(--coral)" }}>
              <Link
                href={`/teams/${teamSlug(teamName)}/${year}/`}
                // The school sets larger than the rest of this line. It is the
                // second thing a reader looks for after the name, and at the
                // shared `label` size it was 10px — the same weight as the
                // conference code beside it. Conference and season stay small
                // deliberately: they are the qualifiers, not the subject.
                className="inline-flex items-center gap-2 text-[0.8125rem] sm:text-sm hover:text-coral-soft transition-colors"
              >
                <TeamLogo name={teamName} size={22} />
                <span className="truncate">{teamName}</span>
              </Link>
              {conference && <span className="text-ink-muted shrink-0">· {conference}</span>}
              {/* The season is the first thing to go on a phone that is also
                  carrying two seals on this line. It is not lost — the vitals
                  below and the career table both state it. */}
              <span className="text-ink-muted shrink-0 hidden sm:inline">· {seasonLabel(year)}</span>
            </div>

            <h1 className="font-display text-2xl sm:text-5xl lg:text-[3.25rem] tracking-tight text-ink leading-[1.05] md:leading-[1.02] break-words">
              {name}
            </h1>

            {/* Vitals sit under the name on desktop but break out to full width
                below the photo on a phone — five fields and a draft chip do not
                fit in what is left beside a headshot. Wraps rather than
                truncates; a high-school name is the field most likely to push
                this past one line. */}
            <div className="hidden md:flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.8125rem] text-ink-soft">
              <Vitals vitals={vitals} draft={draft} bucket={bucket} playerClass={playerClass} />
            </div>
            </div>

            {/* Phone only, and inside the photo/name row rather than under it —
                the mark is identity, so it belongs on the line that carries the
                name. Compact: the board label shortens to TOP / MID. */}
            {heroRanks && (
              <div className="md:hidden ml-auto shrink-0">
                <TopHundredSeal season={heroRanks} size={72} compact />
              </div>
            )}
          </div>

          <div className="flex md:hidden flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-soft">
            <Vitals vitals={vitals} draft={draft} bucket={bucket} playerClass={playerClass} />
          </div>

          {/* Rings were desktop-only, which left a phone with no sense of where
              the player stands at all — the thing the page is for. Smaller, and
              below the vitals rather than beside the name, because three of them
              at ring size do not fit next to a headshot. */}
          {heroRanks && (
            <div className="hidden md:block md:ml-auto shrink-0 md:pb-1">
              <TopHundredSeal season={heroRanks} size={96} />
            </div>
          )}
        </div>

        <StatBand now={statNow} career={statCareer} seasons={seasonCount} />

        {banner && <div className="pt-4">{banner}</div>}

        {/* Six modules. Two columns on tablet, three on desktop — a chart
            narrower than about 220px stops resolving individual games. */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <Module title="Scoring" note={bestNote}>
            <BigStat
              value={fmt(current.pts, 1)}
              unit="PTS"
              pct={pct("pts_pg")}
              delta={<Delta now={current.pts} was={prev?.pts} />}
            />
            {hasLog ? (
              <GameBars games={games} values={pts} unit="PTS" avg={current.pts} />
            ) : (
              <RateRow label="Rank" value={fmt(current.pts, 1)} fill={(pct("pts_pg") ?? 0) / 100} pct={pct("pts_pg")} />
            )}
          </Module>

          <Module title={second.title} note={secondNote}>
            <BigStat
              value={fmt(second.value, 1)}
              unit={second.unit}
              pct={pct(second.rankKey)}
              delta={<Delta now={second.value} was={second.prev} />}
            />
            {hasLog ? (
              <GameBars games={games} values={second.series} unit={second.unit} avg={second.value} />
            ) : (
              <RateRow
                label={second.fallbackLabel}
                value={fmt(val(second.fallbackKey), 1)}
                fill={(pct(second.fallbackKey) ?? 0) / 100}
                pct={pct(second.fallbackKey)}
              />
            )}
          </Module>

          {/* The counting stats the module above didn't take. No chart: these are
              the ones a per-game column renders as a row of one- and two-unit
              stubs, so the percentile is the whole reading and the ramp carries
              it. Title names what's actually in it — a big's version leads with
              passing, not glass. */}
          <Module title={big ? "Passing & defense" : "Glass & defense"} note="percentile in cohort">
            <div className="flex flex-col gap-2 pt-0.5">
              {big ? (
                <RateRow label="AST" value={fmt(current.ast, 1)} fill={(pct("ast_pg") ?? 0) / 100} pct={pct("ast_pg")} />
              ) : (
                <RateRow label="REB" value={fmt(current.reb, 1)} fill={(pct("reb_pg") ?? 0) / 100} pct={pct("reb_pg")} />
              )}
              <RateRow label="STL" value={fmt(val("stl_pg"), 1)} fill={(pct("stl_pg") ?? 0) / 100} pct={pct("stl_pg")} />
              <RateRow label="BLK" value={fmt(val("blk_pg"), 1)} fill={(pct("blk_pg") ?? 0) / 100} pct={pct("blk_pg")} />
              <RateRow label="TOV%" value={fmt(val("tov_pct"), 1)} fill={(pct("tov_pct") ?? 0) / 100} pct={pct("tov_pct")} />
            </div>
          </Module>

          <Module title="Efficiency" note={hasLog ? tsNote : "true shooting"}>
            <BigStat
              value={fmtPct(current.ts)}
              unit="TS"
              pct={pct("ts_pct")}
              delta={<Delta now={current.ts} was={prev?.ts} pctPoints />}
            />
            {hasLog ? (
              <GameBars
                games={games}
                values={ts}
                unit="TS%"
                decimals={1}
                avg={current.ts === null ? null : current.ts * 100}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <RateRow label="USG" value={fmt(val("usage"), 1)} fill={(pct("usage") ?? 0) / 100} pct={pct("usage")} />
                <RateRow label="ORtg" value={fmt(val("ortg"), 1)} fill={(pct("ortg") ?? 0) / 100} pct={pct("ortg")} />
              </div>
            )}
          </Module>

          <Module title="Shooting" note="value · percentile">
            <div className="flex flex-col gap-2 pt-0.5">
              <RateRow label="FG%" value={fmtPct(current.fg)} fill={current.fg} pct={null} />
              <RateRow label="3P%" value={fmtPct(current.fg3)} fill={current.fg3} pct={pct("fg3_pct")} />
              <RateRow label="FT%" value={fmtPct(current.ft)} fill={current.ft} pct={pct("ft_pct")} />
              <RateRow label="eFG%" value={fmtPct(current.efg)} fill={current.efg} pct={pct("efg_pct")} />
            </div>
          </Module>

          <Module title="Impact" note={hasSplit ? "EPM, split off / def" : "efficiency & load"}>
            <BigStat
              value={fmtSigned(current.epm, 2)}
              unit="EPM"
              accent
              pct={pct("epm")}
              delta={<Delta now={current.epm} was={prev?.epm} digits={2} />}
            />
            {/* The off/def split and on/off are lineup quantities, so they exist
                only for seasons the ridge fit covers. Older seasons carry the
                box-score estimate, which has no lineup information at all —
                three empty bars would read as a rendering fault rather than as
                a season we never had the data for, so those seasons get the
                rate stats the cohort file does rank. */}
            {hasSplit ? (
              <div className="flex flex-col gap-2">
                <ImpactBar label="Offense" value={impact?.off ?? null} scale={impactScale} tone="var(--coral)" />
                <ImpactBar label="Defense" value={impact?.def ?? null} scale={impactScale} tone="var(--coral-soft)" />
                {current.onOff !== null && (
                  <div className="flex items-baseline gap-2.5 pt-0.5">
                    <span className="text-[0.6875rem] text-ink-muted w-14 shrink-0">On/Off</span>
                    <span className="tabular text-[0.8125rem] text-ink">{fmtSigned(current.onOff, 1)}</span>
                    <span className="text-[0.625rem] text-ink-muted">team net per 100 with him on</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <RateRow label="ORtg" value={fmt(val("ortg"), 1)} fill={(pct("ortg") ?? 0) / 100} pct={pct("ortg")} />
                <RateRow label="USG" value={fmt(val("usage"), 1)} fill={(pct("usage") ?? 0) / 100} pct={pct("usage")} />
                <RateRow label="PORP" value={fmt(val("porpag"), 1)} fill={(pct("porpag") ?? 0) / 100} pct={pct("porpag")} />
              </div>
            )}
          </Module>
        </div>

      </div>
    </section>
  );
}
