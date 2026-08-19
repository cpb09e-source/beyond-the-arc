import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readPlayer, readPortalEntryForBartId, readPlayerRanks, readRankedPlayerIds, readImpactExtrasForYear } from "@/lib/static-data";
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
   * Shooting + impact for the hero's own season.
   *
   * The rates are derived from the raw MADE/ATTEMPTED counts rather than read
   * from Bart's pre-computed columns, for the same reason CareerTable does it:
   * there is no combined-FG column, only 2P and 3P, so FG% and eFG% have to be
   * built from the parts — and building all four the same way means the hero
   * and the career row below it can never disagree about a player's season.
   */
  const ftPct = fromStart(row, 15);
  const fg2Made = fromStart(row, 16);
  const fg2Att = fromStart(row, 17);
  const fg3Made = fromStart(row, 19);
  const fg3Att = fromStart(row, 20);
  const fgMade = fg2Made !== null && fg3Made !== null ? fg2Made + fg3Made : null;
  const fgAtt = fg2Att !== null && fg3Att !== null ? fg2Att + fg3Att : null;
  const shooting = {
    fg: fgMade !== null && fgAtt ? fgMade / fgAtt : null,
    fg3: fg3Made !== null && fg3Att ? fg3Made / fg3Att : null,
    ft: ftPct,
    // (FGM + 0.5 × 3PM) / FGA — a three counts for one and a half twos.
    efg: fgMade !== null && fg3Made !== null && fgAtt ? (fgMade + 0.5 * fg3Made) / fgAtt : null,
  };

  // EPM rides the rank file the rings already use. On/off lives only in
  // epm-<year>.json (it is a lineup quantity, not a box one), and that read is
  // memoized per year — see readImpactExtrasForYear.
  const heroEpm = heroRanks?.stats?.epm?.value ?? null;
  const heroOnOff = heroRanks
    ? (await readImpactExtrasForYear(heroRanks.year)).get(bartId)?.on_off ?? null
    : null;

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
            <span className="absolute top-3 right-4 text-[0.55rem] uppercase tracking-[0.2em] text-ink-muted font-bold tabular">
              {seasonLabel(current.year)}
            </span>
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
                <div className="flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-2.5">
                  <span className="h-px w-6 bg-coral" />
                  <span>Player · {seasonLabel(current.year)}</span>
                </div>
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

            {/* Transferred-to banner — shown when a portal commit exists. */}
            {transfer && (
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

            {/* The season line, in three groups.
                Per game shrank to make room: it used to run at text-4xl as the
                only numbers here, which is a lot of size to spend on five stats
                a reader has to leave the page to put in context. Shooting and
                impact next to them is the context — and the three groups are
                ruled apart rather than merged into one long row so the eye can
                tell a rate from a per-game figure without reading the label. */}
            <div className="mt-6 sm:mt-7 pt-5 border-t border-hairline flex flex-wrap gap-x-8 sm:gap-x-10 gap-y-5">
              <StatGroup label="Per game">
                <HeroStat label="PTS" value={fmtNum(stats.pts, 1)} />
                <HeroStat label="REB" value={fmtNum(stats.reb, 1)} />
                <HeroStat label="AST" value={fmtNum(stats.ast, 1)} />
                <HeroStat label="STL" value={fmtNum(stats.stl, 1)} />
                <HeroStat label="BLK" value={fmtNum(stats.blk, 1)} />
              </StatGroup>

              <StatGroup label="Shooting">
                <HeroStat label="FG%"  value={fmtPct(shooting.fg)} />
                <HeroStat label="3P%"  value={fmtPct(shooting.fg3)} />
                <HeroStat label="FT%"  value={fmtPct(shooting.ft)} />
                <HeroStat label="eFG%" value={fmtPct(shooting.efg)} />
              </StatGroup>

              {(heroEpm !== null || heroOnOff !== null) && (
                <StatGroup label="Impact">
                  <HeroStat label="EPM"    value={fmtSigned(heroEpm)} />
                  <HeroStat label="On/Off" value={fmtSigned(heroOnOff)} />
                </StatGroup>
              )}
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

/**
 * A captioned cluster of hero stats — per game, shooting, impact.
 *
 * The caption sits above the row rather than beside it so the groups keep a
 * shared baseline: an inline caption makes each group a different height and
 * the numbers stop lining up across the strip.
 */
function StatGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.55rem] uppercase tracking-[0.2em] text-ink-muted font-semibold mb-2.5">{label}</div>
      <div className="flex items-end gap-x-5 sm:gap-x-6 gap-y-4 flex-wrap">{children}</div>
    </div>
  );
}

/**
 * One number in the hero strip.
 *
 * Points used to take a `lead` treatment: coral, and a clamp running to 3.5rem
 * against the 2.25rem everything else got. Two problems, one of them invisible
 * until you look for it. The colour made it read as a different KIND of number
 * rather than as the same stat with more weight, and the extra size broke the
 * row: the flex line aligns on `items-end`, so the taller box pushed its digits
 * up off the shared baseline and Points floated above its own neighbours.
 *
 * Every figure here is the same size and the same ink, so the baseline is a
 * baseline and the groups can sit alongside each other.
 */
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display tabular leading-none tracking-[-0.03em] text-ink text-xl sm:text-2xl">
        {value}
      </div>
      <div className="mt-1.5 text-[0.5rem] sm:text-[0.55rem] uppercase tracking-[0.16em] text-ink-muted font-medium">
        {label}
      </div>
    </div>
  );
}
