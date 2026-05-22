import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline mt-6 sm:mt-12 py-6 sm:py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4 text-sm text-ink-muted">
        <Link href="/" className="flex items-center group shrink-0">
          <BrandWordmark className="h-[1.125rem] text-ink group-hover:text-coral transition-colors" />
        </Link>
        <span className="hidden sm:inline text-ink-muted">·</span>
        <span className="text-xs sm:text-sm">
          Editorial-grade college basketball analytics.
        </span>
      </div>
    </footer>
  );
}
