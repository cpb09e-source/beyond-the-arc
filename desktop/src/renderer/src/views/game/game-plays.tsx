import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { periodLabel, type GameBundle, type Play } from "@/components/game/types";
import { filterPlays, groupPlaysByPeriod, playActor, type PlayKind, type PlaySide } from "@/lib/game-stats";
import { TeamLogo } from "~/ui/logo";
import { ProfileNote } from "~/ui/profile";
import { sideOf, type TeamNames } from "~/views/scoreboard/board-model";

/**
 * Play by play, by period, the filters pinned above the log.
 *
 * A HALF IS A SECTION whose heading stays in view while its plays scroll under
 * it, and folds away on a click, so "what happened in the second half" is one
 * gesture rather than a scroll hunt. The heading carries both crests over the
 * two score columns, which is how the numbers below it are read.
 *
 * THE SCORE SITS ON SCORING PLAYS ONLY, the side that scored in ink. A score on
 * every rebound and substitution is noise that hides the changes.
 */

/** "1st half", "2nd half", then "OT", "2OT": overtimes are not halves. */
const periodName = (p: number) => (p <= 2 ? `${periodLabel(p)} half` : periodLabel(p));

const ROW = "grid grid-cols-[22px_52px_minmax(0,1fr)_40px_40px] items-center gap-3";

export function GamePlays({ b, names }: { b: GameBundle; names: TeamNames | null }) {
  const [side, setSide] = useState<PlaySide>("all");
  const [kind, setKind] = useState<PlayKind>("all");
  const [shut, setShut] = useState<ReadonlySet<number>>(() => new Set());
  const rows = useMemo(() => filterPlays(b.plays, side, kind), [b.plays, side, kind]);
  const groups = useMemo(() => groupPlaysByPeriod(rows), [rows]);
  const away = b.game.away.team;
  const home = b.game.home.team;
  const awayLogo = sideOf(names, away).logoId;
  const homeLogo = sideOf(names, home).logoId;

  if (b.plays.length === 0) return <ProfileNote>No play by play was recorded for this game.</ProfileNote>;

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-6 flex h-[48px] items-center gap-3 border-b border-hairline bg-paper px-6">
        <Segmented
          label="Team"
          value={side}
          onChange={setSide}
          options={[
            ["all", "Both teams"],
            ["away", away],
            ["home", home],
          ]}
        />
        <Segmented
          label="Plays"
          value={kind}
          onChange={setKind}
          options={[
            ["all", "Everything"],
            ["scoring", "Scoring"],
            ["shots", "Shots"],
            ["turnovers", "Turnovers"],
          ]}
        />
        <span className="ml-auto shrink-0 text-[12px] text-ink-muted">
          {rows.length.toLocaleString()} {rows.length === 1 ? "play" : "plays"}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-[13px] text-ink-muted">No play matches those filters.</p>
      ) : (
        groups.map(([per, list]) => {
          const closed = shut.has(per);
          return (
            <section key={per}>
              <button
                type="button"
                aria-expanded={!closed}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  setShut((s) => {
                    const next = new Set(s);
                    if (next.has(per)) next.delete(per);
                    else next.add(per);
                    return next;
                  })
                }
                className={`${ROW} sticky top-[48px] z-10 -mx-6 w-[calc(100%+3rem)] border-b border-hairline bg-paper px-6 py-2 text-left`}
              >
                <ChevronDown size={14} strokeWidth={2} className={`justify-self-center text-ink-muted transition-transform ${closed ? "-rotate-90" : ""}`} />
                <span className="col-span-2 flex items-center gap-2 text-[12.5px] font-medium text-ink">
                  {periodName(per)}
                  <span className="font-normal text-ink-muted tabular">{list.length}</span>
                </span>
                <span className="flex justify-end" title={away}>
                  <TeamLogo id={awayLogo} name={away} size={16} />
                </span>
                <span className="flex justify-end" title={home}>
                  <TeamLogo id={homeLogo} name={home} size={16} />
                </span>
              </button>
              {!closed && (
                <ol>
                  {list.map((p) => (
                    <PlayRow key={p.i} p={p} home={home} away={away} names={names} />
                  ))}
                </ol>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function PlayRow({ p, home, away, names }: { p: Play; home: string; away: string; names: TeamNames | null }) {
  const team = playActor(p, home, away);
  return (
    <li className={`${ROW} border-b border-hairline/50 py-[7px] ${p.sc ? "bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]" : ""}`}>
      <span className="flex justify-center">{team && <TeamLogo id={sideOf(names, team).logoId} name={team} size={16} />}</span>
      <span className="text-[11.5px] text-ink-muted tabular">{p.clk}</span>
      <span className={`min-w-0 text-[12.5px] leading-snug ${p.sc ? "font-medium text-ink" : "text-ink-soft"}`}>{p.txt}</span>
      <span className={`text-right text-[12.5px] tabular ${p.sc ? (p.h ? "text-ink-soft" : "font-semibold text-ink") : "text-transparent"}`}>{p.sc ? p.as : "·"}</span>
      <span className={`text-right text-[12.5px] tabular ${p.sc ? (p.h ? "font-semibold text-ink" : "text-ink-soft") : "text-transparent"}`}>{p.sc ? p.hs : "·"}</span>
    </li>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex min-w-0 rounded-md border border-hairline bg-card p-0.5">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(k)}
          className={`h-[24px] max-w-[150px] truncate rounded-[5px] px-2 text-[12px] transition-colors ${
            value === k ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
