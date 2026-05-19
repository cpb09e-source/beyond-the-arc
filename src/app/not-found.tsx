import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you're looking for doesn't exist.",
};

export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl px-6 lg:px-10 pt-20 pb-32 text-center">
      <div className="flex items-center justify-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-6">
        <span className="h-px w-8 bg-coral" />
        <span>404</span>
        <span className="h-px w-8 bg-coral" />
      </div>
      <h1 className="font-display text-5xl md:text-6xl tracking-tight text-ink leading-[1.05] mb-4">
        Page not found.
      </h1>
      <p className="text-base md:text-lg text-ink-soft mb-10">
        The link is broken, the player retired, or the team folded.
        Either way, this page isn&apos;t here.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-coral text-white font-medium hover:opacity-90 transition-opacity"
        >
          Home
        </Link>
        <Link
          href="/players"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-hairline text-ink hover:border-coral hover:text-coral transition-colors"
        >
          Players
        </Link>
        <Link
          href="/teams"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-hairline text-ink hover:border-coral hover:text-coral transition-colors"
        >
          Teams
        </Link>
        <Link
          href="/coaches"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-hairline text-ink hover:border-coral hover:text-coral transition-colors"
        >
          Coaches
        </Link>
      </div>
    </section>
  );
}
