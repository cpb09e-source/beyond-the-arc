import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, Plainly } from "@/components/legal/legal-page";
import { ContactEmail, LEGAL_ENTITY } from "@/components/legal/legal-facts";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Beyond the Arc and its Windows app collect, what they do not, who processes it, and how to get it deleted.",
  alternates: { canonical: "/privacy/" },
};

/**
 * The short version is that there is very little to describe, and that is the
 * point worth making loudly rather than burying.
 *
 * EVERY CLAIM IS CHECKED AGAINST THE CODE, not against what a privacy template
 * assumes a site does. Re-audited 2026-09-13:
 *
 *   no analytics, no tags       app/layout.tsx carries only the theme script;
 *                               desktop/src has no analytics or crash reporter
 *   account fields              supabase/migrations/010_profiles.sql
 *   password sign-in only       components/account/login-client.tsx (no one-time links)
 *   card never reaches us       Stripe-hosted checkout and billing portal
 *   questions to Anthropic      netlify/functions/parse-query.mts sends the
 *                               question alone; its log line is token counts
 *   app sign-in codes           supabase/migrations/012_desktop_auth.sql
 *   app session, encrypted      desktop/src/main/auth.ts (safeStorage, DPAPI)
 *   paid data deleted           desktop/src/main/data.ts purgePaidCache
 *   survives uninstall          desktop/electron-builder.yml deleteAppDataOnUninstall
 *   outside image hosts         components/team-logo.tsx (Google Cloud Storage),
 *                               lib/nba-draftees.ts nbaLogoUrl (ESPN)
 *
 * If any of that changes, this page is wrong the same day and has to change
 * with the code.
 *
 * THE PROCESSOR DISCLOSURE IS BACK; THE BROWSER-STORAGE ONE STAYS CUT. Both
 * were cut on Colin's instruction 2026-09-02. On 2026-09-13 he restored "Who
 * else handles it", because the Windows app and Ask the Calculator send data to
 * services a reader would not otherwise know about, and kept "What is stored in
 * your browser" out. See docs/TODO-legal-sources.md.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="2026-09-13"
    >
      <Clause id="summary" title="The short version">
        <Plainly>
          No advertising network. No analytics, on the site or in the app. No tracking pixels or
          tracking cookies. We hold your email address and whether you are a subscriber, because we
          cannot run an account without those, and nothing else about you is of any use to us.
        </Plainly>
      </Clause>

      <Clause id="who" title="Who is responsible">
        <p>
          Beyond the Arc is operated by <strong className="text-ink">{LEGAL_ENTITY}</strong>, a sole
          proprietor based in Texas, United States, who is responsible for the information described
          on this page. Write to <ContactEmail /> about anything here.
        </p>
      </Clause>

      <Clause id="collect" title="What we collect">
        <p>If you have an account, we store:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>your <strong className="text-ink">email address</strong>;</li>
          <li>
            your <strong className="text-ink">subscription state</strong>: plan, status, the date it
            renews or ends, and the Stripe customer and price references that tie them together;
          </li>
          <li>whether the account has staff access;</li>
          <li>the dates the account was created and last changed.</li>
        </ul>
        <p>
          Your password is handled by our authentication provider, Supabase, and is stored hashed. We
          never see it.
        </p>
        <p>
          When you connect the Windows app, we briefly store a one-time sign-in code for your account,
          in hashed form. It works once and expires after five minutes.
        </p>
        <p>
          If you do not have an account, we do not collect anything about you beyond the ordinary
          request logs our hosting providers keep to serve pages and stop abuse, which include your IP
          address.
        </p>
      </Clause>

      <Clause id="payments" title="Payments">
        <p>
          Checkout and billing run entirely on <strong className="text-ink">Stripe</strong>. Card
          numbers, expiry dates and security codes are entered on Stripe&apos;s own pages and never
          touch this site or its servers. Stripe may also ask for a billing address, which it keeps. We
          receive back only what we need to know whether your subscription is active.
        </p>
      </Clause>

      <Clause id="ask" title="Questions you ask the Win Calculator">
        <p>
          When you use Ask the Calculator, on the site or in the app, the text of your question goes to
          our server, which sends it to <strong className="text-ink">Anthropic</strong>&apos;s API to
          be turned into filters. Anthropic receives the question and nothing else: not your name,
          your email address or your account.
        </p>
        <p>
          We do not store your questions. Our logs record how much of the model each request used, not
          what was asked. Requests are rate-limited by IP address to stop abuse. Please do not type
          personal information into the question box.
        </p>
      </Clause>

      <Clause id="app" title="The Windows app">
        <p>The app keeps these on your computer, in its folder in your Windows user profile:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            your <strong className="text-ink">session</strong>, encrypted with Windows&apos; own data
            protection so that only your Windows account can read it. Where encryption is not
            available, the session is kept in memory only and you sign in each time you open the app;
          </li>
          <li>
            copies of the <strong className="text-ink">data files</strong> it has downloaded, so
            seasons open quickly and work offline. Paid seasons are kept apart and deleted when you
            sign out or your Season Pass ends;
          </li>
          <li>your preferences, such as favorites and the season and view you last had open.</li>
        </ul>
        <Plainly>
          The app has no analytics and no crash reporting. It talks only to btacbb.xyz and to our own
          file storage, for sign-in, data, Ask the Calculator and updates. Uninstalling the app does not
          delete its folder, so sign out first if you want your session and any paid data gone.
        </Plainly>
      </Clause>

      <Clause id="processors" title="Who else handles it">
        <p>A handful of services run the site for us, and each sees only what its job needs:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><strong className="text-ink">Supabase</strong>: accounts and sign-in;</li>
          <li><strong className="text-ink">Stripe</strong>: payments and billing;</li>
          <li>
            <strong className="text-ink">Netlify</strong>: hosts the site and runs its server functions,
            and keeps request logs;
          </li>
          <li>
            <strong className="text-ink">Cloudflare R2</strong>: stores and serves the data files, the
            Windows app and its updates;
          </li>
          <li>
            <strong className="text-ink">Anthropic</strong>: reads Ask the Calculator questions, as
            described above.
          </li>
        </ul>
        <p>
          Some images load from other hosts: team logos from an image library on Google Cloud Storage,
          and NBA team logos on player pages from ESPN. As with any web request, those hosts see your IP
          address and browser details. We do not sell your personal information, and we share it with
          no one beyond the services listed here.
        </p>
      </Clause>

      <Clause id="email" title="Email we send">
        <p>
          Account email only: password reset links, and notice of a change that materially affects
          paying subscribers. Billing emails, such as receipts, come from Stripe. There is no marketing
          list, so there is nothing to unsubscribe from.
        </p>
      </Clause>

      <Clause id="rights" title="Your data, and getting rid of it">
        <p>
          Account information is kept for as long as the account exists. You can ask for a copy of what
          we hold, ask for it corrected, or ask for the account and everything attached to it to be
          deleted. Write to <ContactEmail /> and it will be done within 30 days, usually the same week.
        </p>
        <p>
          Deleting an account removes the email address, the profile and any app sign-in codes. Stripe
          keeps payment records for as long as tax and accounting law requires, which is not something
          either of us can waive. Data the app saved on your own computer stays there until you sign out
          or delete the app&apos;s folder.
        </p>
        <p>
          Beyond the Arc is run from the United States, and your information is processed there and
          wherever the services above operate. If you are in the UK or EEA, our basis for holding it is
          contract: we cannot give you an account without it. You have the rights the UK GDPR and GDPR
          give you, including the right to complain to your supervisory authority. If you are in
          California, we do not sell or share personal information as those terms are defined by the
          CCPA.
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
          The date at the top of this page reflects the current version. If the site or the app ever
          starts collecting something it does not collect today, this page changes before that happens,
          not after. See also{" "}
          <Link href="/terms" className="text-coral hover:underline">terms of service</Link> and{" "}
          <Link href="/sources" className="text-coral hover:underline">sources</Link>.
        </p>
      </Clause>
    </LegalPage>
  );
}
