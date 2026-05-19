"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Root error boundary. Catches anything that throws inside a route segment
 * during render. Stays branded so a broken page doesn't drop the user into
 * Next.js' default error chrome.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure in dev/console so it isn't silently swallowed.
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto max-w-2xl px-6 lg:px-10 pt-20 pb-32 text-center">
      <div className="flex items-center justify-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-6">
        <span className="h-px w-8 bg-coral" />
        <span>Something broke</span>
        <span className="h-px w-8 bg-coral" />
      </div>
      <h1 className="font-display text-5xl md:text-6xl tracking-tight text-ink leading-[1.05] mb-4">
        That didn&apos;t work.
      </h1>
      <p className="text-base md:text-lg text-ink-soft mb-2">
        Something went wrong rendering this page. Try again, or head somewhere else.
      </p>
      {error.digest && (
        <p className="text-xs text-ink-muted tabular mb-8">Error ID: {error.digest}</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-coral text-white font-medium hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-hairline text-ink hover:border-coral hover:text-coral transition-colors"
        >
          Home
        </Link>
      </div>
    </section>
  );
}
