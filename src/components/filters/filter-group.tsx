"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One collapsible section of a filter panel — the DEMOGRAPHICS / POSITION /
 * ROLE bands on Dunks & Threes, in this site's type.
 *
 * WHY COLLAPSIBLE AT ALL. The team panel is seven groups of stat rows and the
 * player panel is more; open on a phone that is several screens of scrolling
 * to reach the group you wanted, and no way to see what the groups even are
 * without travelling through them. A header row per group that folds shut
 * turns the panel into a table of contents you can operate.
 *
 * OPEN BY DEFAULT, and the count badge stays visible when shut, so folding a
 * group never hides the fact that it is filtering something.
 *
 * The chevron is the only affordance added: the header was already there as an
 * <h4>, so this costs no vertical space over the version that could not fold.
 */
export function FilterGroup({
  label,
  count = 0,
  children,
  defaultOpen = true,
}: {
  label: string;
  /** Active filters inside this group; shown as a badge and kept visible when shut. */
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // CSS containment, carried over from the sections this replaces: without
    // it, changing one control re-styles and re-lays-out every control in the
    // panel on each tick of a drag.
    <section className="[contain:layout_style]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 mb-3 min-h-6 text-left group/grp"
      >
        <h4 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft group-hover/grp:text-ink transition-colors">
          {label}
        </h4>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral/15 text-coral text-[0.58rem] font-bold tabular">
            {count}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto w-3.5 h-3.5 shrink-0 text-ink-muted transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {/* `hidden`, not a height animation: a group holds up to sixteen rows of
          number inputs, and animating that on a phone costs more than the
          motion is worth. The panel it lives in is what animates. */}
      <div className={open ? "block" : "hidden"}>{children}</div>
    </section>
  );
}
