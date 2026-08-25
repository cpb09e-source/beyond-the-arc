import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The tab strip under a team page's hero.
 *
 * TWO MODES, ONE APPEARANCE. Where a season has real tab routes each tab is a
 * link and only that tab's sections render. Where it does not, the whole page
 * renders as one scroll and the tabs are in-page anchors instead.
 *
 * Which seasons get which is decided in team-tab-route.ts, and the split is
 * forced by `output: "export"`: with no server at runtime, a season outside
 * the prebuilt set cannot render a tab route on demand, so the anchor mode is
 * what stops it 404ing. It also stops it looking like a lesser page — same
 * strip, same order, same active state, every section present and indexable.
 * Only the URL stays put.
 *
 * If the two modes ever LOOK different, that is the bug — a reader moving
 * between them should not notice until they watch the address bar.
 *
 * Preview pages get no strip at all — see the note in team-tab-route.ts.
 */

export type TeamTab = "overview" | "roster" | "history" | "shooting" | "lineups" | "onoff";

/** Anchor ids, also used as the section ids in team-page-view. */
export const TAB_ANCHORS: Record<TeamTab, string> = {
  overview: "overview",
  roster: "roster",
  history: "school-history",
  shooting: "shooting",
  lineups: "lineups",
  onoff: "on-off",
};

/**
 * Tab order is also the order the sections appear in on a single-page season.
 * They have to match: in anchor mode the strip is a table of contents for the
 * page below it, and a table of contents in a different order than its
 * contents is worse than none.
 */
const TABS: Array<{ key: TeamTab; label: string; segment: string }> = [
  { key: "overview", label: "Overview",       segment: "" },
  { key: "roster",   label: "Roster",         segment: "roster" },
  { key: "history",  label: "School History", segment: "history" },
  { key: "shooting", label: "Shooting",       segment: "shooting" },
  { key: "lineups",  label: "Lineups",        segment: "lineups" },
  { key: "onoff",    label: "On/Off",         segment: "on-off" },
];

export function TeamTabs({
  active,
  mode,
  slug,
  year,
  overviewHref,
}: {
  active: TeamTab;
  /** "routes" = real sub-pages. "anchors" = one-page scroll. */
  mode: "routes" | "anchors";
  slug: string;
  year: number;
  /**
   * Where the Overview tab points in route mode. The bare /teams/<slug> route
   * renders the same content as /teams/<slug>/<year>, so it passes its own URL
   * here rather than sending a reader who is already on Overview to a second
   * address for it.
   */
  overviewHref?: string;
}) {
  return (
    <nav
      aria-label="Team sections"
      className="border-b border-hairline"
    >
      <div className="mx-auto max-w-[88rem] px-6 lg:px-10">
        {/* Scrolls rather than wraps: six labels are well past a phone's
            width, and a second row of tabs reads as two groups. The strip
            scrolls horizontally instead, so the first two or three are always
            visible and the rest are one swipe away. overscroll-x-contain and
            NOT `none` — `none` on a container that also scrolls vertically
            stops the page scrolling from any finger that lands here. Same rule
            as the tables; see the note in season-grid. */}
        <ul className="flex items-stretch gap-1 overflow-x-auto overscroll-x-contain -mb-px">
          {TABS.map((t) => {
            const isActive = t.key === active;
            const href =
              mode === "anchors"
                ? `#${TAB_ANCHORS[t.key]}`
                : t.key === "overview"
                ? overviewHref ?? `/teams/${slug}/${year}/`
                : `/teams/${slug}/${year}/${t.segment}/`;
            return (
              <li key={t.key}>
                <Link
                  href={href}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-block whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    isActive
                      ? "border-coral text-ink"
                      : "border-transparent text-ink-muted hover:text-ink hover:border-hairline",
                  )}
                  style={isActive ? { borderColor: "var(--accent, var(--color-coral))" } : undefined}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
