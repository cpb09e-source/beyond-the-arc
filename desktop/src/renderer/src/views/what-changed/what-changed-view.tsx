import { useMemo, type MouseEvent } from "react";
import { T, TEAM_GAME_SEASONS } from "@/lib/team-game-index";
import { logDate, useOpenGame } from "~/data/game-link";
import type { TeamGame } from "~/data/team-game-model";
import type { Team } from "~/data/team-model";
import { explain, gameShares, rawFigure, sideOf, type Explanation, type GameShare, type Measure } from "~/explain/explain-model";
import { changedQuery, parseChangedQuery, type ChangeWindow } from "~/explain/explain-query";
import { Ledger, signedText } from "~/explain/ledger";
import { TeamChooser } from "~/explain/team-chooser";
import { seasonProblem, useTeamSeasonGames } from "~/explain/use-team-games";
import { useIsActive } from "~/shell/active";
import { Picker, type PickerOption } from "~/shell/picker";
import { useTabTitle } from "~/shell/tab-title";
import { ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { num1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";

/**
 * What Changed: one team, two stretches of its games, and what moved between
 * them. Michigan's last ten against its first twenty-two, its conference play
 * against the games before it, this season against last.
 *
 * THE SAME ENGINE AS THE DIFFERENCE EXPLAINER (~/explain/explain-model.ts), with
 * the recent stretch as one side and the earlier one as the other, so the
 * parts add up to the change the same way.
 *
 * THEN THE GAMES THAT DID IT. Each game's share of the change is how far it
 * sat from the earlier figure, weighted by its possessions; the shares add up
 * to the change, so "the games most responsible" is arithmetic, not a guess.
 *
 * HONEST ABOUT THE SCHEDULE. Only whole seasons carry adjusted ratings. A
 * stretch of games is raw, so who they played sits right under the headline.
 */

const WINDOWS: PickerOption[] = [
  { key: "last10", label: "Last 10 games", desc: "The ten most recent games against every game before them" },
  { key: "last5", label: "Last 5 games", desc: "The five most recent games against every game before them" },
  { key: "jan", label: "Since January 1", desc: "The new year against November and December" },
  { key: "conf", label: "Conference play", desc: "Conference games against non-conference games" },
  { key: "season", label: "Against last season", desc: "This season against the one before, with adjusted ratings" },
];

const MEASURES: PickerOption[] = [
  { key: "net", label: "Net rating", desc: "Offense and defense together" },
  { key: "offense", label: "Offense", desc: "Points scored per 100 possessions" },
  { key: "defense", label: "Defense", desc: "Points allowed per 100 possessions" },
];

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Split = { after: TeamGame[]; before: TeamGame[]; afterLabel: string; beforeLabel: string; afterPhrase: string; beforePhrase: string };

function splitGames(w: ChangeWindow, games: TeamGame[], earlier: TeamGame[], year: number, epochMs: number): Split {
  if (w === "last10" || w === "last5") {
    const n = w === "last10" ? 10 : 5;
    const before = games.slice(0, -n);
    return { after: games.slice(-n), before, afterLabel: `Last ${n}`, beforeLabel: `First ${before.length}`, afterPhrase: `In its last ${n} games`, beforePhrase: `of its first ${before.length}` };
  }
  if (w === "jan") {
    const cut = (Date.UTC(year, 0, 1) - epochMs) / DAY_MS;
    return {
      after: games.filter((g) => g.row[T.d]! >= cut),
      before: games.filter((g) => g.row[T.d]! < cut),
      afterLabel: "Since Jan 1",
      beforeLabel: "Before",
      afterPhrase: "Since January 1",
      beforePhrase: "before the new year",
    };
  }
  if (w === "conf") {
    return {
      after: games.filter((g) => g.conference),
      before: games.filter((g) => !g.conference),
      afterLabel: "Conference",
      beforeLabel: "Non-conference",
      afterPhrase: "In conference play",
      beforePhrase: "outside the conference",
    };
  }
  return {
    after: games,
    before: earlier,
    afterLabel: seasonLabel(year),
    beforeLabel: seasonLabel(year - 1),
    afterPhrase: `In ${seasonLabel(year)}`,
    beforePhrase: `in ${seasonLabel(year - 1)}`,
  };
}

const adjustedOf = (t: Team) => ({ o: t.adjO, d: t.adjD, net: t.adjNet });

export function WhatChangedView({ year, setYear, query, setQuery }: ViewProps) {
  const { team: name, w, m } = useMemo(() => parseChangedQuery(query), [query]);
  const active = useIsActive();
  const write = (next: Partial<{ team: string | null; w: ChangeWindow; m: Measure }>) => {
    const s = { team: name, w, m, ...next };
    setQuery(changedQuery(s.team, s.w, s.m));
  };

  const cur = useTeamSeasonGames(year, name);
  // Last season loads only when asked for; otherwise these are this season's own cache keys.
  const earlierYear = w === "season" ? year - 1 : year;
  const prev = useTeamSeasonGames(earlierYear, w === "season" ? name : null);
  useTabTitle(name ? `${name}: what changed` : null);

  const epochMs = cur.log.status === "ready" ? cur.log.value.pack.epochMs : 0;
  const split = useMemo(
    () => (cur.ready && name ? splitGames(w, cur.games, w === "season" ? prev.games : [], year, epochMs) : null),
    [cur.ready, cur.games, prev.games, name, w, year, epochMs],
  );

  const result = useMemo(() => {
    if (!split || !cur.team || split.after.length < 3 || split.before.length < 3) return null;
    if (w === "season" && !prev.team) return null;
    const x = sideOf(split.after, w === "season" ? adjustedOf(cur.team) : null);
    const y = sideOf(split.before, w === "season" && prev.team ? adjustedOf(prev.team) : null);
    const e = explain(x, y, m);
    if (!e) return null;
    const base = rawFigure(y, m)!;
    const shares = gameShares(split.after, base, m);
    return { e, x, y, shares, rawChange: shares.reduce((n, s) => n + s.share, 0) };
  }, [split, cur.team, prev.team, w, m]);

  const problem = ((): string | null => {
    if (!name) return null;
    const p = seasonProblem(cur, seasonLabel(year)) ?? (w === "season" ? seasonProblem(prev, seasonLabel(year - 1)) : null);
    if (p) return p;
    if (cur.ready && !cur.team) return `${name} is not a Division I team in ${seasonLabel(year)}.`;
    if (w === "season" && !TEAM_GAME_SEASONS.includes(year - 1)) return `The game log starts in ${seasonLabel(year)}, so there is no season before it to compare.`;
    if (w === "season" && prev.ready && !prev.team) return `${name} was not a Division I team in ${seasonLabel(year - 1)}.`;
    if (split && (split.after.length < 3 || split.before.length < 3)) {
      return `${split.afterLabel} has ${split.after.length} ${split.after.length === 1 ? "game" : "games"} and ${split.beforeLabel.toLowerCase()} has ${split.before.length}: not enough on one side to say what changed.`;
    }
    return null;
  })();

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="What Changed"
        year={year}
        setYear={setYear}
        controls={
          <>
            <TeamChooser year={year} name={name} logoId={cur.team?.logoId ?? null} label="Team" size="small" onPick={(t) => write({ team: t })} />
            <Picker label="Compare" value={w} options={WINDOWS} onChange={(k) => write({ w: k as ChangeWindow })} />
            <Picker label="Rating" value={m} options={MEASURES} onChange={(k) => write({ m: k as Measure })} />
          </>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-auto border-t border-hairline">
        <div className="mx-auto max-w-[980px] px-6 pb-24 pt-6">
          {!name && (
            <div className="max-w-[62ch] space-y-3 pt-4 text-[13px] leading-relaxed text-ink-muted">
              <p className="text-[14px] font-medium text-ink">What moved a team&rsquo;s rating, and the games that moved it.</p>
              <TeamChooser year={year} name={null} logoId={null} label="Team" startOpen={active} onPick={(t) => write({ team: t })} />
              <p>It also opens from What changed on a team&rsquo;s page or its right-click menu.</p>
            </div>
          )}
          {problem && <p className="pt-4 text-[13px] text-ink-muted">{problem}</p>}
          {name && !problem && !result && <p className="pt-4 text-[13px] text-ink-muted">Reading {name}&rsquo;s games…</p>}

          {result && split && name && cur.team && (
            <>
              <Headline e={result.e} team={cur.team} split={split} rank={w === "season" ? { before: prev.team?.btaRank ?? null, after: cur.team.btaRank } : null} />
              <Played split={split} w={w} byNameAfter={cur.byName} byNameBefore={w === "season" ? prev.byName : cur.byName} teams={w === "season" ? { after: cur.team, before: prev.team } : null} />
              <div className="mt-7">
                <Ledger
                  e={result.e}
                  x={{ label: split.afterLabel, team: { name, logoId: cur.team.logoId, year }, side: result.x }}
                  y={{ label: split.beforeLabel, team: { name, logoId: (prev.team ?? cur.team).logoId, year: earlierYear }, side: result.y }}
                  towardX="Better"
                  towardY="Worse"
                  totalLabel="Change"
                />
              </div>
              <Responsible shares={result.shares} rawChange={result.rawChange} epochMs={epochMs} m={m} season={w === "season"} baselineLabel={split.beforeLabel} />
              <p className="mt-6 max-w-[72ch] text-[12px] leading-relaxed text-ink-muted">
                The parts add up to the change: each is what that difference is worth, averaged over every order the parts could be changed in.
                {result.e.adjusted
                  ? " The seasons are compared on adjusted ratings; each game's share is of the raw change, since a single game has no adjusted rating."
                  : " A stretch of games has no adjusted rating, so these are raw: a harder run of opponents can read as a drop. Who they played is above."}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Headline({ e, team, split, rank }: { e: Explanation; team: Team; split: Split; rank: { before: number | null; after: number | null } | null }) {
  const size = Math.abs(e.gap).toFixed(1);
  const level = Number(size) === 0;
  const fmt = (v: number) => (e.measure === "net" ? signed1(v) : num1(v));
  const adj = e.adjusted ? "adjusted " : "";
  const what = e.measure === "net" ? `${adj}net rating` : e.measure === "offense" ? `${adj}offensive rating` : `${adj}defensive rating`;
  const dir = e.measure === "defense" ? (e.gap > 0 ? "fewer allowed" : "more allowed") : e.gap > 0 ? "better" : "worse";
  const sentence = level
    ? `${split.afterPhrase}, ${team.name}'s ${what} is ${fmt(e.x)}, the same as ${split.beforePhrase}.`
    : `${split.afterPhrase}, ${team.name}'s ${what} is ${fmt(e.x)}: ${size} ${dir} than the ${fmt(e.y)} ${split.beforePhrase}.`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <TeamLogo id={team.logoId} name={team.name} size={44} />
      <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink tabular">{signedText(e.gap)}</span>
      <div className="min-w-[260px] flex-1">
        <p className="max-w-[64ch] text-[15px] leading-snug text-ink [text-wrap:balance]">{sentence}</p>
        {rank && rank.after != null && rank.before != null && (
          <p className="mt-1 text-[12.5px] text-ink-muted tabular">
            BTA rank #{rank.before} → #{rank.after}
          </p>
        )}
      </div>
    </div>
  );
}

const avgOpponentNet = (games: TeamGame[], byName: Map<string, Team>): number | null => {
  let n = 0;
  let total = 0;
  for (const g of games) {
    const v = byName.get(g.opp)?.adjNet;
    if (v == null) continue;
    total += v;
    n += 1;
  }
  return n > 0 ? total / n : null;
};

function Played({
  split,
  w,
  byNameAfter,
  byNameBefore,
  teams,
}: {
  split: Split;
  w: ChangeWindow;
  byNameAfter: Map<string, Team>;
  byNameBefore: Map<string, Team>;
  teams: { after: Team; before: Team | null } | null;
}) {
  const record = (gs: TeamGame[]) => `${gs.filter((g) => g.won).length}–${gs.filter((g) => !g.won).length}`;
  const venue = (gs: TeamGame[]) => {
    const n = (s: TeamGame["site"]) => gs.filter((g) => g.site === s).length;
    return `${n("home")} home · ${n("away")} away · ${n("neutral")} neutral`;
  };
  const rows: Array<{ label: string; after: string; before: string; title?: string }> = [
    { label: "Record", after: record(split.after), before: record(split.before) },
    {
      label: "Average opponent",
      title: "The opponents' adjusted net ratings, averaged over the games",
      after: signed1(avgOpponentNet(split.after, byNameAfter)),
      before: signed1(avgOpponentNet(split.before, byNameBefore)),
    },
    { label: "Where", after: venue(split.after), before: venue(split.before) },
  ];
  if (w === "season" && teams) rows.push({ label: "Strength of schedule", after: num1(teams.after.sos), before: num1(teams.before?.sos ?? null) });
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12.5px] tabular">
        <thead>
          <tr className="text-left text-[11px] text-ink-muted">
            <th className="w-[160px] pb-1 font-normal">Who they played</th>
            <th className="pb-1 font-medium text-ink-soft">{split.afterLabel}</th>
            <th className="pb-1 font-medium text-ink-soft">{split.beforeLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} title={r.title} className="h-[28px] border-t border-hairline/70">
              <td className="text-ink-muted">{r.label}</td>
              <td className="text-ink">{r.after}</td>
              <td className="text-ink-soft">{r.before}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Responsible({
  shares,
  rawChange,
  epochMs,
  m,
  season,
  baselineLabel,
}: {
  shares: GameShare[];
  rawChange: number;
  epochMs: number;
  m: Measure;
  season: boolean;
  baselineLabel: string;
}) {
  const openGame = useOpenGame();
  const up = rawChange >= 0;
  const sorted = [...shares].sort((a, b) => (up ? b.share - a.share : a.share - b.share));
  const drivers = sorted.filter((s) => (up ? s.share > 0 : s.share < 0)).slice(0, 5);
  const against = [...sorted].reverse().filter((s) => (up ? s.share < 0 : s.share > 0)).slice(0, 3);
  const open = (ev: MouseEvent, g: TeamGame) =>
    openGame({ date: logDate(epochMs, g.row[T.d]!), team: g.team, opp: g.opp }, { newTab: ev.ctrlKey || ev.metaKey, side: ev.shiftKey }, () => {});
  const valueWord = m === "net" ? "Net" : m === "offense" ? "ORtg" : "DRtg";
  return (
    <div className="mt-8 grid gap-x-8 gap-y-6 @3xl:grid-cols-2">
      {[
        { title: up ? "Games behind the rise" : "Games behind the drop", list: drivers },
        { title: "Games that went the other way", list: against },
      ].map(({ title, list }) => (
        <section key={title} className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[12px] font-medium text-ink-muted">{title}</h2>
            <span className="text-[11px] text-ink-muted">
              {valueWord} · share of {season ? "the raw " : ""}change
            </span>
          </div>
          {list.length === 0 ? (
            <p className="py-2 text-[12.5px] text-ink-muted">None.</p>
          ) : (
            <ul>
              {list.map(({ game: g, value, share }) => {
                const d = new Date(epochMs + g.row[T.d]! * DAY_MS);
                return (
                  <li key={g.idx}>
                    <button
                      type="button"
                      title={`Open the box score  ·  Ctrl-click for a new tab. Measured against ${baselineLabel}.`}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={(ev) => open(ev, g)}
                      className="-mx-2 grid h-[32px] w-[calc(100%+16px)] grid-cols-[44px_18px_16px_minmax(0,1fr)_70px_52px_52px] items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors hover:bg-[var(--row-hover)]"
                    >
                      <span className="text-ink-muted tabular">
                        {MONTHS[d.getUTCMonth()]} {d.getUTCDate()}
                      </span>
                      <span className="text-center text-ink-muted">{g.site === "home" ? "vs" : g.site === "away" ? "@" : "N"}</span>
                      <TeamLogo id={g.oppLogoId} name={g.opp} size={15} />
                      <span className="min-w-0 truncate text-ink-soft">{g.opp}</span>
                      <span className="text-ink-muted tabular">
                        {g.won ? "W" : "L"} {g.pts}–{g.pa}
                      </span>
                      <span className="text-right text-ink-soft tabular">{m === "net" ? signed1(value) : num1(value)}</span>
                      <span className="text-right font-semibold text-ink tabular">{signedText(share)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
