import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { GameRowTr } from "./game-row-client";
import { SeedChip } from "./seed-chip";
import type { CoachSeason, TourneyGame, TourneyRound } from "@/lib/coaches";

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function fullSeasonLabel(y: number): string {
  return `${y - 1}-${y.toString().slice(-2)}`;
}

// "How far they got" → numeric depth. Higher = deeper run.
const ROUND_DEPTH: Record<TourneyRound, number> = {
  "First Four": 0,
  "R64": 1,
  "R32": 2,
  "Sweet 16": 3,
  "Elite Eight": 4,
  "Final Four": 5,
  "Runner-up": 6,
  "Champion": 7,
};

// Number of tournament wins implied by reaching a given round.
// (R64 loss = 0 wins, R32 loss = 1 win, ..., Champion = 6 wins.)
const ROUND_WINS: Record<TourneyRound, number> = {
  "First Four": 0,
  "R64": 0,
  "R32": 1,
  "Sweet 16": 2,
  "Elite Eight": 3,
  "Final Four": 4,
  "Runner-up": 5,
  "Champion": 6,
};

const ROUND_LABEL: Record<TourneyRound, string> = {
  "First Four": "First Four",
  "R64": "First Round",
  "R32": "Second Round",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite Eight",
  "Final Four": "Final Four",
  "Runner-up": "Title runner-up",
  "Champion": "Champion",
};

const ROUND_SHORT: Record<TourneyRound, string> = {
  "First Four": "FF",
  "R64": "R64",
  "R32": "R32",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "FINAL",
  "Champion": "CHAMP",
};

/**
 * March Madness section. Lists every NCAA tournament year the coach has been
 * to: seed, school, result. Beneath each row, a thin strip of "round chips"
 * shows the team's path through the bracket — W/L · score · opponent per round.
 *
 * `gamesByTeamYear`: optional lookup of bracket games per (team, year). When
 * absent (older data, or no bracket scrape yet), the round-by-round strip is
 * just omitted.
 */
export function TournamentSuccess({
  seasons,
  gamesByTeamYear,
  tourneyWinsRank,
}: {
  seasons: CoachSeason[];
  gamesByTeamYear?: (team: string, year: number) => TourneyGame[];
  /** Pre-formatted rank (e.g. "3rd of 264"), or undefined. */
  tourneyWinsRank?: string;
}) {
  // "Tournament appearance" = we have a seed assigned.
  const tourneys = seasons.filter((s) => s.seed !== null).sort((a, b) => b.year - a.year);

  if (tourneys.length === 0) {
    return (
      <div className="text-sm text-ink-muted">
        No NCAA Tournament appearances in our data window (2012-13 through 2025-26).
      </div>
    );
  }

  // Summary stats
  const appearances = tourneys.length;
  const tourneyWins = tourneys.reduce(
    (sum, s) => sum + (s.round ? ROUND_WINS[s.round] : 0),
    0,
  );
  // Tournament losses: each appearance ends with a loss except for years won.
  const champions = tourneys.filter((s) => s.round === "Champion").length;
  const tourneyLosses = appearances - champions;
  const highestSeed = Math.min(...tourneys.map((s) => s.seed ?? 99));

  return (
    <div>
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden mb-6">
        <TourneyStat label="Appearances" value={String(appearances)} sub="NCAA Tournament" />
        <TourneyStat
          label="Tournament record"
          value={`${tourneyWins}-${tourneyLosses}`}
          rank={tourneyWinsRank ? `${tourneyWinsRank} in tourney wins` : undefined}
          tone="coral"
        />
        <TourneyStat label="Highest seed" value={`#${highestSeed}`} sub="best seed earned" />
      </div>

      {/* Year-by-year list */}
      <ul className="divide-y divide-hairline/60">
        {tourneys.map((s) => {
          const games = gamesByTeamYear ? gamesByTeamYear(s.team, s.year) : [];
          return (
            <li key={`${s.year}-${s.team}`} className="py-3.5">
              <div className="flex items-center gap-3 lg:gap-4">
                {/* Year — small "YEAR" label on top, 2-digit year below. */}
                <div className="shrink-0 w-14 text-left leading-tight">
                  <div className="text-[0.55rem] uppercase tracking-widest text-ink-muted font-medium">
                    Year
                  </div>
                  <div className="text-sm tabular text-ink mt-0.5">
                    {seasonLabel(s.year)}
                  </div>
                </div>
                {/* Seed — minimal, tier-colored. */}
                <SeedChip seed={s.seed!} />
                {/* Team + record-in-parens */}
                <Link href={`/teams/${teamSlug(s.team)}/`} className="inline-flex items-baseline gap-2 group min-w-0 flex-1" prefetch={false}>
                  <TeamLogo name={s.team} size={28} />
                  <span className="font-medium text-ink group-hover:text-coral transition-colors truncate self-center">
                    {s.team}
                  </span>
                  <span className="text-xs tabular text-ink-muted self-center">
                    ({s.wins}-{s.losses})
                  </span>
                </Link>
                {/* Outcome */}
                <RoundOutcome round={s.round} />
              </div>
              {/* Round-by-round game log — mini table layout, clickable rows
                  → box score modal. */}
              {games.length > 0 && (
                <div className="mt-2 ml-12 sm:ml-16 mr-2 max-w-2xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[0.55rem] uppercase tracking-widest text-ink-muted font-medium border-b border-hairline/60">
                        <th className="py-1.5 pr-3 w-10">Round</th>
                        <th className="py-1.5 px-3">Opp</th>
                        <th className="py-1.5 pl-3 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((g, i) => (
                        <GameRow key={i} game={g} teamName={s.team} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TourneyStat({ label, value, sub, rank, tone = "default" }: { label: string; value: string; sub?: string; rank?: string; tone?: "default" | "coral" }) {
  return (
    <div className="bg-paper/70 p-4 lg:p-5">
      <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-2">{label}</div>
      <div className={`font-display text-3xl md:text-4xl tabular leading-none ${tone === "coral" ? "text-coral" : "text-ink"}`}>{value}</div>
      {rank && <div className="text-[0.65rem] tabular text-coral font-medium mt-2 uppercase tracking-widest">{rank}</div>}
      {sub && <div className="text-xs text-ink-muted mt-1.5">{sub}</div>}
    </div>
  );
}

function RoundOutcome({ round }: { round: TourneyRound | null }) {
  if (!round) {
    return (
      <span className="text-xs text-ink-muted shrink-0 text-right">qualified · result unknown</span>
    );
  }
  const depth = ROUND_DEPTH[round];
  const isDeep = depth >= 5; // Final Four+
  const isChamp = round === "Champion";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium tabular shrink-0 ${
        isChamp
          ? "bg-coral text-card"
          : isDeep
            ? "bg-coral/15 text-coral"
            : "border border-hairline text-ink-soft"
      }`}
    >
      {isChamp && <span className="font-display">★</span>}
      {ROUND_LABEL[round]}
    </span>
  );
}


/**
 * One round's result for the coach's team — single line. Layout:
 *
 *   ROUND   W   78–40   [16] [logo]
 *
 * The score group is a link to the SR box score (opens in a new tab). The
 * opponent's seed appears as a small chip before its logo; the school name
 * is dropped — the logo carries the identity.
 */
function GameRow({ game, teamName }: { game: TourneyGame; teamName: string }) {
  const teamIsWinner = sameSchool(game.winner.school, teamName);
  const oppCell = teamIsWinner ? game.loser : game.winner;
  const yourCell = teamIsWinner ? game.winner : game.loser;
  const result = teamIsWinner ? "W" : "L";
  const gameSlug = game.boxscore_url
    ? game.boxscore_url.replace(/^\/cbb\/boxscores\//, "").replace(/\.html$/, "")
    : null;
  const sportsRefHref = game.boxscore_url
    ? `https://www.sports-reference.com${game.boxscore_url}`
    : "";
  const title = `${ROUND_LABEL[game.round]} · ${result} ${yourCell.score}–${oppCell.score} vs ${oppCell.school} — click for box score`;

  return (
    <GameRowTr
      year={game.year}
      gameSlug={gameSlug}
      sportsRefHref={sportsRefHref}
      title={title}
    >
      <td className="py-1.5 pr-3 text-[0.7rem] uppercase tracking-widest text-ink-soft font-semibold">
        {ROUND_SHORT[game.round]}
      </td>
      <td className="py-1.5 px-3">
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-muted">vs</span>
          {oppCell.seed !== null && <SeedChip seed={oppCell.seed} size="sm" />}
          <TeamLogo name={oppCell.school} size={18} />
          <span className="text-ink">{oppCell.school}</span>
        </span>
      </td>
      <td className="py-1.5 pl-3 text-right tabular">
        <span className={`font-semibold ${teamIsWinner ? "text-coral" : "text-ink-soft"}`}>
          {result}
        </span>{" "}
        <span className="text-ink">
          {yourCell.score}-{oppCell.score}
        </span>
      </td>
    </GameRowTr>
  );
}

/**
 * Match a Sports-Reference bracket school name against a Bart team name.
 *
 * THIS DECIDES WHO WON. `teamIsWinner` is computed by matching the coach's team
 * against the game's winner, so a false negative doesn't just mis-label a name —
 * it flips the whole row. Every UConn tournament game on every UConn coach page
 * rendered as a LOSS to "UConn", including the 2024 title game, because the
 * bracket data says "UConn" and Bart says "Connecticut" and a bare
 * strip-punctuation compare can never equate those.
 *
 * Three passes, cheapest first. Measured against all 233 school names in
 * tournament-games.json: a bare compare left 54 unmatched, normalization plus
 * the shared alias table plus a parenthetical retry left 7, and the explicit map
 * below covers those.
 */
function sameSchool(a: string, b: string): boolean {
  const ka = schoolKeys(a);
  return schoolKeys(b).some((k) => ka.includes(k));
}

/**
 * Sports-Reference abbreviations with no algorithmic route to Bart's spelling.
 * Only genuine abbreviations belong here — anything normalization can reach
 * should be left to `norm`.
 */
const SR_SCHOOL_ALIASES: Record<string, string> = {
  "UNC": "North Carolina",
  "Pitt": "Pittsburgh",
  "UMass": "Massachusetts",
  "UConn": "Connecticut",
  "Ole Miss": "Mississippi",
  "ETSU": "East Tennessee St.",
  "FDU": "Fairleigh Dickinson",
  "Loyola (IL)": "Loyola Chicago",
  "College of Charleston": "Charleston",
  "California Baptist": "Cal Baptist",
  "Grambling": "Grambling St.",
  "McNeese": "McNeese St.",
  "Omaha": "Nebraska Omaha",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris",
};

/**
 * Candidate keys for one school name — a parenthetical qualifier is tried BOTH
 * ways, which is the whole reason this returns a list.
 *
 * Bart drops the parentheses but keeps the qualifier for "Miami (FL)" →
 * "Miami FL", and drops the qualifier entirely for "Albany (NY)" → "Albany".
 * Picking either rule alone breaks the other, and picking "always strip the
 * qualifier" collapses Miami (FL) and Miami (OH) onto the same key — two real
 * schools that have both been in the same bracket.
 */
function schoolKeys(s: string): string[] {
  const aliased = SR_SCHOOL_ALIASES[s.trim()] ?? s;
  const keys = new Set<string>();
  keys.add(norm(aliased));                                   // "Miami (FL)" -> miamifl
  keys.add(norm(aliased.replace(/\s*\([^)]*\)\s*$/, "")));    // "Albany (NY)" -> albany
  keys.delete("");
  return [...keys];
}

/**
 * Folds "St." and "State" onto one token — the single biggest divergence
 * between the two vocabularies ("Michigan State" vs "Michigan St."). Parentheses
 * are dropped but their CONTENTS are kept; schoolKeys() supplies the
 * qualifier-removed variant separately.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9]+/g, "");
}
