"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PlayerPhoto } from "@/components/player-photo";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";
import { cn } from "@/lib/utils";

/**
 * Jump to a teammate's page.
 *
 * DESKTOP ONLY. On a phone the hero is already carrying a headshot, a name, two
 * badges, a vitals run, a draft chip and the Top-100 mark on the same few
 * hundred pixels, and a control that goes somewhere else does not belong in
 * that contest. The bottom bar is what a phone reader navigates with here.
 *
 * A NAVIGATION CONTROL, NOT A FILTER, which is why it always reads "Select…"
 * rather than the current player's name. A control showing a value implies the
 * page is a view of that value and that changing it changes the view; this one
 * leaves for a different page entirely. Nothing is ever selected: a row is a
 * destination, so clicking it navigates and the label is still "Select…" when
 * the reader lands on the next player's hero and looks for it again.
 *
 * WHY IT IS NOT A <select> ANY MORE. It was, and that cost it both of the
 * things asked for. A native select's list is drawn by the operating system,
 * not by the page: on Windows that is a white panel with a system-blue
 * highlight, which no amount of CSS on our side reaches — the control looked
 * like it belonged to a different site. And an <option> may contain text and
 * nothing else, so a headshot beside each name was not a styling problem but an
 * impossible one. This is the same listbox pattern the explorers use, so it
 * inherits their theming, their keyboard handling and their portal.
 *
 * The list only contains players who HAVE a page: see readTeammates, and the
 * static-export note there about linking to an unbuilt route.
 */
export function TeammatePicker({
  teammates,
  teamName,
}: {
  teammates: Array<{ id: number; name: string; cls: string | null }>;
  teamName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // 15rem, matching the trigger, so the panel reads as the control opening
  // rather than as a menu that happens to be near it.
  const { anchorRef, popRef, at } = usePopoverAnchor({ open, width: 240 });

  const go = useCallback((id: number) => {
    setOpen(false);
    router.push(`/players/${id}/`);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // Both refs — the panel is portalled out of the wrapper.
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => {
          const n = teammates.length;
          return e.key === "ArrowDown" ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0);
        });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const t = teammates[active];
        if (t) go(t.id);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, teammates, active, go, anchorRef, popRef]);

  // Keep the highlighted row on screen when the list is longer than the panel.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (teammates.length === 0) return null;

  return (
    <div ref={anchorRef} className="hidden lg:flex items-center gap-2 justify-end">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
        Teammates
      </span>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setActive(0); }}
        // Not "a ${teamName} teammate" — that reads "a Arizona" for every
        // vowel-initial school.
        aria-label={`${teamName} teammates`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="relative w-48 h-10 pl-3 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm text-left shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
      >
        Select…
        <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]">▾</span>
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          role="listbox"
          aria-label={`${teamName} teammates`}
          style={popoverStyle(at)}
          // bg-popover, not bg-card: this is the same surface the explorers'
          // menus use, and it is what the theme darkens on the dark side.
          className="z-60 flex flex-col overflow-hidden rounded-lg border border-hairline bg-popover shadow-xl"
        >
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1">
            {teammates.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={i === active}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(t.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
                  i === active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]",
                )}
              >
                {/* eager: the whole list mounts at once and is at most a dozen
                    thumbnails, so there is nothing to defer and a face that
                    arrives after the row is worse than one that costs 7 KB. */}
                <PlayerPhoto
                  bartPlayerId={t.id}
                  name={t.name}
                  size={28}
                  eager
                  className="shrink-0 rounded-full"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                {t.cls && (
                  <span className="shrink-0 text-xs text-ink-muted tabular">{t.cls}</span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
