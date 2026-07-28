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
          <img
            src="/images/bta_nav_logo_light-01.svg"
            alt="Beyond the Arc"
            className="ttz-nav-logo-light h-9 w-auto group-hover:opacity-80 transition-opacity"
          />
          <img
            src="/images/bta_nav_logo_dark-01.svg"
            alt="Beyond the Arc"
            className="ttz-nav-logo-dark h-9 w-auto group-hover:opacity-80 transition-opacity"
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
