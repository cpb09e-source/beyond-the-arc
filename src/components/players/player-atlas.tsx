import Link from "next/link";
import { CLASS_BADGE } from "@/lib/class-badge";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { TopHundredSeal } from "@/components/players/top-hundred-seal";
import { TeammatePicker } from "@/components/players/teammate-picker";
import type { StatLine } from "@/lib/player-stat-line";
import { NbaTeamLogo } from "@/components/nba-team-logo";
import type { PlayerRanksSeason } from "@/lib/static-data";
import { formatHeight } from "@/lib/height";

/**
 * Player hero — "Atlas".
 *
 * Small multiples instead of a stat line. Six modules, each carrying one
 * headline number and one picture of it: scoring and playmaking as the season's
 * game-by-game columns, efficiency as a curve against the season average, the
 * rate stats as bars on the site percentile ramp, and impact split into its
 * offensive and defensive halves.
 *
 * The reason for the change: a row of figures can say a player averaged 19.5,
 * but not that he averaged 5.7 the year before, or that he cleared 25 in six
 * games and was held under 12 in five. Both of those are already in the data we
 * ship; they were just never drawn. Every delta chip and every chart here comes
 * from files the page already had open.
 *
 * Degrades in one direction only. No game log (a pre-2024 season, or a roster
 * addition who has not played) drops the three charts and leaves the numbers
 * and their percentiles; a single-season player loses the delta chips; an
 * unranked season loses the percentile chips and the rings. The grid keeps its
 * six modules in every case, because which ones survive varies by player and a
 * reflowing hero reads as broken rather than as adaptive.
 */

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The cohort a player is ranked in, spelled out. Bart's own role notes
 *  ("Stretch 4", "Wing G") are finer but they are his vocabulary, not the
 *  site's, and the percentiles beside them are cohorted by these three. */
const POSITION_LABEL: Record<"G" | "F" | "C", string> = {
  G: "Guard",
  F: "Forward",
  C: "Center",
};

/**
 * Position and class, as badges rather than two more entries in the vitals run.
 *
 * Both answer "what kind of player is this" before any number does, and in a
 * dot-separated run they read as the same weight as a hometown. A badge is also
 * how the rest of the site already marks a category — the tournament seed chip,
 * the transfer chip, the draft chip beside these very vitals.
 *
 * POSITION IS HUED BY BUCKET, not by the accent. Three positions want three
 * colours, and there are exactly three tokens on the site that carry meaning
 * without being the accent: the hardwood, the chart green and the chart red.
 * Guard takes the accent because guards are the largest bucket and the accent
 * is the most neutral of the four in this palette.
 *
 * CLASS REUSES THE PLAYERS EXPLORER'S FOUR, by token. A reader who has just
 * filtered the explorer by class should meet the same amber on the junior they
 * clicked through to.
 */
const POSITION_BADGE: Record<"G" | "F" | "C", { bg: string; border: string; fg: string }> = {
  // The text mixes its hue 66% toward --ink, which is navy on the light theme
  // and cream on the dark one — so one expression darkens or lightens as the
  // theme needs. The raw tokens are chart and accent colours and do not clear
  // AA as small text on their own tints: --coral measured 3.95 and --good 3.73
  // on paper. Mixed, they clear 5.6-6.7 on both grounds.
  //
  // Centre is the exception: --court is a light tan and mixing it toward navy
  // still does not darken enough (3.4). --court-ink exists for exactly this —
  // hardwood dark enough to set text on a hardwood tint — and clears 4.6.
  G: {
    bg: "color-mix(in oklab, var(--color-coral) 16%, transparent)",
    border: "color-mix(in oklab, var(--color-coral) 40%, transparent)",
    fg: "color-mix(in oklab, var(--color-coral) 66%, var(--ink))",
  },
  F: {
    bg: "color-mix(in oklab, var(--good) 16%, transparent)",
    border: "color-mix(in oklab, var(--good) 42%, transparent)",
    fg: "color-mix(in oklab, var(--good) 66%, var(--ink))",
  },
  C: {
    bg: "color-mix(in oklab, var(--court) 16%, transparent)",
    border: "color-mix(in oklab, var(--court) 50%, transparent)",
    fg: "var(--court-ink)",
  },
};

const CLASS_LABEL: Record<string, string> = {
  Fr: "Freshman",
  So: "Sophomore",
  Jr: "Junior",
  Sr: "Senior",
};

function Badge({
  children, bg, border, fg, title,
}: {
  children: React.ReactNode;
  bg: string; border: string; fg: string; title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: bg, borderColor: border, color: fg }}
    >
      {children}
    </span>
  );
}

type DraftChip = { team: string; logo: string | null; round: number; pick: number };

/** The vitals run, rendered once and placed twice — under the name on desktop,
 *  full width under the photo on a phone. */
/**
 * The stat band — seven figures for the season on screen. Counting stats on the
 * first row, shooting on the second.
 *
 * EVERY WIDTH. It was xl:hidden, on the argument that the career table below
 * is the canonical record and states these figures in full wherever it can lay
 * out all twenty of its columns — measured at about 1293px of wrapper, so 1440
 * fits exactly and 1280 is 13px short.
 *
 * The argument holds and the conclusion still went. A summary the reader has to
 * scroll to a second card to find is not a duplicate of that card; it is the
 * line the hero should have carried in the first place, and hiding it above
 * 1280 made the widest screens the only ones without it. Repetition a card
 * apart is a cheaper fault than a hero that answers "what is he doing this
 * year" only on a laptop.
 *
 * THE SEASON ONLY. A career figure under each of these was tried and dropped:
 * it doubled the band's height for a line the career table states in full a
 * card below, and on a 390px phone "45.2 CAREER" measured 79px against a 75px
 * cell, so the shooting row clipped where the counting row did not. The band is
 * the answer to "what is this player doing this year"; the table answers the
 * rest.
 */
function StatBand({ now }: { now: StatLine }) {
  // ORDER IS THE LAYOUT. Four counting stats then three shooting rates, in a
  // grid four wide — so a phone gets games/PPG/RPG/APG on one line and
  // FG%/3P%/FT% on the next without either row being declared. The split is
  // also the right one to read on: the first four are how much a player did and
  // the last three are how well he did it, and they do not compare to each
  // other. From md the grid opens to seven and they all sit on one line.
  //
  // Each figure gets its own tile rather than sitting bare in a ruled column.
  // Seven numbers read as a run whatever you set them in; a bordered cell makes
  // the 4+3 wrap look deliberate instead of like a row that ran out of width,
  // which is the one thing the ruled version could not fix.
  const cells = [
    { unit: "Games", value: int(now.games) },
    { unit: "PPG", value: one(now.ppg) },
    { unit: "RPG", value: one(now.rpg) },
    { unit: "APG", value: one(now.apg) },
    { unit: "FG%", value: one(now.fgPct) },
    { unit: "3P%", value: one(now.fg3Pct) },
    { unit: "FT%", value: one(now.ftPct) },
  ];

  return (
    // No rule above the band. Bare figures needed one to separate them from the
    // vitals; a row of bordered cells is already a block, and a hairline on top
    // of it is a second edge doing the first one's job.
    <div className="mt-5 grid grid-cols-4 md:grid-cols-7 gap-2">
      {cells.map((c) => (
        <div
          key={c.unit}
          // Tinted with --ink at 4%, not with a surface token. On the dark theme
          // --paper-deep and --card both resolve to the #242424 the hero card is
          // already painted in, so a tile drawn in either would be invisible and
          // its border would be doing all the work. Mixing the INK gives a tint
          // that flips with the theme: a whisper of navy on paper, a whisper of
          // cream on black.
          className="min-w-0 rounded-lg border border-ink/10 bg-ink/[0.04] px-2 sm:px-3 pt-2 pb-2.5"
        >
          <div className="label">{c.unit}</div>
          <div className="font-display tabular text-ink leading-[1.1] mt-1 text-[1.5rem] sm:text-[1.65rem] tracking-[-0.035em]">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function int(x: number | null): string {
  return x === null || x === undefined ? "—" : Math.round(x).toLocaleString("en-US");
}
function one(x: number | null): string {
  return x === null || x === undefined
    ? "—"
    : x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function Vitals({
  vitals, draft, bucket, playerClass,
}: {
  vitals: string[];
  draft: DraftChip | null;
  bucket: "G" | "F" | "C";
  /** Fr | So | Jr | Sr, from the most recent season. Null before 2014. */
  playerClass: string | null;
}) {
  const pos = POSITION_BADGE[bucket];
  const cls = playerClass && CLASS_LABEL[playerClass] ? playerClass : null;
  return (
    <>
      <Badge bg={pos.bg} border={pos.border} fg={pos.fg} title={POSITION_LABEL[bucket]}>
        {POSITION_LABEL[bucket]}
      </Badge>
      {cls && (
        <Badge
          title={`${CLASS_LABEL[cls]} — most recent season`}
          bg={CLASS_BADGE[cls]!.bg}
          border="transparent"
          fg={CLASS_BADGE[cls]!.fg}
        >
          {CLASS_LABEL[cls]}
        </Badge>
      )}
      {vitals.map((v, i) => (
        <span key={v} className="flex items-center gap-2">
          {i > 0 && <span className="text-ink-muted/60">·</span>}
          {v}
        </span>
      ))}
      {draft && (
        <span className="inline-flex items-center gap-2 rounded-md bg-court/15 border border-court/40 px-2 py-0.5">
          <span className="label" style={{ color: "var(--court-ink)" }}>
            Drafted
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink font-medium whitespace-nowrap">
            <NbaTeamLogo src={draft.logo} name={draft.team} size={18} />
            {draft.team}
          </span>
          <span className="tabular text-[0.6875rem] text-ink-muted whitespace-nowrap">
            Round {draft.round} · Pick {draft.pick}
          </span>
        </span>
      )}
    </>
  );
}

export function PlayerAtlas({
  bartId,
  name,
  year,
  teamName,
  conference,
  height,
  weight,
  hometown,
  highSchool,
  rsci,
  playerClass,
  statNow,
  draft,
  heroRanks,
  bucket,
  teammates,
  banner,
}: {
  bartId: number;
  name: string;
  year: number;
  teamName: string;
  conference: string | null;
  height: string | null;
  /**
   * Weight and high school are not in any dataset the site ships — not Bart's
   * 67-column row, not players-index, not official-rosters (names and slugs
   * only). They are declared here because the athletics roster pages that
   * `patch-preview-additions.mjs` already parses carry both, so wiring them is
   * a scrape away rather than a redesign. Null until that lands; the line just
   * omits them.
   */
  weight: string | null;
  hometown: string | null;
  highSchool: string | null;
  /** RSCI consensus recruiting rank, 1-100. The one recruiting ranking the site
   *  is cleared to print, and only worth stating when it is a top-100 one. */
  rsci: number | null;
  /** Fr | So | Jr | Sr for the season on screen. Null where the source has none. */
  playerClass: string | null;
  /** The seven-figure line for the season on screen. Only rendered below xl —
   *  see the note on StatBand. */
  statNow: StatLine;
  /** Rendered as a chip beside the vitals — being drafted is a permanent fact
   *  about the player, so it belongs with the identity rather than in a banner
   *  that reads as news. */
  draft: DraftChip | null;
  heroRanks: PlayerRanksSeason | null;
  /** Everyone else on this team in this season who has a profile page. */
  teammates: Array<{ id: number; name: string; cls: string | null }>;
  /** Position cohort the season was ranked in. Only the ranked-cohort label in
   *  the seal's tooltip needs it now that the stat modules have moved out. */
  bucket: "G" | "F" | "C";
  banner?: React.ReactNode;
}) {
  // Only the fields we actually hold. An empty vitals line renders as a single
  // em dash rather than a row of orphaned separators.
  // Position is a badge now and no longer belongs in the dotted run.
  const vitals = [
    formatHeight(height),
    weight,
    hometown,
    highSchool,
    rsci !== null ? `RSCI #${rsci}` : null,
  ].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (vitals.length === 0) vitals.push("—");

  return (
    <section className="mx-auto max-w-[88rem] px-0 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-5 sm:pb-6">
      <div className="bg-[color-mix(in_oklab,var(--card)_55%,var(--paper-deep))] border-y sm:border border-ink/10 sm:rounded-xl shadow-md overflow-hidden ring-0 sm:ring-1 ring-ink/5 px-5 sm:px-7 lg:px-9 py-6 sm:py-7">
        {/* Masthead — the whole card now. It carried a 2px rule along its
            bottom edge for as long as there was something under it: six stat
            modules, then a stat band. Both have gone, so the rule was drawing
            a line under the last thing in the card and reading as a stray
            border rather than a divider. The card's own edge does that job. */}
        <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-7">
          {/* Photo and name ride the same row at every width. Stacked, the photo
              ate the top of a phone screen before the name had been read. */}
          <div className="flex items-center md:items-end gap-4 md:gap-7 min-w-0">
            <PlayerPhoto bartPlayerId={bartId} name={name} size={84} />

            <div className="min-w-0 flex flex-col gap-1.5 md:gap-2">
            {/* No accent rule ahead of the crest. A 20px hairline immediately
                left of a round logo and a school name does not read as the
                editorial rule it is elsewhere on the site — it reads as a
                hyphen joined to the word, as though the school were called
                "-Iowa St." The rule earns its place above a heading, where
                nothing follows it on the same line; here the crest already
                marks where the line starts. */}
            <div className="flex items-center gap-2 label min-w-0 flex-nowrap whitespace-nowrap" style={{ color: "var(--coral)" }}>
              <Link
                href={`/teams/${teamSlug(teamName)}/${year}/`}
                // The school sets larger than the rest of this line. It is the
                // second thing a reader looks for after the name, and at the
                // shared `label` size it was 10px — the same weight as the
                // conference code beside it. Conference and season stay small
                // deliberately: they are the qualifiers, not the subject.
                className="inline-flex items-center gap-2 text-[0.8125rem] sm:text-sm hover:text-coral-soft transition-colors"
              >
                <TeamLogo name={teamName} size={22} />
                <span className="truncate">{teamName}</span>
              </Link>
              {conference && <span className="text-ink-muted shrink-0">· {conference}</span>}
              {/* The season is the first thing to go on a phone that is also
                  carrying two seals on this line. It is not lost — the vitals
                  below and the career table both state it. */}
              <span className="text-ink-muted shrink-0 hidden sm:inline">· {seasonLabel(year)}</span>
            </div>

            <h1 className="font-display text-2xl sm:text-5xl lg:text-[3.25rem] tracking-tight text-ink leading-[1.05] md:leading-[1.02] break-words">
              {name}
            </h1>

            {/* Vitals sit under the name on desktop but break out to full width
                below the photo on a phone — five fields and a draft chip do not
                fit in what is left beside a headshot. Wraps rather than
                truncates; a high-school name is the field most likely to push
                this past one line. */}
            <div className="hidden md:flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.8125rem] text-ink-soft">
              <Vitals vitals={vitals} draft={draft} bucket={bucket} playerClass={playerClass} />
            </div>
            </div>

            {/* Phone only, and inside the photo/name row rather than under it —
                the mark is identity, so it belongs on the line that carries the
                name. Compact only shrinks it; the wording does not change. */}
            {heroRanks && (
              <div className="md:hidden ml-auto shrink-0">
                <TopHundredSeal season={heroRanks} size={72} compact />
              </div>
            )}
          </div>

          <div className="flex md:hidden flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-soft">
            <Vitals vitals={vitals} draft={draft} bucket={bucket} playerClass={playerClass} />
          </div>

          {/* Rings were desktop-only, which left a phone with no sense of where
              the player stands at all — the thing the page is for. Smaller, and
              below the vitals rather than beside the name, because three of them
              at ring size do not fit next to a headshot. */}
          {/* The right-hand column of the masthead: the Top-100 mark, and the
              teammate picker under it. The picker keeps ml-auto even when the
              mark is absent, so it stays on the right edge for the ~99% of
              players who have no seal. */}
          <div className="hidden md:flex md:ml-auto shrink-0 md:pb-1 flex-col items-end gap-3">
            {heroRanks && <TopHundredSeal season={heroRanks} size={96} />}
            <TeammatePicker teammates={teammates} teamName={teamName} />
          </div>
        </div>

        <StatBand now={statNow} />

        {banner && <div className="pt-4">{banner}</div>}


      </div>
    </section>
  );
}
