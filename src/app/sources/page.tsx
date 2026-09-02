import type { Metadata } from "next";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Sources & attribution — Beyond the Arc",
  description:
    "Every source behind the numbers on Beyond the Arc: who collects the data, what we do with it, "
    + "and what we deliberately do not use.",
  alternates: { canonical: "/sources/" },
};

/**
 * Where the numbers come from, in public.
 *
 * WHY THIS PAGE EXISTS. The site charges for access to analysis built on data
 * other people collect. That is normal and legitimate — statistics are facts,
 * and facts are not copyrightable (Feist v. Rural Telephone, 499 U.S. 340) —
 * but a paid product owes its readers a plain statement of what it is built
 * from, and it owes the people who did the collecting their name in public.
 *
 * IT ALSO SAYS WHAT WE DO NOT USE, which is the half most attribution pages
 * skip.
 *
 * TWO CLAUSES WERE CUT ON COLIN'S INSTRUCTION, 2026-09-02, and the reasoning
 * is recorded here rather than lost:
 *
 *   - "Who else touches the site" (Netlify / R2 / Supabase / Stripe). The
 *     matching clause on /privacy was cut in the same pass, so the site now
 *     names its processors nowhere. Raised with Colin as a disclosure gap
 *     rather than a styling one.
 *   - "Recruiting and the transfer portal". This one DID carry something no
 *     other page does — the RSCI credit. The site still renders RSCI consensus
 *     ranks (player-atlas, player-page-view, sortable-roster-table,
 *     season-preview), and RSCI publishes on the condition of attribution, so
 *     that credit now appears nowhere. Raised with Colin; if it should come
 *     back it is one sentence, not a clause.
 */
export default function SourcesPage() {
  return (
    <LegalPage
      title="Sources & attribution"
      updated="2026-09-02"
    >
      <Clause id="stats" title="College basketball statistics">
        <p>
          <strong className="text-ink">CollegeBasketballData.com</strong> is the backbone: schedules,
          box scores, play-by-play and the lineup data underneath the shot charts, lineups and
          on/off pages. Accessed through their API under a paid subscription that permits commercial
          use.
        </p>
        <p>
          <strong className="text-ink">barttorvik.com</strong> — team and player season tables,
          tempo-free ratings and T-Rank. Bart Torvik has been publishing this for years for free,
          and a large share of what the public knows about tempo-free college basketball exists
          because he does.
        </p>
        <Plainly>
          We do not republish either source as a downloadable dataset, a mirror, or an API. What we
          publish is analysis and per-page views built on top of them.
        </Plainly>
      </Clause>

      <Clause id="history" title="Tournament and NBA history">
        <p>
          NCAA tournament results, historical box scores and NBA draft and career outcomes come from
          the <strong className="text-ink">Sports Reference</strong> family of sites
          (sports-reference.com, basketball-reference.com). Sports Reference asks that anyone
          sharing or republishing their data credit them explicitly, and this is us doing that.
        </p>
      </Clause>

      <Clause id="images" title="Photographs, logos and school marks">
        <p>
          Team logos and school names are the trademarks of their institutions. Beyond the Arc is an
          independent site: it is <strong className="text-ink">not affiliated with, endorsed by, or
          sponsored by</strong> the NCAA, any conference, or any college or university. Marks are
          used to identify the team a number belongs to — nothing more.
        </p>
        <p>
          Player and coach photographs are used for identification alongside that person&apos;s
          statistics. If you hold rights in an image on this site and want it removed, write and it
          will be taken down — see below.
        </p>
      </Clause>

      <Clause id="corrections" title="Corrections and takedowns">
        <p>
          Numbers here are derived from upstream feeds and can be wrong — a misjoined player, a
          missing game, a stale roster. Corrections are welcome and get fixed faster than you would
          expect.
        </p>
        <p>
          For a correction, a takedown request, or a question about anything on this page, write to{" "}
          <a href="mailto:cpb09e@gmail.com" className="text-coral hover:underline">cpb09e@gmail.com</a>.
        </p>
      </Clause>
    </LegalPage>
  );
}
