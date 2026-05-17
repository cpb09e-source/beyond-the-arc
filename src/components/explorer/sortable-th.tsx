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
export function SortableTh({
  statKey,
  label,
  title,
  defaultDir = "desc",
  className = "",
  variant = "default",
  basePath = "/",
  defaultSort = "bta_rtg",
  align = "right",
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
  const baseClasses =
    "px-3 py-2 text-xs uppercase tracking-widest font-medium select-none cursor-pointer transition-colors";
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
      className={cn(baseClasses, variantClasses, activeClass, className)}
    >
      <Link
        href={href}
        scroll={false}
        className="block w-full h-full"
        prefetch={false}
      >
        <span className={cn("inline-flex items-center gap-1", align === "left" ? "justify-start" : "justify-end")}>
          {variant === "cbb" && (
            <span className="h-1 w-1 rounded-full bg-coral" aria-hidden />
          )}
          <span>{label}</span>
          {arrow && <span className="text-coral text-[0.65rem] leading-none">{arrow}</span>}
        </span>
      </Link>
    </th>
  );
}
