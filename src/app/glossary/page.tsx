import type { Metadata } from "next";
import { GLOSSARY } from "@/lib/glossary";

export const metadata: Metadata = {
  title: "Glossary — Beyond the Arc",
  description:
    "Every statistic and term used on Beyond the Arc: what each number measures, how to read it, "
    + "and where it stops being reliable.",
};

/**
 * Static, server-rendered. No filtering or search — the section list at the top
 * is the navigation, and a page a reader lands on from a tooltip should show
 * the answer immediately rather than make them type.
 */
export default function GlossaryPage() {
  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-16">
      <header className="max-w-[46rem]">
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">Glossary</h1>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          What every number on the site means, and — where it matters — what it cannot tell you.
          Standard statistics are given with their formulas. The metrics we build ourselves are
          described by what they measure and how they behave rather than by their internals.
        </p>
      </header>

      {/* Section jump list. Plain anchors: no JS, works before hydration. */}
      <nav aria-label="Glossary sections" className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
        {GLOSSARY.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-xs uppercase tracking-wide text-ink-muted hover:text-ink transition-colors"
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="mt-8 space-y-12">
        {GLOSSARY.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <div className="border-b border-hairline pb-2">
              <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              {section.blurb && (
                <p className="mt-1 text-sm text-ink-muted max-w-[46rem]">{section.blurb}</p>
              )}
            </div>

            <dl className="mt-4 grid gap-x-10 gap-y-6 md:grid-cols-2">
              {section.entries.map((e) => (
                <div key={e.term} className="max-w-[34rem]">
                  <dt className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-[0.95rem]">{e.term}</span>
                    {e.original && (
                      <span className="text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-hairline text-ink-muted">
                        BTA original
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm text-ink-muted leading-relaxed">
                    {e.body}
                    {e.formula && (
                      <code className="mt-2 block bg-paper-deep rounded px-2 py-1 text-xs text-ink-soft overflow-x-auto">
                        {e.formula}
                      </code>
                    )}
                    {e.caveat && (
                      <span className="mt-2 block text-xs text-ink-soft">
                        <span className="uppercase tracking-wider text-[0.6rem]">Caveat </span>
                        {e.caveat}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
