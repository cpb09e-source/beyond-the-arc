"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * The one place a table asks for money.
 *
 * UNDER THE TABLE, NOT OVER IT. A modal or an overlay would cover the rows the
 * preview exists to show — the argument for subscribing IS the five real rows
 * above this bar, and burying them to advertise the other 360 gets the order
 * exactly backwards. It sits where the pagination would be, because that is
 * literally what it replaces.
 *
 * The wording is split in two because the two halves do different jobs: the
 * lead says what is happening right now (a fact the reader can verify by
 * counting the rows), and the tail says what a subscription changes. Rolling
 * them into one sentence made it read as marketing rather than as a status.
 *
 * SHARED BY BOTH EXPLORERS. It lived inside the team explorer until the player
 * views got their own gates; a second copy would have been two bars that drift
 * apart in wording, which on the one control that handles money is the drift
 * that matters most.
 */
export function GateBar({
  lead,
  tail,
  signedIn,
}: {
  lead: string;
  tail: string;
  /** Signed-in readers are asked to upgrade; signed-out ones get a way back in. */
  signedIn: boolean;
}) {
  return (
    <div className="px-3 lg:px-4 py-3 border-t border-hairline bg-coral/4.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Lock size={13} strokeWidth={2.5} className="text-coral shrink-0" aria-hidden />
      <p className="text-sm leading-snug min-w-0 flex-1">
        <span className="text-ink font-medium">{lead}</span>{" "}
        <span className="text-ink-muted">{tail}</span>
      </p>
      <div className="flex items-center gap-2 shrink-0">
        {!signedIn && (
          <Link
            href="/account/login"
            className="px-2.5 py-1.5 rounded-md text-xs text-ink-muted hover:text-coral transition-colors whitespace-nowrap"
          >
            Sign in
          </Link>
        )}
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-md bg-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-coral-soft transition-colors whitespace-nowrap"
        >
          See plans
        </Link>
      </div>
    </div>
  );
}
