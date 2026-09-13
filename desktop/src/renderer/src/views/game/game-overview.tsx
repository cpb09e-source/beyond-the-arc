import { ArrowUpDown, CircleDollarSign, Clock, Landmark, MapPin, Tv, Users, type LucideIcon } from "lucide-react";
import { shortDate, type GameBundle, type ScheduleRow } from "@/components/game/types";
import {
  fourFactors,
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
import { FACTOR_WIN_RATE, seasonLabel } from "@/lib/league-averages";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { SectionTitle } from "~/ui/profile";
import { gameRecord, hasPhoto, sideOf, type TeamNames } from "~/views/scoreboard/board-model";
import type { Links } from "./game-model";
import { NameLink, howOf, teamInk } from "./game-parts";

/**
 * Overview: who led the game, how the two teams compared, why it went the way
 * it did, how each arrived, and where both sit in their league.
 *
 * TWO COLUMNS WHEN THERE IS ROOM. The people and the verdict on the left
 * (leaders, the four factors, form), the numbers and the context on the right
 * (team stats, game info, standings). A narrow pane stacks them in that order.
 *
 * EVERY NAME GOES SOMEWHERE: a leader to his profile, a school to its page, a
 * game in a form strip to that game.
 */
export function GameOverview({
  b,
  hc,
  ac,
  names,
  links,
  onBox,
}: {
  b: GameBundle;
  hc: string;
  ac: string;
  names: TeamNames | null;
  links: Links;
  onBox: () => void;
}) {
  return (
    <div className="grid items-start gap-x-8 gap-y-7 @5xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-7">
        <Leaders b={b} hc={hc} ac={ac} names={names} links={links} onBox={onBox} />
        <FourFactorsCard b={b} hc={hc} ac={ac} names={names} />
        <ComingIn b={b} names={names} links={links} />
      </div>
      <div className="flex min-w-0 flex-col gap-7">
        <TeamStatsCard b={b} hc={hc} ac={ac} names={names} />
        <GameInfoCard b={b} />
        <StandingsCard b={b} hc={hc} ac={ac} names={names} links={links} />
      </div>
    </div>
  );
}

/* --------------------------------- leaders -------------------------------- */

function Leaders({ b, hc, ac, names, links, onBox }: { b: GameBundle; hc: string; ac: string; names: TeamNames | null; links: Links; onBox: () => void }) {
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
            <LeaderRow line={c.away} team={b.game.away.team} color={ac} names={names} links={links} />
            <LeaderRow line={c.home} team={b.game.home.team} color={hc} names={names} links={links} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The category leader carries a wash of his own team's color; a tie tints both. */
function LeaderRow({ line, team, color, names, links }: { line: LeaderLine | null; team: string; color: string; names: TeamNames | null; links: Links }) {
  if (!line) return null;
  const p = line.player;
  const who = links.player(p.name);
  return (
    <div
      className="flex h-[46px] items-center gap-3 px-3.5"
      style={line.won ? { background: `color-mix(in oklab, ${color} 10%, transparent)` } : undefined}
    >
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

function TeamStatsCard({ b, hc, ac, names }: { b: GameBundle; hc: string; ac: string; names: TeamNames | null }) {
  const rows = teamStatRows(b);
  if (!rows) return null;
  const away = b.game.away.team;
  const home = b.game.home.team;
  const pace = b.teamStats.pace;
  return (
    <section>
      <SectionTitle>Team stats</SectionTitle>
      <div className="rounded-lg border border-hairline bg-card px-3.5 pb-3 pt-3">
        <div className="mb-1 flex items-center justify-between gap-3 text-[12px] font-medium text-ink-soft">
          <span className="flex min-w-0 items-center gap-1.5">
            <TeamLogo id={sideOf(names, away).logoId} name={away} size={16} />
            <span className="truncate">{away}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{home}</span>
            <TeamLogo id={sideOf(names, home).logoId} name={home} size={16} />
          </span>
        </div>
        {rows.map((r) => (
          <StatLine key={r.label} r={r} hc={hc} ac={ac} />
        ))}
        {pace != null && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-hairline pt-2.5 text-[12px]">
            <SeasonPace value={b.teamStats.seasonPace?.away ?? null} game={pace} align="left" />
            <div className="text-center">
              <div className="text-[11px] text-ink-muted">Pace</div>
              <div className="text-[17px] font-semibold leading-tight text-ink tabular">{n1(pace)}</div>
            </div>
            <SeasonPace value={b.teamStats.seasonPace?.home ?? null} game={pace} align="right" />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One stat as a single track split at a moving seam, leaning toward the side
 * that did better (statSplit inverts the rows won by the smaller number). The
 * tick above the track is an even split.
 */
function StatLine({ r, hc, ac }: { r: StatRow; hc: string; ac: string }) {
  const { lead, awayShare } = statSplit(r);
  return (
    <div className="py-[6px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2 text-[12.5px]">
        <span className="min-w-0 truncate tabular">
          <span className={lead === "a" ? "font-semibold" : "text-ink-soft"} style={lead === "a" ? { color: teamInk(ac) } : undefined}>
            {n1(r.a)}
            {r.unit}
          </span>
          {r.aNote && <span className="ml-1.5 text-[11px] text-ink-muted">{r.aNote}</span>}
        </span>
        <span className="text-center text-[11.5px] text-ink-muted">{r.label}</span>
        <span className="min-w-0 truncate text-right tabular">
          {r.hNote && <span className="mr-1.5 text-[11px] text-ink-muted">{r.hNote}</span>}
          <span className={lead === "h" ? "font-semibold" : "text-ink-soft"} style={lead === "h" ? { color: teamInk(hc) } : undefined}>
            {n1(r.h)}
            {r.unit}
          </span>
        </span>
      </div>
      <div className="relative mt-1">
        <div className="flex h-[5px] overflow-hidden rounded-full">
          <span style={{ width: `${awayShare}%`, background: ac }} />
          <span className="flex-1" style={{ background: hc }} />
        </div>
        <span aria-hidden className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[var(--card)]" style={{ left: `${awayShare}%` }} />
        <span aria-hidden className="absolute -top-[3px] left-1/2 h-[3px] w-px -translate-x-1/2 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />
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
        <div className="text-[11px] text-ink-muted">
          {d > 0 ? "+" : ""}
          {n1(d)} in this game
        </div>
      )}
    </div>
  );
}

/* ------------------------------ four factors ------------------------------ */

const FACTOR_COLS = "grid-cols-[minmax(0,1fr)_78px_78px_46px]";

function FourFactorsCard({ b, hc, ac, names }: { b: GameBundle; hc: string; ac: string; names: TeamNames | null }) {
  const ff = fourFactors(b);
  if (!ff) return null;
  const away = b.game.away.team;
  const home = b.game.home.team;
  const awayLogo = sideOf(names, away).logoId;
  const homeLogo = sideOf(names, home).logoId;
  return (
    <section>
      <SectionTitle aside="This game">Four factors</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <div className={`grid ${FACTOR_COLS} h-[32px] items-center gap-2 border-b border-hairline px-3.5 text-[11px] text-ink-muted`}>
          <span />
          <span className="flex justify-end" title={away}>
            <TeamLogo id={awayLogo} name={away} size={16} />
          </span>
          <span className="flex justify-end" title={home}>
            <TeamLogo id={homeLogo} name={home} size={16} />
          </span>
          <span className="text-right">Took it</span>
        </div>
        {ff.factors.map((f) => {
          const show = (v: number) => (f.diff && v > 0 ? `+${n1(v)}` : `${n1(v)}${f.unit ?? ""}`);
          return (
            <div key={f.key} title={f.sub} className={`grid ${FACTOR_COLS} h-[36px] items-center gap-2 border-b border-hairline/70 px-3.5 text-[12.5px]`}>
              <span className="truncate text-ink-soft">{f.label}</span>
              <FactorValue text={show(f.a)} won={f.aWon} />
              <FactorValue text={show(f.h)} won={f.hWon} />
              <span className="flex justify-end gap-0.5">
                {f.aWon && <TeamLogo id={awayLogo} name={away} size={16} />}
                {f.hWon && <TeamLogo id={homeLogo} name={home} size={16} />}
                {!f.aWon && !f.hWon && <span className="text-ink-muted">–</span>}
              </span>
            </div>
          );
        })}
        <div className="flex items-start gap-2.5 px-3.5 py-3">
          {ff.name ? (
            <>
              <TeamLogo id={sideOf(names, ff.name).logoId} name={ff.name} size={24} />
              <div className="min-w-0 text-[12.5px] leading-snug">
                <p className="text-ink">
                  <span className="font-semibold" style={{ color: teamInk(ff.winner === "a" ? ac : hc) }}>
                    {ff.name}
                  </span>
                  {ff.level ? " took the four factors " : " won the four factors "}
                  <span className="font-semibold tabular">
                    {Math.max(ff.aWins, ff.hWins)}–{Math.min(ff.aWins, ff.hWins)}
                  </span>
                  {ff.won === true ? ", and the game." : ff.won === false ? ", and lost the game." : "."}
                </p>
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  {ff.level
                    ? `Level at ${ff.aWins} each; free throw rate broke it, ${n1(Math.max(ff.ftaA, ff.ftaH))}% to ${n1(Math.min(ff.ftaA, ff.ftaH))}%. `
                    : ""}
                  Teams that took all four won {n1(FACTOR_WIN_RATE.sweep)}% of the time in {seasonLabel(FACTOR_WIN_RATE.season)}.
                </p>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-muted">Dead even, free throw rate included.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function FactorValue({ text, won }: { text: string; won: boolean }) {
  return (
    <span className="flex justify-end">
      <span
        className={`rounded-[4px] px-1.5 py-px tabular ${
          won ? "bg-[color-mix(in_oklab,var(--good)_15%,transparent)] font-semibold text-good" : "text-ink-soft"
        }`}
      >
        {text}
      </span>
    </span>
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

function GameInfoCard({ b }: { b: GameBundle }) {
  const rows = gameInfoRows(b);
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionTitle>Game info</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-hairline bg-card p-3.5">
        {rows.map(({ label, value }) => {
          const Icon = INFO_ICONS[label];
          return (
            <div key={label} className="flex min-w-0 gap-2">
              <Icon size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-ink-muted" aria-hidden />
              <div className="min-w-0">
                <dt className="text-[11px] text-ink-muted">{label}</dt>
                <dd className="text-[12.5px] leading-snug text-ink-soft">{value}</dd>
              </div>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/* -------------------------------- standings ------------------------------- */

function StandingsCard({ b, hc, ac, names, links }: { b: GameBundle; hc: string; ac: string; names: TeamNames | null; links: Links }) {
  const confs = Object.keys(b.standings);
  if (confs.length === 0) return null;
  const g = b.game;
  const colorOf = (t: string) => (t === g.home.team ? hc : t === g.away.team ? ac : null);
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
                  const color = colorOf(r.team);
                  return (
                    <tr
                      key={r.team}
                      className="h-[30px] border-t border-hairline/60"
                      style={color ? { background: `color-mix(in oklab, ${color} 11%, transparent)` } : undefined}
                    >
                      <td className="pl-3.5 text-right text-ink-muted tabular">{i + 1}</td>
                      <td className="pl-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <TeamLogo id={sideOf(names, r.team).logoId} name={r.team} size={16} />
                          <NameLink text={r.team} open={links.team(r.team)} className={`truncate ${color ? "font-medium text-ink" : "text-ink-soft"}`} />
                        </span>
                      </td>
                      <td className={`text-right tabular ${color ? "font-medium text-ink" : "text-ink-soft"}`}>
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
