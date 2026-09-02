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
 * skip. The recruiting-rank decision in particular is deliberate and worth
 * stating: we carry RSCI's consensus number and not a single service's
 * proprietary ranking, because a consensus index is published to be
 * reproduced with credit and a proprietary list is somebody's product.
 */
export default function SourcesPage() {
  return (
    <LegalPage
      title="Sources & attribution"
      updated="2026-09-02"
      lede="Everything here is built on data collected by other people. This page names all of them, says what we take, and says what we deliberately leave alone."
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

      <Clause id="recruiting" title="Recruiting and the transfer portal">
        <p>
          The recruit national-rank badge is the{" "}
          <strong className="text-ink">Recruiting Services Consensus Index (RSCI)</strong>, published
          at rscihoops.com. RSCI is an average of the major services rather than any one
          service&apos;s product, and it is published expressly to be reproduced with attribution.
        </p>
        <p>
          Transfer portal movement — who entered, and where they landed — is fact-checked against
          public reporting including <strong className="text-ink">On3</strong>. We carry the fact of
          a commitment. We do not carry On3&apos;s, 247Sports&apos;, ESPN&apos;s or Rivals&apos;
          proprietary rating or ranking numbers.
        </p>
        <Plainly>
          A player&apos;s destination is a fact and we will report it. A recruiting service&apos;s
          rank number is that service&apos;s product, and if you want it you should go and get it
          from them.
        </Plainly>
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

      <Clause id="infrastructure" title="Who else touches the site">
        <p>
          Hosting is <strong className="text-ink">Netlify</strong>; data files are served from{" "}
          <strong className="text-ink">Cloudflare R2</strong>. Accounts and sign-in run on{" "}
          <strong className="text-ink">Supabase</strong>. Payments are handled entirely by{" "}
          <strong className="text-ink">Stripe</strong> — card details never reach this site. There is
          no advertising network and no third-party analytics on any page.
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
