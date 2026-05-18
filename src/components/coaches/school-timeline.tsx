import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import type { CoachSchoolStint } from "@/lib/coaches";

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * Horizontal tenure ribbon. Each school becomes a coral segment sized by the
 * number of seasons coached. Adjacent schools share a thin hairline divider.
 * Below the ribbon, a vertical list shows logo + name + years for each stint —
 * the ribbon gives shape, the list gives detail.
 */
export function SchoolTimeline({ schools }: { schools: CoachSchoolStint[] }) {
  if (schools.length === 0) return <p className="text-sm text-ink-muted">No tenures in the data window.</p>;
  const totalSeasons = schools.reduce((s, x) => s + x.seasons, 0);

  // Sort earliest first for the ribbon (left = oldest stint).
  const ribbonOrder = [...schools].sort((a, b) => a.first_year - b.first_year);

  return (
    <div>
      {/* Ribbon */}
      <div className="flex h-3 rounded-full overflow-hidden border border-hairline">
        {ribbonOrder.map((s, i) => {
          const pct = (s.seasons / totalSeasons) * 100;
          const winPct = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0;
          const opacity = 0.55 + 0.45 * Math.min(1, Math.max(0, winPct));
          return (
            <div
              key={`${s.team}-${i}`}
              style={{ width: `${pct}%`, opacity }}
              className="bg-coral"
              title={`${s.team} — ${seasonLabel(s.first_year)} to ${seasonLabel(s.last_year)} · ${s.wins}-${s.losses}`}
            />
          );
        })}
      </div>
      {/* Year endpoints */}
      <div className="flex justify-between text-[0.65rem] text-ink-muted tabular mt-1.5">
        <span>{seasonLabel(ribbonOrder[0]!.first_year)}</span>
        <span>{seasonLabel(ribbonOrder[ribbonOrder.length - 1]!.last_year)}</span>
      </div>

      {/* Detail list */}
      <ul className="mt-5 space-y-3">
        {schools.map((s) => {
          const pct = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : null;
          return (
            <li key={s.team}>
              <Link href={`/teams/${teamSlug(s.team)}/`} className="flex items-center gap-3 group">
                <TeamLogo name={s.team} size={32} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-ink group-hover:text-coral transition-colors truncate">{s.team}</span>
                  <span className="block text-[0.65rem] text-ink-muted tabular">
                    {seasonLabel(s.first_year)}{s.first_year !== s.last_year && ` – ${seasonLabel(s.last_year)}`} · {s.seasons} {s.seasons === 1 ? "season" : "seasons"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm tabular text-ink">{s.wins}-{s.losses}</span>
                  {pct !== null && <span className="block text-[0.65rem] text-ink-muted tabular">{(pct * 100).toFixed(1)}%</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
