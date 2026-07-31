import type { Metadata } from "next";
import { GlossaryClient } from "@/components/glossary/glossary-client";

export const metadata: Metadata = {
  title: "Glossary — Beyond the Arc",
  description:
    "Every statistic and term used on Beyond the Arc: what each number measures, how to read it, "
    + "and where it stops being reliable.",
};

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
      <GlossaryClient />
    </section>
  );
}
