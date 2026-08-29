"use client";

import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The mobile menu — a sheet that drops from the top and ENDS WHERE ITS CONTENT
 * ENDS: its own wordmark and close button, big sentence-case rows separated by
 * hairlines, then the settings and account actions directly under the last row.
 *
 * It used to cover the whole screen, with the link list on flex-1 and the
 * account block pushed to the bottom edge. Seven items do not fill a phone, so
 * flex-1 opened a band of roughly 200px of empty paper between Pricing and the
 * theme toggle — the panel looked like it was waiting for links it did not
 * have. Auto height instead, with the page showing beneath it.
 *
 * The structure is borrowed; the palette is not. Ramp is black type and acid
 * yellow on white, which would look like someone else's site pasted into this
 * one — so the rows are ink on paper and the primary action is the site's own
 * azure.
 *
 * NO CHEVRONS. Ramp puts a chevron on rows that expand into a submenu and
 * leaves its direct links (Customers, Pricing) bare. Every row here is a
 * direct link, so a chevron would advertise a submenu that does not exist.
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
    | { href?: undefined; label: string; children: ReadonlyArray<{ href: string; label: string }> }
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, onClose]);

  if (!open) return null;

  const email = profile?.email ?? session?.user?.email ?? "";
  const signedIn = status === "signedIn";

  return (
    <>
      {/* The scrim is not decoration — it is the tap target. A sheet that shows
          the page behind it but ignores taps on that page is worse than a panel
          that covers everything: people reach for what they can see. */}
      <div
        className="lg:hidden fixed inset-0 z-[59] bg-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        id="mobile-nav"
        ref={panelRef}
        tabIndex={-1}
        // max-h plus min-h-0 on the list below keeps the old guarantee: if the
        // nav ever outgrows the screen it scrolls inside itself rather than
        // pushing the buttons off the bottom. svh rather than vh — measured
        // with the URL bar shown, so the sheet does not resize mid-scroll.
        className="lg:hidden fixed inset-x-0 top-0 z-[60] max-h-[100svh] bg-paper flex flex-col rounded-b-2xl shadow-2xl bta-menu-in outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
      {/* Its own header rather than the site header showing through: the panel
          covers the whole screen, so it has to carry the wordmark and the way
          out. */}
      <div className="flex items-center justify-between px-6 h-16 shrink-0 border-b border-hairline">
        <Link href="/" onClick={onClose} className="flex items-center shrink-0">
          {/* Same single-file mark as the header, same height. */}
          <SiteLogo className="h-8 w-auto" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* The links. NOT flex-1 any more — that is what stretched the list and
          opened the gap. Still scrollable in its own right so a longer list
          never pushes the buttons off the bottom of the screen. */}
      <nav className="min-h-0 overflow-y-auto overscroll-contain px-6">
        {items.map((item) => {
          if (item.children) {
            return (
              // A HEADING, NOT A LINK. The section name is a label for the two
              // rows under it; making it tappable as well would give the drawer
              // two ways to reach the same page a thumb-width apart.
              <div key={item.label} className="border-b border-hairline">
                <div className="pt-5 pb-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted font-semibold">
                  {item.label}
                </div>
                {item.children.map((k, i) => {
                  // NOT isCurrent: that one lights the Teams chip for every
                  // page on its menu, which is right for the desktop chip and
                  // wrong here - it lit Team Explorer and Conference Power
                  // Rankings at the same time. A child is current only if it
                  // is the page you are on.
                  const on = k.href === "/" ? pathname === "/" : pathname.startsWith(k.href);
                  return (
                    <Link
                      key={k.href}
                      href={k.href}
                      onClick={onClose}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        // Indented and hairline-separated from each other, but
                        // not from the heading: the group reads as one block.
                        "flex items-center justify-between py-4 pl-3 text-base tracking-tight transition-colors",
                        i > 0 && "border-t border-hairline/60",
                        on ? "text-coral font-semibold" : "text-ink font-medium hover:text-coral",
                      )}
                    >
                      {k.label}
                    </Link>
                  );
                })}
              </div>
            );
          }
          const active = isCurrent(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between py-5 border-b border-hairline",
                "text-base tracking-tight transition-colors",
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
          The safe-area padding is gone with the pinning. env() is only ever
          non-zero on gesture phones, where it would have added a band of dead
          space under a sheet that no longer touches the bottom of the screen. */}
      <div className="shrink-0 px-6 pt-4 pb-5 border-t border-hairline bg-ink/[0.04] rounded-b-2xl">
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
              onClick={onClose}
              className="flex items-center justify-center h-12 w-full rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral-soft transition-colors"
            >
              Your account
            </Link>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/account/login/"
              onClick={onClose}
              className="flex items-center justify-center h-12 rounded-lg border border-ink/15 text-ink text-sm font-semibold hover:bg-paper-deep transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/pricing/"
              onClick={onClose}
              className="flex items-center justify-center h-12 rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral-soft transition-colors"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
