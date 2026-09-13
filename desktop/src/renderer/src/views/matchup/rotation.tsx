import { OUT_SHARE_WARN, fmt1, outShare, playerCost, type MatchupTeam, type Projection } from "@/lib/matchup";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import type { Side } from "./seam";

/**
 * Who's playing: each rotation, and a click to rule a player out.
 *
 * IN OR OUT, NO MINUTES EDITOR, because the model found that who is dressed
 * matters and a minutes-weighted roster rating adds nothing (lib/matchup.ts).
 *
 * WORTH IS PRINTED, where the site keeps it in a tooltip. It is marginal: the
 * cost curve is convex, so the fourth man ruled out costs more than the first,
 * and every other row's figure moves when one is toggled. A wide window can
 * show that happening.
 */
export function Rotation({
  p,
  onToggle,
  onOpenTeam,
}: {
  p: Projection;
  onToggle: (side: Side, i: number) => void;
  onOpenTeam: (team: MatchupTeam, newTab: boolean) => void;
}) {
  const { a, b } = p;
  const swing = p.parts.availability;
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 border-t border-hairline pt-1.5">
        <Roster team={a} out={p.outA} fill="var(--ma-fill)" onToggle={(i) => onToggle("a", i)} onOpenTeam={onOpenTeam} />
        <Roster team={b} out={p.outB} fill="var(--mb-fill)" onToggle={(i) => onToggle("b", i)} onOpenTeam={onOpenTeam} />
      </div>
      {swing !== 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-[12.5px] text-ink-soft">
            Absences move the line{" "}
            <span className="font-mono font-semibold text-ink tabular">{Math.abs(swing).toFixed(2)}</span> points toward{" "}
            <span className="font-medium" style={{ color: swing > 0 ? "var(--ma)" : "var(--mb)" }}>
              {swing > 0 ? a.b : b.b}
            </span>
            .
          </p>
          {/* Past about a quarter of a rotation the model is extrapolating: fewer
              than 1% of the games it was fitted on were missing that much. */}
          {(outShare(a, p.outA) > OUT_SHARE_WARN || outShare(b, p.outB) > OUT_SHARE_WARN) && (
            <p className="mt-1.5 max-w-[68ch] text-[12px] leading-relaxed text-ink-muted">
              That much of a rotation missing is beyond what the model was fitted on: fewer than 1% of games in the sample lost
              this many minutes. Treat the size of the swing as a rough guide, not a measurement.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const COLS = "grid-cols-[minmax(0,1fr)_38px_46px]";

function Roster({
  team,
  out,
  fill,
  onToggle,
  onOpenTeam,
}: {
  team: MatchupTeam;
  out: number[];
  fill: string;
  onToggle: (i: number) => void;
  onOpenTeam: (team: MatchupTeam, newTab: boolean) => void;
}) {
  return (
    <div className="min-w-0">
      <div className={`grid h-[32px] ${COLS} items-center gap-2 px-1.5 text-[11.5px] text-ink-muted`}>
        <button
          type="button"
          title={`Open ${team.b}  ·  Ctrl-click for a new tab`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onOpenTeam(team, e.ctrlKey || e.metaKey)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <TeamLogo id={logoIdOf(team.b)} name={team.b} size={16} />
          <span className="truncate text-[12.5px] font-medium text-ink hover:underline">{team.b}</span>
        </button>
        <span className="text-right" title="Minutes per game">
          MPG
        </span>
        <span className="text-right" title="Points of margin that ruling the player out costs, given who is already out">
          Worth
        </span>
      </div>
      {team.r.length === 0 ? (
        <p className="px-1.5 py-2 text-[12.5px] text-ink-muted">No rotation on record.</p>
      ) : (
        <ul>
          {team.r.map(([name, mpg], i) => {
            const isOut = out.includes(i);
            return (
              <li key={`${name}-${i}`}>
                <button
                  type="button"
                  aria-pressed={isOut}
                  title={isOut ? `${name} is ruled out. Click to restore.` : `Rule ${name} out`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onToggle(i)}
                  className={`grid h-[30px] w-full ${COLS} items-center gap-2 rounded-md px-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--row-hover)]`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`grid size-[14px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
                        isOut ? "border-ink-muted/50" : "border-transparent"
                      }`}
                      style={isOut ? undefined : { background: fill }}
                    >
                      {!isOut && <span className="block size-[5px] rounded-[1.5px] bg-card" />}
                    </span>
                    <span className={`truncate ${isOut ? "text-ink-muted line-through decoration-ink-muted/60" : "text-ink"}`}>
                      {name}
                    </span>
                    {i === team.best && (
                      <span className="shrink-0 rounded-[4px] bg-[var(--accent-wash)] px-1 py-px text-[10.5px] font-medium text-accent">
                        Best
                      </span>
                    )}
                  </span>
                  <span className="text-right font-mono text-[12px] text-ink-soft tabular">{fmt1(mpg)}</span>
                  {/* Most of a rotation costs almost nothing alone; "<0.1" says so where "−0.0" read as noise. */}
                  <span
                    className={`text-right font-mono text-[12px] tabular ${
                      isOut || playerCost(team, i, out) < 0.05 ? "text-ink-muted" : "text-ink-soft"
                    }`}
                  >
                    {isOut ? "out" : playerCost(team, i, out) < 0.05 ? "<0.1" : `−${fmt1(playerCost(team, i, out))}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
