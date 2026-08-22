import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, FAQ, COMPARISON, type Plan } from "@/lib/pricing";
import { Highlight } from "@/components/highlight";
import { SeasonPassCta } from "@/components/pricing/season-pass-cta";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Browse every player, team and coach for free. A Season Pass opens the full 13-season "
    + "history, real plus-minus, lineups and the all-years Win Calculator.",
  alternates: { canonical: "/pricing/" },
};

/**
 * Pricing page.
 *
 * Shape is Ramp's: three columns, price set large, an inherited "everything in
 * X, and:" feature list per card, then a full comparison table, then FAQ, then
 * a closing call to action. Ramp shows no "recommended" badge and lets the
 * middle column's copy do that work; we do carry one, because unlike Ramp our
 * middle column is the only thing actually being sold — Free is the funnel and
 * Program is quote-only.
 *
 * Prices come from docs/monetization-strategy.md §5.1-5.2, which argues them at
 * length: annual-first against KenPom's $24.95 and EvanMiya's $30,
 * because sports subscribers churn at 7.76%/month and annual removes the
 * offseason churn event, and a monthly option deliberately priced so that five
 * months of it costs more than the year.
 */
export default function PricingPage() {
  return (
    <div className="pb-20">
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-6 lg:pt-10">
        <header className="max-w-[44rem]">
          <span className="label" style={{ color: "var(--coral)" }}>
            Pricing
          </span>
          <h1 className="mt-3 font-display text-3xl sm:text-5xl lg:text-[3.5rem] leading-[1.03] tracking-tight text-ink text-balance">
            Free to browse. Paid to go deep.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-soft leading-relaxed max-w-[38rem]">
            Every player, team and coach page is open, this season and last. A Season Pass
            adds the other eleven seasons, the plus-minus built from play-by-play, and the
            tools that answer a question rather than show a number.
          </p>
          {/* The figure is real: public/data/player holds one file per player. */}
          <p className="mt-5 text-sm sm:text-base text-ink-soft">
            <Highlight>
              <span className="tabular font-semibold text-ink">25,474</span>
            </Highlight>{" "}
            players across thirteen seasons, on one impact number.
          </p>
        </header>

        {/* Tier row */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>

        <p className="mt-5 text-xs text-ink-muted">
          Prices in USD. The Season Pass renews each November, before the season starts —
          not on the day you happened to buy it.
        </p>
      </section>

      {/* Comparison */}
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-16">
        <h2 className="font-display text-xl sm:text-2xl tracking-tight text-ink">
          Compare features
        </h2>
        <div className="mt-5 overflow-x-auto overscroll-x-contain border border-hairline rounded-xl">
          <table className="w-full min-w-[44rem] text-sm border-collapse">
            <thead>
              <tr className="bg-paper-deep/50">
                <th className="text-left px-4 py-3 label font-semibold w-[46%]">Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} className="px-4 py-3 text-center">
                    <span className="label" style={{ color: p.accent }}>
                      {p.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((group) => (
                <ComparisonGroup key={group.group} group={group} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-16">
        <h2 className="font-display text-xl sm:text-2xl tracking-tight text-ink">
          Questions
        </h2>
        <dl className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-7 max-w-[64rem]">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="text-sm font-semibold text-ink">{f.q}</dt>
              <dd className="mt-1.5 text-sm text-ink-soft leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-16">
        <div className="rounded-xl border border-ink/10 bg-paper-deep/50 px-6 sm:px-10 py-9 flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
          <div className="max-w-[34rem]">
            <h2 className="font-display text-xl sm:text-2xl tracking-tight text-ink text-balance">
              Thirteen seasons, one ranking.
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              Pick 2015, 2019 and 2026 and rank those players against each other on one
              impact number. No other college basketball site answers that in a single query.
            </p>
          </div>
          <Link
            href="/players"
            className="shrink-0 inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold bg-coral text-white hover:bg-coral-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
          >
            Try it free
          </Link>
        </div>
      </section>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const featured = plan.featured === true;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-6 py-7 flex flex-col gap-5 h-full",
        featured ? "border-coral/50 ring-1 ring-coral/25 shadow-md" : "border-ink/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label" style={{ color: plan.accent }}>
            {plan.name}
          </div>
          <div className="mt-1 text-[0.8125rem] text-ink-muted">{plan.tagline}</div>
        </div>
        {featured && (
          <span
            className="label shrink-0 rounded-full px-2.5 py-1"
            style={{ color: "var(--coral)", background: "color-mix(in oklab, var(--coral) 12%, transparent)" }}
          >
            Most popular
          </span>
        )}
      </div>

      {plan.customCta ? (
        /* The Season Pass carries a period toggle, so it owns its own price
           block and button rather than taking them from the plan record. */
        <SeasonPassCta />
      ) : (
        <>
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-display leading-none text-ink",
                plan.period ? "tabular text-4xl sm:text-[2.75rem]" : "text-3xl sm:text-[2rem]",
              )}
            >
              {plan.price}
            </span>
            {plan.period && (
              <span className="text-sm text-ink-muted">{plan.period}</span>
            )}
          </div>
          {plan.priceNote && (
            <div className="-mt-3 text-xs text-ink-muted">{plan.priceNote}</div>
          )}

          <Link
            href={plan.ctaHref}
            className={cn(
              "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
              featured
                ? "bg-coral text-white hover:bg-coral-soft"
                : "border border-ink/15 text-ink hover:bg-paper-deep",
            )}
          >
            {plan.cta}
          </Link>
        </>
      )}

      <div className="pt-1 border-t border-hairline">
        {plan.inherits && (
          <p className="pt-4 text-[0.8125rem] text-ink-soft">
            Everything in <span className="font-semibold text-ink">{plan.inherits}</span>, and:
          </p>
        )}
        <ul className={cn("flex flex-col gap-2.5", plan.inherits ? "mt-3" : "pt-4")}>
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2.5 text-[0.8125rem] text-ink-soft leading-snug">
              <Check accent={plan.accent} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Check({ accent }: { accent: string }) {
  return (
    <svg
      viewBox="0 0 14 14"
      className="w-3.5 h-3.5 shrink-0 mt-0.5"
      aria-hidden="true"
      style={{ color: accent }}
    >
      <path
        d="M2.5 7.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ComparisonGroup({
  group,
}: {
  group: (typeof COMPARISON)[number];
}) {
  return (
    <>
      <tr>
        <th
          colSpan={PLANS.length + 1}
          className="text-left px-4 pt-6 pb-2 label"
          style={{ color: "var(--court-ink)" }}
          scope="colgroup"
        >
          {group.group}
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.label} className="border-t border-hairline">
          <th scope="row" className="text-left px-4 py-2.5 font-normal text-ink-soft">
            {row.label}
          </th>
          {row.cells.map((cell, i) => (
            <td key={i} className="px-4 py-2.5 text-center">
              {cell === true ? (
                <span className="inline-flex text-coral" aria-label="Included">
                  <Check accent="var(--coral)" />
                </span>
              ) : cell === false ? (
                <span className="text-ink-muted/50" aria-label="Not included">
                  —
                </span>
              ) : (
                <span className="tabular text-xs text-ink-soft">{cell}</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
