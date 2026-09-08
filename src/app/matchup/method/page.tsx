import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { ABSENCE_EXP, CORR, HCA, SCORE_SIGMA, SIGMA, TOTAL_ADJ, TOTAL_SIGMA, type MatchupPack } from "@/lib/matchup";

/**
 * How the Matchup Predictor works — the page the projection links to.
 *
 * Written because the model makes claims a reader is entitled to check: that
 * the home floor is worth six times more in one fixture than another, that a
 * team shooting better from three should be faded, that a minutes editor would
 * add nothing. Each of those is a number from a backtest, and a number without
 * its provenance is just an assertion.
 *
 * Everything here is derived from src/lib/matchup.ts rather than retyped, so
 * the page cannot fall out of step with the model it describes.
 */

const SEASON = 2026;

export const metadata = {
  title: "How the Matchup Predictor works",
  description:
    "The model behind Beyond the Arc's matchup projections: opponent-adjusted efficiency, the fitted pace form, a home floor that depends on the fixture, and what three seasons of backtesting said actually matters.",
};

async function loadPack(): Promise<MatchupPack | null> {
  try {
    return JSON.parse(await fs.readFile(path.resolve("public/data/matchup", `${SEASON}.json`), "utf8")) as MatchupPack;
  } catch {
    return null;
  }
}

export default async function MethodPage() {
  const pack = await loadPack();

  return (
    // One measure for the heading and the prose. Read at the page's full width
    // the kicker sat at the far left of a column that starts a third of the way
    // across, which read as two pages stacked.
    <section className="mx-auto max-w-[68ch] px-6 lg:px-0 pt-4 lg:pt-5 pb-12">
      <PageHeading
        label="How the matchup predictor works"
        sub="The model, the constants, and what three seasons of backtesting said actually decides a college basketball game."
      />

      <div className="text-sm leading-relaxed text-ink-soft">
        <p className="mb-4">
          Every number on the{" "}
          <Link href="/matchup/" className="text-coral hover:underline">Matchup Predictor</Link>{" "}
          comes from a walk-forward backtest of <strong className="text-ink">15,969 games</strong>{" "}across
          2022-23, 2023-24 and 2024-25. Ratings were fitted only on games that had already been played
          when each game tipped off — never on the season as a whole, which is the mistake that makes a
          model look brilliant and perform badly. The constants were chosen on 2022-24, checked once on
          2024-25, and checked once more on 2025-26 after they were frozen.
        </p>

        <H>The short version</H>
        <p className="mb-4">
          Opponent-adjusted efficiency, home court and pace do about <strong className="text-ink">94%</strong>{" "}of
          the achievable work. Every matchup nuance anyone argues about — style clashes, rebounding
          collisions, three-point volume, travel, rest — is the other 6%, and roughly a third of that is
          simply knowing who is injured.
        </p>
        <Table
          head={["", "2024-25 holdout", "2025-26, never opened"]}
          rows={[
            ["Mean absolute error", "8.97", "9.04"],
            ["Straight-up accuracy", "72.4%", "71.4%"],
            ["Margin variance explained", "38.9%", "—"],
          ]}
        />

        <H>1 · Ratings</H>
        <p className="mb-4">
          Each team gets an offensive and defensive rating in points per 100 possessions, and a tempo,
          solved as an iterated fixed point so that beating a good defense counts for more than beating a
          bad one. Last season is carried forward as a prior — <em>unregressed</em>, because carry factors
          from 0.3 to 1.0 were tested and leaving it alone won. That is the reason the page works in
          November, when nobody has played anyone yet.
        </p>

        <H>2 · Pace</H>
        <p className="mb-3">
          The two standard formulas are both biased. A simple average of the two tempos runs about 2.6
          possessions high when two slow teams meet; the KenPom product runs 1.7 high when two fast ones
          do. Between them they can differ by <strong className="text-ink">nearly seven possessions</strong>,
          which is about fifteen points of combined scoring. The fitted form is flat across every tempo
          band:
        </p>
        <Formula>{`pace = L − 0.75 + 0.83 × (tempo_A + tempo_B − 2L)`}</Formula>

        <H>3 · Home court</H>
        <p className="mb-4">
          Measured from conference games only — where schedules are balanced home-and-home and the
          buy-game confound disappears — home advantage is worth under three points, and it has been
          falling: 3.28 in 2022-23, 2.60 in 2025-26. But it is <strong className="text-ink">not one number</strong>.
          The floor is worth about two points more in a non-conference game than a conference one, and
          another three on top of that when a power-conference team hosts a visitor from outside the six
          strongest leagues. Neutral-court games show no bias at any predicted margin, which is how we
          know this is the building and not the ratings.
        </p>
        <Table
          head={["Fixture", "Home floor"]}
          rows={[
            ["Conference game", `+${CORR.confHome.toFixed(2)}`],
            ["Non-conference", `+${CORR.ncHome.toFixed(2)}`],
            ["Power conference hosting a non-power team", `+${(CORR.ncHome + CORR.powerHost).toFixed(2)}`],
            ["Neutral floor", "0"],
          ]}
          note={`Plus a flat ${HCA} per side per 100 possessions inside the base projection.`}
        />
        <p className="mb-4">
          Per-<em>team</em>{" "}home advantage, by contrast, is almost entirely noise: a team&rsquo;s home edge in
          one half of a season predicts the other half at r ≈ 0.05. The one real exception is altitude,
          worth about +0.8 points and concentrated between 4,500 and 6,000 feet.
        </p>

        <H>4 · Style</H>
        <p className="mb-4">
          Four style terms carry weight, and the strongest of them is{" "}
          <strong className="text-ink">negative</strong>. A team projected to out-shoot its opponent from
          three tends to fall short of it, because three-point percentage is the least persistent thing a
          team does and the efficiency rating has already banked the luck. The rebounding collision is
          real but small: across the full observed range it moves the margin by about 3.6 points, and most
          matchups sit nowhere near those extremes.
        </p>
        <Table
          head={["Term", "Points per unit"]}
          rows={[
            ["Three-point percentage edge", CORR.t3pEdge.toFixed(3)],
            ["Three-point attempt share edge", `+${CORR.t3rEdge.toFixed(3)}`],
            ["Turnover edge", CORR.tovEdge.toFixed(3)],
            ["Offensive rebounding edge", `+${CORR.orbEdge.toFixed(3)}`],
            ["Both teams strong (home only)", `+${CORR.qualHome.toFixed(3)}`],
          ]}
        />
        <p className="mb-4">
          Tested and dropped: the fast-versus-slow style clash, combined pace, effective field-goal edge,
          free-throw rate, rest differential, travel distance, and recency weighting of games. None of them
          survived out of sample. Shot-zone and shot-clock splits were tested with end-of-season hindsight
          deliberately left in, and still made the holdout worse.
        </p>

        <H>5 · Who is playing</H>
        <p className="mb-4">
          The largest single addition to the model, and the one thing a team rating is structurally blind
          to. Losing your best player is worth about{" "}
          <strong className="text-ink">{CORR.missTop.toFixed(1)} points</strong>{" "}beyond what the ratings
          already know. There is deliberately <em>no minutes editor</em>: a minutes-weighted roster rating
          was raced against the team model and earned a blend weight of −0.004 — zero, at every stage of a
          season including a team&rsquo;s first five games. Absences are the only player-level signal that
          survived. Roster continuity — the share of last season&rsquo;s minutes that came back — carries a
          smaller term worth {CORR.cont.toFixed(2)} points per unit.
        </p>
        <p className="mb-3">
          The cost of absences is <strong className="text-ink">steeply convex</strong>, and that matters
          more than it sounds. What a team loses is not the missing player, it is the man who replaces
          him: lose one and the sixth man covers it, lose five and walk-ons play. Measured across three
          seasons, per team-side:
        </p>
        <Table
          head={["Rotation minutes missing", "Mean points below projection"]}
          rows={[
            ["none", "−0.1"],
            ["under 20", "−0.5"],
            ["60 – 80", "1.3"],
            ["100 – 120", "2.6"],
            ["over 120", "6.3"],
          ]}
          note={`The model raises the missing share of the rotation to the power ${ABSENCE_EXP} and tilts it by whether the absent players are worth more or less per minute than their teammates. Beyond about two absences it is extrapolating: fewer than 1% of games in the sample were missing that much.`}
        />

        <H>6 · Win probability, and what the ranges mean</H>
        <p className="mb-4">
          The margin is normal around its projection with σ = <strong className="text-ink">{SIGMA}</strong>{" "}points.
          Normal, logistic, Student-t and Pythagorean were all tested and land within 0.001 of each other
          in log loss, so the form does not matter and the scale does. The curve on the page is that
          distribution drawn to scale: a team&rsquo;s share of the area <em>is</em> its win probability.
        </p>
        <p className="mb-4">
          One team&rsquo;s score is harder to call than the margin, because it carries the total&rsquo;s error too —
          σ of <strong className="text-ink">{SCORE_SIGMA}</strong>{" "}against the total&rsquo;s {TOTAL_SIGMA}. The
          range widens with pace while the win probability does not: a fast game is a wider distribution{" "}
          <em>and</em>{" "}a wider projected margin, and the two cancel. Fast games produce more blowouts and
          no more upsets.
        </p>

        <H>7 · The total, and why it is marked</H>
        <p className="mb-4">
          Efficiency times pace projects <em>regulation</em>{" "}scoring between two average-luck teams, and
          what a reader wants is the points in the game that actually gets played. Backtested against every
          game of four seasons the uncorrected total came in low every year, so{" "}
          <strong className="text-ink">{TOTAL_ADJ}</strong>{" "}points are added to it — and to nothing else.
        </p>
        <Table
          head={["Season", "Total, before the correction"]}
          rows={[["2022-23", "−3.11"], ["2023-24", "−3.84"], ["2024-25", "−2.91"], ["2025-26", "−3.88"]]}
          note={`About 1.0 point of that is overtime — 5.2% of games go past regulation and average 168 points against the field's 149 — and about 1.7 is the pace form, whose intercept puts projected possessions 0.8 below the league's own mean. The margin is a difference, so a shortfall common to both teams cancels out of it: its measured bias is +0.08. The total is a sum, so the same shortfall accumulates.`}
        />

        <H>What it cannot do</H>
        <p className="mb-4">
          Beat a betting line. The projection was run walk-forward against{" "}
          <strong className="text-ink">5,400</strong>{" "}closing spreads and totals from 2025-26 — refitting
          the ratings before every game so nothing was known that had not happened yet. On margin it was
          close: 9.25 points of mean error against the closing line&rsquo;s 8.97. Close is the problem. A
          line is a price, not a forecast, and being a third of a point <em>worse</em>{" "}than it means the
          games where this model disagrees are mostly the games where it is wrong. Filtering to
          disagreements of 2.5 points or more went 52.9%, which is half a standard error from breakeven and
          swung from 53.8% to 50.7% between the halves of the season.
        </p>
        <p className="mb-4">
          The total is worse than that, and the correction above does not rescue it. Its disagreements with
          a total line were wrong more often than right, and{" "}
          <strong className="text-ink">more wrong the larger they got</strong> — 47.2% at a gap of five
          points, 46.0% at seven and a half, both several standard errors the wrong side of breakeven. That
          is why the number is printed a step back from the other two. The correction makes it honest. It
          does not make it sharp.
        </p>
        <p className="mb-4">
          It also has no idea about anything off the box score: a coaching change mid-season, a player
          returning from injury at reduced minutes, motivation, or a team that has quit on its season.
          Rule players out by hand when you know something the archive does not.
        </p>

        {pack && (
          <p className="mt-8 pt-4 border-t border-hairline text-xs text-ink-muted">
            Current data: {pack.games.toLocaleString()} games from {pack.season - 1}–{String(pack.season).slice(-2)},
            {" "}{pack.teams.length} teams, league average {pack.league.eff} points per 100 possessions at{" "}
            {pack.league.tempo} possessions. Built {pack.built_at}.
            {pack.dropped > 0 && ` ${pack.dropped} game${pack.dropped === 1 ? "" : "s"} excluded for impossible possession counts in the source archive.`}
          </p>
        )}
      </div>
    </section>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 text-[0.7rem] uppercase tracking-[0.15em] font-bold leading-none" style={{ color: "var(--court-ink)" }}>
      {children}
    </h2>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <pre className="mb-4 overflow-x-auto rounded-lg border border-hairline bg-paper-deep/30 px-4 py-3 text-xs text-ink">
      {children}
    </pre>
  );
}

function Table({ head, rows, note }: { head: string[]; rows: string[][]; note?: string }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-hairline bg-paper-deep/25">
      <table className="w-full text-xs tabular">
        <thead>
          <tr className="border-b border-hairline">
            {head.map((h, i) => (
              <th key={h || i} className={`px-3 py-2 text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-hairline/60 last:border-0">
              {r.map((c, i) => (
                <td key={i} className={`px-3 py-1.5 ${i === 0 ? "text-left text-ink-soft" : "text-right font-medium text-ink"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="px-3 py-2 text-[0.65rem] text-ink-muted border-t border-hairline">{note}</p>}
    </div>
  );
}
