"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { SearchDialog } from "@/components/search/search-dialog";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Teams" },
  // Second, not last: scores are the reason to come back daily, and the only
  // page here whose answer changes between two visits on the same evening.
  { href: "/scoreboard", label: "Scoreboard" },
  { href: "/preview", label: "26-27 Preview" },
  { href: "/players", label: "Players" },
  { href: "/coaches", label: "Coaches" },
  { href: "/calc", label: "Win Calc" },
  { href: "/portal", label: "Transfer Portal" },
];

// Active-route detection. The home route ("/") must match EXACTLY — otherwise
// every page starts with "/" and the home link would always read active.
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // A single game lives at /game?id=… rather than under /scoreboard/, because
  // a static export cannot enumerate every game id at build time. It is still
  // the scoreboard's territory, so it lights that tab.
  if (href === "/scoreboard" && pathname.startsWith("/game")) return true;
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";

  // Close the drawer if the viewport widens past mobile.
  useEffect(() => {
    if (!open) return;
    function onResize() {
      if (window.innerWidth >= 1024) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  return (
    // z-50: must clear the tables' sticky header cells (z-40), which
    // otherwise paint over the search dropdown — same z, later in the DOM.
    // Body-portaled modals still win: equal-or-higher z AND later DOM order.
    <header className="bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/60 relative z-50">
      {/* 108rem matches the widest page container on the site (the teams and
          players tables), so the logo and search line up with the table's edges
          instead of floating inside them. Same width on every route — narrower
          pages just leave more air, which beats the nav shifting as you
          navigate. Only visible above 1408px; below that every container is
          viewport-width anyway. lg:px-16 (vs the pages' lg:px-10) pulls the
          chrome in ~24px from the table edges on each side — per Colin, the
          header sits a touch narrower than the content under it.
          `relative` anchors the search dropdown panel to this container. */}
      {/* The generous lg:px-16 gutter only starts at xl now: at exactly 1024 the
          seven nav labels needed 13px more than the row had, and the gutter was
          the cheapest 48px on the page to give back. */}
      <div className="relative mx-auto max-w-[108rem] px-6 lg:px-10 xl:px-16 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center group shrink-0"
          onClick={() => setOpen(false)}
        >
          <img
            src="/images/bta_nav_logo_light-01.svg"
            alt="Beyond the Arc"
            className="ttz-nav-logo-light h-10 w-auto group-hover:opacity-80 transition-opacity"
          />
          <img
            src="/images/bta_nav_logo_dark-01.svg"
            alt="Beyond the Arc"
            className="ttz-nav-logo-dark h-10 w-auto group-hover:opacity-80 transition-opacity"
          />
        </Link>

        {/* Desktop nav — small-caps tracked, coral baseline underline marks
            the current page. The underline scales from 0 → 100% on hover for
            non-active links (40% width tease) and stays full-width on the
            active link. Mirrors the kicker-rule motif used across the site. */}
        {/* The inline nav starts at lg, not md. Seven items plus the wordmark and
            the search box need about 990px; at the md breakpoint the row was
            941px wide in a 768px viewport and pushed the whole page sideways —
            with six items it was already 820px, so this predates the scoreboard
            link and was only ever hidden by nobody sitting at exactly 768. */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
          {NAV.map((item) => {
            const active = isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // Nowrap plus a tighter tier at lg: seven labels on one
                  // line need the room, and "Transfer Portal" breaking across
                  // two lines in a nav bar reads as a layout accident.
                  "group relative whitespace-nowrap py-2 text-[0.7rem] uppercase font-medium transition-colors",
                  "px-2 tracking-[0.1em] xl:px-3 xl:tracking-[0.18em]",
                  active ? "text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-2 right-2 xl:left-3 xl:right-3 bottom-1 h-px bg-coral origin-center",
                    "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-[0.4]",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: 32-0 game pill, search on desktop, hamburger on mobile. */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* 32-0 nav button hidden for now (game still lives at /32-0). */}
          {/* SearchDialog renders its own desktop trigger (hidden on mobile) and
              the modal. Kept un-wrapped so the modal works on mobile too. */}
          <SearchDialog />
          {/* Mobile search — opens the same dialog via a custom event. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("bta:open-search"))}
            aria-label="Open search"
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-paper-deep transition-colors"
          >
            <Search size={20} />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-paper-deep transition-colors"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {/* Three bars that morph into an X — see .bta-burger in globals.css.
                A real <button> driven by React state rather than the source
                component's hidden-checkbox trick, so aria-expanded /
                aria-controls stay honest. */}
            <span className="bta-burger" data-open={open} aria-hidden>
              <span /><span /><span />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile slide-down drawer */}
      {open && (
        <div id="mobile-nav" className="lg:hidden bg-paper">
          <nav className="px-6 py-4 flex flex-col">
            {NAV.map((item) => {
              const active = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "group relative py-3 text-[0.75rem] uppercase tracking-[0.18em] font-medium transition-colors",
                    active ? "text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute left-0 bottom-2 h-px bg-coral origin-left",
                      "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                      active ? "w-8 scale-x-100" : "w-8 scale-x-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}

