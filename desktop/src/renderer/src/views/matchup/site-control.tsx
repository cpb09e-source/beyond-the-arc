import type { MatchupTeam, Site } from "@/lib/matchup";
import { teamShortName } from "@/lib/team-names";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";

/**
 * Where the game is played: one control, three states, each named for the
 * building rather than for a side. "At Michigan" cannot be misread the way
 * "home" can once the teams have been swapped.
 *
 * It is a headline control rather than a checkbox because it is worth up to
 * ~4.9 points, more than every style term together.
 */
export function SiteControl({
  site,
  a,
  b,
  onSite,
}: {
  site: Site;
  a: MatchupTeam;
  b: MatchupTeam;
  onSite: (s: Site) => void;
}) {
  const opts: Array<[Site, string, MatchupTeam | null]> = [
    ["home", `At ${teamShortName(a.b)}`, a],
    ["neutral", "Neutral", null],
    ["away", `At ${teamShortName(b.b)}`, b],
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Floor"
      title="Where the game is played  ·  F"
      className="inline-flex h-[26px] items-center gap-0.5 rounded-md border border-hairline bg-card p-[2px]"
    >
      {opts.map(([s, label, team]) => {
        const on = site === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSite(s)}
            className={`inline-flex h-full max-w-[150px] items-center gap-1.5 rounded-[4px] px-2 text-[12.5px] transition-colors ${
              on ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            {team && <TeamLogo id={logoIdOf(team.b)} name={team.b} size={14} />}
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
