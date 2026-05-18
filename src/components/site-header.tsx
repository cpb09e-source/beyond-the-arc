import Link from "next/link";
import { SearchDialog } from "@/components/search/search-dialog";

const NAV = [
  { href: "/", label: "Explorer" },
  { href: "/players", label: "Players" },
  { href: "/coaches", label: "Coaches" },
  { href: "/calc", label: "Win Calc" },
  { href: "/portal", label: "Portal" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-hairline bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/60 sticky top-0 z-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <Logomark />
          <span className="font-display text-xl text-ink leading-none tracking-tight">
            Beyond the Arc
          </span>
        </Link>
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
        <SearchDialog />
      </div>
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
