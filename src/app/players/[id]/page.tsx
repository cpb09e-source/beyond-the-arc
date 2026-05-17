import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { readIndex, readPlayer } from "@/lib/static-data";
import { PlayerPhoto } from "@/components/player-photo";
import { CareerTable } from "@/components/players/career-table";

export async function generateStaticParams() {
  const idx = await readIndex();
  return idx.playerIds.map((id) => ({ id: String(id) }));
}

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
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
function strFromEnd(row: Array<string | number | null> | null, offset: number): string | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  return typeof v === "string" ? v : null;
}
function pctFromIdx(row: Array<string | number | null> | null, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function intFromIdx(row: Array<string | number | null> | null, idx: number): number | null {
  const n = pctFromIdx(row, idx);
  return n === null ? null : Math.trunc(n);
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bartId = Number(id);
  if (!Number.isFinite(bartId)) notFound();

  const player = await readPlayer(bartId);
  if (!player || player.seasons.length === 0) notFound();

  const current = player.seasons[0]!;
  const row = current.raw_row;
  const stats = {
    pts: fromEnd(row, 3),
    blk: fromEnd(row, 4),
    stl: fromEnd(row, 5),
    ast: fromEnd(row, 6),
    reb: fromEnd(row, 7),
    notes: strFromEnd(row, 2),
    fg3_pct: pctFromIdx(row, 21),
    fg2_pct: pctFromIdx(row, 18),
    ft_pct: pctFromIdx(row, 15),
    fg3_made: intFromIdx(row, 19),
    fg3_att: intFromIdx(row, 20),
    fg2_made: intFromIdx(row, 16),
    fg2_att: intFromIdx(row, 17),
    ft_made: intFromIdx(row, 13),
    ft_att: intFromIdx(row, 14),
    name: typeof row?.[0] === "string" ? row[0] : null,
    height: typeof row?.[26] === "string" ? row[26] : null,
    hometown: typeof row?.[33] === "string" ? row[33] : null,
  };

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-12">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-3">
            <span className="h-px w-8 bg-coral" />
            <span>Player · {seasonLabel(current.year)}</span>
          </div>
          <div className="flex flex-wrap items-end gap-6 lg:gap-10">
            <PlayerPhoto bartPlayerId={bartId} name={stats.name ?? `Player ${bartId}`} size={120} />
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-5xl md:text-6xl tracking-tight text-ink leading-none">
                {stats.name ?? `Player ${bartId}`}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-ink-soft">
                <Link href={`/teams/${teamSlug(current.team_name)}`} className="inline-flex items-center gap-2 hover:text-coral transition-colors">
                  <TeamLogo name={current.team_name} size={28} />
                  <span className="text-base">{current.team_name}</span>
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
            </div>
          </div>

          <div className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
            <StatTile label="PPG" value={fmtNum(stats.pts, 1)} sub={`${current.games ?? "?"} games`} />
            <StatTile label="RPG" value={fmtNum(stats.reb, 1)} />
            <StatTile label="APG" value={fmtNum(stats.ast, 1)} />
            <StatTile label="SPG" value={fmtNum(stats.stl, 1)} />
            <StatTile label="BPG" value={fmtNum(stats.blk, 1)} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card title="Shooting splits" subtitle={`${seasonLabel(current.year)} — ${current.games ?? "?"} games`}>
          <StatRow label="3-Point %"   value={fmtPct(stats.fg3_pct)} sub={`${stats.fg3_made ?? "—"}/${stats.fg3_att ?? "—"}`} />
          <StatRow label="2-Point %"   value={fmtPct(stats.fg2_pct)} sub={`${stats.fg2_made ?? "—"}/${stats.fg2_att ?? "—"}`} />
          <StatRow label="Free Throw %" value={fmtPct(stats.ft_pct)} sub={`${stats.ft_made ?? "—"}/${stats.ft_att ?? "—"}`} />
        </Card>
        <Card title="On the floor" subtitle="Advanced — coming soon">
          <p className="text-ink-muted text-sm">
            BPM, USG%, ORtg live in Bart&apos;s raw row; we&apos;ll promote them
            after verifying column positions against more known players.
          </p>
        </Card>
      </section>

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
    <div className="bg-card px-5 py-4">
      <div className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</div>
      <div className="font-display text-3xl text-ink tabular mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-xl text-ink">{title}</h3>
        {subtitle && <span className="text-xs text-ink-muted">{subtitle}</span>}
      </div>
      <div className="divide-y divide-hairline/60">{children}</div>
    </div>
  );
}
function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="text-ink-soft text-sm">
        {label}
        {sub && <span className="text-ink-muted text-xs ml-2 tabular">{sub}</span>}
      </span>
      <span className="font-medium text-ink tabular">{value}</span>
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
