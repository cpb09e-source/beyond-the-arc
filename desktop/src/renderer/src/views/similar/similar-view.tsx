import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ALL_SEASONS, FLAGGED_SEASONS } from "@/lib/seasons";
import { exportFields, type ExportEntity, type ExportInput } from "@/lib/table-export";
import { loadPlayerSeason, type Player } from "~/data/player-model";
import type { Team } from "~/data/team-model";
import { useLoaded } from "~/data/use-corpus";
import { TeamChooser } from "~/explain/team-chooser";
import type { Obj } from "~/objects/object";
import { useIsActive } from "~/shell/active";
import { Picker, type PickerOption } from "~/shell/picker";
import { useTabTitle } from "~/shell/tab-title";
import { TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { alikeAndApart, findSimilar, printFeature, scoreBreakdown, seasonScales, wholePoints, type Candidate, type Feature, type Match, type Profile } from "~/similar/similar-model";
import { PLAYER_FEATURES, PLAYER_PROFILES, TEAM_FEATURES, TEAM_PROFILES, playerPct, teamPct } from "~/similar/similar-profiles";
import type { SavedSubject, SubjectRef } from "~/similar/saved-similar";
import { parseSimilarQuery, similarQuery, type SimilarQuery, type SimilarScope } from "~/similar/similar-query";
import { usePlayerPool, useTeamPool, type Pool } from "~/similar/use-similar-pool";
import { DataTable, type Column } from "~/table/data-table";
import { DownloadMenu } from "~/table/download-menu";
import { StatCell } from "~/table/stat-cell";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { Popover } from "~/ui/popover";
import { SearchList, type ListItem } from "~/ui/search-list";
import { SavedSubjectsButton } from "./saved-subjects";
import { SimilarSnapshotButton, type SimilarCardData } from "./similar-card";
import { ScoreButton } from "./score-breakdown";

/**
 * Find Similar: the team-seasons or player-seasons, from 2013-14 on, whose
 * numbers look most like one chosen one.
 *
 * EACH NUMBER AS IT STOOD IN ITS OWN SEASON (~/similar/similar-model.ts), so a
 * 2015 team is matched on how it compared with 2015, not on raw numbers an era
 * of threes has moved. A season whose adjusted ratings are withheld is matched
 * on the rest of its profile, and 2020-21 is marked wherever it appears.
 *
 * THE CHOSEN ROW LEADS THE TABLE, so every match reads against it column by
 * column; Peek sets the two side by side, stat by stat. A match is an object
 * like any other row: open it, compare it, or find what is similar to it.
 */

const ROW_H = 42;

type SRow<R> = { key: string; c: Candidate<R>; m: Match<R> | null };
const rowKey = (r: { key: string }) => r.key;
/** The chosen row stays first, whatever the sort. */
const chosenFirst = (r: { m: unknown }) => (r.m ? 1 : 0);

const KINDS: PickerOption[] = [
  { key: "team", label: "Teams", desc: "Every Division I team-season since 2013-14" },
  { key: "player", label: "Players", desc: "Every season's leaderboard players since 2013-14" },
];
const SCOPES: PickerOption[] = [
  { key: "all", label: "Every season", desc: "Matches from any season, the chosen one's included" },
  { key: "others", label: "Other seasons", desc: "History only: nothing from the chosen season" },
  { key: "same", label: "Same season", desc: "Only the chosen season's other teams or players" },
];
const profileOptions = <R,>(profiles: Profile<R>[]): PickerOption[] => profiles.map((p) => ({ key: p.key, label: p.label, desc: p.desc }));

const keepFor = (scope: SimilarScope, year: number) =>
  scope === "same" ? (c: { year: number }) => c.year === year : scope === "others" ? (c: { year: number }) => c.year !== year : undefined;

function Tag({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span title={title} className="shrink-0 rounded-[4px] border border-hairline px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </span>
  );
}

const COVID_NOTE = "The 2020-21 COVID season: shortened, and short on non-conference games, so its numbers compare less cleanly";

const yy = (y: number) => `’${String(y).slice(-2)}`;
const teamShort = (c: Candidate<Team>) => `${c.row.name} ${yy(c.year)}`;
const playerShort = (c: Candidate<Player>) => `${c.row.name.split(" ").slice(-1)[0]} ${yy(c.year)}`;

function resultColumns<R>(
  identity: Column<SRow<R>>[],
  profile: Profile<R>,
  pctOf: (r: R, key: string) => number | null,
  short: (c: Candidate<R>) => string,
  subject: Candidate<R> | null,
): Column<SRow<R>>[] {
  const chosen = subject ? short(subject) : "";
  return [
    {
      key: "pos", label: "#", title: "Place among the matches", width: 44, align: "right", first: 1, pin: true,
      cell: (r, i) => <span className="text-ink-muted tabular">{r.m ? i : ""}</span>,
    },
    ...identity,
    {
      key: "season", label: "Season", width: 96, align: "left", first: -1,
      sortValue: (r) => r.c.year,
      cell: (r) => (
        <span className="flex items-center gap-1.5 text-ink-soft tabular">
          {seasonLabel(r.c.year)}
          {FLAGGED_SEASONS.has(r.c.year) && <Tag title={COVID_NOTE}>COVID</Tag>}
        </span>
      ),
    },
    {
      key: "match", label: "Match", title: "100 is an identical profile; two unrelated ones score about 13. Click a score for where its points went.", width: 76, align: "right", first: -1,
      sortValue: (r) => r.m?.score ?? 101,
      cell: (r) =>
        r.m ? (
          <ScoreButton m={r.m} profile={profile} chosen={chosen} other={short(r.c)} />
        ) : (
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-accent">Chosen</span>
        ),
      text: (r) => (r.m ? Math.round(r.m.score) : "Chosen"),
    },
    {
      key: "alike", label: "Most alike in", width: 210, align: "left", first: 1,
      cell: (r) => <span className="block truncate text-ink-soft">{r.m ? alikeAndApart(r.m).alike.join(", ") : ""}</span>,
      text: (r) => (r.m ? alikeAndApart(r.m).alike.join(", ") : ""),
    },
    {
      key: "apart", label: "Differs most", width: 230, align: "left", first: 1,
      cell: (r) => {
        const a = r.m ? alikeAndApart(r.m).apart : null;
        return a ? (
          <span className="block truncate text-ink-soft">
            <span className="text-ink">{a.label}</span>: {a.word}
          </span>
        ) : (
          <span className="text-ink-muted">{r.m ? "Nothing far apart" : ""}</span>
        );
      },
      text: (r) => {
        const a = r.m ? alikeAndApart(r.m).apart : null;
        return a ? `${a.label}: ${a.word}` : "";
      },
    },
    ...profile.features.map(
      (f): Column<SRow<R>> => ({
        key: `f:${f.key}`,
        label: f.label,
        width: Math.max(64, Math.round(f.label.length * 7.6) + 40),
        align: "right",
        first: -1,
        band: `${profile.label} profile`,
        sortValue: (r) => f.get(r.c.row),
        cell: (r) => <StatCell value={printFeature(f, f.get(r.c.row))} pct={pctOf(r.c.row, f.key)} />,
        text: (r) => printFeature(f, f.get(r.c.row)),
      }),
    ),
  ];
}

/** The two side by side, stat by stat, with how far apart each one stood in its season. */
/** A saved team or player, run again: the profile and seasons stay when it is the same kind. */
const runSaved = (q: SimilarQuery, write: (next: Partial<SimilarQuery>) => void) => (s: SavedSubject) =>
  write(
    s.kind === "team"
      ? { kind: "team", year: s.year, team: s.name, on: q.kind === "team" ? q.on : "overall" }
      : { kind: "player", year: s.year, player: s.bartId, name: s.name, on: q.kind === "player" ? q.on : "overall" },
  );

type ExportWho<R> = { title: string; header: string; stem: string; identity: ExportEntity<SRow<R>>["identity"] };

/**
 * Download: the chosen row and its matches, through the site's own builders. The
 * profile's stats are the columns, each with its percentile in its own season,
 * led by the season, the match score, and what each match is most alike and
 * furthest apart in.
 */
function similarExport<R>(
  rows: SRow<R>[],
  profile: Profile<R>,
  pctOf: (r: R, key: string) => number | null,
  who: ExportWho<R>,
  scope: SimilarScope,
): ExportInput<SRow<R>> {
  const byKey = new Map(profile.features.map((f) => [f.key, f]));
  return {
    rows,
    cols: profile.features.map(
      (f): ExportInput<SRow<R>>["cols"][number] => ({
        label: f.label,
        total: f.key,
        pct: f.key,
        fmt: f.digits === 0 ? "int" : f.pct ? "pct1" : "num1",
        band: `${profile.label} profile`,
      }),
    ),
    entity: {
      title: who.title,
      sheetName: "Find Similar",
      identity: [
        ...who.identity,
        { header: "Season", get: (r) => seasonLabel(r.c.year) },
        { header: "Match", get: (r) => (r.m ? Math.round(r.m.score) : "Chosen") },
        { header: "Most alike in", width: 28, get: (r) => (r.m ? alikeAndApart(r.m).alike.join(", ") : null) },
        {
          header: "Differs most",
          width: 30,
          get: (r) => {
            const a = r.m ? alikeAndApart(r.m).apart : null;
            return a ? `${a.label}: ${a.word}` : null;
          },
        },
      ],
      num: (r, key) => byKey.get(key)?.get(r.c.row) ?? null,
      pctOf: (r, key) => pctOf(r.c.row, key),
      wideHeader: who.header,
      fileStem: who.stem,
    },
    meta: {
      viewLabel: `${profile.label} match`,
      seasons: SCOPES.find((s) => s.key === scope)?.label ?? "Every season",
      conference: "All",
      teams: who.title,
      filters: [],
      sort: "Match, closest first",
      search: "",
      url: "Beyond the Arc for Windows, Find Similar",
    },
  };
}

/** Save and Download, top right: the saved teams and players, and this table as a file. */
function Actions<R>({
  q,
  write,
  current,
  ready,
  build,
  card,
}: {
  q: SimilarQuery;
  write: (next: Partial<SimilarQuery>) => void;
  current: SubjectRef | null;
  ready: boolean;
  build: () => ExportInput<SRow<R>>;
  card: SimilarCardData | null;
}) {
  const input = build();
  return (
    <>
      <SavedSubjectsButton current={current} onPick={runSaved(q, write)} />
      <SimilarSnapshotButton data={card} />
      <DownloadMenu rows={ready ? input.rows.length : 0} columns={exportFields(input.cols, input.entity).length} buildExport={build} />
    </>
  );
}

function ComparePeek<R>({ m, profile, chosen, other }: { m: Match<R> | null; profile: Profile<R>; chosen: string; other: string }) {
  if (!m) return <p className="px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">The one every row below is compared with.</p>;
  const parts = new Map(m.parts.map((p) => [p.f.key, p]));
  const { apart } = alikeAndApart(m);
  const b = scoreBreakdown(m, profile);
  const whole = wholePoints(b.losses, m.score);
  const points = new Map(b.losses.map((l, i) => [l.part.f.key, whole[i]!]));
  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex items-baseline justify-between border-b border-hairline pb-2">
        <span className="text-[12px] text-ink-muted">{profile.label} match</span>
        <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink tabular">{m.score.toFixed(0)}</span>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto_44px_28px] items-center gap-x-3 gap-y-[5px] text-[12px]">
        <span />
        <span className="truncate text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{chosen}</span>
        <span className="truncate text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{other}</span>
        <span />
        <span className="text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted" title="Points this stat took off 100">
          Pts
        </span>
        {profile.features.map((f: Feature<R>) => {
          const p = parts.get(f.key);
          const gap = p ? Math.abs(p.zs - p.zm) : null;
          return [
            <span key={`${f.key}:l`} className="truncate text-ink-soft">
              {f.label}
            </span>,
            <span key={`${f.key}:a`} className="text-right text-ink tabular">
              {p ? printFeature(f, p.subject) : "–"}
            </span>,
            <span key={`${f.key}:b`} className="text-right text-ink tabular">
              {p ? printFeature(f, p.match) : "–"}
            </span>,
            <span key={`${f.key}:g`} title={gap == null ? "Not compared: one side has no number" : `${gap.toFixed(1)} standard deviations apart in their seasons`} className="h-[5px] rounded-full bg-paper-deep">
              {gap != null && <span className="block h-full rounded-full bg-ink-muted" style={{ width: `${Math.max(6, Math.min(100, (gap / 2) * 100))}%` }} />}
            </span>,
            <span key={`${f.key}:p`} data-points={p ? (points.get(f.key) ?? 0) : undefined} className="text-right text-ink-soft tabular">
              {p ? `−${points.get(f.key) ?? 0}` : "–"}
            </span>,
          ];
        })}
      </div>
      <p className="mt-2.5 text-[11.5px] leading-snug text-ink-muted">
        Bars show how far apart each number stood in its own season; points are what that distance took off 100.{apart ? ` Furthest apart: ${apart.label}, ${other} ${apart.word}.` : ""}
      </p>
    </div>
  );
}

function SeasonStep({ year, onYear }: { year: number; onYear: (y: number) => void }) {
  const at = ALL_SEASONS.indexOf(year);
  const older = ALL_SEASONS[at + 1];
  const newer = at > 0 ? ALL_SEASONS[at - 1] : undefined;
  const btn = "grid size-[24px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:text-ink disabled:opacity-30";
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" aria-label="An older season" disabled={older == null} onMouseDown={(e) => e.preventDefault()} onClick={() => older && onYear(older)} className={btn}>
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-[58px] text-center text-[13px] font-medium text-ink-soft tabular">{seasonLabel(year)}</span>
      <button type="button" aria-label="A newer season" disabled={newer == null} onMouseDown={(e) => e.preventDefault()} onClick={() => newer && onYear(newer)} className={btn}>
        <ChevronRight size={15} />
      </button>
    </span>
  );
}

function PlayerChooser({ year, bartId, name, onPick, startOpen }: { year: number; bartId: number | null; name: string | null; onPick: (bartId: number, name: string) => void; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const anchor = useRef<HTMLButtonElement>(null);
  const [state] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));
  const players = state.status === "ready" ? state.value.players : [];
  const chosen = bartId == null ? undefined : players.find((p) => p.bartId === bartId);
  const items = useMemo<ListItem[]>(
    () =>
      [...players]
        .filter((p) => p.bartId != null)
        .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
        .map((p) => ({
          key: String(p.bartId),
          label: p.name,
          leading: <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={18} />,
          meta: p.team,
          keywords: `${p.team} ${p.confLabel}`,
        })),
    [players],
  );
  const shown = chosen?.name ?? name;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={shown ? `Player, ${shown}` : "Player"}
        title="Change the player"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="group -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
      >
        {chosen && <PlayerPhoto bartId={chosen.bartId} hasPhoto={chosen.hasPhoto} name={chosen.name} size={30} />}
        <span className={`truncate text-[21px] font-semibold leading-tight tracking-[-0.02em] ${shown ? "text-ink" : "text-ink-muted"}`}>{shown ?? "Choose a player"}</span>
        <ChevronDown size={16} strokeWidth={2} className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={340} label="Player">
          <SearchList
            items={items}
            label="Players"
            placeholder={`Search ${seasonLabel(year)} players`}
            onPick={(key) => {
              const p = players.find((x) => String(x.bartId) === key);
              setOpen(false);
              if (p?.bartId != null) onPick(p.bartId, p.name);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover>
      )}
    </>
  );
}

/** The frame both kinds share: header, the chosen one and what the matches say, then the table. */
function Layout<R>({
  q,
  write,
  profiles,
  pool,
  noun,
  chooser,
  chosenLabel,
  matches,
  subject,
  note,
  table,
  actions,
}: {
  q: SimilarQuery;
  write: (next: Partial<SimilarQuery>) => void;
  profiles: Profile<R>[];
  pool: Pool<R>;
  noun: string;
  chooser: ReactNode;
  chosenLabel: (c: Candidate<R>) => string;
  matches: Match<R>[];
  subject: Candidate<R> | null;
  note: string | null;
  table: ReactNode;
  actions: ReactNode;
}) {
  const loading = pool.done < pool.total;
  const top = matches[0];
  const seasons = new Set(matches.map((m) => m.c.year)).size;
  const summary = !subject
    ? null
    : loading
      ? `Reading every season: ${pool.done} of ${pool.total}.`
      : top
        ? `Closest: ${chosenLabel(top.c)} ${seasonLabel(top.c.year)}, a ${top.score.toFixed(0)}, most alike in ${alikeAndApart(top).alike.join(", ")}. These ${matches.length} come from ${seasons} ${seasons === 1 ? "season" : "seasons"}.`
        : "Nothing in these seasons shares enough of this profile to compare.";
  return (
    <>
      <ViewHeader
        kicker={q.kind === "team" ? "Teams" : "Players"}
        title="Find Similar"
        year={q.year ?? ALL_SEASONS[0]!}
        season={false}
        meta={subject && !loading ? `${matches.length} closest of ${pool.rows.length.toLocaleString()} ${noun}` : undefined}
        controls={
          <>
            <Picker label="Find" value={q.kind} options={KINDS} onChange={(k) => write({ kind: k === "player" ? "player" : "team", on: "overall" })} />
            <Picker label="Match on" value={q.on} options={profileOptions(profiles)} onChange={(k) => write({ on: k })} />
            <Picker label="Seasons" value={q.scope} options={SCOPES} onChange={(k) => write({ scope: k as SimilarScope })} />
          </>
        }
        actions={actions}
      />
      <section className="flex shrink-0 flex-wrap items-end gap-x-8 gap-y-2 border-t border-hairline px-5 pb-3.5 pt-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-muted">{q.kind === "team" ? "Teams like" : "Players like"}</p>
          <div className="mt-1 flex min-w-0 items-center gap-3">{chooser}</div>
        </div>
        {(summary || note) && (
          <p className="max-w-[72ch] pb-1 text-[13px] leading-relaxed text-ink-soft">
            {summary}
            {note ? <span className="text-ink-muted"> {note}</span> : null}
          </p>
        )}
      </section>
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {!subject ? (
          <div className="grid h-full place-content-center px-6 text-center">
            <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-ink-muted">
              {q.kind === "team"
                ? "Choose a team to see the team-seasons since 2013-14 whose numbers look most like it, each measured against its own season."
                : "Choose a player to see the player-seasons since 2013-14 whose numbers look most like his, each measured against his own season."}
            </p>
          </div>
        ) : loading ? (
          <TableSkeleton rowHeight={ROW_H} label={`Reading every season: ${pool.done} of ${pool.total}`} />
        ) : (
          table
        )}
      </div>
    </>
  );
}

const TEAM_IDENTITY: Column<SRow<Team>>[] = [
  {
    key: "name", label: "Team", width: 210, align: "left", first: 1, pin: true,
    sortValue: (r) => r.c.row.name,
    cell: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={r.c.row.logoId} name={r.c.row.name} size={20} />
        <span className={`truncate font-medium ${r.m ? "text-ink" : "text-accent"}`}>{r.c.row.name}</span>
      </span>
    ),
    text: (r) => r.c.row.name,
  },
  {
    key: "record", label: "W-L", width: 64, align: "right", first: -1,
    sortValue: (r) => r.c.row.wins - r.c.row.losses,
    cell: (r) => <span className="text-ink-soft tabular">{`${r.c.row.wins}-${r.c.row.losses}`}</span>,
    text: (r) => `${r.c.row.wins}-${r.c.row.losses}`,
  },
];

function TeamSimilar({ q, write, fallbackYear }: { q: SimilarQuery; write: (next: Partial<SimilarQuery>) => void; fallbackYear: number }) {
  const active = useIsActive();
  const pool = useTeamPool(true);
  const year = q.year ?? fallbackYear;
  const profile = TEAM_PROFILES.find((p) => p.key === q.on) ?? TEAM_PROFILES[0]!;
  const complete = pool.done === pool.total;
  const scales = useMemo(() => (complete ? seasonScales(pool.rows, TEAM_FEATURES) : null), [complete, pool.rows]);
  const subject = useMemo(() => (q.team ? (pool.rows.find((c) => c.year === year && c.row.name === q.team) ?? null) : null), [pool.rows, year, q.team]);
  const matches = useMemo(
    () => (subject && scales ? findSimilar(subject, pool.rows, profile, scales, { limit: 50, keep: keepFor(q.scope, subject.year) }) : []),
    [subject, scales, pool.rows, profile, q.scope],
  );
  const rows = useMemo<SRow<Team>[]>(() => (subject ? [{ key: subject.id, c: subject, m: null }, ...matches.map((m) => ({ key: m.c.id, c: m.c, m }))] : []), [subject, matches]);
  const columns = useMemo(() => resultColumns(TEAM_IDENTITY, profile, teamPct, teamShort, subject), [profile, subject]);
  useTabTitle(q.team ? `Teams like ${q.team} ${seasonLabel(year)}` : "Find Similar");
  const card: SimilarCardData | null =
    subject && complete
      ? {
          kind: "team",
          title: `Teams like ${subject.row.name} ${seasonLabel(subject.year)}`,
          mark: (size) => <TeamLogo id={subject.row.logoId} name={subject.row.name} size={size} />,
          name: subject.row.name,
          facts: [seasonLabel(subject.year), subject.row.confLabel, `${subject.row.wins}–${subject.row.losses}`].join(" · "),
          profile: profile.label,
          scope: SCOPES.find((s) => s.key === q.scope)?.label ?? "Every season",
          pool: `${pool.rows.length.toLocaleString()} team-seasons`,
          entries: matches.slice(0, 15).map((m) => ({
            key: m.c.id,
            mark: (size: number) => <TeamLogo id={m.c.row.logoId} name={m.c.row.name} size={size} />,
            name: m.c.row.name,
            sub: [`${seasonLabel(m.c.year)}${FLAGGED_SEASONS.has(m.c.year) ? " (COVID)" : ""}`, `${m.c.row.wins}–${m.c.row.losses}`].join(" · "),
            score: Math.round(m.score),
            alike: alikeAndApart(m).alike.join(", "),
          })),
        }
      : null;
  const current: SubjectRef | null = subject ? { kind: "team", year: subject.year, name: subject.row.name, logoId: subject.row.logoId } : null;
  const buildExport = () =>
    similarExport(
      rows,
      profile,
      teamPct,
      {
        title: subject ? `Teams like ${subject.row.name} ${seasonLabel(subject.year)}` : "Find Similar",
        header: "Team",
        stem: "similar-teams",
        identity: [
          { header: "Team", width: 24, get: (r) => r.c.row.name },
          { header: "W-L", get: (r) => `${r.c.row.wins}-${r.c.row.losses}` },
        ],
      },
      q.scope,
    );

  const withheld = subject && subject.row.explorer?.a_ortg == null;
  const note = !subject
    ? null
    : withheld
      ? `Adjusted ratings are withheld for ${seasonLabel(year)}, so ${q.team} is matched on the rest of its profile.`
      : FLAGGED_SEASONS.has(year)
        ? "2020-21 was the COVID season, so its numbers compare less cleanly."
        : null;

  return (
    <Layout
      q={q}
      write={write}
      profiles={TEAM_PROFILES}
      pool={pool}
      noun="team-seasons"
      actions={<Actions q={q} write={write} current={current} ready={complete && subject != null} build={buildExport} card={card} />}
      subject={subject}
      matches={matches}
      note={note}
      chosenLabel={(c) => c.row.name}
      chooser={
        <>
          <TeamChooser year={year} name={q.team} logoId={subject?.row.logoId ?? null} label="Team" onPick={(name) => write({ team: name, year })} startOpen={active && !q.team} />
          <SeasonStep year={year} onYear={(y) => write({ year: y })} />
        </>
      }
      table={
        <DataTable
          key={`team|${profile.key}|${subject?.id}|${q.scope}`}
          id="find-similar-teams"
          rows={rows}
          columns={columns}
          rowKey={rowKey}
          rowHeight={ROW_H}
          defaultSort={{ key: "match", dir: -1 }}
          group={chosenFirst}
          ariaLabel="Similar teams"
          empty={<p className="px-5 py-10 text-[13px] text-ink-muted">No team-season shares enough of this profile.</p>}
          object={(r): Obj => ({ kind: "team", name: r.c.row.name, logoId: r.c.row.logoId, year: r.c.year, conf: r.c.row.conf })}
          peek={{
            label: (r) => `${r.c.row.name} ${seasonLabel(r.c.year)}`,
            body: (r) => (
              <ComparePeek m={r.m} profile={profile} chosen={subject ? `${subject.row.name} ’${String(subject.year).slice(-2)}` : ""} other={`${r.c.row.name} ’${String(r.c.year).slice(-2)}`} />
            ),
          }}
        />
      }
    />
  );
}

const PLAYER_IDENTITY: Column<SRow<Player>>[] = [
  {
    key: "name", label: "Player", width: 224, align: "left", first: 1, pin: true,
    sortValue: (r) => r.c.row.name,
    cell: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <PlayerPhoto bartId={r.c.row.bartId} hasPhoto={r.c.row.hasPhoto} name={r.c.row.name} size={24} />
        <span className={`truncate font-medium ${r.m ? "text-ink" : "text-accent"}`}>{r.c.row.name}</span>
        <ClassBadge cls={r.c.row.cls} />
      </span>
    ),
    text: (r) => r.c.row.name,
  },
  {
    key: "team", label: "Team", width: 150, align: "left", first: 1,
    sortValue: (r) => r.c.row.team,
    cell: (r) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <TeamLogo id={r.c.row.teamLogoId} name={r.c.row.team} size={16} />
        <span className="truncate text-ink-soft">{r.c.row.team}</span>
      </span>
    ),
    text: (r) => r.c.row.team,
  },
];

function PlayerSimilar({ q, write, fallbackYear }: { q: SimilarQuery; write: (next: Partial<SimilarQuery>) => void; fallbackYear: number }) {
  const active = useIsActive();
  const pool = usePlayerPool(true);
  const year = q.year ?? fallbackYear;
  const profile = PLAYER_PROFILES.find((p) => p.key === q.on) ?? PLAYER_PROFILES[0]!;
  const complete = pool.done === pool.total;
  const scales = useMemo(() => (complete ? seasonScales(pool.rows, PLAYER_FEATURES) : null), [complete, pool.rows]);
  const subject = useMemo(
    () => (q.player != null ? (pool.rows.find((c) => c.year === year && c.row.bartId === q.player) ?? null) : null),
    [pool.rows, year, q.player],
  );
  const matches = useMemo(
    () => (subject && scales ? findSimilar(subject, pool.rows, profile, scales, { limit: 50, keep: keepFor(q.scope, subject.year) }) : []),
    [subject, scales, pool.rows, profile, q.scope],
  );
  const rows = useMemo<SRow<Player>[]>(() => (subject ? [{ key: subject.id, c: subject, m: null }, ...matches.map((m) => ({ key: m.c.id, c: m.c, m }))] : []), [subject, matches]);
  const columns = useMemo(() => resultColumns(PLAYER_IDENTITY, profile, playerPct, playerShort, subject), [profile, subject]);
  const name = subject?.row.name ?? q.name;
  useTabTitle(name ? `Players like ${name} ${seasonLabel(year)}` : "Find Similar");
  const card: SimilarCardData | null =
    subject && complete
      ? {
          kind: "player",
          title: `Players like ${subject.row.name} ${seasonLabel(subject.year)}`,
          mark: (size) => <PlayerPhoto bartId={subject.row.bartId} hasPhoto={subject.row.hasPhoto} name={subject.row.name} size={size} />,
          name: subject.row.name,
          facts: [subject.row.team, seasonLabel(subject.year)].join(" · "),
          profile: profile.label,
          scope: SCOPES.find((s) => s.key === q.scope)?.label ?? "Every season",
          pool: `${pool.rows.length.toLocaleString()} player-seasons`,
          entries: matches.slice(0, 15).map((m) => ({
            key: m.c.id,
            mark: (size: number) => <PlayerPhoto bartId={m.c.row.bartId} hasPhoto={m.c.row.hasPhoto} name={m.c.row.name} size={size} />,
            name: m.c.row.name,
            sub: [m.c.row.team, `${seasonLabel(m.c.year)}${FLAGGED_SEASONS.has(m.c.year) ? " (COVID)" : ""}`].join(" · "),
            score: Math.round(m.score),
            alike: alikeAndApart(m).alike.join(", "),
          })),
        }
      : null;
  const current: SubjectRef | null =
    subject && subject.row.bartId != null
      ? { kind: "player", year: subject.year, bartId: subject.row.bartId, name: subject.row.name, team: subject.row.team, hasPhoto: subject.row.hasPhoto }
      : null;
  const buildExport = () =>
    similarExport(
      rows,
      profile,
      playerPct,
      {
        title: subject ? `Players like ${subject.row.name} ${seasonLabel(subject.year)}` : "Find Similar",
        header: "Player",
        stem: "similar-players",
        identity: [
          { header: "Player", width: 24, get: (r) => r.c.row.name },
          { header: "Team", width: 22, get: (r) => r.c.row.team },
        ],
      },
      q.scope,
    );

  const note =
    subject && complete && q.player != null && !pool.rows.some((c) => c.year === year && c.row.bartId === q.player)
      ? `${name} is not on the ${seasonLabel(year)} leaderboard.`
      : subject && FLAGGED_SEASONS.has(year)
        ? "2020-21 was the COVID season, so its numbers compare less cleanly."
        : subject && profile.key === "impact" && year < 2024
          ? "Before 2023-24, EPM is the box-score estimate, not the play-by-play fit."
          : null;

  return (
    <Layout
      q={q}
      write={write}
      profiles={PLAYER_PROFILES}
      pool={pool}
      noun="player-seasons"
      actions={<Actions q={q} write={write} current={current} ready={complete && subject != null} build={buildExport} card={card} />}
      subject={subject}
      matches={matches}
      note={note}
      chosenLabel={(c) => c.row.name}
      chooser={
        <>
          <PlayerChooser year={year} bartId={q.player} name={q.name} onPick={(bartId, n) => write({ player: bartId, name: n, year })} startOpen={active && q.player == null} />
          <SeasonStep year={year} onYear={(y) => write({ year: y })} />
        </>
      }
      table={
        <DataTable
          key={`player|${profile.key}|${subject?.id}|${q.scope}`}
          id="find-similar-players"
          rows={rows}
          columns={columns}
          rowKey={rowKey}
          rowHeight={ROW_H}
          defaultSort={{ key: "match", dir: -1 }}
          group={chosenFirst}
          ariaLabel="Similar players"
          empty={<p className="px-5 py-10 text-[13px] text-ink-muted">No player-season shares enough of this profile.</p>}
          object={(r): Obj | null =>
            r.c.row.bartId == null
              ? null
              : { kind: "player", bartId: r.c.row.bartId, name: r.c.row.name, hasPhoto: r.c.row.hasPhoto, year: r.c.year, team: r.c.row.team, teamLogoId: r.c.row.teamLogoId, conf: r.c.row.conf }
          }
          peek={{
            label: (r) => `${r.c.row.name} ${seasonLabel(r.c.year)}`,
            body: (r) => (
              <ComparePeek m={r.m} profile={profile} chosen={subject ? `${subject.row.name.split(" ").slice(-1)[0]} ’${String(subject.year).slice(-2)}` : ""} other={`${r.c.row.name.split(" ").slice(-1)[0]} ’${String(r.c.year).slice(-2)}`} />
            ),
          }}
        />
      }
    />
  );
}

export function FindSimilarView({ year, query, setQuery }: ViewProps) {
  const q = useMemo(() => parseSimilarQuery(query), [query]);
  const write = (next: Partial<SimilarQuery>) => setQuery(similarQuery({ ...q, ...next }));
  return q.kind === "player" ? <PlayerSimilar q={q} write={write} fallbackYear={year} /> : <TeamSimilar q={q} write={write} fallbackYear={year} />;
}
