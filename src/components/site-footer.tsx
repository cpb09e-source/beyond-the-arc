"use client";

import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";

/**
 * The site's map, at the bottom of every page.
 *
 * WHY IT IS A MAP AND NOT A LINE. This was a logo, a tagline and nothing else,
 * which is a footer for a site with four pages. There are eleven public
 * destinations here and the header can only carry six — Pricing already had no
 * route from the desktop nav at all, and the glossary and the legal pages had
 * none from anywhere. A footer is where a site is allowed to be complete: no
 * width budget to argue over, and a reader who has scrolled to the bottom is
 * by definition looking for somewhere to go next.
 *
 * THE COLUMNS FOLLOW THE HEADER, so the two agree about what this site is.
 * Teams and Players each own an explorer and a game log in the nav; they own
 * the same pairs here. Nothing in this file invents a destination — every href
 * is a route that exists, checked against the header's own NAV and SUBNAV.
 *
 * The disclaimer sits in the bottom bar rather than on /sources alone. It is
 * the one legal line that has to be visible without a click, because the thing
 * it disclaims — a wall of school logos — is visible without a click on nearly
 * every page.
 */

type FooterLink = { href: string; label: string };

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Teams",
    links: [
      { href: "/", label: "Team explorer" },
      { href: "/teams/games", label: "Team game logs" },
      { href: "/conferences", label: "Conference rankings" },
      { href: "/scoreboard", label: "Scoreboard" },
    ],
  },
  {
    title: "Players",
    links: [
      { href: "/players", label: "Player explorer" },
      { href: "/players/games", label: "Player game logs" },
      { href: "/coaches", label: "Coaches" },
      { href: "/portal", label: "Transfer portal" },
    ],
  },
  {
    title: "More",
    links: [
      { href: "/calc", label: "Win calculator" },
      { href: "/glossary", label: "Glossary" },
      { href: "/pricing", label: "Pricing" },
      { href: "/account", label: "Your account" },
    ],
  },
  {
    title: "About",
    links: [
      { href: "/sources", label: "Sources & attribution" },
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function SiteFooter() {
  // The /32-0 exemption that used to live here went with the game itself. If it
  // comes back it needs this again — the game is a full-viewport surface and
  // wants no footer. See the archive/32-0-game tag.
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-hairline mt-6 sm:mt-12 pt-10 pb-8">
      {/* Matches site-header exactly — same max-width AND same padding scale, so
          the two chrome elements line up at every breakpoint. */}
      <div className="mx-auto max-w-[108rem] px-6 lg:px-10 xl:px-16">
        <div className="flex flex-col lg:flex-row lg:items-start gap-10 lg:gap-16">
          {/* The mark, and what the site is for. Fixed width on desktop so the
              four link columns divide the remaining space evenly. */}
          <div className="lg:w-64 shrink-0">
            <Link href="/" className="inline-flex items-center group">
              <SiteLogo className="h-9 w-auto group-hover:opacity-80 transition-opacity" />
            </Link>
            <p className="mt-3 text-xs text-ink-muted leading-relaxed max-w-[22rem]">
              Editorial-grade college basketball analytics — every team, every player,
              every game since 2014.
            </p>
          </div>

          <nav
            aria-label="Site map"
            className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8"
          >
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted font-semibold">
                  {col.title}
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link
                        href={l.href}
                        className="text-[0.8rem] text-ink-soft hover:text-ink transition-colors"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-10 pt-5 border-t border-hairline flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-[0.7rem] text-ink-muted">
          <span>© {year} Beyond the Arc</span>
          <span className="sm:max-w-[62ch] leading-relaxed">
            Not affiliated with, endorsed by, or sponsored by the NCAA, any conference, or any
            college or university. Team names and logos are the trademarks of their institutions.
          </span>
        </div>
      </div>
    </footer>
  );
}
