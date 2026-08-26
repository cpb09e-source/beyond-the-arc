"use client";

/**
 * The shared box-score modal.
 *
 * One implementation, used by every surface that shows a game: the Win
 * Calculator's results table, the team-page schedule ticker, and the coach
 * pages. It used to live inside calc-client.tsx, which meant the team and coach
 * surfaces had their own older, plainer box-score modals reading a different
 * file — three renderings of the same game that could disagree.
 *
 * DATA: two sidecars, both keyed off the game log's `game_id`
 * ("<cbbdGameId>-<cbbdTeamId>"):
 *   /data/game-box-by-year/<season>.json   team box, merged onto the GameLog
 *                                          by attachGameBox() before it gets here
 *   /data/game-players/<season>/<key>.json player box, fetched lazily and only
 *                                          when the Player Stats tab is opened
 *
 * The caller passes both perspectives of the game (`game` and `opp`) because
 * the logs store one row per team, and every two-sided comparison in here needs
 * the pair. `opp` is null for a non-D1 opponent, which has no row of its own.
 */

import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { loadGamesForYear, type GameLog } from "@/lib/game-filters";
import { attachGameBox, loadGameBox } from "@/lib/game-box";
import { dataUrl } from "@/lib/data-url";
import { getTeamColors, readableInk } from "@/lib/team-colors";
import { gameKey } from "@/lib/quad";

export type BoxPlayer = {
  id: number | null;
  name: string;
  pos: string | null;
  starter: boolean;
  min: number | null;
  pts: number | null;
  fgm: number | null; fga: number | null;
  fg3m: number | null; fg3a: number | null;
  ftm: number | null; fta: number | null;
  oreb: number | null; reb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null;
  usage: number | null; ts: number | null;
  ortg: number | null; drtg: number | null;
};
export type BoxTeam = { team: string; logName: string; players: BoxPlayer[] };
export type GamePlayersFile = { teams: BoxTeam[] };

/**
 * Fallback side colours, used when a team has no palette entry. Real team
 * colours come from getTeamColors() — the same source the team pages use — so
 * a Michigan/UCLA box reads maize vs blue rather than generic coral vs steel.
 */
const SIDE_A = "var(--coral)";
const SIDE_B = "#3e7cb1";

/**
 * Neutral second-side colours, spread around the hue wheel. Reached only when
 * NO combination of the two teams' own palettes is distinguishable, which is
 * now rare — see sideColors().
 */
const FALLBACK_HUES: string[] = ["#c8553d", "#2d8a8a", "#c98a2d", "#6b5ca5", "#4a7c59", SIDE_B];

/**
 * Two visually distinguishable colours for one matchup, keeping BOTH teams in
 * their own palette wherever that is possible.
 *
 * Blue-on-blue is the norm in this sport, not the exception: Duke/North
 * Carolina, Kansas/Kentucky, Michigan/UCLA and Gonzaga/Saint Mary's all
 * resolve to two blues. The old rule handed the second team a neutral fallback
 * hue as soon as the primaries clashed, which is why a Duke bar came out
 * brick-red — a colour Duke has never worn.
 *
 * Most of those clashes have a better answer inside the two palettes. Carolina
 * pairs a very dark navy primary with sky blue; against Duke's royal blue the
 * navy is unreadable but the sky blue is unmistakable, and both teams stay in
 * their own colours. So the pairs are tried in preference order — both
 * primaries, then one side's secondary, then the other's — and only a matchup
 * with no workable combination falls through to a neutral hue.
 */
export function sideColors(teamA: string, teamB: string): [string, string] {
  const a = getTeamColors(teamA);
  const b = getTeamColors(teamB);
  const aP = a?.primary, aS = a?.secondary;
  const bP = b?.primary, bS = b?.secondary;

  const pairs: Array<[string | undefined, string | undefined]> = [
    [aP, bP], [aP, bS], [aS, bP], [aS, bS],
  ];
  for (const [x, y] of pairs) {
    if (!usable(x) || !usable(y)) continue;
    if (!tooClose(x!, y!)) return [x!, y!];
  }

  // No combination of the two palettes works. Keep side A honest and walk the
  // neutral hues for side B rather than making both teams wrong.
  const ca = usable(aP) ? aP! : SIDE_A;
  const cb = FALLBACK_HUES.find((c) => !tooClose(ca, c)) ?? SIDE_B;
  return [ca, cb];
}

/**
 * Can this colour carry meaning on the page at all?
 *
 * Rejects the near-whites that half the palettes list as a secondary — white
 * on warm paper is not a colour, it is an absence — and anything with no hue
 * to speak of, which would read as a grey bar rather than as a team.
 */
function usable(hex: string | undefined): boolean {
  if (typeof hex !== "string" || hex.length === 0) return false;
  const c = hsl(hex);
  if (!c) return false;
  return c.l <= 0.82 && (c.s >= 0.12 || c.l <= 0.35);
}

/**
 * Are two colours too similar to tell apart across a chart?
 *
 * Compares HUE, not RGB distance. RGB distance passes pairs like Michigan navy
 * (#00274C) against a mid-blue: numerically far apart because one is much
 * darker, but both unmistakably "blue" once they're two bars in the same row.
 * Hue catches that; a low-saturation colour (near-black, near-white, grey) has
 * no meaningful hue, so those are compared on lightness instead.
 */
function hsl(h: string): { h: number; s: number; l: number } | null {
  const s = h.replace("#", "");
  if (s.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: ((hue * 60) + 360) % 360, s: sat, l };
}

function tooClose(x: string, y: string): boolean {
  const p = hsl(x), q = hsl(y);
  if (!p || !q) return false;
  const dl = Math.abs(p.l - q.l);
  // Either colour effectively greyscale → judge on lightness only.
  if (p.s < 0.15 || q.s < 0.15) return dl < 0.25;
  const dh = Math.min(Math.abs(p.h - q.h), 360 - Math.abs(p.h - q.h));
  // A big lightness gap separates two colours even at the same hue —
  // Carolina sky blue against Duke royal is four degrees apart and nobody has
  // ever confused them. Judging on hue alone was what pushed same-family
  // matchups onto fallback colours neither team wears.
  if (dl >= 0.24) return false;
  return dh < 45;
}

/**
 * Box score for one game — team comparison and both line-ups. Opened by
 * double-clicking a matching-games row or clicking its score.
 *
 * Team stats come from data already in the browser (the game's two log rows
 * plus the CBBD sidecar). PLAYER stats are ~260k rows per season, so they are
 * fetched per game from public/data/game-players/<season>/<gameKey>.json —
 * an R2-served directory (see src/lib/data-url.ts), lazily, only when the
 * Player Stats tab is first opened.
 */
export function GameBoxModal({
  game,
  opp,
  onClose,
}: {
  game: GameLog;
  /** The opponent's perspective row; null for non-D1 opponents (no row). */
  opp: GameLog | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"team" | "players">("team");
  const [players, setPlayers] = useState<GamePlayersFile | null>(null);
  const [playersErr, setPlayersErr] = useState(false);
  // A ref, not state, guards the one-shot fetch: setting a "loading" flag
  // synchronously inside the effect is the cascading-render pattern React
  // warns about. Loading is derived below instead.
  const fetchStarted = useRef(false);
  const playersLoading = !players && !playersErr;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch once, on first visit to the Player Stats tab. Staying on Team Stats
  // never touches the network.
  useEffect(() => {
    if (tab !== "players" || fetchStarted.current) return;
    fetchStarted.current = true;
    let cancelled = false;
    const key = gameKey(game.game_id);
    fetch(dataUrl(`/data/game-players/${game.year}/${key}.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: GamePlayersFile) => { if (!cancelled) setPlayers(j); })
      .catch(() => { if (!cancelled) setPlayersErr(true); });
    return () => { cancelled = true; };
  }, [tab, game.game_id, game.year]);

  const num = (r: GameLog | null, k: string): number | null => {
    const v = r?.[k];
    return typeof v === "number" ? v : null;
  };
  const str = (r: GameLog | null, k: string): string | null => {
    const v = r?.[k];
    return typeof v === "string" && v ? v : null;
  };

  const round = str(game, "round");
  const tourneyName = str(game, "tourney_name");
  const oppName = game.opp_team_market ?? "Non-D1 opponent";
  const [colorA, colorB] = sideColors(game.team_name, oppName);
  // The raw brand colour is right on paper and wrong on the dark theme: 225 of
  // 366 primaries fall under 3.0 contrast against the dark ground, so a team
  // like Vanderbilt (#261e25) renders its numbers and its bar in something all
  // but indistinguishable from the card behind them.
  //
  // Both variants ship as custom properties and globals.css picks per theme, so
  // nothing here has to know which theme is live — the alternative, reading the
  // theme in JS, would flash the wrong colour on first paint.
  //
  // Two ranges because the two uses differ. Text has to be READ, so it clamps
  // to the same 0.66-0.88 the team pages use. A bar only has to be SEEN against
  // the card, and pushing a fill that light washes the team out of it, so the
  // fill clamps lower and keeps more of the real colour.
  const sideVars = {
    ["--side-a" as string]: colorA,
    ["--side-b" as string]: colorB,
    ["--side-a-dark" as string]: readableInk(colorA, { min: 0.66, max: 0.88 }),
    ["--side-b-dark" as string]: readableInk(colorB, { min: 0.66, max: 0.88 }),
    ["--fill-a" as string]: colorA,
    ["--fill-b" as string]: colorB,
    ["--fill-a-dark" as string]: readableInk(colorA, { min: 0.46, max: 0.72 }),
    ["--fill-b-dark" as string]: readableInk(colorB, { min: 0.46, max: 0.72 }),
  } as React.CSSProperties;

  // Linescore. Built only when both halves are known for BOTH teams — showing
  // one team's halves next to the other's blanks would read as a scoring
  // failure rather than a data gap.
  const h1a = num(game, "h1_pts"), h2a = num(game, "h2_pts"), ota = num(game, "ot_pts");
  const h1b = num(opp, "h1_pts"), h2b = num(opp, "h2_pts"), otb = num(opp, "ot_pts");
  const hasOT = (ota ?? 0) > 0 || (otb ?? 0) > 0;
  const lineScore =
    h1a !== null && h2a !== null && h1b !== null && h2b !== null
      ? [
          {
            name: game.team_name, h1: h1a, h2: h2a, ot: ota,
            total: game.pts_scored, won: !!game.won,
            rank: num(game, "ap_rank"), seed: num(game, "seed"),
          },
          {
            name: oppName, h1: h1b, h2: h2b, ot: otb,
            total: game.pts_against, won: !game.won,
            rank: num(game, "opp_ap_rank"), seed: num(game, "opp_seed"),
          },
        ]
      : null;

  // Shooting splits, each rendered as a ring: made/attempted outside, the
  // percentage inside. Derived from made-attempted rather than a stored rate
  // so the ring and the fraction beside it can never disagree.
  const SHOOTING = [
    { label: "Field Goals", m: "fgm", a: "fga" },
    { label: "3 Pointers", m: "fg3m", a: "fg3a" },
    { label: "Free Throws", m: "ftm", a: "fta" },
  ];
  // Counting stats as split bars. `lower` marks where less is better, which
  // only affects which side is called out, never the bar geometry.
  /**
   * BTA's Four Factors — rebounding, three-point making, fast-break scoring
   * and turnovers. This is the site's own definition (see the explorer and
   * compare-teams headings), NOT the eFG%/TOV%/OREB%/FTr set. Shown here as
   * the single-game view of the same four things.
   */
  const FOUR_FACTORS: Array<{ label: string; key: string; lower?: boolean; untracked?: boolean }> = [
    { label: "Rebounds", key: "reb" },
    { label: "3-Pointers Made", key: "fg3m" },
    { label: "Fast Break Points", key: "fbpts", untracked: true },
    { label: "Turnovers", key: "tov", lower: true },
  ];
  const COUNTS: Array<{ label: string; key: string; lower?: boolean; untracked?: boolean }> = [
    { label: "Offensive Rebounds", key: "oreb" },
    { label: "Assists", key: "ast" },
    { label: "Steals", key: "stl" },
    { label: "Blocks", key: "blk" },
    { label: "Personal Fouls", key: "fouls", lower: true },
    { label: "Largest Lead", key: "largest_lead" },
    // Raw totals, not the differentials the game logs carry — a differential
    // can't be drawn as a two-sided comparison.
    { label: "Points Off Turnovers", key: "pot", untracked: true },
    { label: "Points In The Paint", key: "pitp", untracked: true },
  ];
  const RATINGS: Array<{ label: string; key: string; lower?: boolean }> = [
    { label: "Offensive Rating", key: "ortg" },
    { label: "Defensive Rating", key: "drtg", lower: true },
  ];

  /**
   * Should this row render?
   *
   * CBBD reports 0 rather than null for splits it didn't track, and the older
   * seasons are thin: only 39% of 2014 games carry fast-break points against
   * 98% from 2023 on. A rendered "0 – 0" would assert that neither team scored
   * a fast-break point all game, which is both untrue and unknowable — so for
   * those keys an all-zero pair is treated as absent.
   */
  const showRow = (key: string, a: number | null, b: number | null, untracked?: boolean) => {
    if (a === null && b === null) return false;
    if (untracked && !a && !b) return false;
    return true;
  };

  // Full-bleed on phones, matching coaches/boxscore-modal.tsx. A 16px inset
  // plus rounded corners spends screen on a strip of dimmed backdrop the reader
  // cannot use, and this is a dense table — it wants every pixel. The centred,
  // rounded card comes back at sm.
  return (
    <div className="game-sides fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4" style={sideVars}>
      <div className="bta-backdrop-in absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Box score: ${game.team_name} ${game.pts_scored ?? ""}, ${oppName} ${game.pts_against ?? ""}`}
        className="bta-modal-in relative w-full max-w-5xl h-dvh overflow-y-auto rounded-none border-0 bg-card shadow-xl sm:h-auto sm:max-h-[88vh] sm:rounded-xl sm:border sm:border-hairline"
      >
        {/* Header band — the score is the hero. Date/venue/round sit small in
            the top-left gutter rather than centred beneath it, where they
            competed with the scoreline for attention. */}
        <div className="relative bg-paper-deep/50 border-b border-hairline px-4 sm:px-6 pt-4 pb-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close box score"
            className="absolute right-3 top-3 w-7 h-7 inline-flex items-center justify-center rounded text-base leading-none text-ink-muted hover:text-coral hover:bg-card transition-colors"
          >
            ×
          </button>

          {/* PHONE: a scoreboard, one team per line, score hard right, winner
              in bold. Everything on one row could not be done without shrinking
              the score to 15px — smaller than the body text — which made the
              one thing this modal exists to show the least prominent thing in
              it. A full row per team also means long names never truncate, and
              it rhymes with the linescore table further down the same panel. */}
          <div className="sm:hidden pr-8">
            <div className="text-center mb-2">
              <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-semibold">
                {hasOT ? "Final / OT" : "Final"}
              </span>
            </div>
            <div className="flex items-center gap-2.5 py-1">
              <TeamLogo name={game.team_name} size={28} />
              <span className={`flex-1 min-w-0 truncate ${game.won ? "font-bold text-ink" : "text-ink-soft"}`}>
                {game.team_name}
              </span>
              {num(game, "ap_rank") !== null && <RankBadge rank={num(game, "ap_rank")!} />}
              {num(game, "seed") !== null && <SeedBadge seed={num(game, "seed")!} />}
              <span className={`font-display text-2xl tabular leading-none ${game.won ? "text-ink" : "text-ink-muted"}`}>
                {game.pts_scored ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-2.5 py-1 border-t border-hairline">
              <TeamLogo name={oppName} size={28} />
              <span className={`flex-1 min-w-0 truncate ${!game.won ? "font-bold text-ink" : "text-ink-soft"}`}>
                {game.is_neutral ? "" : game.is_home ? "" : "@ "}{oppName}
              </span>
              {num(game, "opp_ap_rank") !== null && <RankBadge rank={num(game, "opp_ap_rank")!} />}
              {num(game, "opp_seed") !== null && <SeedBadge seed={num(game, "opp_seed")!} />}
              <span className={`font-display text-2xl tabular leading-none ${!game.won ? "text-ink" : "text-ink-muted"}`}>
                {game.pts_against ?? "—"}
              </span>
            </div>
          </div>

          {/* sm+: unchanged — the broadcast-bug scoreline, which has the room. */}
          <div className="hidden sm:flex items-center justify-center gap-4 sm:gap-6 flex-wrap pr-8">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`truncate text-right ${game.won ? "font-semibold text-ink" : "text-ink-soft"}`}>
                {game.team_name}
              </span>
              {num(game, "ap_rank") !== null && <RankBadge rank={num(game, "ap_rank")!} />}
              {num(game, "seed") !== null && <SeedBadge seed={num(game, "seed")!} />}
              <TeamLogo name={game.team_name} size={44} />
            </div>

            {/* Scoreboard: score – FINAL – score, the way a broadcast bug
                reads. The half-by-half breakdown lives in the linescore in
                the panel below, not here. */}
            <div className="flex items-center gap-4 sm:gap-5 shrink-0">
              <span className={`font-display text-4xl sm:text-5xl tabular leading-none ${game.won ? "text-ink" : "text-ink-muted"}`}>
                {game.pts_scored ?? "—"}
              </span>
              <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted font-semibold whitespace-nowrap">
                {hasOT ? "Final / OT" : "Final"}
              </span>
              <span className={`font-display text-4xl sm:text-5xl tabular leading-none ${!game.won ? "text-ink" : "text-ink-muted"}`}>
                {game.pts_against ?? "—"}
              </span>
            </div>

            <div className="flex items-center gap-2.5 min-w-0">
              <TeamLogo name={oppName} size={44} />
              {num(game, "opp_seed") !== null && <SeedBadge seed={num(game, "opp_seed")!} />}
              {num(game, "opp_ap_rank") !== null && <RankBadge rank={num(game, "opp_ap_rank")!} />}
              <span className={`truncate ${!game.won ? "font-semibold text-ink" : "text-ink-soft"}`}>
                {/* "@" carries the venue the way a schedule line does. */}
                {game.is_neutral ? "" : game.is_home ? "" : "@ "}{oppName}
              </span>
            </div>
          </div>

        </div>

        {/* Tabs */}
        <div className="sticky top-0 z-10 bg-card border-b border-hairline flex">
          {(["team", "players"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t ? "border-coral text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t === "team" ? "Team Stats" : "Player Stats"}
            </button>
          ))}
        </div>

        {tab === "team" ? (
          <div className="p-4 sm:p-6">
            {opp ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Shooting — rings */}
                <div className="space-y-4">
                  {SHOOTING.map((row) => {
                    const am = num(game, row.m), aa = num(game, row.a);
                    const bm = num(opp, row.m), ba = num(opp, row.a);
                    if (am === null && bm === null) return null;
                    return (
                      <div key={row.label} className="flex items-center gap-3 py-1">
                        <span className="w-16 text-base tabular text-ink text-right shrink-0">
                          {am === null ? "—" : `${am}/${aa}`}
                        </span>
                        <PctRing made={am} att={aa} color="var(--side-a)" />
                        <span className="flex-1 text-center text-xs text-ink-muted px-1">{row.label}</span>
                        <PctRing made={bm} att={ba} color="var(--side-b)" />
                        <span className="w-16 text-base tabular text-ink shrink-0">
                          {bm === null ? "—" : `${bm}/${ba}`}
                        </span>
                      </div>
                    );
                  })}

                  {/* LINESCORE — fills the space the rings leave. Only drawn
                      when both halves are known for both teams; one team's
                      halves beside the other's blanks would read as a scoring
                      failure rather than a data gap. */}
                  {lineScore && (
                    <div className="pt-4 mt-2 border-t border-hairline">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-ink-muted">
                            <th />
                            <th className="w-9 pb-1 text-right text-xs font-medium">1</th>
                            <th className="w-9 pb-1 text-right text-xs font-medium">2</th>
                            {hasOT && <th className="w-9 pb-1 text-right text-xs font-medium">OT</th>}
                            <th className="w-9 pb-1 text-right text-xs font-semibold text-ink">T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineScore.map((r, i) => (
                            <tr key={i}>
                              <td className="py-1">
                                <span className="inline-flex items-center gap-2 min-w-0">
                                  <TeamLogo name={r.name} size={20} />
                                  {r.rank !== null && <RankBadge rank={r.rank} />}
                                  {r.seed !== null && <SeedBadge seed={r.seed} />}
                                  <span className={`truncate ${r.won ? "font-semibold text-ink" : "text-ink-soft"}`}>{r.name}</span>
                                </span>
                              </td>
                              <td className="py-1 text-right tabular text-ink-soft">{r.h1}</td>
                              <td className="py-1 text-right tabular text-ink-soft">{r.h2}</td>
                              {hasOT && <td className="py-1 text-right tabular text-ink-soft">{r.ot ?? "—"}</td>}
                              <td className={`py-1 text-right tabular font-semibold ${r.won ? "text-ink" : "text-ink-muted"}`}>
                                {r.total ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-2 -mx-1 px-2 py-1.5 rounded bg-paper-deep/60 text-xs text-ink-muted flex items-center gap-1.5 flex-wrap">
                        <span className="tabular">{fmtGameDate(game.game_date)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {game.is_neutral ? "Neutral site" : game.is_home ? `at ${game.team_name}` : `at ${oppName}`}
                        </span>
                        <span aria-hidden>·</span>
                        {round ? (
                          <span className="font-semibold text-coral">{tourneyName ? `${tourneyName} · ${round}` : round}</span>
                        ) : (
                          <span>{num(game, "conf_game") === 1 ? "Conference game" : "Non-conference"}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Ratings first, then BTA's Four Factors, then the rest. */}
                <div className="space-y-3">
                  {RATINGS.map((row) => {
                    const a = num(game, row.key);
                    const b = num(opp, row.key);
                    if (!showRow(row.key, a, b)) return null;
                    return <SplitBar key={row.label} label={row.label} a={a} b={b} lower={row.lower} colorA="var(--side-a)" colorB="var(--side-b)" />;
                  })}

                  <div className="pt-1 border-t border-hairline" />

                  <div className="text-[0.65rem] uppercase tracking-widest text-coral font-bold">
                    Four Factors
                  </div>
                  {FOUR_FACTORS.map((row) => {
                    const a = num(game, row.key);
                    const b = num(opp, row.key);
                    if (!showRow(row.key, a, b, row.untracked)) return null;
                    return <SplitBar key={row.label} label={row.label} a={a} b={b} lower={row.lower} major colorA="var(--side-a)" colorB="var(--side-b)" />;
                  })}

                  <div className="pt-1 border-t border-hairline" />

                  {COUNTS.map((row) => {
                    const a = num(game, row.key);
                    const b = num(opp, row.key);
                    if (!showRow(row.key, a, b, row.untracked)) return null;
                    return <SplitBar key={row.label} label={row.label} a={a} b={b} lower={row.lower} colorA="var(--side-a)" colorB="var(--side-b)" />;
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted text-center py-6">
                No opponent stat line — non-D1 opponents don&apos;t carry a full box in our data.
              </p>
            )}
          </div>
        ) : (
          <div className="p-3 sm:p-4">
            {playersLoading && (
              <p className="py-10 text-center text-sm text-ink-muted">Loading box score…</p>
            )}
            {playersErr && (
              <p className="py-10 text-center text-sm text-ink-muted">
                No player box score available for this game.
              </p>
            )}
            {players && <PlayerBoxPanel file={players} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shooting percentage as a ring. The arc is the percentage; the number sits
 * inside it. Null attempts render an empty track rather than a 0% ring, which
 * would read as "shot and missed everything".
 */
export function PctRing({ made, att, color }: { made: number | null; att: number | null; color: string }) {
  const pct = made === null || !att ? null : made / att;
  const SIZE = 58;
  const R = 23;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" className="text-hairline" strokeWidth={4.5} />
        {pct !== null && (
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`}
          />
        )}
      </svg>
      <span className="absolute text-sm font-semibold tabular text-ink">
        {pct === null ? "—" : `${Math.round(pct * 100)}%`}
      </span>
    </span>
  );
}

/**
 * One counting stat as a single proportional bar: each side's share of the
 * combined total. The winning side is called out in its own colour — for
 * `lower` stats (turnovers, fouls) that is the SMALLER number.
 */
export function SplitBar({
  label, a, b, lower, major, colorA = SIDE_A, colorB = SIDE_B,
}: {
  label: string; a: number | null; b: number | null; lower?: boolean; major?: boolean;
  colorA?: string; colorB?: string;
}) {
  const av = a ?? 0, bv = b ?? 0;
  const total = av + bv;
  // A 0-0 row would divide by zero; show an even, inert bar instead.
  const aShare = total > 0 ? av / total : 0.5;
  const aWins = a !== null && b !== null && a !== b && (lower ? a < b : a > b);
  const bWins = a !== null && b !== null && a !== b && (lower ? b < a : b > a);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1 min-w-0">
          <span className={`text-sm tabular ${aWins ? "font-semibold" : "text-ink-soft"}`} style={aWins ? { color: colorA } : undefined}>
            {a ?? "—"}
          </span>
          {/* Arrow points at the better side. On `lower` rows (turnovers,
              fouls, DRtg) that is the smaller number, so the arrow — not the
              size of the number — is what tells you who won the row. */}
          {aWins && <span aria-label="better" style={{ color: colorA }} className="text-[0.6rem] leading-none">◀</span>}
        </span>
        <span className={`text-xs text-center ${major ? "text-ink font-medium" : "text-ink-muted"}`}>{label}</span>
        <span className="flex items-center gap-1 min-w-0">
          {bWins && <span aria-label="better" style={{ color: colorB }} className="text-[0.6rem] leading-none">▶</span>}
          <span className={`text-sm tabular ${bWins ? "font-semibold" : "text-ink-soft"}`} style={bWins ? { color: colorB } : undefined}>
            {b ?? "—"}
          </span>
        </span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-hairline">
        <div
          className="transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: `${aShare * 100}%`, background: "var(--fill-a)", opacity: aWins ? 1 : 0.5 }}
        />
        <div
          className="flex-1 transition-[width] duration-500"
          style={{ background: "var(--fill-b)", opacity: bWins ? 1 : 0.5 }}
        />
      </div>
    </div>
  );
}

type SortKey = "min" | "pts" | "reb" | "ast" | "stl" | "blk" | "pf" | "tov" | "oreb" | "dreb" | "fga" | "fg3a" | "fta";

/**
 * Both line-ups, with a team selector and sortable columns. Defaults to
 * points descending, which is how anyone scanning a box score starts.
 */
export function PlayerBoxPanel({ file }: { file: GamePlayersFile }) {
  const teams = file.teams;
  // null = show both, otherwise the index of the single team shown.
  const [only, setOnly] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("pts");
  const [desc, setDesc] = useState(true);

  const shown = only === null ? teams : [teams[only]!];

  return (
    <div>
      {teams.length > 1 && (
        <div className="flex items-center gap-1 mb-3 p-1 rounded-lg bg-paper-deep border border-hairline">
          {[0, null, 1].map((sel, i) => {
            const active = only === sel;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setOnly(sel)}
                aria-pressed={active}
                className={`flex-1 py-1.5 rounded-md inline-flex items-center justify-center gap-1.5 text-sm transition-colors ${
                  active ? "bg-card shadow-sm text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {sel === null ? (
                  <>
                    <TeamLogo name={teams[0]!.logName || teams[0]!.team} size={18} />
                    <span className="text-ink-muted">+</span>
                    <TeamLogo name={teams[1]!.logName || teams[1]!.team} size={18} />
                  </>
                ) : (
                  <>
                    <TeamLogo name={teams[sel]!.logName || teams[sel]!.team} size={18} />
                    <span className="hidden sm:inline truncate">{teams[sel]!.team}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {shown.map((t) => (
          <PlayerBoxTable
            key={t.team}
            team={t}
            sort={sort}
            desc={desc}
            onSort={(k) => {
              if (k === sort) setDesc((d) => !d);
              else { setSort(k); setDesc(true); }
            }}
          />
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-coral" aria-hidden />
        Starters
      </p>
    </div>
  );
}

/** One team's line-up. Players who didn't play are listed beneath the table. */
export function PlayerBoxTable({
  team, sort, desc, onSort,
}: {
  team: BoxTeam;
  sort: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
}) {
  const dreb = (p: BoxPlayer) => (p.reb === null || p.oreb === null ? null : p.reb - p.oreb);
  const valueOf = (p: BoxPlayer, k: SortKey): number => {
    if (k === "dreb") return dreb(p) ?? -1;
    return (p[k] as number | null) ?? -1;
  };

  const played = team.players.filter((p) => (p.min ?? 0) > 0);
  const dnp = team.players.filter((p) => (p.min ?? 0) <= 0);
  const rows = [...played].sort((a, b) => {
    const d = valueOf(b, sort) - valueOf(a, sort);
    return desc ? d : -d;
  });

  const COLS: Array<{ k: SortKey; label: string }> = [
    { k: "min", label: "MIN" },
    { k: "pts", label: "PTS" },
    { k: "reb", label: "REB" },
    { k: "ast", label: "AST" },
    { k: "stl", label: "STL" },
    { k: "blk", label: "BLK" },
    { k: "pf", label: "PF" },
    { k: "tov", label: "TOV" },
    { k: "oreb", label: "OREB" },
    { k: "dreb", label: "DREB" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <TeamLogo name={team.logName || team.team} size={20} />
        <span className="text-xs uppercase tracking-widest text-ink font-bold">{team.team}</span>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline text-left">
            <tr>
              <Th>Player</Th>
              {COLS.map((c) => (
                <th key={c.k} className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onSort(c.k)}
                    className={`text-xs uppercase tracking-widest font-medium transition-colors ${
                      sort === c.k ? "text-coral" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {c.label}
                    {sort === c.k && <span aria-hidden>{desc ? " ▾" : " ▴"}</span>}
                  </button>
                </th>
              ))}
              <Th align="right">FG</Th>
              <Th align="right">3PT</Th>
              <Th align="right">FT</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id ?? p.name} className="border-b border-hairline/60 hover:bg-paper-deep/40 transition-colors">
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.starter ? "bg-coral" : "bg-transparent"}`}
                      aria-label={p.starter ? "Starter" : undefined}
                    />
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.pos && <span className="text-xs text-ink-muted">{p.pos}</span>}
                  </span>
                </Td>
                {COLS.map((c) => {
                  const v = c.k === "dreb" ? dreb(p) : (p[c.k] as number | null);
                  return (
                    <Td key={c.k} align="right" className={`tabular ${c.k === "pts" ? "font-semibold text-ink" : "text-ink-soft"}`}>
                      {v ?? "—"}
                    </Td>
                  );
                })}
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.fgm === null ? "—" : `${p.fgm}/${p.fga}`}</Td>
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.fg3m === null ? "—" : `${p.fg3m}/${p.fg3a}`}</Td>
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.ftm === null ? "—" : `${p.ftm}/${p.fta}`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dnp.length > 0 && (
        <p className="mt-1.5 px-1 text-xs text-ink-muted">
          <span className="uppercase tracking-wide font-medium">DNP</span> {dnp.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}


// ISO "YYYY-MM-DD" → "MM/DD/YY". String-based to avoid timezone shifts.
export function fmtGameDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
}

/**
 * NCAA/NIT seed. Only ~1% of rows carry one, and that's the point — a game
 * with no seed simply renders nothing rather than a placeholder.
 */
/**
 * AP rank AS OF THE GAME, not end of season — so a December upset shows the
 * number the loser actually carried that night. ~7% of rows have one (25
 * ranked teams out of ~364); the rest render nothing.
 */
export function RankBadge({ rank }: { rank: number }) {
  return (
    <span title={`AP No. ${rank} at the time of this game`} className="text-[11px] font-bold text-coral tabular">
      #{rank}
    </span>
  );
}

export function SeedBadge({ seed }: { seed: number }) {
  return (
    <span
      title={`No. ${seed} seed`}
      className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-sm bg-ink/10 text-ink-soft text-[10px] font-bold tabular leading-none"
    >
      {seed}
    </span>
  );
}

export function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
export function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}

/**
 * Open the box score knowing only WHICH game it is.
 *
 * GameBoxModal needs both perspectives of a game, because the logs store one row
 * per team and every two-sided comparison inside it needs the pair. Most callers
 * don't hold that pair: a team page has its own schedule, and a coach page has
 * nothing but a game id. This resolves it from the season log.
 *
 * loadGamesForYear() and loadGameBox() are both module-cached and shared with
 * /calc, so a user who has already touched the calculator pays nothing here.
 *
 * Renders null until resolved, and on failure — a game with no row (a non-D1
 * matchup, or a season we don't carry) simply doesn't open rather than showing
 * an error card. Callers that need a fallback should check for the id first.
 */
export function GameBoxModalById({
  gameId,
  season,
  onClose,
}: {
  /** Log id, "<cbbdGameId>-<cbbdTeamId>" — or just the numeric game prefix. */
  gameId: string;
  season: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ own: GameLog; opp: GameLog | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = gameKey(gameId);
    if (!key) return;

    Promise.all([loadGamesForYear(season), loadGameBox(season)])
      .then(([logs, box]) => {
        if (cancelled) return;
        const pair = logs.filter((r) => gameKey(r.game_id) === key);
        // Prefer the exact perspective asked for; fall back to either side,
        // since a caller may only know the numeric game prefix.
        const own = pair.find((r) => r.game_id === gameId) ?? pair[0];
        if (!own) return;
        const opp = pair.find((r) => r.game_id !== own.game_id) ?? null;
        const withBox = attachGameBox(opp ? [own, opp] : [own], box);
        setRows({ own: withBox[0]!, opp: withBox[1] ?? null });
      })
      .catch(() => { /* leave unresolved — the modal just doesn't open */ });

    return () => { cancelled = true; };
  }, [gameId, season]);

  if (!rows) return null;
  return <GameBoxModal game={rows.own} opp={rows.opp} onClose={onClose} />;
}
