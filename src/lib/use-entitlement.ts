"use client";

/**
 * "May this reader see it?" — one answer, one place, for every product gate.
 *
 * WHY THIS IS NOT JUST describeMembership(profile).paid. Because there are
 * three states, not two, and the third one is where the bugs live. Between
 * first paint and the profile row arriving we do not KNOW what this reader is
 * entitled to, and that gap is a real network round trip, not a tick.
 *
 * IT RESOLVES UNKNOWN AS ENTITLED, deliberately.
 *
 * The alternative — assume free until told otherwise — means every subscriber
 * watches their own table lock itself and then unlock, on every page load. A
 * paying customer being shown a padlock is a support email; a free reader
 * seeing an extra column for 200ms is nothing. The asymmetry is not close.
 *
 * THAT IS ONLY SAFE BECAUSE NOTHING HERE GUARDS DATA. Every gate that reads
 * this hook is a presentation gate over rows the browser already holds — see
 * the header of src/lib/access.ts. The archive gate, which is the one that
 * actually withholds bytes, is decided by a Netlify function against a token
 * and never consults this file. So the worst case of failing open is that
 * somebody sees a column we would rather have sold them, which is the same
 * thing devtools would have given them anyway.
 *
 * It also fails open PERMANENTLY if the profile fetch errors, and that is the
 * intended behaviour rather than an oversight: a Supabase outage should
 * degrade to a generous site, not one that locks out the people paying for it.
 */
import { useMemo } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { describeMembership } from "@/lib/auth/membership";

export type Entitlement = {
  /** True when every gate should stand down. Optimistic while unresolved. */
  paid: boolean;
  /**
   * True when there is a session at all.
   *
   * Separate from `paid` because the two drive different words. A signed-out
   * reader is asked to create an account; a signed-in free reader is asked to
   * upgrade, and being told to "sign up" when they are already signed in is
   * the kind of thing that makes a product feel broken.
   */
  signedIn: boolean;
  /** False until membership is actually known. Use for wording, not for gating. */
  known: boolean;
};

export function useEntitlement(): Entitlement {
  /**
   * OPTIONAL, and that is not defensive programming — it is the difference
   * between one control rendering plainly and a whole route losing its
   * prerender. Without a provider React discards the server HTML for the
   * entire page and re-renders it client-side.
   *
   * "No provider" is not a new state to reason about: it is the unresolved
   * case this hook already models, so it takes the same optimistic answer.
   */
  const auth = useAuthOptional();
  const status = auth?.status;
  const profile = auth?.profile ?? null;
  const profileLoading = auth?.profileLoading ?? false;
  return useMemo(() => {
    const signedIn = status === "signedIn";
    // Unresolved covers both halves of the wait: the stored session being read
    // back, and then the profile row being fetched for it. Only the second one
    // knows whether they are a subscriber.
    const unresolved =
      status === undefined || status === "loading"
      || (signedIn && (profileLoading || profile === null));
    return {
      paid: unresolved ? true : describeMembership(profile).paid,
      signedIn,
      known: !unresolved,
    };
  }, [status, profile, profileLoading]);
}
