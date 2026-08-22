"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The Season Pass price, with its billing period as a real choice.
 *
 * Monthly used to be a line of small print under the yearly price, which sells
 * it badly in both directions: someone who wants monthly cannot pick it, and
 * the argument for annual only lands if you can see what monthly actually
 * costs. A toggle shows both numbers and lets the page make its own case —
 * $8 x 12 against $50.
 *
 * Yearly is the default because it is what the pricing rationale argues for
 * (docs/monetization-strategy.md 5.2: annual removes the offseason churn
 * event). Defaulting to monthly would quietly undo that.
 */
type Period = "yearly" | "monthly";

export function SeasonPassCta() {
  const [period, setPeriod] = useState<Period>("yearly");
  const yearly = period === "yearly";

  return (
    <div className="flex flex-col gap-4">
      {/* Period switch — a segmented control, the same idiom the site header
          uses for the current page. */}
      <div
        className="inline-flex self-start rounded-lg bg-ink/6 p-1 gap-0.5"
        role="group"
        aria-label="Billing period"
      >
        {(["yearly", "monthly"] as const).map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={active}
              className={cn(
                "rounded-md px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] font-medium transition-colors",
                active
                  ? "bg-paper text-ink shadow-sm ring-1 ring-ink/5"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {p === "yearly" ? "Yearly" : "Monthly"}
              {p === "yearly" && (
                // The saving is real arithmetic, not a marketing round number:
                // $8 x 12 = $96 against $50 is 47.9%. Putting it on the control
                // means the case for annual is made before anything is clicked.
                <span
                  className={cn(
                    "ml-1.5 tracking-normal",
                    active ? "text-coral" : "text-ink-muted/70",
                  )}
                >
                  −48%
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display leading-none text-ink tabular text-4xl sm:text-[2.75rem]">
            {yearly ? "$50" : "$8"}
          </span>
          <span className="text-sm text-ink-muted">{yearly ? "/year" : "/month"}</span>
        </div>
        {/* The yearly view has to name the monthly price. Before the toggle
            existed the card said "or $8/month" outright, and a control the
            reader never touches is not a substitute for that — without this
            line, anyone who wants monthly cannot tell it is offered. */}
        <div className="mt-2 text-xs text-ink-muted">
          {yearly
            ? "$4.17 a month, billed once. Or $8/month if you would rather — seven months of that costs more than the year."
            : "$96 over a year — seven months of it already costs more than the year."}
        </div>
      </div>

      <Link
        href={`/account/signup/?plan=${period}`}
        className="inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold bg-coral text-white hover:bg-coral-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
      >
        {yearly ? "Get the Season Pass" : "Start monthly"}
      </Link>
    </div>
  );
}
