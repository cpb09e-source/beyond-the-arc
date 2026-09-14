import { useMemo, useState } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { coachProfileRanks, tourneySummary, TOURNEY_ROUND_DEPTH, TOURNEY_ROUND_LABEL, type CoachProfileRanks } from "@/lib/coach-views";
import type { CoachProfile, CoachSeason } from "@/lib/coaches-core";
import { confDisplay } from "@/lib/conf-display";
import { ALL_SEASONS, SEASON_CEIL, SEASON_FLOOR } from "@/lib/seasons";
import { rankPct, useCoachBook, yearsSpan, type CoachBook } from "~/data/coach-model";
import { coachSeasons } from "~/data/team-history";
import { ObjectLink, RailActions, RecordActions } from "~/objects/object-surfaces";
import { useShell } from "~/shell/shell-context";
import { LoadError, TableSkeleton } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { CoachAvatar } from "~/ui/coach-avatar";
import { DetailAction, DetailLink, DetailRow, DetailSection, DetailsCollapsed, DetailsRail, howOf, SiteLinks, useDetailsRail, type OpenHow } from "~/ui/details";
import { num1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { HeaderButton, HighlightRow, ProfileHeader, ProfileNote, ProfileTabs, SectionTitle, type Highlight } from "~/ui/profile";
import { DEFAULT_CALC, serializeCalc } from "~/views/win-calc/calc-state";

/**
 * A coach's page: where they have coached, what their teams did, how their
 * tournaments went, and where they stand among every coach since 2012-13.
 *
 * THE SITE'S PROFILE, NOT A NEW ONE. The profile is lib/coaches-core's, the
 * ranks and the tournament summary are lib/coach-views', the season ratings and
 * their chips are the ones /coaches/<slug> shows. The page arranges them the
 * way a team or player page here is arranged, so a reader who has learned one
 * reads the other.
 *
 * A COACH HAS NO SEASON OF THEIR OWN. The page is about a career; every season
 * in it opens that school's page in that season.
 */

type TabKey = "overview" | "seasons";

const pctText = (v: number | null | undefined) => (v == null ? "–" : (v * 100).toFixed(1));
/** The nearest season the app has a team page for. */
const pageYear = (y: number) => (ALL_SEASONS.includes(y) ? y : Math.min(SEASON_CEIL, Math.max(SEASON_FLOOR, y)));
const winShare = (w: number | null | undefined, l: number | null | undefined) => (w != null && l != null && w + l > 0 ? w / (w + l) : null);
const finishLabel = (s: CoachSeason): string | null =>
  s.seed == null ? null : `${s.seed} seed · ${s.round ? TOURNEY_ROUND_LABEL[s.round] : "NCAA"}`;
const seasonKey = (s: CoachSeason) => `${s.year}|${s.team}`;
const newestFirst = (a: CoachSeason, b: CoachSeason) => b.year - a.year;

const SEASON_COLUMNS: Column<CoachSeason>[] = [
  {
    key: "season", label: "Season", width: 84, align: "left", first: -1, pin: true,
    sortValue: (s) => s.year,
    cell: (s) => <span className="text-ink tabular">{seasonLabel(s.year)}</span>,
  },
  {
    key: "team", label: "School", width: 190, align: "left", first: 1, pin: true,
    sortValue: (s) => s.team,
    cell: (s) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={logoIdOf(s.team)} name={s.team} size={18} />
        <span className="truncate font-medium text-ink">{s.team}</span>
      </span>
    ),
  },
  {
    key: "conf", label: "Conf", width: 108, align: "left", first: 1,
    sortValue: (s) => (s.conference ? confDisplay(s.conference) : null),
    cell: (s) => <span className="block truncate text-ink-soft">{s.conference ? confDisplay(s.conference) : "–"}</span>,
  },
  {
    key: "record", label: "W-L", width: 64, align: "right", first: -1,
    sortValue: (s) => winShare(s.wins, s.losses),
    cell: (s) => <span className="whitespace-nowrap text-ink tabular">{`${s.wins ?? "–"}-${s.losses ?? "–"}`}</span>,
  },
  {
    key: "confRecord", label: "Conf W-L", title: "Conference record", width: 88, align: "right", first: -1,
    sortValue: (s) => winShare(s.conf_wins, s.conf_losses),
    cell: (s) => <span className="whitespace-nowrap text-ink-soft tabular">{s.conf_wins != null ? `${s.conf_wins}-${s.conf_losses ?? 0}` : "–"}</span>,
  },
  {
    key: "bta", label: "BTA", title: "BTA rank that season", width: 60, align: "right", first: 1,
    sortValue: (s) => s.bta_rank ?? null,
    cell: (s) => <StatCell value={s.bta_rank != null ? `#${s.bta_rank}` : "–"} pct={s.bta_pct ?? null} />,
  },
  {
    key: "net", label: "Net", title: "Adjusted net rating", width: 64, align: "right", first: -1,
    sortValue: (s) => s.adj_net ?? null,
    cell: (s) => <StatCell value={signed1(s.adj_net ?? null)} pct={s.adj_net_pct ?? null} strong />,
  },
  {
    key: "adjO", label: "Adj O", title: "Adjusted offensive efficiency", width: 64, align: "right", first: -1,
    sortValue: (s) => s.adj_oe ?? null,
    cell: (s) => <StatCell value={num1(s.adj_oe ?? null)} pct={s.adj_oe_pct ?? null} />,
  },
  {
    key: "adjD", label: "Adj D", title: "Adjusted defensive efficiency (lower is better)", width: 64, align: "right", first: 1,
    sortValue: (s) => s.adj_de ?? null,
    cell: (s) => <StatCell value={num1(s.adj_de ?? null)} pct={s.adj_de_pct ?? null} />,
  },
  {
    key: "ncaa", label: "NCAA", title: "Seed and the round the run ended in", width: 176, align: "left", first: -1,
    sortValue: (s) => (s.round ? TOURNEY_ROUND_DEPTH[s.round] + 1 : s.seed != null ? 0.5 : null),
    cell: (s) => {
      const f = finishLabel(s);
      return f ? <span className="block truncate text-ink-soft">{f}</span> : <span className="text-ink-muted">–</span>;
    },
  },
  {
    key: "champ", label: "Conf title", title: "Regular-season conference champion", width: 92, align: "center", first: -1,
    sortValue: (s) => (s.reg_season_conf_champ ? 1 : 0),
    cell: (s) =>
      s.reg_season_conf_champ ? <span role="img" aria-label="Regular-season champion" className="inline-block size-[7px] rounded-full bg-good" /> : null,
  },
];

export function CoachProfileView({ record }: ViewProps) {
  const ref = record?.kind === "coach" ? record : null;
  const { openRecord, openView } = useShell();
  const [state, retry] = useCoachBook();
  const [tab, setTab] = useState<TabKey>("overview");
  const [detailsOpen, toggleDetails] = useDetailsRail();

  const book = state.status === "ready" ? state.value : null;
  const profile = book && ref ? (book.bySlug.get(ref.slug) ?? null) : null;
  const name = profile?.name ?? ref?.name ?? "";
  const ranks = useMemo(() => (book && profile ? coachProfileRanks(book.profiles, profile) : null), [book, profile]);

  const openTeam = (team: string, year: number, how: OpenHow) =>
    openRecord({ kind: "team", name: team, logoId: logoIdOf(team) }, { newTab: how.newTab, side: how.side, year: pageYear(year) });
  const openCalc = (how: OpenHow) =>
    openView("win-calc", { query: serializeCalc({ ...DEFAULT_CALC, coaches: [name], years: coachSeasons(name) }), newTab: how.newTab, side: how.side });

  const first = profile?.by_year[profile.by_year.length - 1]?.year;
  const last = profile?.by_year[0]?.year;
  const rank = profile && book ? book.compositeRank.get(profile.slug) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-6 pt-5">
          <ProfileHeader
            avatar={<CoachAvatar name={name} team={profile?.current_team ?? ref?.team ?? null} size={52} />}
            name={name}
            badges={
              profile && (
                <>
                  {rank != null && (
                    <span
                      title={`Composite résumé rank among ${book!.rows.length} coaches`}
                      className="shrink-0 rounded-[5px] bg-[var(--accent-wash)] px-1.5 py-[3px] font-mono text-[11px] font-semibold text-accent tabular"
                    >
                      #{rank}
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-[5px] px-1.5 py-[3px] text-[11px] font-medium ${
                      profile.is_active
                        ? "bg-[color-mix(in_oklab,var(--good)_14%,var(--card))] text-good"
                        : "bg-[color-mix(in_oklab,var(--ink)_7%,var(--card))] text-ink-muted"
                    }`}
                  >
                    {profile.is_active ? "Active" : "Former"}
                  </span>
                </>
              )
            }
            facts={
              profile
                ? [
                    profile.current_team && (
                      <ObjectLink
                        key="team"
                        obj={{ kind: "team", name: profile.current_team, logoId: logoIdOf(profile.current_team), year: pageYear(profile.current_year ?? SEASON_CEIL) }}
                        className="flex items-center gap-1.5 text-ink-soft underline-offset-2 hover:text-ink hover:underline"
                      >
                        <TeamLogo id={logoIdOf(profile.current_team)} name={profile.current_team} size={16} />
                        {profile.current_team}
                      </ObjectLink>
                    ),
                    profile.current_conference && confDisplay(profile.current_conference),
                    first != null && last != null && (
                      <span key="span">{`${profile.seasons_count} ${profile.seasons_count === 1 ? "season" : "seasons"}, ${yearsSpan(first, last)}`}</span>
                    ),
                    profile.schools_count > 1 && `${profile.schools_count} schools`,
                  ]
                : []
            }
            actions={
              <>
                <RecordActions obj={ref ? { kind: "coach", slug: ref.slug, name, team: profile?.current_team ?? ref.team } : null} primary={["win-calc", "snapshot"]} />
              </>
            }
          />

          {profile && book && ranks && (
            <div className="mt-5">
              <HighlightRow items={highlights(profile, book, ranks)} />
            </div>
          )}

          <div className="mt-5">
            <ProfileTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "seasons", label: "Seasons", count: profile ? profile.by_year.length : null },
              ]}
            />
          </div>
        </div>

        {state.status === "error" ? (
          <LoadError year={SEASON_CEIL} reason={state.reason} message={state.message} what="Coaches" onRetry={retry} />
        ) : !book ? (
          <div className="relative min-h-0 flex-1">
            <TableSkeleton rowHeight={42} label="Building coaches" />
          </div>
        ) : !profile ? (
          <ProfileNote>{name || "This coach"} is not in the coach history.</ProfileNote>
        ) : tab === "overview" ? (
          <CoachOverview profile={profile} onTeam={openTeam} />
        ) : (
          <div className="relative min-h-0 flex-1">
            <DataTable
              key={`seasons:${profile.slug}`}
              rows={profile.by_year}
              columns={SEASON_COLUMNS}
              rowKey={seasonKey}
              defaultSort={{ key: "season", dir: -1 }}
              tieBreak={newestFirst}
              ariaLabel={`${name} seasons`}
              empty={<ProfileNote>No seasons on record.</ProfileNote>}
              onOpen={(s, how) => openTeam(s.team, s.year, how)}
              object={(s) => ({ kind: "team", name: s.team, logoId: logoIdOf(s.team), year: pageYear(s.year), conf: s.conference ?? undefined })}
            />
          </div>
        )}
      </div>
      {profile &&
        book &&
        ranks &&
        (detailsOpen ? (
          <CoachDetails profile={profile} book={book} ranks={ranks} onTeam={openTeam} onCalc={openCalc} onCollapse={toggleDetails} />
        ) : (
          <DetailsCollapsed onExpand={toggleDetails} />
        ))}
    </div>
  );
}

function highlights(p: CoachProfile, book: CoachBook, ranks: CoachProfileRanks): Highlight[] {
  const total = book.profiles.length;
  return [
    { label: "Record", value: `${p.career_wins}–${p.career_losses}`, pct: rankPct(ranks.winsRank, total), title: `Career wins: #${ranks.winsRank} of ${total} coaches` },
    {
      label: "Win %",
      value: pctText(p.career_win_pct),
      pct: ranks.pctRankEligible ? rankPct(ranks.pctRank, ranks.pctRankTotal) : null,
      title: ranks.pctRankEligible ? `#${ranks.pctRank} of ${ranks.pctRankTotal} coaches with three or more seasons` : "Ranked from three seasons",
    },
    { label: "Score", value: num1(p.composite_score ?? null), pct: book.pct.composite.get(p.slug) ?? null, title: "Composite résumé score" },
    { label: "Net", value: signed1(p.adj_net_avg ?? null), pct: book.pct.adjNet.get(p.slug) ?? null, title: "Mean adjusted net rating across the seasons coached" },
    { label: "Conf %", value: pctText(p.conf_win_pct), pct: book.pct.conf.get(p.slug) ?? null, title: "Conference win %" },
    {
      label: "Tourney",
      value: `${p.tourney_wins}–${p.tourney_losses}`,
      pct: p.ncaa_appearances > 0 ? (book.pct.tourneyWins.get(p.slug) ?? null) : null,
      title: "NCAA tournament games, counted off the bracket",
    },
  ];
}

function CoachOverview({ profile, onTeam }: { profile: CoachProfile; onTeam: (team: string, year: number, how: OpenHow) => void }) {
  const summary = tourneySummary(profile.by_year);
  const signature: Array<[string, CoachSeason | null]> = [
    ["Most wins", profile.best_record_season],
    ["Best win %", profile.best_season],
    ["Toughest", profile.worst_season],
  ];
  const marks: Array<[string, string]> = [
    ["20-win seasons", String(profile.twenty_win_seasons)],
    ["30-win seasons", String(profile.thirty_win_seasons)],
    ["Conf. titles", String(profile.reg_season_champs)],
    ["BTA top 25", String(profile.top25_seasons ?? 0)],
    ["Best BTA rank", profile.best_bta_rank != null ? `#${profile.best_bta_rank}` : "–"],
    ["Conf. record", profile.conf_wins != null ? `${profile.conf_wins}–${profile.conf_losses ?? 0}` : "–"],
    ["Sweet 16s", String(profile.sweet_sixteens)],
    ["Final Fours", String(profile.final_fours)],
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <div className="grid gap-x-10 gap-y-7 @5xl:grid-cols-2">
        <div className="flex flex-col gap-7">
          <section>
            <SectionTitle aside={profile.schools.length > 1 ? `${profile.schools.length} schools` : undefined}>Schools</SectionTitle>
            <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
              {profile.schools.map((s) => (
                <li key={`${s.team}|${s.first_year}`}>
                  <button
                    type="button"
                    title={`Open ${s.team}  ·  Ctrl-click for a new tab`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => onTeam(s.team, s.last_year, howOf(e))}
                    className="grid h-[44px] w-full grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <TeamLogo id={logoIdOf(s.team)} name={s.team} size={20} />
                      <span className="truncate text-ink">{s.team}</span>
                      <span className="shrink-0 text-[12px] text-ink-muted">
                        {s.seasons} {s.seasons === 1 ? "season" : "seasons"}
                      </span>
                    </span>
                    <span className="text-[12px] text-ink-muted">{yearsSpan(s.first_year, s.last_year)}</span>
                    <span className="text-right text-ink tabular">
                      {s.wins}–{s.losses}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Signature seasons</SectionTitle>
            <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
              {signature.map(([label, s]) => (s ? <SeasonRow key={label} label={label} season={s} onTeam={onTeam} /> : null))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-7">
          <section>
            <SectionTitle aside={summary.appearances > 0 ? `${summary.appearances} ${summary.appearances === 1 ? "appearance" : "appearances"}` : undefined}>
              March Madness
            </SectionTitle>
            {summary.appearances === 0 ? (
              <p className="text-[13px] text-ink-muted">No NCAA tournament since 2012-13.</p>
            ) : (
              <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
                {summary.tourneys.map((s) => (
                  <SeasonRow key={seasonKey(s)} label={seasonLabel(s.year)} season={s} onTeam={onTeam} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle aside="Since 2012-13">Career marks</SectionTitle>
            <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
              {marks.map(([label, value]) => (
                <div key={label} className="bg-card px-3 py-2.5">
                  <div className="truncate text-[11.5px] text-ink-muted">{label}</div>
                  <div className={`mt-1 text-[16px] font-semibold tabular ${value === "0" || value === "–" ? "text-ink-muted" : "text-ink"}`}>{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One season as a row: the school that year, its record, and how March went. */
function SeasonRow({ label, season: s, onTeam }: { label: string; season: CoachSeason; onTeam: (team: string, year: number, how: OpenHow) => void }) {
  const finish = finishLabel(s);
  const own = label === seasonLabel(s.year);
  return (
    <li>
      <button
        type="button"
        title={`Open ${s.team} in ${seasonLabel(s.year)}  ·  Ctrl-click for a new tab`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => onTeam(s.team, s.year, howOf(e))}
        className="grid h-[48px] w-full grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
      >
        <span className={`truncate ${own ? "text-ink-muted tabular" : "text-ink-muted"}`}>{label}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo id={logoIdOf(s.team)} name={s.team} size={16} />
            <span className="truncate text-ink">{s.team}</span>
            {!own && <span className="shrink-0 text-[12px] text-ink-muted tabular">{seasonLabel(s.year)}</span>}
          </span>
          {finish && <span className="truncate pl-6 text-[12px] text-ink-muted">{finish}</span>}
        </span>
        <span className="text-right text-ink tabular">
          {s.wins ?? "–"}–{s.losses ?? "–"}
        </span>
      </button>
    </li>
  );
}

/** The rail: where the coach is now, where they rank among every coach, and the ways out. */
function CoachDetails({
  profile,
  book,
  ranks,
  onTeam,
  onCalc,
  onCollapse,
}: {
  profile: CoachProfile;
  book: CoachBook;
  ranks: CoachProfileRanks;
  onTeam: (team: string, year: number, how: OpenHow) => void;
  onCalc: (how: OpenHow) => void;
  onCollapse: () => void;
}) {
  const total = book.profiles.length;
  const composite = book.compositeRank.get(profile.slug);
  const rankRows: Array<[string, string, number | null, string?]> = [
    ["Composite", composite != null ? `#${composite}` : "–", book.pct.composite.get(profile.slug) ?? null, "Composite résumé score"],
    ["Per season", num1(profile.composite_per_season ?? null), book.pct.perSeason.get(profile.slug) ?? null, "Composite per season coached"],
    ["Wins", `#${ranks.winsRank}`, rankPct(ranks.winsRank, total), "Career wins since 2012-13"],
    [
      "Win %",
      ranks.pctRankEligible ? `#${ranks.pctRank}` : "Under 3 seasons",
      ranks.pctRankEligible ? rankPct(ranks.pctRank, ranks.pctRankTotal) : null,
      ranks.pctRankEligible ? `Among ${ranks.pctRankTotal} coaches with three or more seasons` : undefined,
    ],
    [
      "Tourney wins",
      profile.ncaa_appearances > 0 && ranks.tourneyRank.rank > 0 ? `#${ranks.tourneyRank.rank}` : "–",
      profile.ncaa_appearances > 0 ? (book.pct.tourneyWins.get(profile.slug) ?? null) : null,
      "NCAA tournament wins, among coaches who have been",
    ],
  ];

  return (
    <DetailsRail label={`${profile.name} details`} onCollapse={onCollapse}>
      <DetailSection title="Now" aside={profile.current_year != null ? seasonLabel(profile.current_year) : undefined}>
        <DetailRow label="Status">
          <span className={profile.is_active ? "text-good" : "text-ink-muted"}>{profile.is_active ? "Active" : "Former"}</span>
        </DetailRow>
        {profile.current_team && (
          <DetailRow label={profile.is_active ? "School" : "Last school"}>
            <DetailLink
              title="Open the school  ·  Ctrl-click for a new tab"
              object={{ kind: "team", name: profile.current_team, logoId: logoIdOf(profile.current_team), year: pageYear(profile.current_year ?? SEASON_CEIL) }}
              onOpen={(how) => onTeam(profile.current_team!, profile.current_year ?? SEASON_CEIL, how)}
            >
              <TeamLogo id={logoIdOf(profile.current_team)} name={profile.current_team} size={16} />
              <span className="truncate">{profile.current_team}</span>
            </DetailLink>
          </DetailRow>
        )}
        {profile.current_conference && (
          <DetailRow label="Conference">
            <span className="truncate">{confDisplay(profile.current_conference)}</span>
          </DetailRow>
        )}
      </DetailSection>

      <DetailSection title="Ranks" aside={`of ${total} coaches`}>
        {rankRows.map(([label, value, p, title]) => (
          <DetailRow key={label} label={label} title={title}>
            <span className="truncate tabular">{value}</span>
            <span className="ml-auto flex shrink-0">
              <PercentileChip pct={p} className="min-w-[28px] px-1 py-[2px] text-[11px]" />
            </span>
          </DetailRow>
        ))}
      </DetailSection>

      <DetailSection title="Go to">
        <RailActions obj={{ kind: "coach", slug: profile.slug, name: profile.name, team: profile.current_team }} groups={["goto"]} />
      </DetailSection>

      <DetailSection title="Share">
        <RailActions obj={{ kind: "coach", slug: profile.slug, name: profile.name, team: profile.current_team }} groups={["share"]} />
      </DetailSection>
    </DetailsRail>
  );
}
