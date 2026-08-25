import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TeamName } from "@/components/team-name";
import { SeasonPreview } from "@/components/teams/season-preview";

// Bart's year key for the upcoming season (season-END year: 2027 = 2026-27).
export const PREVIEW_SEASON_YEAR = 2027;
export const PREVIEW_SEASON_LABEL = "2026-27";

import { SeasonSwitcher } from "@/components/teams/season-switcher";
import { NationalRanks } from "@/components/teams/national-ranks";
import { SortableSeasonsTable } from "@/components/teams/sortable-seasons-table";
import { SeasonGrid, type SeasonGridRow } from "@/components/teams/season-grid";
import { TeamTabs, TAB_ANCHORS, type TeamTab } from "@/components/teams/team-tabs";
import { SortableRosterTable } from "@/components/teams/sortable-roster-table";
import { DistributionPanel, type DistributionRank } from "@/components/teams/distribution-panel";
import { AssistNetworkPanel } from "@/components/teams/assist-network-panel";
import { ClockSplitsPanel } from "@/components/teams/clock-splits-panel";
import { TeamLineups } from "@/components/teams/team-lineups";
import type { AssistNetwork, ClockSplits } from "@/lib/static-data";
import { ScheduleTicker } from "@/components/teams/schedule-ticker";
import { TeamStatsPanel, type TeamSplits } from "@/components/teams/team-stats-panel";
import { FindGameTrigger } from "@/components/teams/find-game-trigger";
import { TourneyTimeline } from "@/components/teams/tourney-timeline";
import { PlayerHeadshotStrip } from "@/components/teams/player-headshot-strip";
import type { StaticPlayerRow, StaticTeamSeasonRow, ConfRecord, GameLog } from "@/lib/static-data";
import { confDisplay } from "@/lib/conf-display";
import { getTeamColors } from "@/lib/team-colors";

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function coachSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function fromEnd(row: Array<string | number | null> | null, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function pctFromIdx(row: Array<string | number | null> | null, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

export type RosterEntry = {
  id: number;
  bart_player_id: number | null;
  name: string;
  class: string | null;
  height: string | null;
  hometown: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  pir: number | null;
  epm: number | null;
  ewins: number | null;
  on_off: number | null;
  ts_pct: number | null;
  usg_pct: number | null;
  /** Per-stat percentile chips, keyed by the roster column. `null` for any
   *  stat the player didn't clear the rank cohort threshold for. Empty for
   *  players without a rank file at all. */
  pcts?: {
    pir?: number | null;
    pts?: number | null;
    reb?: number | null;
    ast?: number | null;
    fg3_pct?: number | null;
    ft_pct?: number | null;
    epm?: number | null;
    ewins?: number | null;
    on_off?: number | null;
    ts_pct?: number | null;
    usg_pct?: number | null;
  };
};

/**
 * Folds the pre-computed `roster_ranks` map (baked into the team JSON by
 * scripts/embed-roster-ranks.mjs) into each roster entry. Pure sync lookup,
 * zero extra I/O at build time — every Netlify deploy used to read tens of
 * thousands of player-ranks files for the roster chips and blew the build
 * budget. Now the percentiles ride along in the team JSON we already load.
 */
export function attachRosterRanks(
  roster: RosterEntry[],
  rosterRanks: StaticTeamSeasonRow["roster_ranks"],
): RosterEntry[] {
  if (!rosterRanks) return roster;
  return roster.map((p) => {
    if (p.bart_player_id === null) return p;
    const r = rosterRanks[p.bart_player_id];
    if (!r) return p;
    return {
      ...p,
      pcts: {
        ...p.pcts, // keep EPM / TS% / USG% percentiles set in buildRoster
        pir:       r.pir       ?? null,
        pts:       r.pts       ?? null,
        reb:       r.reb       ?? null,
        ast:       r.ast       ?? null,
        fg3_pct:   r.fg3_pct   ?? null,
        ft_pct:    r.ft_pct    ?? null,
      },
    };
  });
}

// Cache PIR per (year, player.id) across team-page generations.
// Computed once per year from the full D-I cohort the first time any team
// page that year is built; reused for the other ~365 teams that share the
// same cohort.
const yearMetricsCache = new Map<number, Map<number, { pir: number | null }>>();

function computeYearMetrics(players: StaticPlayerRow[], year: number) {
  const cached = yearMetricsCache.get(year);
  if (cached) return cached;

  // This used to z-score the entire D-I cohort for the year (PIR / PORPAG /
  // defensive index), apply six conference and team-strength multipliers and a
  // volume-shooter penalty — all to produce BTA PRTG. The roster table never
  // rendered it: its impact column is EPM, and has been for a while. Removing
  // the dead metric leaves PIR, which is a plain per-row formula needing no
  // cohort statistics at all, so the whole cohort pass goes with it.
  const out = new Map<number, { pir: number | null }>();
  for (const p of players) {
    const row = p.player_bart_stats?.raw_row ?? null;
    const pts = fromEnd(row, 3);
    const reb = fromEnd(row, 7);
    const ast = fromEnd(row, 6);
    const stl = fromEnd(row, 5);
    const blk = fromEnd(row, 4);
    const pir =
      pts !== null && reb !== null && ast !== null && stl !== null && blk !== null
        ? pts + reb + ast + stl + blk - (pctFromIdx(row, 52) ?? 0) - (pctFromIdx(row, 44) ?? 0)
        : null;
    out.set(p.id, { pir });
  }
  yearMetricsCache.set(year, out);
  return out;
}


// Percentile rank (0-100, higher value = higher percentile) of each id's value
// across the pool; ids with no value are omitted. Used for the roster chips on
// EPM / TS% / USG% so they read on the same ramp as the players table.
function poolPercentiles(byId: Map<number, number | null>): Map<number, number> {
  const vals = [...byId.entries()].filter((e): e is [number, number] => typeof e[1] === "number")
    .sort((a, b) => a[1] - b[1]);
  const out = new Map<number, number>();
  const n = vals.length;
  if (n < 2) return out;
  vals.forEach(([id], i) => out.set(id, Math.round((i / (n - 1)) * 100)));
  return out;
}

export function buildRoster(
  players: StaticPlayerRow[],
  teamId: number,
  year: number,
  epmByBart: Map<number, number>,
  extrasByBart?: Map<number, { ewins: number | null; on_off: number | null }>,
): RosterEntry[] {
  const metrics = computeYearMetrics(players, year);

  // TS% / USG% / EPM over the FULL year pool so the roster chips are percentiles
  // vs all of D-I (matching the players table), not just this team.
  const tsById = new Map<number, number | null>();
  const usgById = new Map<number, number | null>();
  const epmById = new Map<number, number | null>();
  const ewinsById = new Map<number, number | null>();
  const onOffById = new Map<number, number | null>();
  for (const p of players) {
    const row = p.player_bart_stats?.raw_row ?? null;
    const games = p.player_bart_stats?.games ?? null;
    const pts = fromEnd(row, 3);
    const fga = (pctFromIdx(row, 17) ?? 0) + (pctFromIdx(row, 20) ?? 0);
    const fta = pctFromIdx(row, 14) ?? 0;
    const denom = 2 * (fga + 0.44 * fta);
    tsById.set(p.id, pts != null && games != null && denom > 0 ? (pts * games) / denom : null);
    const usgRaw = pctFromIdx(row, 6); // Bart usage %, 0–100
    usgById.set(p.id, usgRaw != null ? usgRaw / 100 : null);
    epmById.set(p.id, p.bart_player_id != null ? (epmByBart.get(p.bart_player_id) ?? null) : null);
    // eWins and on/off exist only for players the play-by-play fit reached, so
    // these maps are sparser than the EPM one by design.
    const ex = p.bart_player_id != null ? extrasByBart?.get(p.bart_player_id) : undefined;
    ewinsById.set(p.id, ex?.ewins ?? null);
    onOffById.set(p.id, ex?.on_off ?? null);
  }
  const pctlTs = poolPercentiles(tsById);
  const pctlUsg = poolPercentiles(usgById);
  const pctlEpm = poolPercentiles(epmById);
  const pctlEwins = poolPercentiles(ewinsById);
  const pctlOnOff = poolPercentiles(onOffById);

  return players
    .filter((p) => {
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      return team?.id === teamId;
    })
    .map((p): RosterEntry => {
      const row = p.player_bart_stats?.raw_row ?? null;
      const m = metrics.get(p.id);
      return {
        id: p.id,
        bart_player_id: p.bart_player_id,
        name: p.name,
        class: p.class,
        height: p.height,
        hometown: p.hometown,
        pts: fromEnd(row, 3),
        reb: fromEnd(row, 7),
        ast: fromEnd(row, 6),
        fg3_pct: pctFromIdx(row, 21),
        ft_pct: pctFromIdx(row, 15),
        pir: m?.pir ?? null,
        epm: epmById.get(p.id) ?? null,
        ewins: ewinsById.get(p.id) ?? null,
        on_off: onOffById.get(p.id) ?? null,
        ts_pct: tsById.get(p.id) ?? null,
        usg_pct: usgById.get(p.id) ?? null,
        pcts: {
          epm: pctlEpm.get(p.id) ?? null,
          ewins: pctlEwins.get(p.id) ?? null,
          on_off: pctlOnOff.get(p.id) ?? null,
          ts_pct: pctlTs.get(p.id) ?? null,
          usg_pct: pctlUsg.get(p.id) ?? null,
        },
      };
    })
    .sort((a, b) => (b.epm ?? -Infinity) - (a.epm ?? -Infinity));
}

/**
 * PAGE WIDTH. Every section on this page shares one shell —
 * `mx-auto max-w-[88rem] px-6 lg:px-10` — and the eight copies of it have to
 * stay in step, including the one in season-preview.tsx, which lines its
 * heading up against this exact gutter (see the note there). Widened from
 * max-w-7xl (80rem) on request; the By season grid gained columns and wanted
 * the room. Changing it means changing all eight.
 */
export function TeamPageView({
  team,
  current,
  roster,
  slug,
  rankedPlayerIds,
  confRecords,
  shootingRanks,
  fourFactorRanks,
  scheduleGames,
  netRanks,
  teamSplits,
  assistNetwork,
  clockSplits,
  seasonGrid,
  tab = "all",
  overviewHref,
  preview = false,
}: {
  team: { name: string; seasons: StaticTeamSeasonRow[] };
  current: StaticTeamSeasonRow;
  roster: RosterEntry[];
  slug: string;
  rankedPlayerIds: Set<number>;
  confRecords: Map<number, ConfRecord>;
  shootingRanks: DistributionRank[];
  fourFactorRanks: DistributionRank[];
  scheduleGames: GameLog[];
  /** year → this team's aNET rank that season. See netRanksForTeam(). */
  netRanks: Record<number, number>;
  /** Eight-way stat splits for the season on screen; null before 2014. */
  teamSplits: TeamSplits | null;
  /** Who assisted whom this season. Null before 2014 — no play-by-play. */
  assistNetwork: AssistNetwork | null;
  /** Shot selection by shot-clock position. Null before 2014. */
  clockSplits: ClockSplits | null;
  /**
   * By-season rows with baked percentiles, or null if this team has not been
   * baked yet — see readTeamSeasonGrid(). Null falls back to the older seasons
   * table, which is what makes a partial bake (`--team Vermont`) a safe state
   * to leave the site in rather than a broken one.
   */
  seasonGrid: SeasonGridRow[] | null;
  /**
   * Which tab to render. "all" is the whole page in one scroll — every older
   * season, and every preview page — and is what this component did before the
   * split. The four named tabs each render the hero plus their own sections.
   *
   * The tab strip appears in BOTH cases; on "all" it scrolls to anchors rather
   * than navigating. See team-tabs.tsx for why only the current season gets
   * real routes.
   */
  tab?: TeamTab | "all";
  /**
   * Where the Overview tab points. The bare /teams/<slug> route renders the
   * same content as /teams/<slug>/<year>, so it passes its own URL rather than
   * sending a reader already on Overview to a second address for it.
   */
  overviewHref?: string;
  // Preview mode — renders the last-completed-season layout with game-dependent
  // sections blurred, the roster swapped for the upcoming-season client roster,
  // record shown as 0-0 and BTA rank as TBD.
  preview?: boolean;
}) {
  const teamColors = getTeamColors(team.name);
  const accentColor = teamColors?.primary ?? null;
  // CSS vars set on the page wrapper let any descendant theme its hover
  // states without prop-drilling. --accent is the full color (for text +
  // border), --accent-tint is a low-alpha background suitable for row
  // hovers. Always set; fall back to coral for unthemed teams.
  const cssVars: React.CSSProperties = {
    ["--accent" as string]: accentColor ?? "#ed5a4f",
    ["--accent-tint" as string]: accentColor ? `${accentColor}1a` : "rgba(237, 90, 79, 0.08)",
  };

  const currentTrank = current.team_trank_stats;
  const currentCbb = current.team_season_stats;
  // Newest season first — team.seasons already comes that way from the export.
  const chronological = [...team.seasons];

  // NET rank — where this team's aNET sat in that season's D-I cohort. The
  // headline badge and the five-year average both read from it, so the number
  // on the shield is the same one the explorer sorts on by default.
  const currentNetRank = netRanks[current.year] ?? null;
  // Average over the last 5 seasons (newest first in team.seasons).
  const last5 = team.seasons.slice(0, 5);
  const last5Ranks = last5.map((s) => netRanks[s.year]).filter((r): r is number => typeof r === "number");
  const avgRank = last5Ranks.length > 0
    ? Math.round(last5Ranks.reduce((a, b) => a + b, 0) / last5Ranks.length)
    : null;

  // "Where they rank best/worst", or three adjusted-efficiency tiles when the
  // season carries no national ranks. Rendered inside the hero on a normal
  // season and below the roster on a preview — one definition, two positions.
  const ranksBlock =
    current.national_ranks && (current.national_ranks.top.length > 0 || current.national_ranks.bottom.length > 0) ? (
      <NationalRanks
        top={current.national_ranks.top}
        bottom={current.national_ranks.bottom}
        total={current.national_ranks.top[0]?.total ?? current.national_ranks.bottom[0]?.total ?? 0}
        blurBody={preview}
      />
    ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
        <StatTile label="Adj ORtg" value={fmtNum(currentTrank?.adjoe ?? null, 1)} sub="points per 100" />
        <StatTile label="Adj DRtg" value={fmtNum(currentTrank?.adjde ?? null, 1)} sub="points per 100 (allowed)" />
        <StatTile label="Adj Tempo" value={fmtNum(currentTrank?.adjt ?? null, 1)} sub="possessions / 40 min" />
      </div>
    );

  // Which sections this render is responsible for. "all" is one long scroll
  // (older seasons, and every preview page); a named tab renders the hero plus
  // its own sections and nothing else.
  const showAll = tab === "all";
  const show = {
    overview: showAll || tab === "overview",
    roster:   showAll || tab === "roster",
    history:  showAll || tab === "history",
    shooting: showAll || tab === "shooting",
    lineups:  showAll || tab === "lineups",
    onoff:    showAll || tab === "onoff",
  };
  // Preview pages keep the single-page layout and get no strip. Their sections
  // are reordered around a blurred, game-less season, so a tab that promised
  // "Shooting" would open on a blurred panel.
  const showTabs = !preview;

  return (
    <div style={cssVars}>
      {/* Hero */}
      <section>
        <div className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-10 pb-8">
          <div className="flex flex-wrap items-center gap-6 lg:gap-10">
            <TeamLogo name={current.name} size={96} className="rounded-md" />
            <div className="flex-1 min-w-0">
              <div
                className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] font-medium mb-3"
                style={accentColor ? { color: accentColor } : undefined}
              >
                <span
                  className={accentColor ? "h-px w-8" : "h-px w-8 bg-coral"}
                  style={accentColor ? { background: accentColor } : undefined}
                />
                <span className={accentColor ? "inline-flex items-center gap-2" : "inline-flex items-center gap-2 text-coral"}>
                  {confDisplay(current.conference)}
                  <SeasonSwitcher
                    slug={slug}
                    currentYear={preview ? PREVIEW_SEASON_YEAR : current.year}
                    years={
                      // Teams still active in the latest completed season also
                      // get the next-season preview in the picker.
                      (team.seasons[0]?.year ?? 0) >= PREVIEW_SEASON_YEAR - 1
                        ? [PREVIEW_SEASON_YEAR, ...team.seasons.map((s) => s.year)]
                        : team.seasons.map((s) => s.year)
                    }
                  />
                </span>
              </div>
              <div className="flex items-baseline gap-3 md:gap-4 flex-wrap">
                <h1 className="font-display text-4xl md:text-6xl tracking-tight text-ink leading-none">
                  <TeamName name={current.name} />
                </h1>
                {preview ? (
                  <span
                    className="inline-flex items-baseline gap-1 px-3 py-1.5 rounded-md text-white font-display text-xl md:text-2xl tabular leading-none shadow-sm"
                    style={accentColor ? { background: accentColor, color: teamColors?.onPrimary ?? "#fff" } : { background: "var(--color-coral, #ed5a4f)" }}
                    title={`NET rank for ${PREVIEW_SEASON_LABEL} — set once games are played`}
                  >
                    <span className="text-[0.6em] opacity-80 uppercase tracking-widest mr-0.5">NET</span>
                    TBD
                  </span>
                ) : (
                  currentNetRank !== null && (
                    <span
                      className="inline-flex items-baseline gap-1 px-3 py-1.5 rounded-md text-white font-display text-xl md:text-2xl tabular leading-none shadow-sm"
                      style={accentColor ? { background: accentColor, color: teamColors?.onPrimary ?? "#fff" } : { background: "var(--color-coral, #ed5a4f)" }}
                      title={`NET rank for ${seasonLabel(current.year)} — aNET position in D-I`}
                    >
                      <span className="text-[0.6em] opacity-80 uppercase tracking-widest mr-0.5">NET</span>
                      #{currentNetRank}
                    </span>
                  )
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-ink-soft">
                <span className="tabular text-2xl text-ink">
                  {preview ? "0-0" : (currentTrank?.record ?? "—")}
                </span>
                {!preview && avgRank !== null && last5Ranks.length > 1 && (
                  <span className="text-sm text-ink-muted">
                    Avg NET Rank, last {last5Ranks.length} seasons: #{avgRank}
                  </span>
                )}
                {(() => {
                  // The team-seasons export only fills `coach` for the current
                  // year; historical seasons rely on the coach-history lookup
                  // we already thread through via confRecords. Fall back to
                  // that so /teams/<slug>/<year> pages show the coach too.
                  const coachName = current.coach ?? confRecords.get(current.year)?.coachName ?? null;
                  if (!coachName) return null;
                  return (
                    <span className="text-sm text-ink-muted">
                      Coach:{" "}
                      <Link
                        href={`/coaches/${coachSlug(coachName)}/`}
                        className={
                          accentColor
                            ? "text-[color:var(--accent)] hover:opacity-80 transition-opacity"
                            : "text-ink hover:text-coral transition-colors"
                        }
                      >
                        {coachName}
                      </Link>
                    </span>
                  );
                })()}
                {!preview && (
                  <FindGameTrigger
                    teamId={current.id}
                    teamName={team.name}
                    defaultYear={current.year}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Overview only. It rode above the strip on every tab for a while,
              on the theory that the season at a glance is wanted wherever you
              are — but it is the single largest repeated block on the page,
              and repeating it across six tabs roughly doubled the bytes stored
              per team-season for something a reader is one click from anyway. */}
          {show.overview && scheduleGames.length > 0 && (
            <div className="mt-8">
              <ScheduleTicker games={scheduleGames} teamName={team.name} blurBody={preview} />
            </div>
          )}

          {/* NCAA Tournament timeline — parked. Component still imported so
              re-enabling is one line change. Keeping the data flow (confRecords
              already carries tourneyRound/tourneySeed) ready. */}
          {false && team.name === "Kansas" && confRecords.size > 0 && (
            <div className="mt-4">
              <TourneyTimeline
                history={confRecords}
                startYear={2008}
                endYear={current.year}
              />
            </div>
          )}
        </div>
      </section>

      {/* The strip sits under the masthead — identity and schedule, the two
          things every tab shows — and above everything it switches between.
          The rank barbell is Overview content and moved below it: with the
          strip underneath, the ranks read as part of the masthead rather than
          as the first thing the tab is showing you.

          Every season gets the same strip and the same routes — see the note
          in team-tabs.tsx. */}
      {showTabs && (
        <TeamTabs
          active={tab === "all" ? "overview" : tab}
          slug={slug}
          year={current.year}
          overviewHref={overviewHref}
        />
      )}


      {/* PREVIEW ORDER: schedule, then the roster, then everything else.
          Nobody arrives at a 0-0 team for its rankings — the season hasn't
          happened, so every rank on the page is last year's carried over and
          shown blurred. The roster is the one thing on a preview page that is
          genuinely about next season, and it was sitting four blocks down,
          below two panels of blurred history. It comes straight after the
          schedule now, and the ranks follow it.

          The ranks block is hoisted to a variable rather than duplicated
          because it has two shapes (national ranks, or the three-tile
          fallback) and both would have to be kept in step. */}
      {preview && (
        <>
          <SeasonPreview teamName={team.name} />
          {/* mb-6 stands in for the hero's pb-8: the panel below opens with
              mt-2 on the assumption that whatever precedes it already paid for
              the gap, and here that is this section rather than the hero. */}
          <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8 mb-6">{ranksBlock}</section>
        </>
      )}

      {/* Everything we hold on the team, in six cards, sliced eight ways.
          Sits directly under the best/worst barbell above: that names the five
          things worth knowing, this is the rest of it on demand.
          Deliberately tighter than a normal section break (the hero's own pb-8
          already contributes 32px) because the two belong together. */}
      {show.overview && teamSplits && (
        <section id={TAB_ANCHORS.overview} className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8 scroll-mt-20">
          <TeamStatsPanel splits={teamSplits} blurBody={preview} />
        </section>
      )}

      {/* The rank barbell sits BELOW Team Stats now. Team Stats is the whole
          season in six cards; the barbell is the five things that stand out in
          it. Reading the summary before its highlights is the wrong way round,
          and the barbell's five rows made a thin opening for a page whose
          first real block is a grid.

          On a preview page it moves below the roster instead — see the note
          where that renders. */}
      {show.overview && !preview && (
        <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8">{ranksBlock}</section>
      )}

      {/* Preview rosters render above, right under the schedule. */}
      {!preview && show.roster && (
      <section id={TAB_ANCHORS.roster} className="mx-auto max-w-[88rem] px-4 lg:px-10 mt-5 scroll-mt-20">
        {/* px-2 on top of the section's px-4 lands the heading on the same 24px
            margin as every other block on the page — see the note in
            season-preview.tsx for why the section itself can't just be px-6. */}
        <div className="mb-2 sm:mb-4 px-2 lg:px-0">
          <h2 className="font-display text-3xl text-ink whitespace-nowrap">Roster — {seasonLabel(current.year)}</h2>
        </div>
        {/* Player headshot strip — faces + names before the spreadsheet. */}
        {roster.length > 0 && (
          <div className="mb-3 sm:mb-5">
            <PlayerHeadshotStrip players={roster} rankedPlayerIds={rankedPlayerIds} />
          </div>
        )}
        {roster.length === 0 ? (
          <p className="text-ink-muted text-sm">No roster data for this season.</p>
        ) : (
          <SortableRosterTable roster={roster} rankedPlayerIds={rankedPlayerIds} />
        )}
      </section>
      )}

      {/* Shooting + Four Factors sit BELOW the roster now. They are a closing
          detail on the season, not the way into it — the reader wants the team,
          then the players, then the breakdown. */}
      {/* SCHOOL HISTORY — the full ledger, every season we hold. Mirrors the
          coach page's "Season by season" treatment so cross-page recognition
          is consistent.

          Its own tab rather than the foot of Overview: it is the one section
          that is not about the season in the URL, and a reader who wants it
          wants the whole run, not a glance at it under everything else. */}
      {show.history && (
      <section id={TAB_ANCHORS.history} className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-12 mb-20 scroll-mt-20">
        <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
          {/* Top accent rule — coral bar marks this table as the headline. */}
          <div
            className="h-1 w-full"
            style={{
              backgroundImage: accentColor
                ? `linear-gradient(to right, var(--accent), var(--accent), color-mix(in srgb, var(--accent) 60%, transparent))`
                : "linear-gradient(to right, var(--color-coral), var(--color-coral), color-mix(in srgb, var(--color-coral) 60%, transparent))",
            }}
          />
          <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex items-end justify-between gap-3">
            <div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] font-bold mb-1.5 flex items-center gap-2"
                   style={{ color: accentColor ?? undefined }}>
                <span className="h-px w-6" style={{ backgroundColor: accentColor ?? "var(--color-coral)" }} />
                Full record
              </div>
              <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">By season</h2>
            </div>
            <span className="text-xs tabular text-ink-muted whitespace-nowrap">
              <span className="font-display text-2xl text-ink tabular leading-none">{chronological.length}</span>{" "}
              {chronological.length === 1 ? "season" : "seasons"}
            </span>
          </div>
          {seasonGrid ? (
            <SeasonGrid
              rows={seasonGrid}
              currentYear={current.year}
              slug={slug}
              accentColor={accentColor}
            />
          ) : (
          <SortableSeasonsTable
            seasons={chronological}
            currentYear={current.year}
            slug={slug}
            confRecords={confRecords}
            accentColor={accentColor}
          />
          )}
        </div>
      </section>
      )}

      {show.shooting && (
      <section id={TAB_ANCHORS.shooting} className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8 scroll-mt-20">
        <DistributionPanel title="Shooting" ranks={shootingRanks} blurBody={preview} />
        <DistributionPanel title="Four Factors" ranks={fourFactorRanks} blurBody={preview}>
          {current.four_factor_record && current.four_factor_record.games > 0 && (
            <>
              <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1">
                Record when all three positive
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-5xl text-ink tabular leading-none">
                  {current.four_factor_record.wins}-{current.four_factor_record.losses}
                </span>
                <span className="text-xs text-ink-muted">
                  {`across ${current.four_factor_record.games} game${current.four_factor_record.games === 1 ? "" : "s"} where REB Diff > 0, FBP Diff > 0, 3PM Diff > 0`}
                </span>
              </div>
            </>
          )}
        </DistributionPanel>
      </section>
      )}

      {/* Play-by-play derivatives. Both are reconstructed from the CBBD plays
          archive rather than reported by anyone, and both are absent before
          2014 where there is no play-by-play — so the section disappears
          entirely rather than rendering two empty frames. */}
      {/* Shot clock and assist network live under Shooting rather than a tab
          of their own. Both are shot-selection questions — when in the
          possession the shot went up, and who created it — so they belong with
          the shooting splits above rather than in a "play-by-play" tab named
          after where the data came from instead of what it says. */}
      {show.shooting && (clockSplits || assistNetwork) && (
        <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {clockSplits ? <ClockSplitsPanel splits={clockSplits} /> : <div />}
          {assistNetwork ? <AssistNetworkPanel network={assistNetwork} /> : <div />}
        </section>
      )}

      {/* LINEUPS. TeamLineups client-fetches /data/lineups-<year>.json, which
          only exists for seasons with play-by-play stint data (2025 onward),
          so most older seasons render its empty state. `standalone` is what
          makes it say so rather than render nothing — see the note there. */}
      {show.lineups && !preview && (
        <section id={TAB_ANCHORS.lineups} className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8 scroll-mt-20">
          <TeamLineups teamName={team.name} year={current.year} standalone />
        </section>
      )}

      {/* ON/OFF — tab exists, content does not yet. There is no team on/off
          dataset in public/data at all; the only on-off numbers we hold are
          the per-player ones the roster table already shows.

          Shipped as a stated placeholder rather than held back, because the
          tab strip is the thing being reviewed and a gap in it reads as a bug.
          When the data lands this block is the only thing that changes. */}
      {show.onoff && !preview && (
        <section id={TAB_ANCHORS.onoff} className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8 mb-20 scroll-mt-20">
          <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
            <div className="h-1 w-full bg-gradient-to-r from-[color:var(--accent,#ed5a4f)] via-[color:var(--accent,#ed5a4f)] to-transparent" />
            <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30">
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-[color:var(--accent,#0c6bd6)] font-bold mb-1.5 flex items-center gap-2">
                <span className="h-px w-6 bg-[color:var(--accent,#0c6bd6)]" />
                With and without
              </div>
              <h2 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight">On/Off</h2>
            </div>
            <p className="px-5 lg:px-7 py-8 text-sm text-ink-muted">
              Coming soon — how the team scores and defends with each player on
              the floor against off it.
            </p>
          </div>
        </section>
      )}


    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-paper/70 px-5 py-4">
      <div className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</div>
      <div className="font-display text-3xl text-ink tabular mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
