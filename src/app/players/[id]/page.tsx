import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readPlayer, readPortalEntryForBartId, readPlayerRanks, readRankedPlayerIds } from "@/lib/static-data";
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
      <section className="mx-auto max-w-7xl px-0 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-5 sm:pb-6">
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

            <div className="mt-6 sm:mt-7 pt-5 border-t border-hairline">
              <div className="text-[0.55rem] uppercase tracking-[0.2em] text-ink-muted font-semibold mb-3">Per game</div>
              <div className="flex items-end gap-x-7 sm:gap-x-9 lg:gap-x-11 gap-y-5 flex-wrap">
                <PerGameStat label="Points"   value={fmtNum(stats.pts, 1)} lead />
                <PerGameStat label="Rebounds" value={fmtNum(stats.reb, 1)} />
                <PerGameStat label="Assists"  value={fmtNum(stats.ast, 1)} />
                <PerGameStat label="Steals"   value={fmtNum(stats.stl, 1)} />
                <PerGameStat label="Blocks"   value={fmtNum(stats.blk, 1)} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* No margin of its own — the gap to the hero is the hero section's own
          bottom padding and nothing else, which keeps it tighter (24px) than
          the 32px between the cards below. The hero and the career ledger read
          as one block: vitals, then the record those vitals belong to. */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10">
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
        <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
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

/** Per-game figure. `lead` marks points, which carries the accent + extra size. */
function PerGameStat({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div>
      <div
        className={cn(
          "font-display tabular leading-none tracking-[-0.03em]",
          lead ? "text-coral text-[clamp(2.5rem,4.5vw,3.5rem)]" : "text-ink text-2xl sm:text-3xl lg:text-4xl",
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[0.55rem] sm:text-[0.6rem] uppercase tracking-[0.18em] text-ink-muted font-medium">
        {label}
      </div>
    </div>
  );
}
