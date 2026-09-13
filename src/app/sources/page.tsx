import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";
import { ContactEmail, Ext } from "@/components/legal/legal-facts";

export const metadata: Metadata = {
  title: "Sources & attribution",
  description:
    "Every source behind the numbers on Beyond the Arc: who collects the data, what each one supplies, "
    + "whose methods we build on, and what we deliberately do not use.",
  alternates: { canonical: "/sources/" },
};

/**
 * Where the numbers come from, in public.
 *
 * WHY THIS PAGE EXISTS. The site charges for access to analysis built on data
 * other people collect. That is normal and legitimate (statistics are facts,
 * and facts are not copyrightable: Feist v. Rural Telephone, 499 U.S. 340),
 * but a paid product owes its readers a plain statement of what it is built
 * from, and it owes the people who did the collecting their name in public.
 *
 * IT ALSO SAYS WHAT WE DO NOT USE, which is the half most attribution pages
 * skip.
 *
 * THE INVENTORY IS AUDITED FROM THE CODE, 2026-09-13, not from memory: every
 * host that scripts/, src/, netlify/ and desktop/src reach, and every file
 * under public/ that came from somewhere else. docs/TODO-legal-sources.md
 * section 1 maps each source to the files and pages it feeds. A source added or
 * dropped changes both.
 *
 * ONE OF THE TWO CLAUSES CUT ON 2026-09-02 IS BACK, by Colin's decision on
 * 2026-09-13: "Recruiting and the transfer portal", because RSCI publishes its
 * ranks on the condition of attribution and no other page credited it. The
 * other, the list of services that run the site (formerly "Who else touches the
 * site"), stays cut; /privacy names the processors instead.
 *
 * THE LOGO SENTENCE IS DELIBERATELY NARROW. Team ids and colors come from CBB
 * Analytics' team catalog (scripts/match-teams.mjs), and the logo images are
 * fetched by that id from storage.googleapis.com/cbb-image-files. Nothing in
 * the repo says who owns that bucket, so the page states what the code shows
 * and no more.
 */
export default function SourcesPage() {
  return (
    <LegalPage
      title="Sources & attribution"
      updated="2026-09-13"
    >
      <Clause id="stats" title="College basketball statistics">
        <p>
          <strong className="text-ink">CollegeBasketballData.com</strong>{" "}
          (<Ext href="https://collegebasketballdata.com/">collegebasketballdata.com</Ext>) is the
          backbone: schedules, box scores and play-by-play since 2013-14. Those feed the team and
          player explorers, both game logs, the Win Calculator, shot charts, lineups, on/off and our
          plus-minus ratings. It also supplies the AP rank at the time of each game, the live
          scoreboard and game pages, and one of the two adjusted ratings inside BTA RTG. Accessed
          through their API under a paid subscription that permits commercial use.
        </p>
        <p>
          <strong className="text-ink">Bart Torvik</strong>{" "}
          (<Ext href="https://barttorvik.com/">barttorvik.com</Ext>) supplies the team T-Rank tables
          and player season statistics behind the team, player and coach pages and the season
          preview, and the other adjusted rating inside BTA RTG. The names every team and player on
          this site is keyed to are his. Bart has been publishing this for years for free, and a
          large share of what the public knows about tempo-free college basketball exists because he
          does.
        </p>
        <Plainly>
          We do not republish either source as a downloadable dataset, a mirror, or an API. What we
          publish is analysis and per-page views built on top of them.
        </Plainly>
      </Clause>

      <Clause id="history" title="Tournament, coaching and NBA history">
        <p>
          NCAA tournament brackets and box scores, and the year-by-year head coach of every Division I
          program, come from{" "}
          <strong className="text-ink">College Basketball at Sports Reference</strong>{" "}
          (<Ext href="https://www.sports-reference.com/cbb/">sports-reference.com/cbb</Ext>). Whether a
          player reached the NBA, and his draft details on player pages, come from{" "}
          <strong className="text-ink">Basketball Reference</strong>{" "}
          (<Ext href="https://www.basketball-reference.com/">basketball-reference.com</Ext>). Sports
          Reference asks that anyone sharing or republishing their data credit them explicitly, and
          this is us doing that.
        </p>
        <p>
          The current head coach named on each team page comes from{" "}
          <strong className="text-ink">ESPN</strong>&apos;s college basketball team listings.
        </p>
      </Clause>

      <Clause id="recruiting" title="Recruiting and the transfer portal">
        <p>
          Recruit rankings: <strong className="text-ink">RSCI</strong> (Recruiting Services Consensus
          Index), <Ext href="https://sites.google.com/site/rscihoops/home">rscihoops.com</Ext>. The
          recruit rank shown on rosters, season previews and player pages is RSCI&apos;s final top 100
          for each class since 2013. RSCI is a consensus of the major recruiting services, published to
          be cited with credit.
        </p>
        <p>
          Transfer portal entries, on the portal page and in season previews, and which incoming
          freshmen committed where, come from <strong className="text-ink">On3</strong>{" "}
          (<Ext href="https://www.on3.com/">on3.com</Ext>). We use the facts of each move and each
          commitment only. On3&apos;s own rankings are not used anywhere on the site.
        </p>
      </Clause>

      <Clause id="images" title="Photographs, logos and school marks">
        <p>
          Team logos and school names are the trademarks of their institutions. Beyond the Arc is an
          independent site: it is <strong className="text-ink">not affiliated with, endorsed by, or
          sponsored by</strong> the NCAA, any conference, or any college or university. Marks are used
          to identify the team a number belongs to, and nothing more.
        </p>
        <p>
          Player photographs come from <strong className="text-ink">ESPN</strong>{" "}
          (<Ext href="https://www.espn.com/mens-college-basketball/">espn.com</Ext>) and are used to
          identify a player alongside that player&apos;s statistics. Conference logos also come from
          ESPN, and the NBA team logos on player pages load from ESPN&apos;s image servers.
        </p>
        <p>
          Team logos load from an image library hosted on Google Cloud Storage, matched to each school
          through the team catalog of <strong className="text-ink">CBB Analytics</strong>{" "}
          (<Ext href="https://cbbanalytics.com/">cbbanalytics.com</Ext>), which is also where the team
          colors used around the site come from.
        </p>
        <p>
          If you hold rights in an image on this site and want it removed, write and it will be taken
          down. See below.
        </p>
      </Clause>

      <Clause id="methods" title="Methods we build on">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-ink">The Trapezoid of Excellence</strong> on the team scatter is{" "}
            <Ext href="https://x.com/ryanhammer09">Ryan Hammer</Ext>&apos;s idea: the teams that win
            titles pair an elite adjusted net rating with a tempo near the middle of the sport. The
            shape on our chart is drawn from our own numbers for each season, so a team will not sit
            exactly where it does on his.
          </li>
          <li>
            <strong className="text-ink">The Four Factors</strong> (shooting, turnovers, rebounding and
            free throws) are Dean Oliver&apos;s, and so is the formula we use to estimate possessions,
            with the free-throw weighting used by Ken Pomeroy{" "}
            (<Ext href="https://kenpom.com/">kenpom.com</Ext>).
          </li>
          <li>
            <strong className="text-ink">Quadrants</strong> in the Win Calculator use the NCAA&apos;s
            official quadrant thresholds, applied to our own team ratings rather than to the NET, so
            that every season back to 2013-14 has them.
          </li>
        </ul>
        <p>
          Everything else, including EPM, Box-EPM, BTA RTG, PORP, the adjusted team ratings and the
          matchup predictor, is a model we built from the data above. The{" "}
          <Link href="/matchup/method" className="text-coral hover:underline">matchup method</Link> and
          the <Link href="/glossary" className="text-coral hover:underline">glossary</Link> explain how.
        </p>
      </Clause>

      <Clause id="not-used" title="What we deliberately do not use">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            Recruiting services&apos; own rankings (247Sports, ESPN, On3, Rivals). The only recruit rank
            on this site is RSCI&apos;s consensus.
          </li>
          <li>
            Statistics from CBB Analytics. They were a data source until July 2026, and every number
            they supplied has since been rebuilt from the sources above.
          </li>
          <li>Ratings or data from KenPom or EvanMiya.</li>
        </ul>
      </Clause>

      <Clause id="corrections" title="Corrections and takedowns">
        <p>
          Numbers here are derived from upstream feeds and can be wrong: a misjoined player, a missing
          game, a stale roster. Corrections are welcome and get fixed faster than you would expect.
        </p>
        <p>
          For a correction, a takedown request, or a question about anything on this page, write to{" "}
          <ContactEmail />.
        </p>
      </Clause>
    </LegalPage>
  );
}
