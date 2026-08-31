"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SiteLogo } from "@/components/site-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The mobile menu — a FULL-SCREEN sheet, like Ramp's: its own wordmark and
 * close button, sentence-case rows separated by hairlines, and the settings
 * and account actions on the bottom edge of the screen.
 *
 * It spent a while at auto height, ending where its content ended, because
 * seven always-open rows left a band of empty paper above the account block.
 * Collapsing the Teams section took three rows down to one and made that gap
 * worse, not better — a short panel with a strip of live page under it reads
 * as a dropdown that failed to finish. Full height instead: the nav owns the
 * screen while it is open, and the empty space belongs to the sheet rather
 * than looking like a mistake.
 *
 * The structure is borrowed; the palette is not. Ramp is black type and acid
 * yellow on white, which would look like someone else's site pasted into this
 * one — so the rows are ink on paper and the primary action is the site's own
 * azure.
 *
 * CHEVRONS ONLY ON SECTIONS. Ramp puts a chevron on rows that expand into a
 * submenu and leaves its direct links (Customers, Pricing) bare. Teams is the
 * one row here with pages under it, so it is the one row with a chevron - and
 * it starts SHUT. Two children permanently open under a heading spent three
 * rows on one destination and pushed the rest of the nav down the screen;
 * closed, a section costs exactly what a link costs.
 *
 * Replaces a slide-down drawer whose rows were 12px uppercase links — legible,
 * but sized for a desktop nav rather than for a thumb.
 */
export function MobileMenu({
  open,
  onClose,
  items,
  isCurrent,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * A row is either a destination or a SECTION: a heading with its own
   * destinations under it. Teams is two tables rather than one page, and a
   * flat list either hides that or spends two top-level rows saying it.
   */
  items: ReadonlyArray<
    | { href: string; label: string; children?: undefined }
    | {
        href?: undefined;
        label: string;
        children: ReadonlyArray<{
          href: string;
          label: string;
          desc?: string;
          icon?: LucideIcon;
        }>;
      }
  >;
  isCurrent: (pathname: string, href: string) => boolean;
  pathname: string;
}) {
  const { status, session, profile } = useAuth();
  // Focus lands on the panel rather than the close button: putting it on the
  // button paints a focus ring the instant the menu opens, which reads as an
  // error state. The panel is the conventional target for a dialog, and a
  // keyboard user's first Tab still reaches the close button.
  const panelRef = useRef<HTMLDivElement>(null);

  // Which section is open, by label. One at a time: two expanded sections in a
  // sheet this size is the flat list the nesting was meant to replace.
  const [openSection, setOpenSection] = useState<string | null>(null);

  // Every exit collapses on the way out, so the menu opens the same way each
  // time rather than reopening on whatever was last poked.
  const handleClose = useCallback(() => {
    setOpenSection(null);
    onClose();
  }, [onClose]);

  // While the panel covers the screen, the page behind it must not scroll —
  // otherwise flicking the menu scrolls the article underneath and the reader
  // loses their place for having opened a menu.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape closes it, and focus starts on the close button so the panel is
  // operable without a pointer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, handleClose]);

  if (!open) return null;

  const email = profile?.email ?? session?.user?.email ?? "";
  const signedIn = status === "signedIn";

  return (
    // NO SCRIM. It existed to catch taps on the page showing beside a
    // short sheet. Nothing shows beside this one, so a scrim would be an
    // invisible layer under an opaque panel.
    <div
      id="mobile-nav"
      ref={panelRef}
      tabIndex={-1}
      // svh rather than vh — measured with the URL bar shown, so the sheet
      // does not resize mid-scroll on iOS. min-h-0 on the list below keeps
      // the old guarantee: a nav longer than the screen scrolls inside
      // itself instead of pushing the account buttons off the bottom.
      className="lg:hidden fixed inset-0 z-[60] h-[100svh] bg-paper flex flex-col bta-menu-in outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      {/* Its own header rather than the site header showing through: the panel
          covers the whole screen, so it has to carry the wordmark and the way
          out. */}
      <div className="flex items-center justify-between px-6 h-16 shrink-0 border-b border-hairline">
        <Link href="/" onClick={handleClose} className="flex items-center shrink-0">
          {/* Same single-file mark as the header, same height. */}
          <SiteLogo className="h-8 w-auto" />
        </Link>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close menu"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* The links take the slack. flex-1 with min-h-0 so a list longer than
          the screen scrolls inside this element rather than growing the sheet
          and pushing the account block out of reach. */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6">
        {items.map((item) => {
          if (item.children) {
            const expanded = openSection === item.label;
            // A child page lights the SECTION name while the section is shut,
            // so collapsing by default never costs the "you are here" mark.
            const inside = item.children.some((k) =>
              k.href === "/" ? pathname === "/" : pathname.startsWith(k.href),
            );
            return (
              <div key={item.label} className="border-b border-hairline">
                {/* A BUTTON, NOT A LINK. The section name opens the section;
                    making it navigate as well would give a thumb two different
                    outcomes for the same tap depending on where it landed. */}
                <button
                  type="button"
                  onClick={() => setOpenSection(expanded ? null : item.label)}
                  aria-expanded={expanded}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 py-4 text-left",
                    "text-[0.9375rem] tracking-tight transition-colors",
                    "focus-visible:outline-none focus-visible:text-coral",
                    inside ? "text-coral font-semibold" : "text-ink font-medium hover:text-coral",
                  )}
                >
                  {item.label}
                  <svg
                    viewBox="0 0 24 24"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={cn(
                      "shrink-0 text-ink-muted transition-transform duration-200",
                      expanded && "rotate-90",
                    )}
                  >
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {expanded && (
                  // No hairlines between the children: indented, lighter, and
                  // tucked under a row that is already divided from the list,
                  // they read as one group without borrowing the rule that
                  // separates top-level destinations.
                  <div className="pb-3 pl-2 pr-1">
                    {item.children.map((k) => {
                      // NOT isCurrent: that one lights the Teams chip for every
                      // page on its menu, which is right for the desktop chip
                      // and wrong here - it lit Team Explorer and Conference
                      // Power Rankings at the same time. A child is current
                      // only if it is the page you are on.
                      const on = k.href === "/" ? pathname === "/" : pathname.startsWith(k.href);
                      const Icon = k.icon;
                      return (
                        <Link
                          key={k.href}
                          href={k.href}
                          onClick={handleClose}
                          aria-current={on ? "page" : undefined}
                          className={cn(
                            // THE SAME ROW AS THE DESKTOP PANEL, at the same
                            // sizes. Ramp and Clerk both carry the icon and the
                            // blurb straight into the mobile drawer rather than
                            // flattening to text, and they are right to: the
                            // phone is where you have the least context about
                            // which of two similarly-named tables you want.
                            "flex items-start gap-3 rounded-lg px-2 py-2.5 -mx-1 transition-colors",
                            on && "bg-coral/[0.07]",
                          )}
                        >
                          {Icon && (
                            <span
                              className={cn(
                                "mt-px flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors",
                                on
                                  ? "bg-coral/12 ring-coral/25 text-coral"
                                  : "bg-ink/[0.06] ring-ink/10 text-ink-soft",
                              )}
                            >
                              <Icon size={17} strokeWidth={1.9} aria-hidden />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className={cn(
                              "block text-sm leading-tight tracking-tight transition-colors",
                              on ? "text-coral font-semibold" : "text-ink font-semibold",
                            )}>
                              {k.label}
                            </span>
                            {k.desc && (
                              <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                                {k.desc}
                              </span>
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const active = isCurrent(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleClose}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between py-4 border-b border-hairline",
                "text-[0.9375rem] tracking-tight transition-colors",
                active ? "text-coral font-semibold" : "text-ink font-medium hover:text-coral",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Settings and account actions.
          TINTED, and that is load-bearing rather than decorative. Pinned to the
          bottom edge of the screen, this block was separated from the nav by
          the edge itself. Sitting directly under Pricing it is separated only
          by a hairline — the same hairline that divides the six rows above it —
          so Theme read as an eighth nav row. The tint says "not a destination"
          without adding a label.
          Mixing --ink rather than a surface token: on the dark theme
          --paper-deep resolves to a colour the sheet is nearly painted in
          already, so it would not read.
          Back on the bottom edge, so the safe-area padding is back with it:
          without it the sign-in buttons sit under the home indicator on a
          gesture phone. */}
      <div
        className="shrink-0 px-6 pt-4 border-t border-hairline bg-ink/[0.04]"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        {/* Theme, above the account actions. It is a setting rather than a
            destination, so it sits with the other chrome at the foot of the
            sheet instead of in the nav list — which is exactly what the tint
            on this block is there to say. */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft">
            Theme
          </span>
          <ThemeToggle />
        </div>

        {signedIn ? (
          <>
            {email && (
              <p className="mb-3 text-xs text-ink-muted truncate">Signed in as {email}</p>
            )}
            <Link
              href="/account/"
              onClick={handleClose}
              className="flex items-center justify-center h-12 w-full rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral-soft transition-colors"
            >
              Your account
            </Link>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/account/login/"
              onClick={handleClose}
              className="flex items-center justify-center h-12 rounded-lg border border-ink/15 text-ink text-sm font-semibold hover:bg-paper-deep transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/pricing/"
              onClick={handleClose}
              className="flex items-center justify-center h-12 rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral-soft transition-colors"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
