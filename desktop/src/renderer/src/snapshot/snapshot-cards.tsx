import draftees from "@public/data/nba-draftees.json";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import { useEffect, type ReactNode } from "react";
import { isFinal, isLive, periodHeadings } from "@/components/game/types";
import { PercentileChip } from "@/components/percentile-chip";
import { CLASS_BADGE } from "@/lib/class-badge";
import { TOURNEY_ROUND_LABEL } from "@/lib/coach-views";
import { gameEyebrow } from "@/lib/game-stats";
import { draftRound, nbaLogoUrl, nbaTeamName, normNbaName, type NbaDraftee } from "@/lib/nba-draftees";
import { positionBucket } from "@/lib/player-cohort";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { useCoachBook, yearsSpan } from "~/data/coach-model";
import { loadPlayerSeason, type Player } from "~/data/player-model";
import { ncaaLabel, teamHistory } from "~/data/team-history";
import { ranksFor, shapeSeason, type Season } from "~/data/team-model";
import { useCorpus, useLoaded } from "~/data/use-corpus";
import { siteUrl, type Obj } from "~/objects/object";
import { CoachAvatar } from "~/ui/coach-avatar";
import { fmtRanked, num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { PlayerPhoto } from "~/ui/player-photo";
import { sideOf, useTeamNames } from "~/views/scoreboard/board-model";
import { useGame } from "~/views/game/game-model";
import { playerStat } from "~/views/players/player-columns";

/**
 * A snapshot card: one team, player, coach or game, laid out to be posted.
 *
 * THE APP'S OWN NUMBERS, CHIPS AND CRESTS, drawn by the same components the
 * pages use, at a fixed size a feed shows whole: Wide is 1200 × 675, the 16:9
 * card X and Bluesky display without cropping; Square is 1080 × 1080 for
 * Instagram and a group chat. The sheet (./snapshot-sheet.tsx) captures the
 * window's own pixels, so crests from the app's asset protocol draw exactly as
 * they do on screen, with none of a canvas's cross-origin rules to work around.
 *
 * EVERY CARD SAYS WHERE IT CAME FROM: the wordmark and the page's address sit on
 * its foot, so a card seen out of context still leads back to btacbb.xyz.
 */

export type CardFormat = "wide" | "square";
export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = {
  wide: { width: 1200, height: 675 },
  square: { width: 1080, height: 1080 },
};

export type SnapObj = Extract<Obj, { kind: "team" | "player" | "coach" | "game" }>;
export const isSnappable = (o: Obj): o is SnapObj => o.kind === "team" || o.kind === "player" || o.kind === "coach" || o.kind === "game";

type BodyProps<K extends SnapObj["kind"]> = { o: Extract<SnapObj, { kind: K }>; format: CardFormat; onReady: (ready: boolean) => void };

/** A card at its posted size: the body, then the wordmark and where the card leads. Other cards (Find Similar's) use it too. */
export function CardFrame({ format, foot, children }: { format: CardFormat; foot: string; children: ReactNode }) {
  const { width, height } = CARD_SIZE[format];
  const square = format === "square";
  return (
    <div className="flex flex-col bg-paper text-ink" style={{ width, height, padding: square ? "68px 68px 44px" : "48px 60px 30px" }}>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <footer className="flex shrink-0 items-center gap-4 border-t border-hairline pt-6">
        <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[26px] w-auto" />
        <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[26px] w-auto" />
        <span className="ml-auto truncate text-[18px] text-ink-muted">{foot}</span>
      </footer>
    </div>
  );
}

export function SnapshotCard({ obj, format, onReady }: { obj: SnapObj; format: CardFormat; onReady: (ready: boolean) => void }) {
  return (
    <CardFrame format={format} foot={(siteUrl(obj) ?? "https://btacbb.xyz/").replace(/^https:\/\//, "").replace(/\/$/, "")}>
      {obj.kind === "team" ? (
        <TeamBody o={obj} format={format} onReady={onReady} />
      ) : obj.kind === "player" ? (
        <PlayerBody o={obj} format={format} onReady={onReady} />
      ) : obj.kind === "coach" ? (
        <CoachBody o={obj} format={format} onReady={onReady} />
      ) : (
        <GameBody o={obj} format={format} onReady={onReady} />
      )}
    </CardFrame>
  );
}

function useReady(ready: boolean, onReady: (ready: boolean) => void) {
  useEffect(() => onReady(ready), [ready, onReady]);
}

function Pending({ text }: { text: string }) {
  return <div className="grid flex-1 place-items-center text-[22px] text-ink-muted">{text}</div>;
}

function Header({
  mark,
  name,
  facts,
  badges,
  right,
  square,
}: {
  mark: ReactNode;
  name: string;
  facts: string;
  badges?: ReactNode;
  right?: ReactNode;
  square: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-7">
        <div className="shrink-0">{mark}</div>
        <div className="min-w-0 flex-1">
          <h1 className={`truncate font-semibold leading-[1.04] tracking-[-0.03em] ${square ? "text-[64px]" : "text-[58px]"}`}>{name}</h1>
          <p className="mt-2.5 truncate text-[23px] text-ink-muted">{facts}</p>
          {badges && !square && <div className="mt-3.5 flex flex-wrap items-center gap-2.5">{badges}</div>}
        </div>
        {right && <div className="shrink-0 self-start pt-2 text-right">{right}</div>}
      </div>
      {/* Square has the height for a row of badges of their own, and not the width beside the photo. */}
      {badges && square && <div className="mt-6 flex flex-wrap items-center gap-3">{badges}</div>}
    </>
  );
}

function RankBadge({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-[15px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</div>
      <div className="mt-1 text-[68px] font-semibold leading-none tracking-[-0.03em] text-accent tabular">{value}</div>
    </>
  );
}

type Tile = { label: string; value: string; pct: number | null; neutral?: boolean };

/**
 * Six numbers, each with its place in the field. The chip rides beside the label
 * and the number takes the tile's whole width below, so a six-character record
 * never pushes the chip over the edge.
 */
function Tiles({ tiles, square }: { tiles: Tile[]; square: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-hairline bg-card px-5 pb-[18px] pt-4">
          <div className="flex h-[30px] items-center justify-between gap-3">
            <span className="truncate text-[18px] text-ink-muted">{t.label}</span>
            <PercentileChip pct={t.pct} neutral={t.neutral} className="min-w-[42px] px-1.5 py-[3px] text-[16px]" />
          </div>
          <div
            className="mt-2.5 whitespace-nowrap font-semibold leading-none tracking-[-0.02em] tabular"
            style={{ fontSize: square ? (t.value.length > 6 ? 50 : 58) : t.value.length > 5 ? 38 : 46 }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A line of facts under the numbers: who coached, how the season ended. */
function Facts({ items }: { items: Array<[label: string, value: string | null | undefined]> }) {
  const shown = items.filter((i): i is [string, string] => !!i[1]);
  if (shown.length === 0) return null;
  return (
    <div className="mt-6 flex flex-wrap gap-x-9 gap-y-2 text-[21px]">
      {shown.map(([label, value]) => (
        <span key={label} className="whitespace-nowrap">
          <span className="text-ink-muted">{label}</span> <span className="font-medium">{value}</span>
        </span>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3.5 text-[15px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{children}</h2>;
}

/** Wide: the numbers and the side list beside each other. Square: one above the other. */
function Body({ format, main, side, tight = false }: { format: CardFormat; main: ReactNode; side: ReactNode; tight?: boolean }) {
  return format === "wide" ? (
    <div className={`${tight ? "mt-7" : "mt-9"} grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-12`}>
      <div>{main}</div>
      <div className="min-w-0">{side}</div>
    </div>
  ) : (
    <div className={`${tight ? "mt-9 gap-9" : "mt-12 gap-12"} flex min-h-0 flex-1 flex-col`}>
      <div>{main}</div>
      <div className="min-w-0">{side}</div>
    </div>
  );
}

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

/** The coach and the tournament for a school's season, from the site's history. */
function seasonFacts(team: string, year: number, coachLabel: string, ncaaLabelText: string): Array<[string, string | null]> {
  const now = teamHistory(team).find((h) => h.year === year);
  return [
    [coachLabel, now?.coach ?? null],
    [ncaaLabelText, now ? (ncaaLabel(now) ?? "No bid") : null],
  ];
}

function TeamBody({ o, format, onReady }: BodyProps<"team">) {
  const [state] = useCorpus("teams", o.year, shapeTeams);
  const season = state.status === "ready" ? state.value : null;
  const team = season?.teams.find((t) => t.name === o.name) ?? null;
  useReady(!!team, onReady);
  if (!season) return <Pending text={state.status === "error" ? `${seasonLabel(o.year)} did not load.` : "Loading…"} />;
  if (!team) return <Pending text={`${o.name} has no season in ${seasonLabel(o.year)}.`} />;
  const ranks = ranksFor(season, team);
  const square = format === "square";
  return (
    <>
      <Header
        square={square}
        mark={<TeamLogo id={team.logoId} name={team.name} size={square ? 124 : 104} />}
        name={team.name}
        facts={[seasonLabel(o.year), team.confLabel, `${team.wins}–${team.losses}`].join(" · ")}
        right={team.btaRank != null ? <RankBadge label="BTA rank" value={`#${team.btaRank}`} /> : undefined}
      />
      <Body
        format={format}
        main={
          <>
            <Tiles
              square={square}
              tiles={[
                { label: "Adj O", value: num1(team.adjO), pct: team.pct.a_ortg ?? null },
                { label: "Adj D", value: num1(team.adjD), pct: team.pct.a_drtg ?? null },
                { label: "Net", value: signed1(team.adjNet), pct: team.pct.a_net ?? null },
                { label: "Tempo", value: num1(team.tempo), pct: team.pct.adjt ?? null, neutral: true },
                { label: "eFG%", value: pct1(team.efg), pct: team.pct.cbb_efg ?? null },
                { label: "SOS", value: num1(team.sos), pct: team.pct.adj_sos ?? null },
              ]}
            />
            <Facts items={seasonFacts(team.name, o.year, "Coach", "NCAA")} />
          </>
        }
        side={
          ranks && (
            <>
              <SectionLabel>Best in the country</SectionLabel>
              <ul className={`grid ${square ? "gap-3.5" : "gap-3"}`}>
                {ranks.top.slice(0, 5).map((s) => (
                  <li key={s.key} className={`grid grid-cols-[minmax(0,1fr)_auto_66px] items-center gap-4 ${square ? "text-[24px]" : "text-[21px]"}`}>
                    <span className="truncate text-ink-soft">{s.label}</span>
                    <span className="tabular">{fmtRanked(s)}</span>
                    <span className="flex justify-end">
                      <PercentileChip pct={s.total > 1 ? Math.round((100 * (s.total - s.rank)) / (s.total - 1)) : 100} className="min-w-[60px] px-1.5 py-[4px] text-[17px]">
                        #{s.rank}
                      </PercentileChip>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      />
    </>
  );
}

/**
 * Position and class as the site's player page marks them: position hued by its
 * bucket (guard in the accent, forward in the chart green, center in hardwood),
 * class in the explorer's four class colors. Bart's finer role note ("Stretch 4")
 * is his vocabulary, not the site's, so the card does not print it.
 */
const POSITION_BADGE: Record<"G" | "F" | "C", { label: string; bg: string; border: string; fg: string }> = {
  G: {
    label: "Guard",
    bg: "color-mix(in oklab, var(--coral) 16%, transparent)",
    border: "color-mix(in oklab, var(--coral) 40%, transparent)",
    fg: "color-mix(in oklab, var(--coral) 66%, var(--ink))",
  },
  F: {
    label: "Forward",
    bg: "color-mix(in oklab, var(--good) 16%, transparent)",
    border: "color-mix(in oklab, var(--good) 42%, transparent)",
    fg: "color-mix(in oklab, var(--good) 66%, var(--ink))",
  },
  C: {
    label: "Center",
    bg: "color-mix(in oklab, var(--court) 16%, transparent)",
    border: "color-mix(in oklab, var(--court) 50%, transparent)",
    fg: "var(--court-ink)",
  },
};
const CLASS_LABEL: Record<string, string> = { Fr: "Freshman", So: "Sophomore", Jr: "Junior", Sr: "Senior" };

function Badge({ children, bg, border, fg }: { children: ReactNode; bg: string; border: string; fg: string }) {
  return (
    <span
      className="inline-flex h-[38px] items-center whitespace-nowrap rounded-lg border px-3.5 text-[16px] font-semibold uppercase tracking-[0.1em]"
      style={{ background: bg, borderColor: border, color: fg }}
    >
      {children}
    </span>
  );
}

const DRAFTEES = draftees as Record<string, NbaDraftee>;

/**
 * The NBA draft, matched on name as the site's player page matches it, and only
 * when the draft came after the season on the card: a namesake drafted years
 * before this player's college season is someone else.
 */
function draftOf(p: Player, year: number): { team: string; logo: string | null; round: number; pick: number } | null {
  const d = DRAFTEES[normNbaName(p.name)];
  if (!d || d.pick == null || d.year < year) return null;
  return { team: nbaTeamName(d.team, d.year) ?? d.team ?? "", logo: appLogo(nbaLogoUrl(d.team, d.year)), round: draftRound(d.pick), pick: d.pick };
}

/** The site's ESPN mark, through the app's own asset protocol (main/index.ts), which reaches ESPN where the page cannot. */
function appLogo(url: string | null): string | null {
  const m = url ? /\/nba\/500\/([a-z]{2,4})\.png$/.exec(url) : null;
  return m ? `bta://nba/${m[1]}.png` : null;
}

function PlayerBadges({ p, year }: { p: Player; year: number }) {
  const bucket = positionBucket(p.position);
  const cls = p.cls && CLASS_BADGE[p.cls] ? p.cls : null;
  const draft = draftOf(p, year);
  if (!bucket && !cls && !draft) return null;
  return (
    <>
      {bucket && (
        <Badge bg={POSITION_BADGE[bucket].bg} border={POSITION_BADGE[bucket].border} fg={POSITION_BADGE[bucket].fg}>
          {POSITION_BADGE[bucket].label}
        </Badge>
      )}
      {cls && (
        <Badge bg={CLASS_BADGE[cls]!.bg} border="transparent" fg={CLASS_BADGE[cls]!.fg}>
          {CLASS_LABEL[cls]}
        </Badge>
      )}
      {draft && (
        <span
          className="inline-flex h-[38px] items-center gap-2.5 whitespace-nowrap rounded-lg border px-3.5"
          style={{ background: "color-mix(in oklab, var(--court) 15%, transparent)", borderColor: "color-mix(in oklab, var(--court) 40%, transparent)" }}
        >
          <span className="text-[14px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--court-ink)" }}>
            Drafted
          </span>
          {draft.logo && (
            <img
              src={draft.logo}
              alt=""
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              className="size-[24px] object-contain"
            />
          )}
          <span className="text-[18px] font-medium">{draft.team}</span>
          <span className="text-[15px] text-ink-muted tabular">
            Round {draft.round} · Pick {draft.pick}
          </span>
        </span>
      )}
    </>
  );
}

/**
 * What a player is worth, as a ledger rather than a row of bars: EPM leads, its
 * offense and defense beneath it, then the value of that impact over the minutes
 * played (eWins), how efficiently and how much of the offense he carried. Each
 * with its place among the season's players, in the site's chips.
 *
 * SQUARE FOLDS THE ROWS UNDER EPM INTO TWO COLUMNS: there the ledger sits under
 * the numbers rather than beside them, and six full-width rows ran into the foot.
 */
type ImpactRow = { key: string; st: NonNullable<ReturnType<typeof playerStat>> };

function ImpactLedger({ p, hasEwins, estimated, square }: { p: Player; hasEwins: boolean; estimated: boolean; square: boolean }) {
  const rows = ["epm", "off_epm", "def_epm", ...(hasEwins ? ["ewins"] : []), "ts_pct", "usg_pct"]
    .map((key) => ({ key, st: playerStat(key) }))
    .filter((r): r is ImpactRow => !!r.st);
  const [lead, ...rest] = rows;

  const cell = (r: ImpactRow, isLead: boolean, className = "") => {
    const split = r.key === "off_epm" || r.key === "def_epm";
    const label = split && !square ? (r.key === "off_epm" ? "Offense" : "Defense") : r.st.label;
    const pct = r.st.pctKey ? (p.pct[r.st.pctKey] ?? null) : null;
    return (
      <div
        key={r.key}
        className={`grid grid-cols-[minmax(0,1fr)_auto_62px] items-center gap-4 px-5 ${isLead ? "h-[64px]" : square ? "h-[54px]" : "h-[44px]"} ${className}`}
      >
        <span className={`truncate ${isLead ? "text-[22px] font-semibold" : split && !square ? "pl-5 text-[18px] text-ink-muted" : "text-[19px] text-ink-soft"}`}>{label}</span>
        <span className={`tabular ${isLead ? "text-[34px] font-semibold tracking-[-0.02em]" : "text-[21px]"}`}>{r.st.format(p.s[r.st.field] as number | null)}</span>
        <span className="flex justify-end">
          <PercentileChip pct={pct} className={isLead ? "min-w-[52px] px-1.5 py-[5px] text-[18px]" : "min-w-[44px] px-1.5 py-[3px] text-[15px]"} />
        </span>
      </div>
    );
  };

  return (
    <>
      <SectionLabel>{estimated ? "Impact · estimated from the box score" : "Impact"}</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-hairline bg-card">
        {lead && cell(lead, true)}
        <div className={square ? "grid grid-cols-2" : undefined}>
          {rest.map((r, i) =>
            cell(
              r,
              false,
              // An odd one out at the end takes the whole row rather than leaving an empty cell beside it.
              `border-t border-hairline ${square && i % 2 === 1 ? "border-l" : ""} ${square && i === rest.length - 1 && i % 2 === 0 ? "col-span-2" : ""}`,
            ),
          )}
        </div>
      </div>
    </>
  );
}

function PlayerBody({ o, format, onReady }: BodyProps<"player">) {
  const [state] = useLoaded(`player-season|${o.year}`, () => loadPlayerSeason(o.year));
  const season = state.status === "ready" ? state.value : null;
  const p = season?.roster.find((x) => x.bartId === o.bartId) ?? null;
  useReady(!!p, onReady);
  if (!season) return <Pending text={state.status === "error" ? `${seasonLabel(o.year)} did not load.` : "Loading…"} />;
  if (!p) return <Pending text={`${o.name} has no season in ${seasonLabel(o.year)}.`} />;
  const square = format === "square";

  // How much, then how well: the site's stat band, counting stats over shooting.
  const tiles = ["ppg", "rpg", "apg", "fg_pct", "fg3_pct", "ft_pct"].flatMap((key): Tile[] => {
    const st = playerStat(key);
    return st ? [{ label: st.label, value: st.format(p.s[st.field] as number | null), pct: st.pctKey ? (p.pct[st.pctKey] ?? null) : null }] : [];
  });

  return (
    <>
      <Header
        square={square}
        mark={<PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={square ? 132 : 112} />}
        name={p.name}
        facts={[p.team, seasonLabel(o.year), p.height, p.hometown].filter(Boolean).join(" · ")}
        badges={<PlayerBadges p={p} year={o.year} />}
        right={p.rank != null && p.rank <= 100 ? <RankBadge label="In the country" value={`#${p.rank}`} /> : <TeamLogo id={p.teamLogoId} name={p.team} size={76} />}
      />
      <Body
        format={format}
        tight
        main={
          <>
            <Tiles square={square} tiles={tiles} />
            <Facts items={seasonFacts(p.team, o.year, "Coach", "Team NCAA")} />
          </>
        }
        side={<ImpactLedger p={p} hasEwins={season.hasEwins} estimated={season.estimated} square={square} />}
      />
    </>
  );
}

function CoachBody({ o, format, onReady }: BodyProps<"coach">) {
  const [state] = useCoachBook();
  const book = state.status === "ready" ? state.value : null;
  const profile = book?.bySlug.get(o.slug) ?? null;
  const row = book?.rows.find((r) => r.slug === o.slug) ?? null;
  useReady(!!(profile && row), onReady);
  if (!book) return <Pending text={state.status === "error" ? "The coach history did not load." : "Loading…"} />;
  if (!profile || !row) return <Pending text={`${o.name} is not in the coach history.`} />;
  const square = format === "square";
  const rank = book.compositeRank.get(o.slug);
  const first = profile.by_year[profile.by_year.length - 1]?.year;
  const last = profile.by_year[0]?.year;
  const pctOf = (m: Map<string, number>) => m.get(o.slug) ?? null;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <Header
        square={square}
        mark={<CoachAvatar name={profile.name} team={profile.current_team} size={square ? 124 : 104} />}
        name={profile.name}
        facts={[
          profile.current_team,
          profile.is_active ? "Active" : "Former",
          first != null && last != null ? `${plural(profile.seasons_count, "season", "seasons")}, ${yearsSpan(first, last)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        right={rank != null ? <RankBadge label={`Of ${book.rows.length} coaches`} value={`#${rank}`} /> : undefined}
      />
      <Body
        format={format}
        main={
          <>
            <Tiles
              square={square}
              tiles={[
                { label: "Record", value: `${row.career_wins}–${row.career_losses}`, pct: null },
                { label: "Win %", value: row.career_win_pct == null ? "–" : (row.career_win_pct * 100).toFixed(1), pct: null },
                { label: "Score", value: num1(row.composite_score ?? null), pct: pctOf(book.pct.composite) },
                { label: "Net", value: signed1(row.adj_net_avg ?? null), pct: pctOf(book.pct.adjNet) },
                { label: "NCAA", value: String(row.ncaa_appearances), pct: null },
                { label: "Tourney", value: `${row.tourney_wins}–${row.tourney_losses}`, pct: row.ncaa_appearances > 0 ? pctOf(book.pct.tourneyWins) : null },
              ]}
            />
            <Facts
              items={[
                ["Best finish", row.best_finish ? TOURNEY_ROUND_LABEL[row.best_finish] : null],
                ["Final Fours", row.final_fours > 0 ? String(row.final_fours) : null],
                ["Titles", row.ncaa_titles > 0 ? String(row.ncaa_titles) : null],
              ]}
            />
          </>
        }
        side={
          <>
            <SectionLabel>Schools</SectionLabel>
            <ul className={`grid ${square ? "gap-4" : "gap-3.5"}`}>
              {profile.schools.slice(0, square ? 6 : 5).map((s) => (
                <li key={`${s.team}|${s.first_year}`} className={`grid grid-cols-[34px_minmax(0,1fr)_auto_92px] items-center gap-3 ${square ? "text-[23px]" : "text-[20px]"}`}>
                  <TeamLogo id={logoIdOf(s.team)} name={s.team} size={30} />
                  <span className="truncate text-ink-soft">{s.team}</span>
                  <span className="text-ink-muted tabular">{yearsSpan(s.first_year, s.last_year)}</span>
                  <span className="text-right tabular">
                    {s.wins}–{s.losses}
                  </span>
                </li>
              ))}
            </ul>
            {rank != null && <p className="mt-6 text-[17px] text-ink-muted">Ranked on a composite résumé against every coach since 2012-13.</p>}
          </>
        }
      />
    </>
  );
}

function GameBody({ o, format, onReady }: BodyProps<"game">) {
  const [state] = useGame(o.season, o.id);
  const namesState = useTeamNames();
  const names = namesState.status === "ready" ? namesState.value : null;
  const b = state.status === "ready" ? state.value : null;
  useReady(!!b && namesState.status !== "loading", onReady);
  if (state.status !== "ready") return <Pending text={state.status === "error" ? "The box score did not load." : "Loading…"} />;
  if (!b) return <Pending text="The archive holds no box score for this game." />;

  const g = b.game;
  const final = isFinal(g);
  const n = Math.max(g.home.periods.length, g.away.periods.length);
  const square = format === "square";
  const side = (s: typeof g.away, at: boolean) => {
    const lost = final && s.winner === false;
    return (
      <div className={`flex min-w-0 flex-col items-center gap-4 text-center ${lost ? "opacity-60" : ""}`}>
        <TeamLogo id={sideOf(names, s.team).logoId} name={s.team} size={square ? 150 : 120} />
        <div className="w-full truncate text-[34px] font-semibold tracking-[-0.02em]">
          {at && <span className="mr-2 text-ink-muted">@</span>}
          {s.rank != null && <span className="mr-2 text-[24px] text-ink-muted tabular">{s.rank}</span>}
          {s.team}
        </div>
      </div>
    );
  };
  const points = (s: typeof g.away) => (
    <span className={`font-semibold leading-none tracking-[-0.04em] tabular ${square ? "text-[120px]" : "text-[104px]"} ${final && s.winner === false ? "text-ink-muted" : ""}`}>
      {s.points ?? "–"}
    </span>
  );

  return (
    <>
      <p className="truncate text-[22px] text-ink-muted">{gameEyebrow(g)}</p>
      <div className={`grid flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-8 ${square ? "mt-6" : "mt-2"}`}>
        {side(g.away, false)}
        <div className="flex items-center gap-7">
          {points(g.away)}
          <span className="text-[18px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {final ? (n > 2 ? `Final/${n === 3 ? "OT" : `${n - 2}OT`}` : "Final") : isLive(g) ? "Live" : ""}
          </span>
          {points(g.home)}
        </div>
        {side(g.home, !g.neutralSite)}
      </div>
      {n > 0 && (
        <table className="mx-auto mb-6 text-[20px] tabular">
          <thead>
            <tr className="text-[14px] uppercase tracking-[0.1em] text-ink-muted">
              <th className="pr-6" />
              {periodHeadings(n).map((h) => (
                <th key={h} className="w-16 pb-1 text-right font-semibold">
                  {h}
                </th>
              ))}
              <th className="w-20 pb-1 text-right font-semibold">T</th>
            </tr>
          </thead>
          <tbody>
            {[g.away, g.home].map((s) => (
              <tr key={s.team}>
                <td className="py-1 pr-6 text-left text-ink-soft">{s.team}</td>
                {Array.from({ length: n }, (_, i) => (
                  <td key={i} className="text-right text-ink-soft">
                    {s.periods[i] ?? "–"}
                  </td>
                ))}
                <td className="text-right font-semibold">{s.points ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
