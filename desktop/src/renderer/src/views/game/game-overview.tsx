import { ArrowUpDown, CircleDollarSign, Clock, Landmark, MapPin, Tv, Users, type LucideIcon } from "lucide-react";
import { isFinal, shortDate, type GameBundle, type GameSide, type ScheduleRow } from "@/components/game/types";
import {
  gameInfoRows,
  gameLeaders,
  h2hTally,
  n1,
  paceDelta,
  statSplit,
  teamStatRows,
  type GameInfoLabel,
  type LeaderLine,
  type StatRow,
} from "@/lib/game-stats";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { SectionTitle } from "~/ui/profile";
import { gameRecord, hasPhoto, sideOf, type TeamNames } from "~/views/scoreboard/board-model";
import type { Links } from "./game-model";
import { NameLink, howOf } from "./game-parts";

/**
 * Overview: who led the game, how each team arrived, where both sit in their
 * league, and the two teams' numbers side by side.
 *
 * TWO COLUMNS WHEN THERE IS ROOM. The team stats down the left, set large
 * enough to read at a glance; the people and the context on the right (leaders,
 * form, standings). A narrow pane stacks them in that order.
 *
 * ONE INK FOR BOTH TEAMS. Brand colors fought the theme (a pale gold vanished on
 * paper, a navy on the dark ground) and made two teams' bars compete, so
 * nothing here wears a school's color. Whoever won a row is the darker, heavier
 * side, and the team that won the game leads its header in full ink.
 *
 * EVERY NAME GOES SOMEWHERE: a leader to his profile, a school to its page, a
 * game in a form strip to that game.
 */
export function GameOverview({ b, names, links, onBox }: { b: GameBundle; names: TeamNames | null; links: Links; onBox: () => void }) {
  return (
    <div className="grid items-start gap-x-8 gap-y-7 @5xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-7">
        <TeamStatsCard b={b} names={names} />
      </div>
      <div className="flex min-w-0 flex-col gap-7">
        <Leaders b={b} names={names} links={links} onBox={onBox} />
        <ComingIn b={b} names={names} links={links} />
        <StandingsCard b={b} names={names} links={links} />
      </div>
    </div>
  );
}

/** A quiet wash for the side a row belongs to, the same in both themes. */
const WASH = "bg-[color-mix(in_oklab,var(--ink)_5%,transparent)]";

/* --------------------------------- leaders -------------------------------- */

function Leaders({ b, names, links, onBox }: { b: GameBundle; names: TeamNames | null; links: Links; onBox: () => void }) {
  const cats = gameLeaders(b);
  if (cats.every((c) => !c.away && !c.home)) return null;
  return (
    <section>
      <SectionTitle
        aside={
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onBox} className="text-accent hover:underline">
            Full box score
          </button>
        }
      >
        Game leaders
      </SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        {cats.map((c, i) => (
          <div key={c.label} className={i ? "border-t border-hairline" : ""}>
            <div className="px-3.5 pb-0.5 pt-2 text-[11px] font-medium text-ink-muted">{c.label}</div>
            <LeaderRow line={c.away} team={b.game.away.team} names={names} links={links} />
            <LeaderRow line={c.home} team={b.game.home.team} names={names} links={links} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The category leader sits on a light wash; a tie washes both. */
function LeaderRow({ line, team, names, links }: { line: LeaderLine | null; team: string; names: TeamNames | null; links: Links }) {
  if (!line) return null;
  const p = line.player;
  const who = links.player(p.name);
  return (
    <div className={`flex h-[46px] items-center gap-3 px-3.5 ${line.won ? WASH : ""}`}>
      <PlayerPhoto bartId={who?.bartId ?? null} hasPhoto={hasPhoto(who?.bartId ?? null)} name={p.name} size={30} />
      <TeamLogo id={sideOf(names, team).logoId} name={team} size={16} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <NameLink text={p.name} open={who?.open} className={`truncate text-[13px] ${line.won ? "font-medium text-ink" : "text-ink-soft"}`} />
          {p.position && <span className="shrink-0 text-[11px] text-ink-muted">{p.position}</span>}
        </div>
        {/* The feed leaves some counts empty; a dash reads better than the word "null". */}
        <div className="truncate text-[11.5px] text-ink-muted">{line.detail.replace(/\bnull\b/g, "–")}</div>
      </div>
      <span className={`shrink-0 text-[20px] font-semibold leading-none tabular ${line.won ? "text-ink" : "text-ink-muted"}`}>{line.value}</span>
    </div>
  );
}

/* ------------------------------- team stats ------------------------------- */

function TeamStatsCard({ b, names }: { b: GameBundle; names: TeamNames | null }) {
  const rows = teamStatRows(b);
  if (!rows) return null;
  const g = b.game;
  const final = isFinal(g);
  const pace = b.teamStats.pace;
  return (
    <section>
      <SectionTitle>Team stats</SectionTitle>
      <div className="rounded-lg border border-hairline bg-card px-4 pb-4 pt-3.5">
        <div className="mb-1 grid grid-cols-2 items-center gap-6 border-b border-hairline pb-3">
          <TeamHead side={g.away} names={names} lost={final && g.away.winner === false} />
          <TeamHead side={g.home} names={names} lost={final && g.home.winner === false} flip />
        </div>
        {rows.map((r) => (
          <StatLine key={r.label} r={r} />
        ))}
        {pace != null && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-hairline pt-3 text-[13px]">
            <SeasonPace value={b.teamStats.seasonPace?.away ?? null} game={pace} align="left" />
            <div className="text-center">
              <div className="text-[12px] text-ink-muted">Pace</div>
              <div className="text-[19px] font-semibold leading-tight text-ink tabular">{n1(pace)}</div>
            </div>
            <SeasonPace value={b.teamStats.seasonPace?.home ?? null} game={pace} align="right" />
          </div>
        )}
      </div>
    </section>
  );
}

/** Crest, name and total; the loser of a final steps back to muted ink. */
function TeamHead({ side, names, lost, flip = false }: { side: GameSide; names: TeamNames | null; lost: boolean; flip?: boolean }) {
  const s = sideOf(names, side.team);
  const tone = lost ? "text-ink-muted" : "font-semibold text-ink";
  return (
    <div className={`flex min-w-0 items-center gap-2 ${flip ? "flex-row-reverse" : ""}`}>
      <TeamLogo id={s.logoId} name={side.team} size={22} />
      <span className={`truncate text-[14px] ${tone}`}>{side.team}</span>
      {side.points != null && <span className={`${flip ? "mr-auto" : "ml-auto"} text-[19px] leading-none tabular ${tone}`}>{side.points}</span>}
    </div>
  );
}

const INK_WON = "color-mix(in oklab, var(--ink) 72%, var(--card))";
const INK_LOST = "color-mix(in oklab, var(--ink) 14%, var(--card))";
const INK_EVEN = "color-mix(in oklab, var(--ink) 32%, var(--card))";

/**
 * One stat as a single track split at a moving seam, leaning toward the side
 * that did better (statSplit inverts the rows won by the smaller number). The
 * side that took the row is the dark half and the heavy number; the tick above
 * the track is an even split.
 */
function StatLine({ r }: { r: StatRow }) {
  const { lead, awayShare } = statSplit(r);
  const tone = (side: "a" | "h") => (lead === side ? "font-semibold text-ink" : lead === null ? "text-ink-soft" : "text-ink-muted");
  const fill = (side: "a" | "h") => (lead === side ? INK_WON : lead === null ? INK_EVEN : INK_LOST);
  return (
    <div className="py-[12px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3">
        <span className="min-w-0 truncate tabular">
          <span className={`text-[16px] ${tone("a")}`}>
            {n1(r.a)}
            {r.unit}
          </span>
          {r.aNote && <span className="ml-2 text-[12px] text-ink-muted">{r.aNote}</span>}
        </span>
        <span className="text-center text-[13px] text-ink-soft">{r.label}</span>
        <span className="min-w-0 truncate text-right tabular">
          {r.hNote && <span className="mr-2 text-[12px] text-ink-muted">{r.hNote}</span>}
          <span className={`text-[16px] ${tone("h")}`}>
            {n1(r.h)}
            {r.unit}
          </span>
        </span>
      </div>
      <div className="relative mt-2">
        <div className="flex h-[9px] overflow-hidden rounded-full">
          <span style={{ width: `${awayShare}%`, background: fill("a") }} />
          <span className="flex-1" style={{ background: fill("h") }} />
        </div>
        <span aria-hidden className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-[var(--card)]" style={{ left: `${awayShare}%` }} />
        <span aria-hidden className="absolute -top-[4px] left-1/2 h-[4px] w-px -translate-x-1/2 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />
      </div>
    </div>
  );
}

function SeasonPace({ value, game, align }: { value: number | null; game: number; align: "left" | "right" }) {
  if (value == null) return <span />;
  const d = paceDelta(game, value);
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-ink-soft">
        <span className="tabular">{n1(value)}</span> <span className="text-ink-muted">season</span>
      </div>
      {d !== 0 && (
        <div className="text-[12px] text-ink-muted">
          {d > 0 ? "+" : ""}
          {n1(d)} in this game
        </div>
      )}
    </div>
  );
}

/* ------------------------------- coming in -------------------------------- */

/** Each team's last five, newest first, and their last meetings. Every cell opens its game. */
function ComingIn({ b, names, links }: { b: GameBundle; names: TeamNames | null; links: Links }) {
  const g = b.game;
  const tally = h2hTally(b);
  const rec = (rows: ScheduleRow[]) => {
    const w = rows.filter((r) => r.won).length;
    return rows.length ? `${w}–${rows.length - w} in the last ${rows.length}` : undefined;
  };
  /** A schedule row, from one team's side, as a game record. */
  const recordOf = (team: string, r: ScheduleRow) =>
    gameRecord(
      r.season,
      { id: r.id, neutralSite: r.neutral, away: { team: r.isHome ? r.opponent : team }, home: { team: r.isHome ? team : r.opponent } },
      names,
    );
  return (
    <section>
      <SectionTitle>Coming in</SectionTitle>
      <div className="grid gap-4 rounded-lg border border-hairline bg-card p-3.5">
        <Strip
          label={g.away.team}
          logo={sideOf(names, g.away.team).logoId}
          aside={rec(b.form.away)}
          cells={b.form.away.map((r) => ({ r, mark: r.opponent, open: (how) => links.game(recordOf(g.away.team, r), how) }))}
          names={names}
          empty="No completed games before this one."
        />
        <Strip
          label={g.home.team}
          logo={sideOf(names, g.home.team).logoId}
          aside={rec(b.form.home)}
          cells={b.form.home.map((r) => ({ r, mark: r.opponent, open: (how) => links.game(recordOf(g.home.team, r), how) }))}
          names={names}
          empty="No completed games before this one."
        />
        <Strip
          label="Head to head"
          aside={tally.note ?? undefined}
          cells={b.h2h.map((r, i) => ({ r, mark: tally.winners[i]!, open: (how) => links.game(recordOf(g.home.team, r), how) }))}
          names={names}
          neutral
          empty="First meeting in our records."
        />
      </div>
    </section>
  );
}

type Cell = { r: ScheduleRow; mark: string; open: (how: { newTab: boolean; side: boolean }) => void };

function Strip({
  label,
  logo,
  aside,
  cells,
  names,
  neutral = false,
  empty,
}: {
  label: string;
  logo?: number | null;
  aside?: string;
  cells: Cell[];
  names: TeamNames | null;
  neutral?: boolean;
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px]">
        {logo !== undefined && <TeamLogo id={logo} name={label} size={14} />}
        <span className="truncate text-ink-soft">{label}</span>
        {aside && <span className="ml-auto shrink-0 text-ink-muted">{aside}</span>}
      </div>
      {cells.length === 0 ? (
        <p className="text-[12px] text-ink-muted">{empty}</p>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {[...cells].reverse().map((c) => (
            <FormCell key={`${c.r.season}:${c.r.id}`} cell={c} names={names} neutral={neutral} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Washed green for a win, red for a loss; a head-to-head cell wears the winner's crest instead. */
function FormCell({ cell, names, neutral }: { cell: Cell; names: TeamNames | null; neutral: boolean }) {
  const { r, mark } = cell;
  const where = r.neutral ? "N" : r.isHome ? "vs" : "@";
  const tone =
    neutral || r.won === null
      ? "bg-[color-mix(in_oklab,var(--ink)_4%,var(--card))]"
      : r.won
        ? "bg-[color-mix(in_oklab,var(--good)_13%,var(--card))]"
        : "bg-[color-mix(in_oklab,var(--bad)_11%,var(--card))]";
  return (
    <button
      type="button"
      title={`${shortDate(r.date)} ${where} ${r.opponent}: ${r.won ? "W" : "L"} ${r.us}-${r.them}  ·  Ctrl-click for a new tab`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => cell.open(howOf(e))}
      className={`flex min-w-0 flex-col items-center gap-1 rounded-md px-1 pb-1.5 pt-1.5 outline-none ring-accent transition-[box-shadow] hover:shadow-[inset_0_0_0_1px_var(--hairline)] focus-visible:ring-2 ${tone}`}
    >
      {neutral ? (
        <span className="text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">Won</span>
      ) : (
        <span className={`text-[10px] font-semibold ${r.won ? "text-good" : r.won === false ? "text-bad" : "text-ink-muted"}`}>
          {r.won === null ? "–" : r.won ? "W" : "L"}
        </span>
      )}
      {/* A meeting with no recorded result names no winner, so it wears no crest. */}
      {mark ? (
        <TeamLogo id={sideOf(names, mark).logoId} name={mark} size={20} />
      ) : (
        <span aria-label="No result" className="grid size-[20px] place-items-center text-ink-muted">–</span>
      )}
      <span className="text-[11.5px] font-medium text-ink tabular">
        {r.us}–{r.them}
      </span>
      <span className="text-[10px] text-ink-muted">
        {where === "@" ? "@ " : ""}
        {shortDate(r.date)}
      </span>
    </button>
  );
}

/* -------------------------------- standings ------------------------------- */

function StandingsCard({ b, names, links }: { b: GameBundle; names: TeamNames | null; links: Links }) {
  const confs = Object.keys(b.standings);
  if (confs.length === 0) return null;
  const g = b.game;
  const playing = (t: string) => t === g.home.team || t === g.away.team;
  return (
    <section>
      <SectionTitle aside="Entering this game">{confs.length === 1 ? `${confs[0]} standings` : "Standings"}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        {confs.map((c, ci) => (
          <div key={c} className={ci ? "border-t border-hairline" : ""}>
            {confs.length > 1 && <div className="px-3.5 pb-1 pt-2.5 text-[12px] font-medium text-ink-soft">{c}</div>}
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="h-[28px] text-[11px] text-ink-muted">
                  <th className="w-9 pl-3.5 text-right font-normal">#</th>
                  <th className="pl-3 text-left font-normal">Team</th>
                  <th className="w-16 text-right font-normal">Conf</th>
                  <th className="w-16 pr-3.5 text-right font-normal">All</th>
                </tr>
              </thead>
              <tbody>
                {b.standings[c]!.map((r, i) => {
                  const here = playing(r.team);
                  return (
                    <tr key={r.team} className={`h-[30px] border-t border-hairline/60 ${here ? WASH : ""}`}>
                      <td className="pl-3.5 text-right text-ink-muted tabular">{i + 1}</td>
                      <td className="pl-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <TeamLogo id={sideOf(names, r.team).logoId} name={r.team} size={16} />
                          <NameLink text={r.team} open={links.team(r.team)} className={`truncate ${here ? "font-medium text-ink" : "text-ink-soft"}`} />
                        </span>
                      </td>
                      <td className={`text-right tabular ${here ? "font-medium text-ink" : "text-ink-soft"}`}>
                        {r.cw}–{r.cl}
                      </td>
                      <td className="pr-3.5 text-right text-ink-muted tabular">
                        {r.w}–{r.l}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- game info ------------------------------- */

const INFO_ICONS: Record<GameInfoLabel, LucideIcon> = {
  Arena: Landmark,
  Location: MapPin,
  "Tip-off": Clock,
  Attendance: Users,
  Television: Tv,
  Line: CircleDollarSign,
  Total: ArrowUpDown,
};

/** The Game info tab: where and when, who carried it, and the line. */
export function GameInfo({ b }: { b: GameBundle }) {
  const rows = gameInfoRows(b);
  if (rows.length === 0) return <p className="text-[13px] text-ink-muted">The feed has no details for this game.</p>;
  return (
    <dl className="grid max-w-[780px] gap-px overflow-hidden rounded-lg border border-hairline bg-hairline @2xl:grid-cols-2">
      {rows.map(({ label, value }, i) => {
        const Icon = INFO_ICONS[label];
        // An odd last cell spans the row, so no empty hairline square is left beside it.
        const wide = i === rows.length - 1 && rows.length % 2 === 1;
        return (
          <div key={label} className={`flex min-w-0 gap-3 bg-card px-4 py-3.5 ${wide ? "@2xl:col-span-2" : ""}`}>
            <Icon size={16} strokeWidth={1.75} className="mt-[2px] shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-muted">{label}</dt>
              <dd className="mt-0.5 text-[14px] leading-snug text-ink">{value}</dd>
            </div>
          </div>
        );
      })}
    </dl>
  );
}
