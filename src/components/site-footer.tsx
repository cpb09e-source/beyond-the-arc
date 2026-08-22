"use client";

import Link from "next/link";

export function SiteFooter() {
  // The /32-0 exemption that used to live here went with the game itself. If it
  // comes back it needs this again — the game is a full-viewport surface and
  // wants no footer. See the archive/32-0-game tag.
  return (
    <footer className="border-t border-hairline mt-6 sm:mt-12 py-6 sm:py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 flex flex-row items-center justify-between gap-3 sm:gap-4 text-sm text-ink-muted">
        <Link href="/" className="flex items-center group shrink-0">
          {/* The same single-file mark the header and the mobile menu carry.
              It replaces the old light/dark PAIR — two images, one hidden by
              theme — which this mark does not need: it reads on paper and on
              the After Hours navy alike, so the second file and the
              .ttz-nav-logo-* toggles it depended on are gone.

              h-9 against the header's h-8. The mark is 3.75:1, so at the
              bottom of a page it can afford the extra eighth. */}
          <img
            src="/images/btalogo_final-01.svg"
            alt="Beyond the Arc"
            className="h-9 w-auto group-hover:opacity-80 transition-opacity"
          />
        </Link>
        <span className="hidden sm:inline text-ink-muted">·</span>
        <span className="text-xs sm:text-sm">
          Editorial-grade college basketball analytics.
        </span>
      </div>
    </footer>
  );
}
