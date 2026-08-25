"use client";

import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The mobile menu, built on Ramp's shape: a full-screen panel with its own
 * wordmark and close button, big sentence-case rows separated by hairlines,
 * and the account actions pinned to the bottom where a thumb reaches.
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
  items: ReadonlyArray<{ href: string; label: string }>;
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
    <div
      id="mobile-nav"
      ref={panelRef}
      tabIndex={-1}
      className="lg:hidden fixed inset-0 z-[60] bg-paper flex flex-col bta-menu-in outline-none"
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

      {/* The links. Scrollable in its own right so a longer list never pushes
          the buttons off the bottom of the screen. */}
      <nav className="flex-1 overflow-y-auto overscroll-contain px-6">
        {items.map((item) => {
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

      {/* Account actions, pinned. pb accounts for the home indicator on
          gesture-navigation phones, which otherwise sits on top of the
          buttons. */}
      <div
        className="shrink-0 px-6 pt-4 border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Theme, above the account actions. It is a setting rather than a
            destination, so it sits with the other chrome at the foot of the
            sheet instead of in the nav list. */}
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
  );
}
