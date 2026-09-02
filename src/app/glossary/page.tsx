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
          Every number the site can put in a column, read straight from the tables that use it —
          the players explorer, the team explorer, both game logs, lineups and on/off. Standard
          statistics come with their formulas. The metrics we build ourselves are described by
          what they measure and how they behave rather than by their internals, and carry one of
          two marks: <strong className="text-ink font-semibold">BTA original</strong> for a metric
          we invented, <strong className="text-ink font-semibold">BTA-built</strong> for a public
          idea whose number is ours because nobody else produces it for college basketball.
        </p>
      </header>
      <GlossaryClient />
    </section>
  );
}
