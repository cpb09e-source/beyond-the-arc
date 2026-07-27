"use client";

import { useState } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile collapse for the scope row on /teams and /players.
 *
 * Both bars were previously always-expanded. On a 390x844 phone that put the
 * first table row 356px (teams) / 418px (players) down the page — half the
 * viewport spent on selects that are almost always left at their defaults. The
 * portal and coaches pages already collapse theirs; this brings the other two
 * in line and keeps them matched with each other, which was the point of the
 * pass that removed the old toggle in the first place.
 *
 * Desktop is untouched: everything above `md` renders exactly as before, since
 * the region is `hidden md:flex` and the toggle is `md:hidden`.
 *
 * The collapsed state still says what the current scope IS — a bare "Filters"
 * button hides whether you're looking at one season or five.
 */
export function ScopeCollapse({
  summary,
  pending,
  children,
}: {
  /** Short human read of the active scope, e.g. "2025-26 · All teams". */
  summary: string;
  /** Dims the row while a submit is in flight, matching the old behaviour. */
  pending?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative mb-3", pending && "opacity-70")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="md:hidden w-full min-h-11 flex items-center justify-between gap-2 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 min-w-0 text-sm font-medium text-ink">
          <SlidersHorizontal className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden />
          Scope
          <span className="text-ink-muted font-normal truncate">{summary}</span>
        </span>
        <ChevronDown
          className={cn("w-4 h-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div className={cn(open ? "flex" : "hidden", "md:flex flex-wrap items-end gap-2")}>
        {children}
      </div>
    </div>
  );
}

/**
 * "2025-26 · 3 teams · Big 12" — whichever parts are actually narrowed.
 * Season is always shown because there is always exactly one answer to "which
 * season am I looking at", and it's the field readers change most.
 */
export function scopeSummary(parts: Array<{ label: string; values: string[]; all?: string }>): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.values.length === 0) {
      if (p.all) out.push(p.all);
      continue;
    }
    out.push(p.values.length === 1 ? p.values[0]! : `${p.values.length} ${p.label}`);
  }
  return out.join(" · ");
}
