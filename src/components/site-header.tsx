"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { SearchDialog } from "@/components/search/search-dialog";
import { BrandWordmark } from "@/components/brand-wordmark";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Teams" },
  { href: "/players", label: "Players" },
  { href: "/coaches", label: "Coaches" },
  { href: "/calc", label: "Win Calc" },
  { href: "/portal", label: "Transfer Portal" },
];

// Active-route detection. The home route ("/") must match EXACTLY — otherwise
// every page starts with "/" and the home link would always read active.
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";

  // Close the drawer if the viewport widens past mobile.
  useEffect(() => {
    if (!open) return;
    function onResize() {
      if (window.innerWidth >= 768) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  return (
    <header className="bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/60 relative z-40">
      <div className="mx-auto max-w-[88rem] px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center group shrink-0"
          onClick={() => setOpen(false)}
        >
          <BrandWordmark className="h-5 text-ink group-hover:text-coral transition-colors" />
        </Link>

        {/* Desktop nav — small-caps tracked, coral baseline underline marks
            the current page. The underline scales from 0 → 100% on hover for
            non-active links (40% width tease) and stays full-width on the
            active link. Mirrors the kicker-rule motif used across the site. */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {NAV.map((item) => {
            const active = isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative px-3 py-2 text-[0.7rem] uppercase tracking-[0.18em] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-3 right-3 bottom-1 h-px bg-coral origin-center",
                    "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-[0.4]",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: search on desktop, hamburger on mobile. */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:block">
            <SearchDialog />
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ink hover:bg-paper-deep transition-colors"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile slide-down drawer */}
      {open && (
        <div id="mobile-nav" className="md:hidden bg-paper">
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
            <div className="mt-3 pt-3 border-t border-hairline">
              <SearchDialog />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

