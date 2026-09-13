import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";
import { ContactEmail, LEGAL_ENTITY } from "@/components/legal/legal-facts";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms you agree to when you use Beyond the Arc, subscribe to a Season Pass, or install the Windows app.",
  alternates: { canonical: "/terms/" },
};

/**
 * DRAFTED, NOT LAWYERED. This is a working set of terms written to describe
 * what the site and the app actually do. It is honest and specific, which is
 * most of the value, and it is not a substitute for a lawyer reading it before
 * the site is promoted. See docs/TODO-legal-sources.md for what is still open.
 *
 * EVERY FACTUAL CLAIM HERE IS CHECKED AGAINST THE CODE. Re-audited 2026-09-13:
 *
 *   free seasons                lib/access.ts FREE_SEASONS
 *   prices and periods          lib/pricing.ts, components/pricing/season-pass-cta.tsx
 *   five-day trial, one ever    netlify/functions/create-checkout-session.mts
 *   cancel runs to period end   netlify/functions/stripe-webhook.mts (cancel_at_period_end)
 *   access while a retry runs   netlify/shared/billing.mts ACTIVE_STATUSES (past_due)
 *   app comes with the pass     netlify/shared/desktop-auth.mts DESKTOP_ACCESS
 *   app sign-in and refresh     desktop/src/main/auth.ts, netlify/functions/desktop-token.mts
 *   paid data removed           desktop/src/main/data.ts purgePaidCache, called from index.ts
 *   app updates                 desktop/src/main/updater.ts
 *
 * TWO THINGS THIS PAGE DELIBERATELY DOES NOT SAY, because the code does not do
 * them. The pricing page says the Season Pass renews each November; checkout
 * sets no billing anchor, so Stripe renews on the anniversary of the first
 * charge, and that is what section 3 describes. And the pricing page puts 50 a
 * month on Ask the Calculator, which nothing enforces yet, so no number appears
 * here. Both are listed in the TODO doc.
 *
 * Section 13 names Texas, confirmed by the operator 2026-09-02. It is the one
 * clause that cannot be inferred from the code, and a guessed state points a
 * dispute at the wrong court. The entity name is a placeholder; see
 * components/legal/legal-facts.tsx.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="2026-09-13"
    >
      <Clause id="who" title="1. Who you are dealing with">
        <p>
          Beyond the Arc (&ldquo;BTA&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an independent
          college basketball analytics site at btacbb.xyz, with a companion app for Windows. It is
          operated by <strong className="text-ink">{LEGAL_ENTITY}</strong>, a sole proprietor based in
          Texas, reachable at <ContactEmail />.
        </p>
        <p>
          Using the site or the app means accepting these terms. To buy a subscription you need to be
          an adult where you live, or have a parent or guardian agree to these terms for you.
        </p>
      </Clause>

      <Clause id="what" title="2. What is free and what the Season Pass adds">
        <p>
          Most of the site is free: every team, player and coach page at every season, the
          scoreboard, the transfer portal, the glossary, and the team and player explorers for the
          current season and the one before it.
        </p>
        <p>
          A <strong className="text-ink">Season Pass</strong> adds the full archive in the explorers
          and game logs, back to 2013-14, along with the paid tools and the Windows app. The{" "}
          <Link href="/pricing" className="text-coral hover:underline">pricing page</Link> always
          shows exactly what each plan includes, and that list can change as features are added or
          retired.
        </p>
        <p>
          A Season Pass is billed monthly or yearly. Today that is $8 a month or $50 a year, in US
          dollars; the price you pay is the one shown when you check out. We may change prices for
          future billing periods. A price change never applies to a period you have already paid for.
        </p>
      </Clause>

      <Clause id="billing" title="3. Billing, renewal and cancellation">
        <p>
          Payment is taken by Stripe, on Stripe&apos;s own checkout pages. Your subscription renews
          automatically at the end of each billing period, a month or a year from when it started,
          and is charged for the next period until you cancel.
        </p>
        <Plainly>
          You can cancel at any time from your account page. Canceling stops the next charge and
          leaves your access running to the end of the period you have already paid for. We do not
          cut you off the moment you cancel.
        </Plainly>
        <p>
          If a payment fails, Stripe retries it. Access continues during the retry window and is
          withdrawn if the payment does not ultimately succeed.
        </p>
        <p>
          Your account page shows your plan and the date of your next charge, or the date your access
          ends if you have canceled. Receipts, invoices and card changes are handled through
          Stripe&apos;s billing portal, which your account page links to.
        </p>
      </Clause>

      <Clause id="trial" title="4. The free trial">
        <p>
          A new Season Pass, monthly or yearly, starts with a{" "}
          <strong className="text-ink">five-day free trial</strong>, with full access to everything a
          paid pass includes. One trial per customer: if you have had a subscription before, a new one
          starts without a trial.
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
          After the first charge, refunds are at our discretion. Write and explain: a charge you did
          not expect, or a subscription you forgot was running, is worth asking about, and this is not
          a business that wants money from people who are not using the site. What we do not offer is
          a retroactive refund of a long-running subscription.
        </p>
        <p>
          If you are a consumer in the UK or EU, none of this affects your statutory cancellation
          rights.
        </p>
      </Clause>

      <Clause id="app" title="6. Beyond the Arc for Windows">
        <p>
          The Windows app comes with the Season Pass. While it is in early access, we may limit who can
          download it.
        </p>
        <p>
          While your account is entitled to the app, we give you a personal, non-exclusive,
          non-transferable license to install it and use it on computers you own or control. The app
          is licensed to you, not sold. You may not sell or redistribute it, or copy, modify, decompile
          or reverse-engineer it, except where the law gives you a right to that which cannot be
          waived.
        </p>
        <p>
          The app signs in through the website. It opens btacbb.xyz in your browser, you confirm there
          with the account you are signed in to, and the app receives a session for that account. The
          app never sees your password.
        </p>
        <Plainly>
          The app stays signed in on that computer until you sign out. It checks your account with us
          about once an hour while it is running. When your Season Pass ends, the app stops opening
          paid content at its next check and deletes the paid seasons it downloaded to that computer.
          Signing out deletes them too.
        </Plainly>
        <p>
          The app checks for updates on its own, downloads them in the background, and installs them
          when you restart it or choose to install. Updates are part of the app, and installing it
          means agreeing to receive them.
        </p>
        <p>
          Everything in sections 7 to 9 applies to the app exactly as it applies to the site.
        </p>
      </Clause>

      <Clause id="use" title="7. What you may and may not do with the data">
        <p>
          A subscription is for one person. Sharing an account or its sign-in, or scripting it to pull
          data on behalf of other people, is not permitted.
        </p>
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            scrape, crawl or systematically download the site, the app or their data files in bulk,
            or use automated means to extract data at a scale a person could not;
          </li>
          <li>
            republish our data as a dataset, a mirror, a feed or a substitute API, whether free or
            paid. That includes tables you export: an export is for your own analysis;
          </li>
          <li>
            get around the paywall or any other access control, or pass paid content, links, files
            or sessions to someone who has not paid for them;
          </li>
          <li>use the site, the app or their data to train a machine-learning model;</li>
          <li>resell, sublicense or share access to paid content;</li>
          <li>
            send Ask the Calculator questions through anything other than the site or the app, or
            otherwise overload or interfere with the service.
          </li>
        </ul>
        <Plainly>
          Quoting a number, a chart or a table in an article, a broadcast, a podcast or a post is
          welcome and always has been. Credit Beyond the Arc and link back where you can. This clause
          is aimed at wholesale copying, not at people writing about basketball.
        </Plainly>
      </Clause>

      <Clause id="accuracy" title="8. Accuracy, and what this site is not">
        <p>
          The numbers are derived from third-party data (see{" "}
          <Link href="/sources" className="text-coral hover:underline">sources</Link>) and from models
          we build ourselves. Both can be wrong. Data arrives late, gets corrected upstream, and
          occasionally joins the wrong player to the wrong row. Ask the Calculator uses an AI model to
          read your question and can misread it, which is why it only fills in the filters and waits
          for you to check them.
        </p>
        <p>
          The site, the app and the data are provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;, without warranty of any kind, including accuracy, completeness,
          availability or fitness for any particular purpose, to the fullest extent the law allows.
        </p>
        <Plainly>
          Nothing here is betting advice. If you are wagering on these numbers, that is entirely your
          own risk, and you should assume any given figure could be wrong.
        </Plainly>
      </Clause>

      <Clause id="liability" title="9. Limits on our liability">
        <p>
          To the fullest extent the law allows, we are not liable for indirect, incidental, special or
          consequential losses, including lost profits, lost data or losses on wagers, arising out of
          your use of the site or the app. Our total liability to you for any claim is limited to the
          amount you paid us in the twelve months before the claim.
        </p>
        <p>
          Some places do not allow some of these limits. Where that is true, they apply to you only as
          far as your local law permits.
        </p>
      </Clause>

      <Clause id="accounts" title="10. Your account">
        <p>
          Keep your sign-in details to yourself; you are responsible for what happens under your
          account, on the site and in the app. We may suspend or close an account that breaches these
          terms, and will refund the unused remainder of a paid period if we do so for anything other
          than serious or repeated abuse.
        </p>
        <p>
          You can cancel a subscription yourself at any time. To delete your account, write to us. See{" "}
          <Link href="/privacy" className="text-coral hover:underline">privacy</Link> for what happens
          to your data when you do.
        </p>
      </Clause>

      <Clause id="ip" title="11. Ownership">
        <p>
          The metrics we build, the writing, the design, the app and the code are ours. The underlying
          statistics are facts and belong to nobody; the feeds they arrive through belong to the
          organizations named on the{" "}
          <Link href="/sources" className="text-coral hover:underline">sources page</Link>. Team names
          and logos are the trademarks of their institutions, and this site is not affiliated with or
          endorsed by any of them.
        </p>
      </Clause>

      <Clause id="changes" title="12. Changes to these terms">
        <p>
          We may update these terms. The date at the top of this page always reflects the current
          version, and a change that materially affects paying subscribers will be sent by email
          before it takes effect. Using the site or the app after a change takes effect means
          accepting it. If you do not accept a change, cancel, and your access runs to the end of the
          period you have paid for.
        </p>
      </Clause>

      <Clause id="law" title="13. Governing law">
        <p>
          These terms are governed by the laws of the State of Texas, United States, and the courts of
          that state have jurisdiction over any dispute. If you are a consumer, this does not deprive
          you of the protection of the mandatory laws of the country where you live. If a court finds
          any part of these terms unenforceable, the rest still applies.
        </p>
      </Clause>

      <Clause id="contact" title="14. Contact">
        <p>
          Questions about these terms, billing or the app go to <ContactEmail />.
        </p>
      </Clause>
    </LegalPage>
  );
}
