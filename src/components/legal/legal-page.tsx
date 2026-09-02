import Link from "next/link";

/**
 * Shared chrome for /sources, /terms and /privacy.
 *
 * ONE READING MEASURE, NOT THE SITE'S TABLE WIDTH. Every other page here is a
 * table and wants the full 88rem; these are prose and want about 68 characters
 * a line. The container still matches so the left edge lines up with the rest
 * of the site — it is the text column inside it that is narrow.
 *
 * `updated` is a real date, printed. A legal page with no date is a legal page
 * nobody can tell is stale.
 */
export function LegalPage({
  title, updated, children,
}: {
  title: string;
  /** ISO date. Shown as "2 September 2026". */
  updated: string;
  children: React.ReactNode;
}) {
  const when = new Date(`${updated}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-20">
      <div className="max-w-[46rem]">
        {/* NO STANDFIRST. Each of these pages used to carry a one-line summary
            under the heading, and all three said a version of "this page is
            honest and readable" — a claim the page either earns in its first
            clause or does not earn at all. The first clause now lands
            immediately, which is what a reader came for. */}
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-ink-soft">Last updated {when}</p>
      </div>

      <div className="mt-8 max-w-[46rem] flex flex-col gap-8">{children}</div>

      <nav className="mt-14 max-w-[46rem] border-t border-hairline pt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
        <Link href="/sources" className="hover:text-ink transition-colors">Sources &amp; attribution</Link>
        <Link href="/terms" className="hover:text-ink transition-colors">Terms of service</Link>
        <Link href="/privacy" className="hover:text-ink transition-colors">Privacy</Link>
        <Link href="/glossary" className="hover:text-ink transition-colors">Glossary</Link>
      </nav>
    </section>
  );
}

/** One numbered clause. The heading carries the anchor so a clause is linkable. */
export function Clause({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-base font-semibold text-ink">
        <a href={`#${id}`} className="hover:text-coral transition-colors">{title}</a>
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-sm text-ink-soft leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * A statement we want a reader to be able to hold us to — the plain-English
 * version of a clause, set apart so it cannot be lost in the paragraph.
 */
export function Plainly({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-l-2 border-coral/50 pl-3 text-sm text-ink leading-relaxed">
      {children}
    </p>
  );
}
