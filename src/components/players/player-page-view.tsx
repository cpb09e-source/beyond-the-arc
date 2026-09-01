import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { draftRound, nbaLogoUrl } from "@/lib/nba-draftees";
import { CareerTable } from "@/components/players/career-table";
import { PlayerOverview } from "@/components/players/player-overview";
import { PlayerShotChart } from "@/components/players/player-shot-chart";
import { PlayerAtlas } from "@/components/players/player-atlas";
import { seasonLine } from "@/lib/player-stat-line";
import { PlayerTabs } from "@/components/players/player-tabs";
import { PlayerGameLog } from "@/components/players/player-game-log";
import { teamSlug } from "@/lib/team-slug";
import type { PlayerPageData } from "@/lib/player-page-data";

/**
 * A player page, from data.
 *
 * NO "use client" DIRECTIVE, and that is deliberate rather than an oversight.
 * A component with no directive is SHARED: rendered from a Server Component it
 * runs on the server as this always has, and imported by a Client Component
 * the bundler compiles a client copy. That is what lets the live season fetch
 * its numbers and render them through the very same component the frozen
 * seasons are prebuilt with — one renderer, two graphs, no second
 * implementation to drift. See src/lib/live-team-page.ts for the same argument
 * on the team side, where it was made first.
 */
export function PlayerPageView({
  bartId, player, current, stats, transfer, overviewOptions, positionByYear,
  heroRanks, logRows, teammates, gamePct, logLadders, draft, rsci, draftTeam,
}: PlayerPageData) {
    /**
   * Transfer banner. The draft used to supersede it here; the draft is now a
   * chip in the masthead, so this only has one thing to say. Kept as a banner
   * because a portal commit IS news — it is about next season, not this one.
   */
  const banner = transfer ? (
    <div className="inline-flex items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-md bg-coral/10 border border-coral/30">
      <span className="text-[0.6rem] uppercase tracking-widest text-coral font-bold whitespace-nowrap">
        Transfer →
      </span>
      <Link href={`/teams/${teamSlug(transfer.to)}`} className="inline-flex items-center gap-2 group min-w-0">
        <TeamLogo name={transfer.to} size={22} />
        <span className="text-ink font-medium group-hover:text-coral transition-colors truncate">
          {transfer.to}
        </span>
      </Link>
    </div>
  ) : null;

  return (
    // pb-20 lives on the wrapper rather than on the last section: which section
    // IS last depends on the player (the shot charts render only where we have
    // located shots), so pinning the page's bottom gutter to any one of them
    // left some profiles ending flush against the footer.
    <div className="pb-20">
      <PlayerTabs
        hero={
      <>
      {/* Hero — "Atlas". Six small-multiple modules instead of a stat line:
          each headline number is drawn as well as printed, so the season's
          shape and the player's standing read before the figures do. The
          component owns its own section chrome. */}
      <PlayerAtlas
        bartId={bartId}
        name={stats.name ?? `Player ${bartId}`}
        year={current.year}
        teamName={transfer ? transfer.from : current.team_name}
        conference={current.team_conference}
        height={stats.height}
        weight={null}
        hometown={stats.hometown}
        highSchool={null}
        rsci={rsci}
        playerClass={current.class}
        // Straight off Bart's season row, so the band and the career table's
        // own top row are reading the same columns through the same
        // arithmetic. See the note in player-stat-line.
        statNow={seasonLine(current)}
        draft={
          draft && draft.pick !== null
            ? {
                team: draftTeam ?? draft.team ?? "—",
                logo: nbaLogoUrl(draft.team, draft.year),
                round: draftRound(draft.pick),
                pick: draft.pick,
              }
            : null
        }
        heroRanks={heroRanks}
        bucket={heroRanks?.bucket ?? positionByYear[String(current.year)] ?? "G"}
        teammates={teammates}
        banner={banner}
      />
      </>
        }
        overview={
        <>

      {/* No margin of its own — the gap to the hero is the hero section's own
          bottom padding and nothing else, which keeps it tighter (24px) than
          the 32px between the cards below. The hero and the career ledger read
          as one block: vitals, then the record those vitals belong to. */}
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10">
        {/* Career ledger — heavier chrome than other cards on the page so this
            anchors the profile as the canonical record. CareerTable owns its
            own header (season count + View toggle) so the dropdown sits
            next to the count instead of in a separate band below.

            Sits directly under the hero: the year-by-year record is what most
            readers come to a player page for, and it reads as the continuation
            of the vitals. Player Overview follows as the single-season detail. */}
        <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
          <CareerTable seasons={player.seasons} />
        </div>
      </section>

      {overviewOptions.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8">
          {/* Player Overview — ledger card matching /coaches season-by-season.
              Inner component supplies the team/year picker band + grid.
              Full-bleed edge-to-edge on mobile; framed card on lg+. */}
          <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
            {/* Heading lives inside the client component now: the rank rings
                sit to its right and have to track the year picker. */}
            <PlayerOverview options={overviewOptions} bartPlayerId={bartId} />
          </div>
        </section>
      )}

        </>
        }
        log={
          <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-6">
            <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
              <PlayerGameLog
                rows={logRows}
                playerName={stats.name ?? `Player ${bartId}`}
                ladders={logLadders}
                minAtt={gamePct?.min_att ?? 2}
                emptySeason={current.year}
              />
            </div>
          </section>
        }
        shooting={
          /* The two hexbin courts (2024+ seasons). Players with no located
             shots fall back to a zone-splits card — but only when the Player
             Overview isn't already carrying those splits in its Shot Diet
             panel, or they'd appear twice on the same page.
             PLACEHOLDER CONTENT for this tab: the shot charts are what exists
             today, and the tab is defined properly later. */
          <PlayerShotChart
            bartPlayerId={bartId}
            years={player.seasons.map((s) => s.year)}
            positionByYear={positionByYear}
            suppressFallback={overviewOptions.length > 0}
          />
        }
      />
    </div>
  );
}
