"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useEntitlement } from "@/lib/use-entitlement";

/**
 * A team-page section a free reader can see the shape of but not read.
 *
 * SAME TREATMENT AS THE PREVIEW-SEASON BLUR next door in preview-blur.tsx, and
 * that is on purpose rather than laziness: a reader who has met one of these
 * already knows what a softened panel with a card over it means. What differs
 * is only the card — "no games yet" is a fact about the season, this is an
 * offer — so the mechanics are shared and the words are not.
 *
 * WHY THE CONTENT IS STILL RENDERED UNDERNEATH. Two reasons, one good and one
 * merely true.
 *
 * The good one: the blur has to be OF something. A section replaced by a
 * padlock advertises a feature; a section you can see the shape of — the
 * column count, the row count, the fact that real numbers vary down the
 * table — shows one. That is most of the argument for paying.
 *
 * The merely true one: this cannot withhold anything anyway. Team pages are
 * prerendered, so every number is in the HTML the CDN served before this
 * component ran. See PAID_TEAM_TABS in lib/access.ts for why that trade was
 * taken. Do not let this comment become an excuse to put something genuinely
 * sensitive behind it.
 *
 * NOT USED FOR SAMPLE TEAMS. The caller checks isSampleTeam() and does not
 * render this at all, so a sample page ships no gate to disable.
 */
export function PaidSection({
  title,
  blurb,
  children,
}: {
  /** What is behind the wall, named — "Lineups", not "This section". */
  title: string;
  /** One line on what the reader would get. */
  blurb: string;
  children: ReactNode;
}) {
  const { paid, signedIn } = useEntitlement();
  // Optimistic while membership resolves — see useEntitlement. A subscriber
  // watching their own page blur and then clear on every load is worse than a
  // free reader seeing it a beat late.
  if (paid) return <>{children}</>;

  return (
    <div className="relative">
      <div
        // grayscale, not saturate-50: these tables carry percentile chips, and a
        // colour block survives a blur intact — a green smudge still ranks the
        // lineup. Same reasoning as the explorer’s locked bands.
        className="pointer-events-none select-none blur-[5px] opacity-40 grayscale max-h-[32rem] overflow-hidden"
        aria-hidden
      >
        {children}
      </div>

      {/* Anchored near the top rather than centred. These sections are tall —
          a lineup grid runs well past a screen — and a card centred in 900px
          of blur sits below the fold, so the reader scrolls through a smear
          with no explanation before reaching the one element that explains
          it. */}
      <div className="absolute inset-x-0 top-0 grid place-items-center px-4 pt-16">
        <div className="max-w-sm rounded-xl border border-hairline bg-paper/92 backdrop-blur-sm shadow-lg px-5 py-4 text-center">
          <Lock size={16} strokeWidth={2.5} className="mx-auto text-coral" aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">{title} is part of the Season Pass</p>
          <p className="mt-1 text-sm text-ink-muted leading-snug">{blurb}</p>

          <Link
            href="/pricing"
            className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-coral px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-coral-soft"
          >
            See plans
          </Link>

          {/* The sample is offered HERE, at the moment of refusal, rather than
              anywhere else on the site. It is the only link on this card that
              costs nothing and answers the reader's actual question, which is
              "is this any good?" */}
          <p className="mt-2.5 text-xs text-ink-muted leading-snug">
            Or read{" "}
            <Link href="/teams/vanderbilt/2026/lineups/" className="text-coral hover:underline">
              Vanderbilt
            </Link>{" "}
            and{" "}
            <Link href="/teams/saint-louis/2026/lineups/" className="text-coral hover:underline">
              Saint Louis
            </Link>{" "}
            in full, free.
          </p>

          {!signedIn && (
            <Link
              href="/account/login"
              className="mt-2 block text-xs text-ink-muted transition-colors hover:text-coral"
            >
              Already a member? Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The counterpart, on the two teams that are open.
 *
 * A sample that is not LABELLED a sample is just a paywall that failed. This
 * says why the page is readable, so a reader who arrived here from the card
 * above understands they are looking at the thing being sold rather than
 * assuming lineups are free everywhere and hitting the wall on their own team.
 */
export function SampleBanner({ teamName }: { teamName: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-coral/25 bg-coral/[0.06] px-3 py-2">
      <span className="text-[0.6rem] font-bold uppercase tracking-widest text-coral">
        Free sample
      </span>
      <span className="text-sm text-ink-soft">
        {teamName} is open to everyone. Every other team needs a Season Pass.
      </span>
      <Link
        href="/pricing"
        className="text-sm font-medium text-coral transition-colors hover:underline"
      >
        See plans
      </Link>
    </div>
  );
}
