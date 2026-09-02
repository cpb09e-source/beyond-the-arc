"use client";

import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { Health } from "@/components/admin/admin-dashboard";

/**
 * The admin frame: a rail, a bar, and one pane at a time.
 *
 * ── WHY VIEWS AND NOT ONE LONG PAGE ───────────────────────────────────────
 *
 * The dashboard reads seven sources and each has a panel; stacked, that is a
 * page nobody reaches the bottom of, where the transfers form — the thing an
 * administrator actually came to USE — sits below four status tables. Splitting
 * it costs the "everything at once" view, so the rail pays that back: every
 * nav item carries the same health dot its tile carries, which means the state
 * of a pane you are not looking at is still on screen. Nothing is hidden, only
 * folded.
 *
 * ── THE HASH IS THE ROUTE ─────────────────────────────────────────────────
 *
 * The site is a static export with one /admin/ page, so the view cannot be a
 * path without shipping seven more prerendered pages that all render the same
 * component. The hash costs nothing, survives a reload, and is linkable —
 * #subscribers in a note still opens the subscribers pane a year from now.
 *
 * It is read through useSyncExternalStore rather than an effect: `location` is
 * external mutable state, the server has no opinion about it (getServerSnapshot
 * returns ""), and reading it in an effect to then setState is the pattern that
 * both flashes the wrong pane and trips react-hooks/set-state-in-effect.
 */

export type ViewId =
  | "overview" | "pipeline" | "data" | "checks" | "subscribers" | "banner" | "transfers";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  /** The same health its tile shows. Drives the dot on the rail. */
  health?: Health;
  /** A count worth carrying in the rail — subscribers, mostly. */
  badge?: string | null;
};

export type NavGroup = { title: string; items: NavItem[] };

/** Older anchors, and the ones the tiles used before this was a rail. */
const ALIAS: Record<string, ViewId> = {
  "": "overview",
  run: "pipeline",
  history: "pipeline",
  webhook: "subscribers",
};

const VIEW_EVENT = "admin:view";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  window.addEventListener(VIEW_EVENT, cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
    window.removeEventListener(VIEW_EVENT, cb);
  };
}

const readHash = () => window.location.hash.replace(/^#/, "");
const serverHash = () => "";

/** The current pane, and a way to change it that the back button understands. */
export function useView(known: readonly ViewId[]): [ViewId, (id: ViewId) => void] {
  const raw = useSyncExternalStore(subscribe, readHash, serverHash);
  const view = (known as readonly string[]).includes(raw)
    ? (raw as ViewId)
    : ALIAS[raw] ?? "overview";

  const go = useCallback((id: ViewId) => {
    if (window.location.hash !== `#${id}`) {
      // pushState, not replaceState: moving between panes is navigation, and
      // back should return to the one you were reading.
      window.history.pushState(null, "", `#${id}`);
      window.dispatchEvent(new Event(VIEW_EVENT));
    }
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }, []);

  return [view, go];
}

// ── The frame ──────────────────────────────────────────────────────────────

export function AdminShell({
  groups, view, onNavigate, bar, footer, children,
}: {
  groups: NavGroup[];
  view: ViewId;
  onNavigate: (id: ViewId) => void;
  /** The right-hand controls in the top bar. */
  bar?: React.ReactNode;
  /** Sits under the rail: season, workflow link. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const active = groups.flatMap((g) => g.items).find((i) => i.id === view);

  return (
    <div className="mx-auto max-w-[108rem] px-4 sm:px-6 lg:px-10 xl:px-16 pb-16">
      <div className="flex gap-8">
        {/* THE RAIL sticks to the top of the viewport, not the page: the site
            header scrolls away above it, so `top-0` only engages once it has
            been scrolled past — which is exactly when it is wanted. */}
        <aside className="hidden lg:flex w-56 shrink-0 flex-col sticky top-0 max-h-screen overflow-y-auto py-6 pr-1">
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <nav key={g.title} aria-label={g.title} className="flex flex-col gap-0.5">
                <h2 className="px-2 pb-1.5 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted font-semibold">
                  {g.title}
                </h2>
                {g.items.map((item) => (
                  <RailItem key={item.id} item={item} active={item.id === view} onClick={() => onNavigate(item.id)} />
                ))}
              </nav>
            ))}
          </div>
          {footer && <div className="mt-auto pt-6">{footer}</div>}
        </aside>

        <div className="min-w-0 flex-1">
          {/* THE BAR. Blurred rather than opaque so a table scrolling under it
              reads as continuing, which is the one thing a sticky bar is for. */}
          <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 lg:px-0 bg-paper/85 backdrop-blur-md border-b border-hairline">
            <div className="h-14 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden className="grid grid-cols-2 gap-[2px] shrink-0">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={cn("w-[5px] h-[5px] rounded-[1px]", i === 0 ? "bg-coral" : "bg-ink/25")} />
                  ))}
                </span>
                <span className="text-[0.8rem] text-ink-muted">Admin</span>
                <span aria-hidden className="text-ink-muted/60">/</span>
                <h1 className="text-[0.8rem] font-semibold text-ink truncate">{active?.label ?? "Overview"}</h1>
              </div>
              <div className="flex items-center gap-2 shrink-0">{bar}</div>
            </div>

            {/* The rail, folded flat. Same items, same dots, horizontally
                scrollable — a phone gets the whole map, not a hamburger. */}
            <div className="lg:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2 flex gap-1 overflow-x-auto ttz-scroll">
              {groups.flatMap((g) => g.items).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "shrink-0 h-8 px-2.5 rounded-lg text-[0.75rem] font-medium inline-flex items-center gap-1.5 border transition-colors",
                    item.id === view
                      ? "border-hairline bg-card text-ink shadow-sm"
                      : "border-transparent text-ink-muted hover:text-ink hover:bg-ink/[0.04]",
                  )}
                >
                  <span className="opacity-70">{item.icon}</span>
                  {item.label}
                  <Dot health={item.health} />
                </button>
              ))}
            </div>
          </div>

          {/* Keyed on the view so a switch reads as an arrival, not a repaint. */}
          <div key={view} className="pt-6 bta-pane-in">{children}</div>
        </div>
      </div>
    </div>
  );
}

function RailItem({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group h-9 px-2 rounded-lg flex items-center gap-2.5 text-[0.82rem] transition-colors text-left",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
        active
          ? "bg-card border border-hairline shadow-sm text-ink font-semibold"
          : "border border-transparent text-ink-soft hover:text-ink hover:bg-ink/[0.04]",
      )}
    >
      <span className={cn("shrink-0", active ? "text-coral" : "text-ink-muted group-hover:text-ink-soft")}>
        {item.icon}
      </span>
      <span className="truncate flex-1">{item.label}</span>
      {item.badge && (
        <span className="shrink-0 text-[0.65rem] tabular-nums text-ink-muted font-medium">{item.badge}</span>
      )}
      <Dot health={item.health} />
    </button>
  );
}

/**
 * A dot only when there is something to say. Green is left off on purpose:
 * six green dots down a rail is a decoration, and the eye stops reading it —
 * an empty rail meaning "nothing wrong" is the stronger signal.
 */
function Dot({ health }: { health?: Health }) {
  if (!health || health === "good" || health === "off") return null;
  const tone =
    health === "bad" ? "bg-bad"
      : health === "warn" ? "bg-gold"
        : health === "live" ? "bg-coral animate-pulse"
          : "bg-ink/25 animate-pulse";
  return <span aria-hidden className={cn("shrink-0 w-1.5 h-1.5 rounded-full", tone)} />;
}
