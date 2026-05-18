import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import type { CoachSeason } from "@/lib/coaches";

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
 * Career Chronicle — an annotated horizontal timeline. Each season becomes a
 * vertical "moment" on a thin baseline, with rich content stacked above and
 * below: school transition flags on top, year + record below, and a tournament
 * outcome chip at the bottom when applicable.
 *
 * Visually unlike a chart: it reads as a museum timeline / résumé annotation
 * rather than a data plot. School transitions and tournament moments stand
 * out as distinct interruptions in the baseline.
 *
 * Pure SSR — no client JS.
 */
export function CareerArcChart({ seasons }: { seasons: CoachSeason[] }) {
  const data = [...seasons]
    .filter((s) => s.wins !== null && s.losses !== null)
    .sort((a, b) => a.year - b.year); // oldest → newest, left → right

  if (data.length === 0) {
    return <p className="text-sm text-ink-muted">No completed seasons in the data window.</p>;
  }

  // Single-season careers get a "spotlight" treatment.
  if (data.length === 1) {
    const s = data[0]!;
    const games = (s.wins ?? 0) + (s.losses ?? 0);
    const pct = games > 0 ? (s.wins ?? 0) / games : 0;
    return (
      <div className="flex items-center gap-6 py-3">
        <div className="text-coral font-display text-7xl tabular leading-none">{(pct * 100).toFixed(1)}%</div>
        <div className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted font-medium">{seasonLabel(s.year)} · {s.team}</span>
          <span className="text-2xl tabular text-ink mt-1">{s.wins}–{s.losses}</span>
          {s.round && <span className="mt-2 text-sm text-coral">NCAA Tournament · #{s.seed} seed · {s.round}</span>}
          <span className="text-xs text-ink-muted mt-3 max-w-xs">One season in the data window — the chronicle will fill out as more seasons accumulate.</span>
        </div>
      </div>
    );
  }

  // Detect school transitions to mark with a flag on top.
  const schoolStart: Map<number, string> = new Map(); // index → team (first season at this team)
  for (let i = 0; i < data.length; i++) {
    if (i === 0 || data[i]!.team !== data[i - 1]!.team) {
      schoolStart.set(i, data[i]!.team);
    }
  }

  // Compute career best/worst to render as soft visual anchors.
  const eligible = data.filter((s) => (s.wins ?? 0) + (s.losses ?? 0) >= 10);
  const sortedByPct = [...eligible].sort((a, b) => {
    const ap = ((a.wins ?? 0)) / ((a.wins ?? 0) + (a.losses ?? 0));
    const bp = ((b.wins ?? 0)) / ((b.wins ?? 0) + (b.losses ?? 0));
    return bp - ap;
  });
  const peakYear = sortedByPct[0]?.year;
  const dipYear = sortedByPct[sortedByPct.length - 1]?.year;

  // Tournament round → short chip label and tone.
  function roundChip(s: CoachSeason): { label: string; tone: "champ" | "deep" | "mid" | "early" } | null {
    if (!s.round) {
      if (s.seed !== null) return { label: "tourney", tone: "early" };
      return null;
    }
    if (s.round === "Champion") return { label: "★ CHAMP", tone: "champ" };
    if (s.round === "Runner-up") return { label: "FINAL", tone: "deep" };
    if (s.round === "Final Four") return { label: "F4", tone: "deep" };
    if (s.round === "Elite Eight") return { label: "E8", tone: "mid" };
    if (s.round === "Sweet 16") return { label: "S16", tone: "mid" };
    if (s.round === "R32") return { label: "R32", tone: "early" };
    if (s.round === "R64") return { label: "R64", tone: "early" };
    return { label: s.round, tone: "early" };
  }

  return (
    <div className="w-full overflow-x-auto -mx-2 px-2 pb-1">
      <div
        className="relative flex items-stretch min-w-max"
        style={{ minHeight: "180px" }}
      >
        {data.map((s, i) => {
          const games = (s.wins ?? 0) + (s.losses ?? 0);
          const pct = games > 0 ? (s.wins ?? 0) / games : 0;
          const isPeak = s.year === peakYear;
          const isDip = s.year === dipYear && dipYear !== peakYear;
          const newSchool = schoolStart.has(i);
          const chip = roundChip(s);
          // Cell width: enough to hold record + chip without crowding.
          const cellWidthClass = "w-[88px]";
          return (
            <div
              key={`${s.year}-${i}`}
              className={`${cellWidthClass} flex-shrink-0 flex flex-col items-stretch relative group`}
            >
              {/* TOP slot: school transition flag */}
              <div className="h-9 flex flex-col items-center justify-end relative">
                {newSchool && (
                  <Link
                    href={`/teams/${teamSlug(s.team)}/`}
                    className="flex flex-col items-center gap-0.5 absolute left-0 right-0 -top-0 hover:text-coral transition-colors"
                    title={`Started at ${s.team}`}
                  >
                    <TeamLogo name={s.team} size={22} />
                    <span className="text-[0.55rem] uppercase tracking-widest text-ink-muted font-medium truncate max-w-[80px] text-center leading-tight">
                      {s.team.length > 10 ? s.team.slice(0, 10) + "…" : s.team}
                    </span>
                  </Link>
                )}
              </div>

              {/* MIDDLE slot: the timeline tick. Vertical line of varying intensity */}
              <div className="relative h-7 flex items-center">
                {/* Horizontal baseline crossing all cells */}
                {i < data.length - 1 && (
                  <div className="absolute top-1/2 left-1/2 right-0 h-px bg-hairline" />
                )}
                {i > 0 && (
                  <div className="absolute top-1/2 left-0 right-1/2 h-px bg-hairline" />
                )}
                {/* New-school separator: an upright dotted divider rising through the row */}
                {newSchool && i > 0 && (
                  <div
                    className="absolute top-[-36px] bottom-[-160px] left-0 w-px"
                    style={{ borderLeft: "1px dotted currentColor" }}
                  />
                )}
                {/* The tick / dot. Bigger and coral for peak. Hollow ring for tourney. */}
                <div className="relative mx-auto">
                  {chip && chip.tone === "champ" && (
                    <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 text-coral font-display text-[10px] whitespace-nowrap">★</span>
                  )}
                  <span
                    className={`block rounded-full transition-colors ${
                      s.seed !== null
                        ? "ring-2 ring-coral bg-coral"
                        : isPeak
                          ? "bg-coral"
                          : isDip
                            ? "bg-ink-muted/50"
                            : "bg-ink"
                    }`}
                    style={{
                      width: isPeak || s.seed !== null ? "12px" : "8px",
                      height: isPeak || s.seed !== null ? "12px" : "8px",
                    }}
                  />
                </div>
              </div>

              {/* BELOW: year + record stack */}
              <div className="text-center pt-2 px-0.5">
                <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium tabular">
                  {seasonLabel(s.year)}
                </div>
                <div className={`font-display text-lg tabular leading-none mt-1 ${isPeak ? "text-coral" : "text-ink"}`}>
                  {s.wins}-{s.losses}
                </div>
                <div className="text-[0.6rem] text-ink-muted tabular mt-0.5">
                  {(pct * 100).toFixed(0)}%
                </div>
                {/* Tournament chip — only on tourney years */}
                {chip && (
                  <div className="mt-2 flex justify-center">
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.55rem] tabular uppercase tracking-widest font-medium ${
                        chip.tone === "champ"
                          ? "bg-coral text-card"
                          : chip.tone === "deep"
                            ? "bg-coral/15 text-coral"
                            : chip.tone === "mid"
                              ? "border border-coral/40 text-coral"
                              : "border border-hairline text-ink-soft"
                      }`}
                    >
                      {s.seed !== null && <span className="font-display">{s.seed}</span>}
                      {chip.label !== "tourney" && <span>·</span>}
                      <span>{chip.label === "tourney" ? "?" : chip.label}</span>
                    </span>
                  </div>
                )}
                {/* Peak label */}
                {isPeak && !chip && (
                  <div className="mt-2 flex justify-center">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.55rem] tabular uppercase tracking-widest font-medium bg-coral/15 text-coral">
                      peak
                    </span>
                  </div>
                )}
              </div>

              {/* Native browser tooltip for fast hover-over context */}
              <span className="sr-only">
                {seasonLabel(s.year)} · {s.team} · {s.wins}-{s.losses} ({(pct * 100).toFixed(1)}%)
                {s.seed !== null && ` · NCAA #${s.seed} seed${s.round ? ` → ${s.round}` : ""}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 text-[11px] text-ink-muted border-t border-hairline pt-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-coral ring-2 ring-coral/40" />
          NCAA tournament year
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-coral" />
          Peak season
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-ink" />
          Regular season
        </span>
        <span className="ml-auto italic">Dotted lines mark school changes.</span>
      </div>
    </div>
  );
}
