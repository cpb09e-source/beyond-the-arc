import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline mt-12 py-8">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm text-ink-muted">
        <Link href="/" className="flex items-center gap-3 group">
          <Logomark />
          <span className="font-display text-ink text-lg leading-none">
            Beyond the Arc
          </span>
          <span className="text-ink-muted">·</span>
          <span>
            Editorial-grade college basketball analytics.
          </span>
        </Link>
      </div>
    </footer>
  );
}

function Logomark() {
  return (
    <svg
      width="24"
      height="24"
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
