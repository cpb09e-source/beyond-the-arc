"use client";

import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";

export function SiteFooter() {
  // The /32-0 exemption that used to live here went with the game itself. If it
  // comes back it needs this again — the game is a full-viewport surface and
  // wants no footer. See the archive/32-0-game tag.
  return (
    <footer className="border-t border-hairline mt-6 sm:mt-12 py-6 sm:py-8">
      {/* Matches site-header exactly — same max-width AND same padding scale, so
          the two chrome elements line up at every breakpoint. It was max-w-7xl
          (80rem) against the header's 108rem, which read as inset on every page
          and badly so on team pages, where the content itself runs 88rem to
          100rem and the footer sat narrower than the tables above it. */}
      <div className="mx-auto max-w-[108rem] px-6 lg:px-10 xl:px-16 flex flex-row items-center justify-between gap-3 sm:gap-4 text-sm text-ink-muted">
        <Link href="/" className="flex items-center group shrink-0">
          {/* The same single-file mark the header and the mobile menu carry.
              It replaces the old light/dark PAIR — two images, one hidden by
              theme — which this mark does not need: it reads on paper and on
              the After Hours navy alike, so the second file and the
              .ttz-nav-logo-* toggles it depended on are gone.

              h-9 against the header's h-8. The mark is 3.75:1, so at the
              bottom of a page it can afford the extra eighth. */}
          <SiteLogo className="h-9 w-auto group-hover:opacity-80 transition-opacity" />
        </Link>
        <span className="hidden sm:inline text-ink-muted">·</span>
        <span className="hidden md:inline text-xs sm:text-sm">
          Editorial-grade college basketball analytics.
        </span>
        {/* The legal set, reachable from every page — which is the only place
            attribution and terms are any use. Kept to the right so the line
            still reads as chrome rather than as navigation. */}
        <nav aria-label="Site information" className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Link href="/sources" className="hover:text-ink transition-colors">Sources</Link>
          <Link href="/terms" className="hover:text-ink transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-ink transition-colors">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
