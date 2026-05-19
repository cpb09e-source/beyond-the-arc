import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readIndex, readPlayer, readPortalEntryForBartId, readPlayerRanks } from "@/lib/static-data";
import { PlayerPhoto } from "@/components/player-photo";
import { CareerTable } from "@/components/players/career-table";
import { PlayerOverview, type PlayerOverviewOption } from "@/components/players/player-overview";

export async function generateStaticParams() {
  const idx = await readIndex();
  return idx.playerIds.map((id) => ({ id: String(id) }));
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
          <div className="flex items-start sm:items-end gap-4 sm:gap-6 lg:gap-10">
            {/* Two renders so we can scale the photo across breakpoints without
                fighting PlayerPhoto's inline width/height styles. */}
            <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={72} className="sm:hidden" />
            <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={120} className="hidden sm:inline-flex" />
            <div className="flex-1 min-w-0">
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

          <div className="mt-8 sm:mt-10 grid grid-cols-5 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
            <StatTile label="PPG" value={fmtNum(stats.pts, 1)} sub={`${current.games ?? "?"} games`} />
            <StatTile label="RPG" value={fmtNum(stats.reb, 1)} />
            <StatTile label="APG" value={fmtNum(stats.ast, 1)} />
            <StatTile label="SPG" value={fmtNum(stats.stl, 1)} />
            <StatTile label="BPG" value={fmtNum(stats.blk, 1)} />
          </div>
        </div>
      </section>

      {overviewOptions.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-10">
          <PlayerOverview options={overviewOptions} />
        </section>
      )}

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-14 mb-20">
        <h2 className="font-display text-3xl text-ink mb-2">Career</h2>
        <p className="text-xs text-ink-muted mb-6">Click a season to open the team&apos;s game log for that year.</p>
        <CareerTable seasons={player.seasons} bartPlayerId={bartId} playerName={stats.name ?? `Player ${bartId}`} />
      </section>
    </>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card px-2 sm:px-5 py-3 sm:py-4 min-w-0">
      <div className="text-[0.6rem] sm:text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</div>
      <div className="font-display text-xl sm:text-3xl text-ink tabular mt-1">{value}</div>
      {sub && <div className="text-[0.6rem] sm:text-xs text-ink-muted mt-1 truncate">{sub}</div>}
    </div>
  );
}
