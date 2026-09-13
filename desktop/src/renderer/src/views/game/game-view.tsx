import { GitCompareArrows } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isFinal, isLive, longDate, periodHeadings, periodLabel, tipLabel, type GameBundle, type GameSide } from "@/components/game/types";
import { gameEyebrow, gameNotStarted, gameStarted, recordsFromStandings } from "@/lib/game-stats";
import { lookupId } from "@/lib/player-photo-index";
import { sideColors } from "@/lib/side-colors";
import { RecordActions } from "~/objects/object-surfaces";
import { useCompare } from "~/shell/compare";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { LoadError, TableSkeleton } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { HeaderButton, ProfileNote, ProfileTabs } from "~/ui/profile";
import { hasPhoto, sideOf, useTeamNames, type TeamNames } from "~/views/scoreboard/board-model";
import { GameBox } from "./game-box";
import { NO_PHOTOS, useGame, usePhotoIndex, type GameRecord, type Links } from "./game-model";
import { GameOverview } from "./game-overview";
import { NameLink, RankChip } from "./game-parts";
import { GamePlays } from "./game-plays";

/**
 * One game, in full: the scoreline, then Overview, Box score and Play by play.
 *
 * THE SITE'S GAME PAGE, AS A RECORD. Every figure comes from the same bundle
 * through src/lib/game-stats.ts. What the app adds is where things lead: each
 * school opens its team page, each player his profile, each game in a form strip
 * that game, all in this tab or a new one (Ctrl) or beside it (Shift).
 *
 * THE SCORELINE STAYS PUT above the tabs, the one thing a reader came for. The
 * two totals meet in the middle, because the question is "by how much"; in a
 * narrow pane, where that cannot fit, each team gets a row instead.
 */

type TabKey = "overview" | "box" | "plays";

export function GameView({ record }: ViewProps) {
  const rec = record?.kind === "game" ? record : null;
  const season = rec?.season ?? 0;
  const id = rec?.id ?? 0;
  const [state, retry] = useGame(season, id);
  const namesState = useTeamNames();
  const names = namesState.status === "ready" ? namesState.value : null;
  const photosState = usePhotoIndex(season);
  const photos = photosState.status === "ready" ? photosState.value : NO_PHOTOS;
  const [tab, setTab] = useState<TabKey>("overview");
  const { openRecord } = useShell();
  const { add } = useCompare();

  const b = state.status === "ready" ? state.value : null;
  const colors = useMemo(() => (b ? sideColors(b.game.home.team, b.game.away.team) : null), [b]);

  const links = useMemo<Links>(
    () => ({
      team: (cbbd) => {
        const s = sideOf(names, cbbd);
        const ours = s.ours;
        if (!ours) return null;
        return (how) => openRecord({ kind: "team", name: ours, logoId: s.logoId }, { newTab: how.newTab, side: how.side, year: season });
      },
      player: (name) => {
        const bartId = lookupId(photos, name);
        if (bartId == null) return null;
        return {
          bartId,
          open: (how) => openRecord({ kind: "player", bartId, name, hasPhoto: hasPhoto(bartId) }, { newTab: how.newTab, side: how.side, year: season }),
        };
      },
      game: (r, how) => openRecord(r, { newTab: how.newTab, side: how.side, year: r.season }),
    }),
    [names, photos, openRecord, season],
  );

  const setStatus = useSetStatus();
  useEffect(() => {
    if (state.status === "loading") setStatus("Loading…");
    else if (state.status === "error") setStatus("Not loaded");
    else if (!b) setStatus("No box score");
    else setStatus(`${isFinal(b.game) ? "Final" : isLive(b.game) ? "Live" : "Scheduled"} · ${b.plays.length.toLocaleString()} plays`);
  }, [state.status, b, setStatus]);

  if (!rec) return <ProfileNote>This tab holds no game.</ProfileNote>;

  const notStarted = b ? gameNotStarted(b.game) : false;
  const awaySide = b ? sideOf(names, b.game.away.team) : null;
  const homeSide = b ? sideOf(names, b.game.home.team) : null;
  const bothOurs = !!awaySide?.ours && !!homeSide?.ours;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-6 pt-4">
        <div className="flex min-h-[26px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="truncate text-[12.5px] text-ink-muted">{b ? gameEyebrow(b.game) : `${seasonLabel(season)} season`}</p>
          <div className="flex items-center gap-2">
          {b && bothOurs && (
            <HeaderButton
              title="Add both teams to the compare tray"
              onClick={() => {
                add({ kind: "team", name: awaySide!.ours!, logoId: awaySide!.logoId, year: season });
                add({ kind: "team", name: homeSide!.ours!, logoId: homeSide!.logoId, year: season });
              }}
            >
              <GitCompareArrows size={14} strokeWidth={2} />
              Compare teams
            </HeaderButton>
          )}
          <RecordActions obj={rec} primary={["snapshot"]} />
          </div>
        </div>

        {b ? <Scoreline b={b} names={names} links={links} /> : <PendingScoreline rec={rec} />}
        {b && <LineScore b={b} names={names} />}

        {b && !notStarted && (
          <div className="mt-4">
            <ProfileTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "box", label: "Box score", count: b.players.away.length + b.players.home.length || null },
                { key: "plays", label: "Play by play", count: b.plays.length || null },
              ]}
            />
          </div>
        )}
      </div>

      {state.status === "error" ? (
        <LoadError year={season} reason={state.reason} message={state.message} what="The box score" onRetry={retry} />
      ) : state.status === "loading" ? (
        <div className="relative mt-4 min-h-0 flex-1 border-t border-hairline">
          <TableSkeleton rowHeight={38} label="Loading the box score" />
        </div>
      ) : !b ? (
        <ProfileNote>The archive holds no box score for this game.</ProfileNote>
      ) : notStarted ? (
        <ProfileNote>
          This game has not been played yet: {longDate(b.game.startDate)}
          {b.game.venue ? `, ${b.game.venue}` : ""}
          {b.game.tbd ? ", tip time to be announced" : ""}. The box score, four factors and play by play appear once it tips.
        </ProfileNote>
      ) : tab === "overview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 pt-5">
          <GameOverview b={b} hc={colors![0]} ac={colors![1]} names={names} links={links} onBox={() => setTab("box")} />
        </div>
      ) : tab === "box" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 pt-5">
          <GameBox b={b} hc={colors![0]} ac={colors![1]} names={names} links={links} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-12">
          <GamePlays b={b} names={names} />
        </div>
      )}
    </div>
  );
}

function Scoreline({ b, names, links }: { b: GameBundle; names: TeamNames | null; links: Links }) {
  const g = b.game;
  const final = isFinal(g);
  const started = gameStarted(g);
  const records = recordsFromStandings(b);
  const dimAway = final && g.away.winner === false;
  const dimHome = final && g.home.winner === false;

  return (
    <>
      <div className="mt-3 hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 @3xl:grid">
        <TeamBlock side={g.away} record={records.away} names={names} links={links} dim={dimAway} outer="left" />
        <div className="flex items-center gap-5">
          {started && <Total v={g.away.points} dim={dimAway} />}
          <Status b={b} />
          {started && <Total v={g.home.points} dim={dimHome} />}
        </div>
        <TeamBlock side={g.home} record={records.home} names={names} links={links} dim={dimHome} outer="right" at={!g.neutralSite} />
      </div>

      <div className="mt-3 grid gap-2 @3xl:hidden">
        {(
          [
            [g.away, records.away, dimAway, false],
            [g.home, records.home, dimHome, !g.neutralSite],
          ] as Array<[GameSide, string, boolean, boolean]>
        ).map(([side, record, dim, at]) => {
          const s = sideOf(names, side.team);
          return (
            <div key={side.team} className="flex min-w-0 items-center gap-3">
              <TeamLogo id={s.logoId} name={side.team} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {at && <span className="shrink-0 text-[13px] text-ink-muted">@</span>}
                  {side.rank != null && <RankChip n={side.rank} />}
                  <NameLink text={side.team} open={links.team(side.team)} className={`truncate text-[17px] font-semibold tracking-[-0.015em] ${dim ? "text-ink-muted" : "text-ink"}`} />
                </div>
                <div className="truncate text-[12px] text-ink-muted">{[record, side.conference].filter(Boolean).join(" · ")}</div>
              </div>
              {started && <span className={`text-[30px] font-semibold leading-none tracking-[-0.03em] tabular ${dim ? "text-ink-muted" : "text-ink"}`}>{side.points ?? "–"}</span>}
            </div>
          );
        })}
        <div className="flex justify-center">
          <Status b={b} />
        </div>
      </div>
    </>
  );
}

/** The crest outermost on both sides, the name nearest the number. */
function TeamBlock({
  side,
  record,
  names,
  links,
  dim,
  outer,
  at = false,
}: {
  side: GameSide;
  record: string;
  names: TeamNames | null;
  links: Links;
  dim: boolean;
  outer: "left" | "right";
  at?: boolean;
}) {
  const s = sideOf(names, side.team);
  const left = outer === "left";
  return (
    <div className={`flex min-w-0 items-center justify-end gap-3.5 ${left ? "" : "flex-row-reverse"}`}>
      <TeamLogo id={s.logoId} name={side.team} size={52} />
      <div className={`min-w-0 ${left ? "text-right" : "text-left"}`}>
        <div className={`flex min-w-0 items-center gap-1.5 ${left ? "justify-end" : ""}`}>
          {at && <span className="shrink-0 text-[14px] text-ink-muted">@</span>}
          {side.rank != null && <RankChip n={side.rank} />}
          <NameLink
            text={side.team}
            open={links.team(side.team)}
            className={`truncate text-[24px] font-semibold leading-tight tracking-[-0.02em] ${dim ? "text-ink-muted" : "text-ink"}`}
          />
        </div>
        <div className="mt-1 truncate text-[12.5px] text-ink-muted">{[record, side.conference].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

function Total({ v, dim }: { v: number | null; dim: boolean }) {
  return <span className={`text-[50px] font-semibold leading-none tracking-[-0.04em] tabular ${dim ? "text-ink-muted" : "text-ink"}`}>{v ?? "–"}</span>;
}

function Status({ b }: { b: GameBundle }) {
  const g = b.game;
  if (isLive(g)) {
    return (
      <div className="flex min-w-[68px] flex-col items-center gap-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-accent tabular">
          <span className="live-dot" aria-hidden />
          {g.clock ?? "Live"}
        </span>
        {g.period != null && <span className="text-[11.5px] text-ink-muted">{periodLabel(g.period)}</span>}
      </div>
    );
  }
  if (isFinal(g)) {
    const n = Math.max(g.home.periods.length, g.away.periods.length);
    return (
      <div className="min-w-[68px] text-center">
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Final</div>
        {n > 2 && <div className="mt-0.5 text-[11.5px] text-ink-muted">{n === 3 ? "Overtime" : `${n - 2} overtimes`}</div>}
      </div>
    );
  }
  return <div className="min-w-[68px] whitespace-nowrap text-center text-[17px] font-semibold text-ink">{g.tbd ? "Time TBD" : tipLabel(g.startDate)}</div>;
}

/** Halves and overtimes, centered under the scoreline. */
function LineScore({ b, names }: { b: GameBundle; names: TeamNames | null }) {
  const g = b.game;
  const n = Math.max(g.home.periods.length, g.away.periods.length);
  if (n === 0) return null;
  const final = isFinal(g);
  return (
    <div className="mt-3 flex justify-center">
      <table className="text-[12.5px] tabular">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
            <th className="pr-3" />
            {periodHeadings(n).map((h) => (
              <th key={h} className="w-9 pb-0.5 text-right font-medium">
                {h}
              </th>
            ))}
            <th className="w-10 pb-0.5 text-right font-medium">T</th>
          </tr>
        </thead>
        <tbody>
          {[g.away, g.home].map((s) => {
            const lost = final && s.winner === false;
            return (
              <tr key={s.team}>
                <td className="py-0.5 pr-3">
                  <span className="flex justify-center" title={s.team}>
                    <TeamLogo id={sideOf(names, s.team).logoId} name={s.team} size={18} />
                  </span>
                </td>
                {Array.from({ length: n }, (_, i) => (
                  <td key={i} className={`text-right ${lost ? "text-ink-muted" : "text-ink-soft"}`}>
                    {s.periods[i] ?? "–"}
                  </td>
                ))}
                <td className={`text-right font-semibold ${lost ? "text-ink-muted" : "text-ink"}`}>{s.points ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the tab already knows about the game, while its box score is on the way. */
function PendingScoreline({ rec }: { rec: GameRecord }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-6">
      <span className="flex min-w-0 items-center gap-3">
        <TeamLogo id={rec.awayLogo} name={rec.away} size={44} />
        <span className="truncate text-[20px] font-semibold text-ink">{rec.away}</span>
      </span>
      <span className="text-[13px] text-ink-muted">{rec.name.includes(" vs ") ? "vs" : "at"}</span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[20px] font-semibold text-ink">{rec.home}</span>
        <TeamLogo id={rec.homeLogo} name={rec.home} size={44} />
      </span>
    </div>
  );
}
