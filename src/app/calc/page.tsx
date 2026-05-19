import { CalcClient } from "@/components/calc/calc-client";

export default function CalcPage() {
  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-12 pb-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <span>The win calculator</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink mb-3">
            If these things happen,
            <span className="italic text-coral"> how often do they win?</span>
          </h1>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-8 lg:py-10">
        <CalcClient />
      </section>

      <div className="mx-auto max-w-7xl px-6 lg:px-10 my-12">
        <div className="court-divider" />
      </div>
      <section className="mx-auto max-w-7xl px-6 lg:px-10 mb-20">
        <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
          Each row is one team&apos;s perspective on one game. Conditions are
          evaluated from that team&apos;s perspective, so &ldquo;TOV Diff &gt; 1&rdquo;
          means the team committed fewer turnovers than its opponent by more
          than 1. Game data sourced from{" "}
          <span className="text-ink">cbbanalytics.com</span>.
        </p>
      </section>
    </>
  );
}
