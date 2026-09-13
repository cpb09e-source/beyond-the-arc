import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { TEAM_GAME_SEASONS } from "@/lib/team-game-index";
import type { TeamGame } from "~/data/team-game-model";
import type { Team } from "~/data/team-model";
import { explain, sideOf, type Explanation, type Measure } from "~/explain/explain-model";
import { differenceQuery, parseDifferenceQuery, type DifferenceWindow, type TeamRef } from "~/explain/explain-query";
import { Ledger, PART_TEXT, signedText } from "~/explain/ledger";
import { TeamChooser } from "~/explain/team-chooser";
import { seasonProblem, useTeamSeasonGames, type TeamSeasonGames } from "~/explain/use-team-games";
import { useIsActive } from "~/shell/active";
import { Picker, type PickerOption } from "~/shell/picker";
import { useTabTitle } from "~/shell/tab-title";
import { ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { num1, seasonLabel, signed1 } from "~/ui/format";

/**
 * The Difference Explainer: not how two teams differ, which Compare shows, but
 * why. Duke's net rating is 19.0 better than Auburn's; this page says how much
 * of that is shooting, turnovers, offensive rebounds, free throws and the
 * schedule, at each end of the floor, in parts that add up to the 19.0.
 *
 * EVERY PART OPENS INTO ITS NUMBERS, and every number into its games through
 * the Stat Lens, so a gap can be followed all the way down to the nights that
 * made it.
 *
 * THE MATH IS ~/explain/explain-model.ts, shared with What Changed. The page
 * only chooses the two sets of games.
 */

const WINDOWS: PickerOption[] = [
  { key: "season", label: "Full season", desc: "Every game, against the published adjusted ratings" },
  { key: "conf", label: "Conference games", desc: "Raw ratings from conference play" },
  { key: "nonconf", label: "Non-conference", desc: "Raw ratings from games outside the conference" },
  { key: "last10", label: "Last 10 games", desc: "Raw ratings from each team's ten most recent games" },
];

const MEASURES: PickerOption[] = [
  { key: "net", label: "Net rating", desc: "Offense and defense together" },
  { key: "offense", label: "Offense", desc: "Points scored per 100 possessions" },
  { key: "defense", label: "Defense", desc: "Points allowed per 100 possessions" },
];

const WINDOW_PHRASE: Record<DifferenceWindow, string> = {
  season: "",
  conf: " in conference games",
  nonconf: " outside conference play",
  last10: " over each team's last 10 games",
};

const pickGames = (games: TeamGame[], w: DifferenceWindow): TeamGame[] =>
  w === "conf" ? games.filter((g) => g.conference) : w === "nonconf" ? games.filter((g) => !g.conference) : w === "last10" ? games.slice(-10) : games;

/** TEAM_GAME_SEASONS runs newest first: the season a step older or newer that has a game log. */
const stepSeason = (year: number, dir: -1 | 1): number | null => {
  const at = TEAM_GAME_SEASONS.indexOf(year);
  return at < 0 ? null : (TEAM_GAME_SEASONS[at - dir] ?? null);
};

const adjustedOf = (t: Team) => ({ o: t.adjO, d: t.adjD, net: t.adjNet });

export function DifferenceView({ year, query, setQuery }: ViewProps) {
  const { a, b, w, m } = useMemo(() => parseDifferenceQuery(query), [query]);
  const active = useIsActive();
  const write = (next: Partial<{ a: TeamRef | null; b: TeamRef | null; w: DifferenceWindow; m: Measure }>) => {
    const s = { a, b, w, m, ...next };
    setQuery(differenceQuery(s.a, s.b, s.w, s.m));
  };

  const A = useTeamSeasonGames(a?.year ?? year, a?.name ?? null);
  const B = useTeamSeasonGames(b?.year ?? a?.year ?? year, b?.name ?? null);
  const sameSeason = !a || !b || a.year === b.year;
  const labelOf = (r: TeamRef) => (sameSeason ? r.name : `${r.name} ${seasonLabel(r.year)}`);
  useTabTitle(a && b ? `${labelOf(a)} vs ${labelOf(b)}` : a ? `${a.name} vs …` : null);

  const xGames = useMemo(() => pickGames(A.games, w), [A.games, w]);
  const yGames = useMemo(() => pickGames(B.games, w), [B.games, w]);
  const result = useMemo(() => {
    if (!A.team || !B.team || xGames.length < 3 || yGames.length < 3) return null;
    const x = sideOf(xGames, w === "season" ? adjustedOf(A.team) : null);
    const y = sideOf(yGames, w === "season" ? adjustedOf(B.team) : null);
    const e = explain(x, y, m);
    return e ? { e, x, y } : null;
  }, [A.team, B.team, xGames, yGames, w, m]);

  const problem = ((): string | null => {
    if (!a || !b) return null;
    if (a.year === b.year && a.name === b.name) return "Pick two different teams, or one team in two seasons.";
    for (const [r, s] of [[a, A], [b, B]] as Array<[TeamRef, TeamSeasonGames]>) {
      const p = seasonProblem(s, seasonLabel(r.year));
      if (p) return p;
      if (s.ready && !s.team) return `${r.name} is not a Division I team in ${seasonLabel(r.year)}.`;
    }
    if (A.ready && B.ready) {
      for (const [r, games] of [[a, xGames], [b, yGames]] as Array<[TeamRef, TeamGame[]]>) {
        if (games.length < 3) return `${r.name} has ${games.length === 0 ? "no" : `only ${games.length}`} ${w === "conf" ? "conference " : w === "nonconf" ? "non-conference " : ""}games in the ${seasonLabel(r.year)} log.`;
      }
    }
    return null;
  })();

  const loading = !!a && !!b && !problem && !result;

  return (
    <>
      <ViewHeader
        kicker="Tools"
        title="Difference Explainer"
        year={year}
        season={false}
        controls={
          <>
            <Picker label="Games" value={w} options={WINDOWS} onChange={(k) => write({ w: k as DifferenceWindow })} />
            <Picker label="Rating" value={m} options={MEASURES} onChange={(k) => write({ m: k as Measure })} />
          </>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-auto border-t border-hairline">
        <div className="mx-auto max-w-[980px] px-6 pb-24 pt-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-4">
            <SideCard
              label="First team"
              r={a}
              fallbackYear={year}
              data={A}
              figure={result ? { value: result.e.x, adjusted: result.e.adjusted } : null}
              measure={m}
              w={w}
              startOpen={active && !a}
              onPick={(name) => write({ a: { year: a?.year ?? b?.year ?? year, name } })}
              onYear={(y) => a && write({ a: { ...a, year: y } })}
            />
            <button
              type="button"
              aria-label="Swap the two teams"
              title="Swap the two teams"
              disabled={!a || !b}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => write({ a: b, b: a })}
              className="mt-1.5 grid size-[30px] place-items-center rounded-md border border-hairline bg-card text-ink-muted transition-colors enabled:hover:border-ink-muted enabled:hover:text-ink disabled:opacity-40"
            >
              <ArrowLeftRight size={14} strokeWidth={2} />
            </button>
            <SideCard
              label="Second team"
              r={b}
              fallbackYear={a?.year ?? year}
              data={B}
              figure={result ? { value: result.e.y, adjusted: result.e.adjusted } : null}
              measure={m}
              w={w}
              startOpen={active && !!a && !b}
              onPick={(name) => write({ b: { year: b?.year ?? a?.year ?? year, name } })}
              onYear={(y) => b && write({ b: { ...b, year: y } })}
            />
          </div>

          {(!a || !b) && (
            <div className="mt-10 max-w-[62ch] space-y-2 text-[13px] leading-relaxed text-ink-muted">
              <p className="text-[14px] font-medium text-ink">Two teams, and why their ratings differ, part by part.</p>
              <p>
                Choose both teams above. It also opens from Explain on two selected teams, a team&rsquo;s right-click menu, Compare, or typing &ldquo;Duke vs
                Auburn&rdquo; into Ctrl K.
              </p>
            </div>
          )}

          {problem && <p className="mt-10 text-[13px] text-ink-muted">{problem}</p>}
          {loading && <p className="mt-10 text-[13px] text-ink-muted">Reading both game logs…</p>}

          {result && a && b && (
            <>
              <Headline e={result.e} x={labelOf(a)} y={labelOf(b)} w={w} />
              <div className="mt-6">
                <Ledger
                  e={result.e}
                  x={{ label: labelOf(a), team: { name: a.name, logoId: A.team?.logoId ?? null, year: a.year }, side: result.x }}
                  y={{ label: labelOf(b), team: { name: b.name, logoId: B.team?.logoId ?? null, year: b.year }, side: result.y }}
                  towardX={`${labelOf(a)} ahead`}
                  towardY={`${labelOf(b)} ahead`}
                  totalLabel="Gap"
                />
              </div>
              <p className="mt-5 max-w-[72ch] text-[12px] leading-relaxed text-ink-muted">
                Each part is what that difference is worth, averaged over every order the parts could be changed in, so the parts add up to the gap. Defense is
                rebuilt from what opponents made, missed and turned over. Open a part for its numbers; click a number for its games.
                {result.e.adjusted
                  ? " Schedule is the published adjusted rating against what the games show raw."
                  : " These ratings are raw: adjusted ratings exist only for whole seasons."}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SideCard({
  label,
  r,
  fallbackYear,
  data,
  figure,
  measure,
  w,
  startOpen,
  onPick,
  onYear,
}: {
  label: string;
  r: TeamRef | null;
  fallbackYear: number;
  data: TeamSeasonGames;
  figure: { value: number; adjusted: boolean } | null;
  measure: Measure;
  w: DifferenceWindow;
  startOpen: boolean;
  onPick: (name: string) => void;
  onYear: (year: number) => void;
}) {
  const year = r?.year ?? fallbackYear;
  const t = data.team;
  const older = stepSeason(year, -1);
  const newer = stepSeason(year, 1);
  const what = measure === "net" ? "net rating" : measure === "offense" ? "offensive rating" : "defensive rating";
  return (
    <div className="min-w-0">
      <TeamChooser year={year} name={r?.name ?? null} logoId={t?.logoId ?? null} label={label} onPick={onPick} startOpen={startOpen} />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
        <span className="inline-flex h-[24px] items-center rounded-md border border-hairline bg-card">
          <StepButton label="Older season" disabled={!r || older == null} onClick={() => older != null && onYear(older)}>
            <ChevronLeft size={13} strokeWidth={2} />
          </StepButton>
          <span className="px-1 text-[12px] font-medium text-ink tabular">{seasonLabel(year)}</span>
          <StepButton label="Newer season" disabled={!r || newer == null} onClick={() => newer != null && onYear(newer)}>
            <ChevronRight size={13} strokeWidth={2} />
          </StepButton>
        </span>
        {t && (
          <span className="truncate tabular">
            {t.wins}–{t.losses} · {t.confLabel}
            {t.btaRank != null ? ` · BTA #${t.btaRank}` : ""}
          </span>
        )}
      </div>
      {figure && (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink tabular">
            {measure === "net" ? signed1(figure.value) : num1(figure.value)}
          </span>
          <span className="text-[12px] text-ink-muted">
            {figure.adjusted ? "adjusted " : ""}
            {what}
            {w === "season" ? "" : WINDOW_PHRASE[w]}
          </span>
        </div>
      )}
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={onClick}
      className="grid h-full w-[22px] place-items-center text-ink-muted transition-colors enabled:hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Headline({ e, x, y, w }: { e: Explanation; x: string; y: string; w: DifferenceWindow }) {
  const size = Math.abs(e.gap).toFixed(1);
  const level = Number(size) === 0;
  const where = WINDOW_PHRASE[w];
  let sentence: string;
  if (e.measure === "net") {
    sentence = level
      ? `${x} and ${y} have the same ${e.adjusted ? "adjusted " : ""}net rating${where}.`
      : `${x}'s ${e.adjusted ? "adjusted " : ""}net rating is ${size} points per 100 possessions ${e.gap > 0 ? "better" : "worse"} than ${y}'s${where}.`;
  } else if (e.measure === "offense") {
    sentence = level
      ? `${x} and ${y} score at the same rate${where}.`
      : `${x}'s offense scores ${size} ${e.gap > 0 ? "more" : "fewer"} points per 100 possessions than ${y}'s${where}.`;
  } else {
    sentence = level
      ? `${x} and ${y} allow points at the same rate${where}.`
      : `${x}'s defense allows ${size} ${e.gap > 0 ? "fewer" : "more"} points per 100 possessions than ${y}'s${where}.`;
  }
  // The part that carries the most, named, when there is a gap to carry.
  const parts = [...e.parts.map((p) => ({ label: PART_TEXT[p.key].label, v: p.total })), ...(e.schedule != null ? [{ label: "The schedule", v: e.schedule }] : [])];
  const top = [...parts].sort((p, q) => Math.abs(q.v) - Math.abs(p.v))[0];
  return (
    <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hairline pt-5">
      <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink tabular">{signedText(e.gap)}</span>
      <div className="min-w-[260px] flex-1">
        <p className="max-w-[64ch] text-[15px] leading-snug text-ink [text-wrap:balance]">{sentence}</p>
        {!level && top && (
          <p className="mt-1 text-[12.5px] text-ink-muted">
            The biggest part is {top.label.toLowerCase()}, <span className="font-medium text-ink-soft tabular">{signedText(top.v)}</span>.
          </p>
        )}
      </div>
    </div>
  );
}
