import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readPlayer, readPortalEntryForBartId, readPlayerRanks, readRankedPlayerIds, readImpactExtrasForYear, readNbaDraftee } from "@/lib/static-data";
import { nbaTeamName, draftRound, ordinal } from "@/lib/nba-draftees";
import { PlayerPhoto } from "@/components/player-photo";
import { CareerTable } from "@/components/players/career-table";
import { PlayerOverview, type PlayerOverviewOption } from "@/components/players/player-overview";
import { PlayerShotChart } from "@/components/players/player-shot-chart";
import { RankRings } from "@/components/players/rank-rings";
import { cn } from "@/lib/utils";

export async function generateStaticParams() {
  // Only emit profile pages for ranked players. Unranked players (didn't
  // clear 18g/20mpg/5.3ppg + position bucket) get a 404 — their names render
  // as plain text everywhere else.
  const ranked = await readRankedPlayerIds();
  return [...ranked].map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bartId = Number(id);
  if (!Number.isFinite(bartId)) return { title: "Player not found" };
  const player = await readPlayer(bartId);
  if (!player || player.seasons.length === 0) return { title: "Player not found" };

  const current = player.seasons[0]!;
  const row = current.raw_row;
  const name = typeof row?.[0] === "string" ? row[0] : `Player ${bartId}`;
  const pts = fromEnd(row, 3);
  const reb = fromEnd(row, 7);
  const ast = fromEnd(row, 6);
  const seasonStr = seasonLabel(current.year);

  const lineParts: string[] = [];
  if (pts !== null) lineParts.push(`${fmtNum(pts, 1)} PPG`);
  if (reb !== null) lineParts.push(`${fmtNum(reb, 1)} RPG`);
  if (ast !== null) lineParts.push(`${fmtNum(ast, 1)} APG`);
  const statLine = lineParts.length > 0 ? lineParts.join(" · ") + ". " : "";
  const description = `${name} — ${current.team_name} ${seasonStr}. ${statLine}Full season stats, percentile rankings, and career history.`.trim();
  const ogTitle = `${name} · ${current.team_name}`;

  return {
    title: name,
    description,
    openGraph: {
      title: ogTitle,
      description,
      url: `/players/${bartId}/`,
      type: "profile",
    },
    twitter: { card: "summary_large_image", title: ogTitle, description },
    alternates: { canonical: `/players/${bartId}/` },
  };
}

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** 0..1 → "55.6%". Bart stores every rate as a decimal. The hero reads as a
 *  scouting line rather than a box score, and a shooting line is spoken in
 *  percent — the leading-dot form belongs in the career table, where a column
 *  of them aligns on the decimal. */
function fmtPct(x: number | null): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
/** Signed, one decimal — for the impact numbers, where the sign IS the reading. */
function fmtSigned(x: number | null): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : ""}${x.toFixed(1)}`;
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Bart's per-season role note (raw_row[64]) → the G/F/C bucket the rest of the
// site ranks by. Mirrors scripts/compute-player-ranks.mts and
// scripts/build-shot-baselines.mjs — all three must agree or a player gets
// compared against a cohort he isn't in.
const POSITION_BUCKET: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};

// raw_row column positions — see scripts/sync-bart.mts
function fromEnd(row: Array<string | number | null> | null, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fromStart(row: Array<string | number | null> | null, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bartId = Number(id);
  if (!Number.isFinite(bartId)) notFound();

  const player = await readPlayer(bartId);
  if (!player || player.seasons.length === 0) notFound();

  const current = player.seasons[0]!;

  // Portal lookup: if the player has committed to a new school this cycle,
  // surface the transfer in the hero with a redacted-current + new-school
  // treatment. Only kicks in when status === "Transferred" AND team_to is set.
  const portalEntry = await readPortalEntryForBartId(bartId);
  const transfer = portalEntry && portalEntry.status === "Transferred" && portalEntry.team_to
    ? { from: current.team_name, to: portalEntry.team_to, toConf: portalEntry.conf_to }
    : null;

  // Pre-computed percentile ranks (year × position bucket). Drives the
  // Player Overview panel. Populated for players who clear the 18g/20mpg/5.3ppg
  // baseline; the year dropdown reflects only ranked seasons.
  const ranks = await readPlayerRanks(bartId);
  const overviewOptions: PlayerOverviewOption[] = ranks
    ? ranks.seasonRanks
        .map((r) => {
          const sb = player.seasons.find((s) => s.year === r.year);
          if (!sb) return null;
          return { year: r.year, team_name: sb.team_name, ranks: r };
        })
        .filter((x): x is PlayerOverviewOption => x !== null)
    : [];

  // Season → position bucket, from Bart's per-season role note. Feeds the shot
  // chart's "vs position" court, which needs a cohort to compare against; same
  // mapping compute-player-ranks.mts uses for percentiles.
  const positionByYear: Record<string, "G" | "F" | "C"> = {};
  for (const s of player.seasons) {
    const note = (Array.isArray(s.raw_row) ? s.raw_row[64] : null) ?? s.notes;
    const b = typeof note === "string" ? POSITION_BUCKET[note] : undefined;
    if (b) positionByYear[String(s.year)] = b;
  }

  // Ranks for the season the hero shows. Falls back to the newest ranked season
  // so a player whose latest year missed the eligibility floor still gets rings
  // rather than a hole where they were.
  const heroRanks =
    ranks?.seasonRanks.find((r) => r.year === current.year) ??
    ranks?.seasonRanks.slice().sort((a, b) => b.year - a.year)[0] ??
    null;

  const row = current.raw_row;
  const stats = {
    pts: fromEnd(row, 3),
    blk: fromEnd(row, 4),
    stl: fromEnd(row, 5),
    ast: fromEnd(row, 6),
    reb: fromEnd(row, 7),
    name: typeof row?.[0] === "string" ? row[0] : null,
    height: typeof row?.[26] === "string" ? row[26] : null,
    hometown: typeof row?.[33] === "string" ? row[33] : null,
  };

  /**
   * One derived line per season, plus the career aggregate.
   *
   * Rates are built from the raw MADE/ATTEMPTED counts, not from Bart's
   * precomputed rate columns, for two reasons. There is no combined-FG column —
   * only 2P and 3P — so FG% and eFG% have to be assembled from parts anyway.
   * And a career rate is only correct as total-makes over total-attempts: the
   * average of four seasons' percentages is not the career percentage unless
   * every season had identical attempts, which is never true.
   */
  const epmByYear = new Map<number, number>();
  for (const r of ranks?.seasonRanks ?? []) {
    const v = r.stats?.epm?.value;
    if (typeof v === "number") epmByYear.set(r.year, v);
  }
  // on/off is a lineup quantity, so it lives only in epm-<year>.json. One read
  // per season, memoized across the ~15,700 pages this route generates.
  const onOffByYear = new Map<number, number>();
  for (const season of player.seasons) {
    const extras = await readImpactExtrasForYear(season.year);
    const v = extras.get(bartId)?.on_off;
    if (typeof v === "number") onOffByYear.set(season.year, v);
  }

  const lines = player.seasons.map((season) => {
    const r = season.raw_row;
    const g = season.games ?? 0;
    const ftm = fromStart(r, 13), fta = fromStart(r, 14);
    const fg2m = fromStart(r, 16), fg2a = fromStart(r, 17);
    const fg3m = fromStart(r, 19), fg3a = fromStart(r, 20);
    const mpg = fromStart(r, 54);
    return {
      year: season.year,
      g,
      min: mpg !== null ? mpg * g : 0,
      // Bart's per-game rates × games recovers the season total, which is what
      // a career line has to sum. He carries no season point total.
      pts: (fromEnd(r, 3) ?? 0) * g,
      reb: (fromEnd(r, 7) ?? 0) * g,
      ast: (fromEnd(r, 6) ?? 0) * g,
      ftm: ftm ?? 0, fta: fta ?? 0,
      fgm: (fg2m ?? 0) + (fg3m ?? 0),
      fga: (fg2a ?? 0) + (fg3a ?? 0),
      fg3m: fg3m ?? 0, fg3a: fg3a ?? 0,
      epm: epmByYear.get(season.year) ?? null,
      onOff: onOffByYear.get(season.year) ?? null,
    };
  });

  type Totals = (typeof lines)[number];
  /** A summary row: per-game rates and shooting percentages over a set of seasons. */
  function summarize(rows: Totals[]) {
    const g = rows.reduce((n, r) => n + r.g, 0);
    const min = rows.reduce((n, r) => n + r.min, 0);
    const sum = (k: "pts" | "reb" | "ast" | "ftm" | "fta" | "fgm" | "fga" | "fg3m" | "fg3a") =>
      rows.reduce((n, r) => n + r[k], 0);
    const fgm = sum("fgm"), fga = sum("fga"), fg3m = sum("fg3m");
    /**
     * EPM and on/off are per-100 RATES, so a career figure is the
     * minutes-weighted mean of the seasons that HAVE one — not a plain average,
     * which would let a 6-minute freshman year pull as hard as a 34-minute
     * senior year. Seasons without the stat are excluded from both the numerator
     * and the weight rather than counted as zero.
     */
    const weighted = (k: "epm" | "onOff") => {
      const have = rows.filter((r) => r[k] !== null && r.min > 0);
      if (!have.length) return null;
      const w = have.reduce((n, r) => n + r.min, 0);
      return w > 0 ? have.reduce((n, r) => n + (r[k] as number) * r.min, 0) / w : null;
    };
    return {
      g,
      pts: g ? sum("pts") / g : null,
      reb: g ? sum("reb") / g : null,
      ast: g ? sum("ast") / g : null,
      fg: fga ? fgm / fga : null,
      fg3: sum("fg3a") ? fg3m / sum("fg3a") : null,
      ft: sum("fta") ? sum("ftm") / sum("fta") : null,
      efg: fga ? (fgm + 0.5 * fg3m) / fga : null,
      epm: weighted("epm"),
      onOff: weighted("onOff"),
      min,
    };
  }

  const currentLine = summarize(lines.filter((l) => l.year === current.year));
  const careerLine = summarize(lines);
  const multiSeason = player.seasons.length > 1;

  /**
   * NBA draft record, matched on name.
   *
   * A drafted player has left college, so this SUPERSEDES the transfer banner
   * rather than stacking with it: a portal entry from an earlier cycle is stale
   * the moment a player is drafted, and showing both would have him arriving at
   * a new school and going to the NBA in the same breath.
   */
  const draft = await readNbaDraftee(stats.name);
  const draftTeam = draft && draft.pick !== null ? nbaTeamName(draft.team, draft.year) : null;

  return (
    // pb-20 lives on the wrapper rather than on the last section: which section
    // IS last depends on the player (the shot charts render only where we have
    // located shots), so pinning the page's bottom gutter to any one of them
    // left some profiles ending flush against the footer.
    <div className="pb-20">
      {/* Dossier hero — scouting-file split. Photo + vitals ride a deep-paper
          column; name and the per-game bar take the open side. The vitals that
          used to run inline as "Illinois · Fr · 6-6 · Lenexa" become a ruled
          mini-table, which is scannable and stops the meta line from wrapping
          into three rows on narrow screens. Stacks to one column below md. */}
      <section className="mx-auto max-w-[88rem] px-0 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-5 sm:pb-6">
        {/* Warm off-white rather than pure card white — the flat #fff panel read
            as a hole punched in the paper. Still lifts off the page background
            because it's a step lighter than --paper-deep, plus the border/ring. */}
        <div className="bg-[color-mix(in_oklab,var(--card)_55%,var(--paper-deep))] border-y sm:border border-ink/10 sm:rounded-xl shadow-md overflow-hidden ring-0 sm:ring-1 ring-ink/5 grid grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
          {/* Vitals column */}
          <div className="relative bg-paper-deep border-b md:border-b-0 md:border-r border-hairline px-6 py-6 flex flex-col items-center gap-5">
            {/* The season eyebrow lives here, with the photo it labels, rather
                than over the name — the vitals in this column are all "as of
                this season", so it captions the column it belongs to. It also
                replaces a bare corner-set year that said the same thing twice. */}
            <div className="flex items-center gap-2.5 text-[0.55rem] uppercase tracking-[0.18em] text-coral font-bold self-start">
              <span className="h-px w-5 bg-coral" />
              <span>Player · {seasonLabel(current.year)}</span>
            </div>
            <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={132} />
            <dl className="w-full text-xs">
              <VitalRow label="Team">
                <Link
                  href={`/teams/${teamSlug(transfer ? transfer.from : current.team_name)}`}
                  className="inline-flex items-center gap-1.5 hover:text-coral transition-colors min-w-0"
                >
                  <TeamLogo name={transfer ? transfer.from : current.team_name} size={16} />
                  <span className="truncate">{transfer ? transfer.from : current.team_name}</span>
                </Link>
              </VitalRow>
              <VitalRow label="Class">{current.class ?? "—"}</VitalRow>
              <VitalRow label="Height">{stats.height ?? "—"}</VitalRow>
              {stats.hometown && <VitalRow label="From">{stats.hometown}</VitalRow>}
            </dl>
          </div>

          {/* Name + per-game bar */}
          <div className="px-6 sm:px-8 lg:px-10 py-7 sm:py-8 flex flex-col justify-center min-w-0">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl tracking-tight text-ink leading-[1.05] sm:leading-none break-words">
                  {stats.name ?? `Player ${bartId}`}
                </h1>
              </div>
              {/* Leaderboard rings, top right of the card. Server-rendered off
                  the hero's own season rather than the Overview's picker — the
                  hero has no year control, so they'd have nothing to track. */}
              {heroRanks && (
                <div className="hidden sm:block shrink-0">
                  <RankRings season={heroRanks} size={74} />
                </div>
              )}
            </div>

            {/* Drafted banner. Reads the way the draft is spoken — franchise,
                round, pick, year — rather than as a bare code and number. */}
            {draft && draft.pick !== null && (
              <div className="mt-3 inline-flex self-start items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-md bg-court/15 border border-court/40">
                <span className="text-[0.6rem] uppercase tracking-widest text-court-ink font-bold whitespace-nowrap">
                  Drafted
                </span>
                <span className="text-ink font-medium truncate">
                  {draftTeam ?? draft.team}
                </span>
                <span className="text-ink-muted text-sm whitespace-nowrap">
                  Round {draftRound(draft.pick)} · {ordinal(draft.pick)} pick · {draft.year}
                </span>
              </div>
            )}

            {/* Transferred-to banner — shown when a portal commit exists, and
                only for a player the draft has not already taken. */}
            {!draft && transfer && (
              <div className="mt-3 inline-flex self-start items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-md bg-coral/10 border border-coral/30">
                <span className="text-[0.6rem] uppercase tracking-widest text-coral font-bold whitespace-nowrap">
                  Transfer →
                </span>
                <Link href={`/teams/${teamSlug(transfer.to)}`} className="inline-flex items-center gap-2 group min-w-0">
                  <TeamLogo name={transfer.to} size={22} />
                  <span className="text-ink font-medium group-hover:text-coral transition-colors truncate">
                    {transfer.to}
                  </span>
                </Link>
              </div>
            )}

            {/* Summary table — the season, then the career, on the same
                columns. Two lines is the whole point: a rate means little
                until you can see it against the player's own baseline, and
                putting them one above the other makes that a glance rather
                than a scroll to the career ledger below. A single-season
                player gets one row, because a career line identical to the
                season above it is noise. */}
            <div className="mt-6 sm:mt-7 pt-5 border-t border-hairline overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-right">
                <thead>
                  <tr>
                    <SumTh className="text-left w-24">Summary</SumTh>
                    <SumTh>G</SumTh>
                    <SumTh>PTS</SumTh>
                    <SumTh>REB</SumTh>
                    <SumTh>AST</SumTh>
                    <SumTh divide>FG%</SumTh>
                    <SumTh>3P%</SumTh>
                    <SumTh>FT%</SumTh>
                    <SumTh>eFG%</SumTh>
                    <SumTh divide>EPM</SumTh>
                    <SumTh>On/Off</SumTh>
                  </tr>
                </thead>
                <tbody>
                  <SummaryRow label={seasonLabel(current.year)} line={currentLine} lead />
                  {multiSeason && <SummaryRow label="Career" line={careerLine} />}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* No margin of its own — the gap to the hero is the hero section's own
          bottom padding and nothing else, which keeps it tighter (24px) than
          the 32px between the cards below. The hero and the career ledger read
          as one block: vitals, then the record those vitals belong to. */}
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10">
        {/* Career ledger — heavier chrome than other cards on the page so this
            anchors the profile as the canonical record. CareerTable owns its
            own header (season count + View toggle) so the dropdown sits
            next to the count instead of in a separate band below.

            Sits directly under the hero: the year-by-year record is what most
            readers come to a player page for, and it reads as the continuation
            of the vitals. Player Overview follows as the single-season detail. */}
        <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
          <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
          <CareerTable seasons={player.seasons} bartPlayerId={bartId} playerName={stats.name ?? `Player ${bartId}`} />
        </div>
      </section>

      {overviewOptions.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8">
          {/* Player Overview — ledger card matching /coaches season-by-season.
              Inner component supplies the team/year picker band + grid.
              Full-bleed edge-to-edge on mobile; framed card on lg+. */}
          <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
            <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
            {/* Heading lives inside the client component now: the rank rings
                sit to its right and have to track the year picker. */}
            <PlayerOverview options={overviewOptions} bartPlayerId={bartId} />
          </div>
        </section>
      )}

      {/* Shooting section: the two hexbin courts (2024+ seasons). Players with
          no located shots fall back to a zone-splits card — but only when the
          Player Overview isn't already carrying those splits in its Shot Diet
          panel, or they'd appear twice on the same page. */}
      <PlayerShotChart
        bartPlayerId={bartId}
        years={player.seasons.map((s) => s.year)}
        positionByYear={positionByYear}
        suppressFallback={overviewOptions.length > 0}
      />
    </div>
  );
}

/**
 * SecondaryStat — display-typeset stat with the label tucked underneath.
 * Sized one step below the lede PPG so the eye picks up the hero number
 * first and reads the supporting stats as a single subordinate cluster.
 */
/** One row of the dossier vitals table. */
function VitalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-hairline last:border-b-0">
      <dt className="text-[0.55rem] uppercase tracking-[0.16em] text-ink-muted font-semibold shrink-0">{label}</dt>
      <dd className="text-ink-soft text-right min-w-0 truncate">{children}</dd>
    </div>
  );
}

/** Header cell for the hero summary table. `divide` opens a new stat group. */
function SumTh({ children, className, divide }: { children: React.ReactNode; className?: string; divide?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "pb-2 text-[0.55rem] uppercase tracking-[0.16em] text-ink-muted font-semibold whitespace-nowrap",
        // The rule sits on the cell rather than between groups as a spacer
        // column, so the columns stay on one grid and the header aligns with
        // the numbers under it.
        divide && "border-l border-hairline pl-4",
        !divide && "pl-3",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * One line of the hero summary — a season, or the career.
 *
 * `lead` marks the current season: it carries the ink and the weight, and the
 * career line sits a step back in both, so the eye lands on the season being
 * shown and reads the career as its context rather than as a competing row.
 */
function SummaryRow({
  label, line, lead = false,
}: {
  label: string;
  lead?: boolean;
  line: {
    g: number; pts: number | null; reb: number | null; ast: number | null;
    fg: number | null; fg3: number | null; ft: number | null; efg: number | null;
    epm: number | null; onOff: number | null;
  };
}) {
  const tone = lead ? "text-ink" : "text-ink-soft";
  return (
    <tr>
      <th scope="row" className={cn("py-1.5 text-left text-xs sm:text-sm font-semibold whitespace-nowrap", lead ? "text-ink" : "text-ink-muted")}>
        {label}
      </th>
      <SumTd tone={tone} lead={lead}>{line.g || "—"}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtNum(line.pts, 1)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtNum(line.reb, 1)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtNum(line.ast, 1)}</SumTd>
      <SumTd tone={tone} lead={lead} divide>{fmtPct(line.fg)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtPct(line.fg3)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtPct(line.ft)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtPct(line.efg)}</SumTd>
      <SumTd tone={tone} lead={lead} divide>{fmtSigned(line.epm)}</SumTd>
      <SumTd tone={tone} lead={lead}>{fmtSigned(line.onOff)}</SumTd>
    </tr>
  );
}

function SumTd({
  children, tone, lead, divide,
}: { children: React.ReactNode; tone: string; lead: boolean; divide?: boolean }) {
  return (
    <td
      className={cn(
        "py-1.5 font-display tabular tracking-[-0.02em] whitespace-nowrap",
        lead ? "text-lg sm:text-xl" : "text-sm sm:text-base",
        tone,
        divide ? "border-l border-hairline pl-4" : "pl-3",
      )}
    >
      {children}
    </td>
  );
}
