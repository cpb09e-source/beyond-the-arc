"use client";

import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";
import { SearchDialog } from "@/components/search/search-dialog";
import { AccountNav } from "@/components/account/account-nav";
import { MobileMenu } from "@/components/mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * The pages that hang off a nav label rather than being one.
 *
 * Teams is two tables now - the explorer, and the conference power
 * rankings built from it - and the row has no width for an eighth label:
 * seven already needed the xl gutter given back to fit at 1024. A menu adds
 * a page without adding a word.
 */
const SUBNAV: Record<string, ReadonlyArray<{ href: string; label: string; desc: string }>> = {
  "/": [
    { href: "/", label: "Team Explorer", desc: "Every team, every season, your columns" },
    { href: "/conferences", label: "Conference Power Rankings", desc: "Each league minus its bottom two" },
  ],
};

const NAV = [
  { href: "/", label: "Teams" },
  // Second, not last: scores are the reason to come back daily, and the only
  // page here whose answer changes between two visits on the same evening.
  { href: "/scoreboard", label: "Scoreboard" },
  { href: "/players", label: "Players" },
  { href: "/coaches", label: "Coaches" },
  { href: "/calc", label: "Win Calc" },
  { href: "/portal", label: "Transfer Portal" },
];

// The mobile menu carries one extra entry. Pricing is a real page that the
// desktop row has no width for — seven labels already fill it — so without
// this the only route to it is a URL someone was given.
const MOBILE_NAV = [
  ...NAV.flatMap((item) => {
    const kids = SUBNAV[item.href];
    // The parent label is kept and the children follow it: on a phone the
    // list scrolls, so there is no reason to hide a page behind a hover.
    return kids ? kids.map((k) => ({ href: k.href, label: k.label })) : [item];
  }),
  { href: "/pricing", label: "Pricing" },
];

// Active-route detection. The home route ("/") must match EXACTLY — otherwise
// every page starts with "/" and the home link would always read active.
function isCurrent(pathname: string, href: string): boolean {
  // The Teams chip covers everything on its menu, so /conferences does not
  // leave the row with nothing lit.
  if (href === "/") {
    return pathname === "/" || SUBNAV["/"]!.some((k) => k.href !== "/" && pathname.startsWith(k.href));
  }
  // A single game lives at /game?id=… rather than under /scoreboard/, because
  // a static export cannot enumerate every game id at build time. It is still
  // the scoreboard's territory, so it lights that tab.
  if (href === "/scoreboard" && pathname.startsWith("/game")) return true;
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * A nav chip that is also a menu.
 *
 * THE CHIP IS STILL A LINK. "Teams" goes to the team explorer on click, the
 * way it always has, and the menu is an addition rather than a toll booth -
 * turning a working link into a button that only opens a list is the thing
 * that makes people hunt for a page they used to reach in one click.
 *
 * Opens on hover AND on focus, closes on Escape and on blur out of the group.
 * Touch never sees it: below lg the whole row is replaced by the drawer, where
 * the child pages are listed flat.
 */
function NavMenu({
  label,
  href,
  items,
  active,
  pathname,
}: {
  label: string;
  href: string;
  items: ReadonlyArray<{ href: string; label: string; desc: string }>;
  active: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
    >
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        className={cn(
          "relative inline-flex items-center gap-1 whitespace-nowrap rounded-md py-1.5 text-[0.7rem] uppercase font-medium transition-colors",
          "px-2 tracking-[0.1em] xl:px-3 xl:tracking-[0.18em]",
          active
            ? "bg-paper text-ink shadow-sm ring-1 ring-ink/5"
            : "text-ink-muted hover:text-ink hover:bg-paper/60",
        )}
      >
        {label}
        <ChevronDown size={11} strokeWidth={2.5} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </Link>
      {open && (
        // No gap between the chip and the panel: a few pixels of nothing is
        // enough to drop the hover on the way down and close the menu under
        // the pointer.
        <div className="absolute left-0 top-full pt-1 w-64">
          <div className="rounded-lg border border-ink/12 bg-card shadow-lg ring-1 ring-ink/5 py-1">
            {items.map((k) => {
              const here = k.href === "/" ? pathname === "/" : pathname.startsWith(k.href);
              return (
                <Link
                  key={k.href}
                  href={k.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-3 py-2 transition-colors",
                    here ? "bg-coral/6" : "hover:bg-paper-deep/60",
                  )}
                >
                  <span className={cn("block text-sm font-medium", here ? "text-coral" : "text-ink")}>{k.label}</span>
                  <span className="block text-xs text-ink-muted leading-snug mt-0.5">{k.desc}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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
    // NO BAR. The header carries no background of its own — it sits on the
    // page's own paper and the nav trough below is the only filled shape in the
    // row. Safe because this header is `relative`, not sticky: it scrolls away
    // with the page, so nothing ever passes under it needing to be masked. (The
    // wash and blur it used to carry existed for a stickiness it never had.)
    <header className="relative z-50">
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
          {/* One file, not the light/dark pair: the new mark ships as a single
              asset and dark mode is off site-wide. If dark returns, add the
              dark variant back alongside it with the ttz-nav-logo-* classes.

              h-8, not h-10. The mark is 1200x320 (3.75:1) where the original
              was 2.5:1, so height buys width faster here — h-8 renders 120px
              against the old logo's 100px. */}
          <SiteLogo className="h-8 w-auto group-hover:opacity-80 transition-opacity" />
        </Link>

        {/* Desktop nav as a SEGMENTED CONTROL: the links sit in a recessed
            translucent trough, and the current page is a raised paper chip
            inside it.

            This replaced a coral baseline underline that grew on hover. The
            underline is still the site's motif everywhere else — section
            kickers, the active tab on the game page — but in the header it was
            a one-pixel line asked to carry the "you are here" signal across a
            row of seven near-identical labels, and a filled shape does that at
            a glance where a hairline does not. It also gives the row a single
            object to be, rather than seven loose words floating in a bar.

            The trough is the only filled surface in the header; the bar itself
            has no background at all now. */}
        {/* The inline nav starts at lg, not md. Seven items plus the wordmark and
            the search box need about 990px; at the md breakpoint the row was
            941px wide in a 768px viewport and pushed the whole page sideways —
            with six items it was already 820px, so this predates the scoreboard
            link and was only ever hidden by nobody sitting at exactly 768. */}
        <nav className="hidden lg:flex items-center gap-0.5 rounded-lg bg-ink/6 p-1 backdrop-blur-sm">
          {NAV.map((item) => {
            const active = isCurrent(pathname, item.href);
            const kids = SUBNAV[item.href];
            if (kids) {
              return (
                <NavMenu
                  key={item.href}
                  label={item.label}
                  href={item.href}
                  items={kids}
                  active={active}
                  pathname={pathname}
                />
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // Nowrap plus a tighter tier at lg: seven labels on one
                  // line need the room, and "Transfer Portal" breaking across
                  // two lines in a nav bar reads as a layout accident.
                  "relative whitespace-nowrap rounded-md py-1.5 text-[0.7rem] uppercase font-medium transition-colors",
                  "px-2 tracking-[0.1em] xl:px-3 xl:tracking-[0.18em]",
                  active
                    // The current page is a RAISED chip inside the recessed
                    // trough — the segmented-control read, where the shapes
                    // themselves say which one you are on.
                    ? "bg-paper text-ink shadow-sm ring-1 ring-ink/5"
                    : "text-ink-muted hover:text-ink hover:bg-paper/60",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: search on desktop, hamburger on mobile. */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Theme switch. Desktop only here — below lg the header row has no
              spare width, and the same control is in the hamburger sheet. */}
          <ThemeToggle className="hidden lg:inline-flex" />
          {/* SearchDialog renders its own desktop trigger (hidden on mobile) and
              the modal. Kept un-wrapped so the modal works on mobile too. */}
          <SearchDialog />
          {/* Account sits with search rather than in NAV — see the note on that
              array about the row's width budget. */}
          <AccountNav />
          {/* Mobile search — opens the same dialog via a custom event. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("bta:open-search"))}
            aria-label="Open search"
            /* Tinted chip, thin glyph. The chip is what makes it read as a
               control in a header that is otherwise all type; the Clerk pass
               was about the MARK inside it, which is now 16px at 1.75 rather
               than 18px at 2. The 36px box stays as the tap target either way. */
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors"
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            /* Same chip as the search button beside it and as the close button
               inside the menu. The hamburger IS that X once the panel opens, so
               one shape across all three makes the swap read as a single
               control changing state rather than as different buttons. The bars
               themselves are 15x10 at 1.5px now, down from 17x13 at 2px. */
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors"
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

      {/* Full-screen menu, replacing the old slide-down drawer. */}
      <MobileMenu
        open={open}
        onClose={() => setOpen(false)}
        items={MOBILE_NAV}
        isCurrent={isCurrent}
        pathname={pathname}
      />

    </header>
  );
}

