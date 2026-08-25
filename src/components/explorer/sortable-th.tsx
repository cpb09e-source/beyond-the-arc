"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * SortableTh — a clickable column header that toggles the sort spec via URL.
 *
 * Behavior:
 *   - First click on a column → sort by that column DESC (or ASC for rank-style).
 *   - Click again on the same column → flip direction.
 *   - Click any other column → start that column at its default direction.
 *
 * State lives in `?sort=<key>&order=<asc|desc>` — refresh-safe & shareable.
 */

/**
 * StatLabel — a column label that survives the header's blanket `uppercase`.
 *
 * Most stat abbreviations are all-caps anyway (PPG, TS%, ORB%), so uppercasing
 * the header in CSS is free. It is not free for a name whose FIRST letter is
 * lowercase on purpose: "eWins" is the metric's name, and the transform was
 * rendering it "EWINS", which reads as a different stat.
 *
 * So: detect a leading lowercase letter followed by a capital, opt that label
 * out of the CSS transform, and uppercase the tail by hand — "eWins" becomes
 * "eWINS". Everything else is returned untouched and keeps using the CSS rule.
 * Written as a pattern rather than a list of exceptions so the next lowercase-
 * initial metric works without anyone remembering this file exists.
 */
/**
 * The responsive-abbreviation branch that used to live here is gone.
 *
 * It existed for exactly two labels — "3PA Rate" and "FTA Rate" — which were
 * the only two-WORD labels in a header row of tracking-widest caps, so they set
 * the column's minimum width and pushed the whole table wider than it needed to
 * be. It rendered "3PAR"/"FTAR" below sm and the long form above it.
 *
 * Both stats are now NAMED 3PAR and FTAR everywhere, so the short form is the
 * only form and there is nothing left to switch between. Nothing else in the
 * header row was ever wide enough to need this.
 */
export function StatLabel({ label }: { label: string }) {
  if (!/^[a-z][A-Z]/.test(label)) return <>{label}</>;
  return <span className="normal-case">{label[0] + label.slice(1).toUpperCase()}</span>;
}
export function SortableTh({
  statKey,
  label,
  title,
  defaultDir = "desc",
  className = "",
  variant = "default",
  basePath = "/",
  defaultSort = "a_net",
  align = "right",
  nowrap = true,
  idleArrows = false,
}: {
  statKey: string;
  label: string;
  title?: string;
  defaultDir?: "asc" | "desc";
  className?: string;
  variant?: "default" | "cbb";
  basePath?: string;
  defaultSort?: string;
  align?: "left" | "right";
  nowrap?: boolean;
  /** Show a faint ⇅ on inactive columns (D&3-style affordance). */
  idleArrows?: boolean;
}) {
  const params = useSearchParams();
  const sortInUrl = params.get("sort");
  const orderInUrl = params.get("order") as "asc" | "desc" | null;
  const currentSort = sortInUrl ?? defaultSort;
  // When URL has no sort param at all, the default-sort column displays in its
  // own defaultDir (so "BTA RTG ↓" shows on first load). When URL sets sort
  // but not order, fall back to ascending for stability.
  const currentDir: "asc" | "desc" = orderInUrl ?? (sortInUrl ? "asc" : defaultDir);
  const isActive = currentSort === statKey;

  const nextDir = isActive ? (currentDir === "asc" ? "desc" : "asc") : defaultDir;
  const next = new URLSearchParams(params);
  next.set("sort", statKey);
  next.set("order", nextDir);
  const href = `${basePath}?${next.toString()}`;

  const arrow = isActive ? (currentDir === "asc" ? "↑" : "↓") : "";
  // Padding lives on the LINK, not the cell. With it on the <th>, the anchor's
  // `w-full h-full` filled only the content box, so the tappable area was the
  // 16px-tall text and the surrounding padding did nothing — a third of the
  // 44px touch target guideline, on every sortable column of every table.
  // Moving it inside makes the whole cell tappable, and the extra vertical
  // padding below `sm` takes a phone tap from 16px to 40px.
  const baseClasses =
    "p-0 text-xs uppercase tracking-wide sm:tracking-widest font-medium select-none cursor-pointer transition-colors";
  const variantClasses =
    variant === "cbb"
      ? "text-right border-l border-coral/30 hover:bg-coral/5"
      : align === "left"
      ? "text-left hover:bg-paper-deep/60"
      : "text-right hover:bg-paper-deep/60";
  const activeClass = isActive ? "text-ink" : "text-ink-muted";

  return (
    <th
      title={title ?? label}
      className={cn(baseClasses, variantClasses, activeClass, nowrap ? "whitespace-nowrap" : "whitespace-normal", className)}
    >
      <Link
        href={href}
        scroll={false}
        className="block w-full h-full px-1.5 sm:px-3 py-3 sm:py-2"
        prefetch={false}
      >
        <span className={cn("inline-flex items-center gap-1", align === "left" ? "justify-start" : "justify-end")}>
          {variant === "cbb" && (
            <span className="h-1 w-1 rounded-full bg-coral" aria-hidden />
          )}
          <span><StatLabel label={label} /></span>
          {arrow ? (
            <span className="text-coral text-[0.65rem] leading-none">{arrow}</span>
          ) : idleArrows ? (
            <span className="text-ink-muted/50 text-[0.6rem] leading-none tracking-tighter" aria-hidden>↑↓</span>
          ) : null}
        </span>
      </Link>
    </th>
  );
}
