import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of service — Beyond the Arc",
  description: "The terms you agree to when you use or subscribe to Beyond the Arc.",
  alternates: { canonical: "/terms/" },
};

/**
 * DRAFTED, NOT LAWYERED. This is a working set of terms written to describe
 * what the site actually does — the paywall boundary, the billing behaviour
 * Stripe is configured for, the refund position, the accuracy disclaimer. It
 * is honest and specific, which is most of the value, and it is not a
 * substitute for a solicitor reading it before the subscriber count gets
 * interesting. See docs/TODO-legal-sources.md for what is still open.
 *
 * EVERY FACTUAL CLAIM HERE IS CHECKED AGAINST THE CODE. Cancellation running
 * to period end, cards never touching this site, two free seasons for signed-
 * out readers — each is how the app behaves today, not how a template says a
 * SaaS usually behaves. If the behaviour changes, this page is wrong and has
 * to change with it.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="2026-09-02"
      lede="The agreement between you and Beyond the Arc. Written to be read — if a clause is unclear, that is a fault worth reporting."
    >
      <Clause id="who" title="1. Who you are dealing with">
        <p>
          Beyond the Arc (&ldquo;BTA&rdquo;, &ldquo;we&rdquo;) is an independent college basketball
          analytics site operated by a sole proprietor and reachable at{" "}
          <a href="mailto:cpb09e@gmail.com" className="text-coral hover:underline">cpb09e@gmail.com</a>.
          Using the site means accepting these terms.
        </p>
      </Clause>

      <Clause id="what" title="2. What the subscription buys">
        <p>
          Most of the site is free. A subscription unlocks the full season archive in the team and
          player explorers; without one you can read the two most recent seasons. Everything else —
          team pages, game logs, the portal, the glossary — is open to everyone.
        </p>
        <p>
          Plans are monthly or yearly, priced as shown on the{" "}
          <Link href="/pricing" className="text-coral hover:underline">pricing page</Link> at the time
          you subscribe. We may change prices for future billing periods; a price change never
          applies to a period you have already paid for.
        </p>
      </Clause>

      <Clause id="billing" title="3. Billing, renewal and cancellation">
        <p>
          Payment is taken by Stripe. Subscriptions renew automatically at the end of each period
          until cancelled.
        </p>
        <Plainly>
          You can cancel at any time from your account page. Cancelling stops the next charge and
          leaves your access running to the end of the period you have already paid for — we do not
          cut you off the moment you cancel.
        </Plainly>
        <p>
          If a payment fails, Stripe retries it. Access continues during the retry window and is
          withdrawn if the payment does not ultimately succeed.
        </p>
      </Clause>

      <Clause id="trial" title="4. The free trial">
        <p>
          A new subscription starts with a <strong className="text-ink">five-day free trial</strong>,
          with full access to everything a paid pass includes. One trial per customer.
        </p>
        <Plainly>
          Your card is taken before the trial starts, and it is charged automatically when the five
          days are up. Cancel at any point during the trial and you are never charged at all. Your
          account page shows the exact date of the first charge from the moment the trial begins.
        </Plainly>
      </Clause>

      <Clause id="refunds" title="5. Refunds">
        <p>
          The trial exists so that nobody has to buy something they have not used. If you are unsure,
          cancel before it ends and it costs you nothing.
        </p>
        <p>
          After the first charge, refunds are at our discretion. Write and explain — a charge you did
          not expect, or a subscription you forgot was running, is worth asking about, and this is
          not a business that wants money from people who are not using the site. What we do not
          offer is a retroactive refund of a long-running subscription.
        </p>
        <p>
          If you are a consumer in the UK or EU, none of this affects your statutory cancellation
          rights.
        </p>
      </Clause>

      <Clause id="use" title="6. What you may and may not do with the data">
        <p>
          A subscription is for you. Sharing an account, or scripting it to pull data on behalf of
          other people, is not permitted.
        </p>
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            scrape, crawl or systematically download the site or its data files in bulk, or use
            automated means to extract data at a scale a person could not;
          </li>
          <li>
            republish our data as a dataset, a mirror, a feed or a substitute API, whether free or
            paid;
          </li>
          <li>use the site or its data to train a machine-learning model;</li>
          <li>resell, sublicense or share access to paid content.</li>
        </ul>
        <Plainly>
          Quoting a number, a chart or a table in an article, a broadcast, a podcast or a post is
          welcome and always has been. Credit Beyond the Arc and link back where you can. This
          clause is aimed at wholesale copying, not at people writing about basketball.
        </Plainly>
      </Clause>

      <Clause id="accuracy" title="7. Accuracy, and what this site is not">
        <p>
          The numbers are derived from third-party feeds (see{" "}
          <Link href="/sources" className="text-coral hover:underline">sources</Link>) and from models
          we build ourselves. Both can be wrong. Data arrives late, gets corrected upstream, and
          occasionally joins the wrong player to the wrong row. The site is provided
          &ldquo;as is&rdquo;, without warranty of accuracy, completeness or fitness for any
          particular purpose.
        </p>
        <Plainly>
          Nothing here is betting advice. If you are wagering on these numbers, that is entirely
          your own risk, and you should assume any given figure could be wrong.
        </Plainly>
        <p>
          Our total liability to you for any claim arising out of the site is limited to the amount
          you paid us in the twelve months before the claim.
        </p>
      </Clause>

      <Clause id="accounts" title="8. Your account">
        <p>
          Keep your sign-in details to yourself; you are responsible for what happens under your
          account. We may suspend or close an account that breaches these terms, and will refund the
          unused remainder of a paid period if we do so for anything other than serious or repeated
          abuse.
        </p>
        <p>
          You can delete your account at any time. See{" "}
          <Link href="/privacy" className="text-coral hover:underline">privacy</Link> for what happens
          to your data when you do.
        </p>
      </Clause>

      <Clause id="ip" title="9. Ownership">
        <p>
          The metrics we build, the writing, the design and the code are ours. The underlying
          statistics are facts and belong to nobody; the feeds they arrive through belong to the
          organisations named on the{" "}
          <Link href="/sources" className="text-coral hover:underline">sources page</Link>. Team names
          and logos are the trademarks of their institutions, and this site is not affiliated with or
          endorsed by any of them.
        </p>
      </Clause>

      <Clause id="changes" title="10. Changes to these terms">
        <p>
          We may update these terms. The date at the top of this page always reflects the current
          version, and a change that materially affects paying subscribers will be sent by email
          before it takes effect.
        </p>
      </Clause>

      {/* Texas, confirmed by the operator 2026-09-02. This is the one clause on
          the page that cannot be inferred from the code — it names where the
          business is actually run from, and a guessed state points a dispute at
          the wrong court. It changes only if the business moves. */}
      <Clause id="law" title="11. Governing law">
        <p>
          These terms are governed by the laws of the State of Texas, United States, and the courts
          of that state have jurisdiction over any dispute. If you are a consumer, this does not
          deprive you of the protection of the mandatory laws of the country where you live.
        </p>
      </Clause>
    </LegalPage>
  );
}
