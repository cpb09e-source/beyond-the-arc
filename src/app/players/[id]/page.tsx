import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readPlayer, readPortalEntryForBartId, readPlayerRanks, readRankedPlayerIds } from "@/lib/static-data";
import { PlayerPhoto } from "@/components/player-photo";
import { CareerTable } from "@/components/players/career-table";
import { PlayerOverview, type PlayerOverviewOption } from "@/components/players/player-overview";

export async function generateStaticParams() {
  // Only emit profile pages for ranked players. Unranked players (didn't
  // clear 18g/18mpg/5ppg + position bucket) get a 404 — their names render
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
  // Player Overview panel. Populated for players who clear the 18g/18mpg/5ppg
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
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-10 pt-8 sm:pt-10 pb-10 sm:pb-12">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-3">
            <span className="h-px w-8 bg-coral" />
            <span>Player · {seasonLabel(current.year)}</span>
          </div>
          {/* Hero row — photo + name | stats banner. On lg+ the stats sit
              to the right of the name (ml-auto). Below lg the banner
              wraps to a full-width row below the name (flex-wrap). The
              banner scale is tuned smaller when inline so it doesn't
              fight the player-name h1 for visual weight. */}
          <div className="flex items-end gap-y-10 gap-x-6 sm:gap-x-8 lg:gap-x-12 flex-wrap">
            {/* Photo + name cluster */}
            <div className="flex items-start sm:items-end gap-4 sm:gap-6 lg:gap-10 min-w-0">
              {/* Two renders so we can scale the photo across breakpoints without
                  fighting PlayerPhoto's inline width/height styles. */}
              <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={72} className="sm:hidden" />
              <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={120} className="hidden sm:inline-flex" />
              <div className="min-w-0">
                <h1 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight text-ink leading-[1.05] sm:leading-none break-words">
                  {stats.name ?? `Player ${bartId}`}
                </h1>
                <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-1.5 text-ink-soft text-sm sm:text-base">
                  <Link
                    href={`/teams/${teamSlug(transfer ? transfer.from : current.team_name)}`}
                    className="inline-flex items-center gap-2 hover:text-coral transition-colors"
                    title={transfer ? `${transfer.from} → ${transfer.to}` : undefined}
                  >
                    <TeamLogo name={transfer ? transfer.from : current.team_name} size={24} />
                    <span>{transfer ? transfer.from : current.team_name}</span>
                  </Link>
                  <span className="text-ink-muted">·</span>
                  <span>{current.class ?? "—"}</span>
                  <span className="text-ink-muted">·</span>
                  <span>{stats.height ?? "—"}</span>
                  {stats.hometown && (
                    <>
                      <span className="text-ink-muted">·</span>
                      <span className="text-ink-muted">{stats.hometown}</span>
                    </>
                  )}
                </div>

                {/* Transferred-to banner — shown when a portal commit exists. */}
                {transfer && (
                  <div className="mt-3 inline-flex items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-md bg-coral/10 border border-coral/30">
                    <span className="text-[0.6rem] uppercase tracking-widest text-coral font-bold whitespace-nowrap">
                      Transfer →
                    </span>
                    <Link
                      href={`/teams/${teamSlug(transfer.to)}`}
                      className="inline-flex items-center gap-2 group min-w-0"
                    >
                      <TeamLogo name={transfer.to} size={22} />
                      <span className="text-ink font-medium group-hover:text-coral transition-colors truncate">
                        {transfer.to}
                      </span>
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Stat banner — inline on lg+, wraps below on smaller screens.
                Scale is tuned down vs the standalone version so it sits
                next to the player-name h1 without competing. */}
            <div className="w-full lg:w-auto lg:ml-auto">
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-3 sm:mb-4 flex items-center gap-2">
                <span className="h-px w-6 bg-coral" />
                Per game
              </div>
              <div className="flex items-end gap-x-6 sm:gap-x-8 lg:gap-x-10 gap-y-4 flex-wrap">
                {/* Lede — points per game */}
                <div>
                  <div className="font-display text-ink tabular leading-[0.9] tracking-[-0.04em] text-[clamp(2.75rem,5vw,4rem)]">
                    {fmtNum(stats.pts, 1)}
                  </div>
                  <div className="mt-2 text-[0.6rem] sm:text-[0.65rem] uppercase tracking-[0.18em] text-ink-muted font-medium">
                    Points
                  </div>
                </div>

                {/* Supporting — rebounds / assists / steals / blocks. */}
                <div className="flex items-end gap-x-5 sm:gap-x-7 lg:gap-x-9 gap-y-4 flex-wrap">
                  <SecondaryStat label="Rebounds" value={fmtNum(stats.reb, 1)} />
                  <SecondaryStat label="Assists"  value={fmtNum(stats.ast, 1)} />
                  <SecondaryStat label="Steals"   value={fmtNum(stats.stl, 1)} />
                  <SecondaryStat label="Blocks"   value={fmtNum(stats.blk, 1)} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {overviewOptions.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-10">
          {/* Player Overview — ledger card matching /coaches season-by-season.
              Inner component supplies the team/year picker band + grid. */}
          <div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5">
            <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
            <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30">
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
                <span className="h-px w-6 bg-coral" />
                Full-season stats
              </div>
              <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Player Overview</h2>
            </div>
            <PlayerOverview options={overviewOptions} />
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8 mb-20">
        {/* Career ledger — heavier chrome than other cards on the page so this
            anchors the profile as the canonical record. CareerTable owns its
            own header (season count + View toggle) so the dropdown sits
            next to the count instead of in a separate band below. */}
        <div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5">
          <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
          <CareerTable seasons={player.seasons} bartPlayerId={bartId} playerName={stats.name ?? `Player ${bartId}`} />
        </div>
      </section>
    </>
  );
}

/**
 * SecondaryStat — display-typeset stat with the label tucked underneath.
 * Sized one step below the lede PPG so the eye picks up the hero number
 * first and reads the supporting stats as a single subordinate cluster.
 */
function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-ink tabular text-2xl sm:text-3xl lg:text-4xl leading-none tracking-[-0.02em]">
        {value}
      </div>
      <div className="mt-2 text-[0.55rem] sm:text-[0.6rem] uppercase tracking-[0.18em] text-ink-muted font-medium">
        {label}
      </div>
    </div>
  );
}
