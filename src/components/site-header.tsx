"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { SearchDialog } from "@/components/search/search-dialog";

const NAV = [
  { href: "/", label: "Explorer" },
  { href: "/players", label: "Players" },
  { href: "/coaches", label: "Coaches" },
  { href: "/calc", label: "Win Calc" },
  { href: "/portal", label: "Portal" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

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
    <header className="border-b border-hairline bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/60 relative z-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
          <Logomark />
          <span className="font-display text-xl text-ink leading-none tracking-tight">
            Beyond the Arc
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-deep rounded-md transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right cluster: search on desktop, hamburger on mobile. */}
        <div className="flex items-center gap-2">
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
        <div id="mobile-nav" className="md:hidden border-t border-hairline bg-paper">
          <nav className="px-6 py-3 flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm text-ink-soft hover:text-ink hover:bg-paper-deep rounded-md transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 pt-2 border-t border-hairline">
              <SearchDialog />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function Logomark() {
  // A 3-point arc in coral as the logo — fits "beyond the arc"
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="text-coral group-hover:text-ink transition-colors"
    >
      <path
        d="M2 28 Q 16 -2 30 28"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="16" cy="28" r="1.5" fill="currentColor" />
    </svg>
  );
}
