import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy — Beyond the Arc",
  description:
    "What Beyond the Arc collects, what it does not collect, who processes it, and how to get it deleted.",
  alternates: { canonical: "/privacy/" },
};

/**
 * The short version is that there is very little to describe, and that is the
 * point worth making loudly rather than burying.
 *
 * EVERY CLAIM IS CHECKED AGAINST THE CODE, not against what a privacy template
 * assumes a site does. There is no analytics script in layout.tsx, no ad
 * network, no third-party tag of any kind; the only browser storage is the
 * Supabase session, the theme choice, a saved-filter list and the plan the
 * reader clicked before signing in — all first-party, none of it tracking.
 * Card details never reach this origin because checkout is Stripe-hosted.
 *
 * If any of that changes, this page is wrong the same day and has to change
 * with the code.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="2026-09-02"
      lede="What we collect, which is very little, and what we do with it, which is less."
    >
      <Clause id="summary" title="The short version">
        <Plainly>
          No advertising network. No third-party analytics. No tracking pixels or cookies. We hold
          your email address and whether you are a subscriber, because we cannot run an account
          without those, and nothing else about you is of any use to us.
        </Plainly>
      </Clause>

      <Clause id="collect" title="What we collect">
        <p>If you have an account, we store:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>your <strong className="text-ink">email address</strong>;</li>
          <li>
            your <strong className="text-ink">subscription state</strong> — plan, status, renewal
            date, and the Stripe customer reference that ties them together;
          </li>
          <li>the date the account was created.</li>
        </ul>
        <p>
          Your password is handled by our authentication provider and is stored hashed. We never see
          it. If you sign in with a one-time link, there is no password at all.
        </p>
        <p>
          If you do not have an account, we do not collect anything about you beyond the ordinary
          server logs our host keeps to serve pages and stop abuse.
        </p>
      </Clause>

      <Clause id="payments" title="Payments">
        <p>
          Checkout and billing run entirely on <strong className="text-ink">Stripe</strong>. Card
          numbers, expiry dates and security codes are entered on Stripe&apos;s own pages and never
          touch this site or its servers. We receive back only what we need to know whether your
          subscription is active.
        </p>
      </Clause>

      <Clause id="browser" title="What is stored in your browser">
        <p>
          Your sign-in session, your light-or-dark choice, any filter views you save in the
          explorers, and — briefly — which plan you clicked before signing in. All of it is
          first-party, none of it is shared with anyone, and clearing your browser data removes it.
        </p>
        <p>There are no advertising or analytics cookies to consent to, because there are none.</p>
      </Clause>

      <Clause id="processors" title="Who else handles it">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><strong className="text-ink">Supabase</strong> — accounts, sign-in and the subscription record.</li>
          <li><strong className="text-ink">Stripe</strong> — payments and billing.</li>
          <li><strong className="text-ink">Netlify</strong> — hosting and server logs.</li>
          <li><strong className="text-ink">Cloudflare R2</strong> — serving the data files behind the pages.</li>
        </ul>
        <p>
          Each is a processor acting on our instructions. We do not sell your data, we do not share
          it for advertising, and we have never been asked for it by anyone.
        </p>
      </Clause>

      <Clause id="email" title="Email we send">
        <p>
          Account email only: sign-in links, receipts, and notice of a change that materially affects
          paying subscribers. There is no marketing list, so there is nothing to unsubscribe from.
        </p>
      </Clause>

      <Clause id="rights" title="Your data, and getting rid of it">
        <p>
          You can ask for a copy of what we hold, ask for it corrected, or ask for the account and
          everything attached to it to be deleted. Write to{" "}
          <a href="mailto:cpb09e@gmail.com" className="text-coral hover:underline">cpb09e@gmail.com</a>{" "}
          and it will be done within 30 days, usually the same week.
        </p>
        <p>
          Deleting an account removes the email address and profile. Stripe keeps payment records
          for as long as tax and accounting law requires, which is not something either of us can
          waive.
        </p>
        <p>
          If you are in the UK or EEA, our basis for holding this is contract — we cannot give you
          an account without it — and you have the rights the UK GDPR and GDPR give you, including
          the right to complain to your supervisory authority. If you are in California, we do not
          sell or share personal information as those terms are defined by the CCPA.
        </p>
      </Clause>

      <Clause id="children" title="Children">
        <p>
          The site is not intended for children under 13 and we do not knowingly collect their
          information. If a child has created an account, write and it will be removed.
        </p>
      </Clause>

      <Clause id="changes" title="Changes">
        <p>
          The date at the top of this page reflects the current version. If the site ever starts
          collecting something it does not collect today, this page changes before that happens,
          not after. See also{" "}
          <Link href="/terms" className="text-coral hover:underline">terms of service</Link> and{" "}
          <Link href="/sources" className="text-coral hover:underline">sources</Link>.
        </p>
      </Clause>
    </LegalPage>
  );
}
