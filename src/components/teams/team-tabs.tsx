import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Navigation for a team page's six sections.
 *
 * TWO SHAPES, ONE LIST. Above lg it is a vertical rail beside the content;
 * below lg it is a bar fixed to the bottom of the screen. Both render the same
 * TABS array in the same order, so there is one place to add a section.
 *
 * WHY IT STOPPED BEING A STRIP. Six labels do not fit across a phone. The old
 * strip scrolled horizontally, which meant On/Off sat past the right edge with
 * nothing but a scrollbar to say so — the last two sections were effectively
 * undiscoverable on the device most people read on. A bottom bar fits all six
 * at icon size, never scrolls, and sits under the thumb instead of at the top
 * of a page the reader has already scrolled past.
 *
 * THE RAIL IS ON THE RIGHT, AND ITS POSITION NEVER MOVES. That second part is
 * why the sections all share one max-width now. They used to differ — 88rem for
 * most, 96rem for School History, 100rem for Lineups — and each centred itself,
 * so a rail pinned to the content's edge landed somewhere different on every
 * tab. Switching sections slid the navigation, which is the one element that
 * has to hold still. One container width for all ten sections fixes it at the
 * source; see the note in team-page-view.
 *
 * TWO MODES, ONE APPEARANCE. Where a season has real tab routes each item is a
 * link to that route and only that section renders. Where it does not, the
 * whole page renders as one scroll and the items are in-page anchors.
 *
 * Which seasons get which is decided in team-tab-route.ts, and the split is
 * forced by `output: "export"`: with no server at runtime, a season outside the
 * prebuilt set cannot render a tab route on demand, so the anchor mode is what
 * stops it 404ing. If the two modes ever LOOK different, that is the bug.
 *
 * Preview pages get no navigation at all — see the note in team-tab-route.ts.
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
 * They have to match: in anchor mode this is a table of contents for the page
 * below it, and a table of contents in a different order than its contents is
 * worse than none.
 *
 * `short` is the bottom bar's label. A phone gives each of six items about
 * 62px, so "School History" and "Shooting" have to shorten — and "Shots" is
 * what the tab is actually about, not an abbreviation of the word above it.
 */
const TABS: Array<{
  key: TeamTab;
  label: string;
  short: string;
  segment: string;
  icon: React.ReactNode;
}> = [
  {
    key: "overview", label: "Overview", short: "Overview", segment: "",
    icon: (
      <>
        <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
        <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
        <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
        <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
      </>
    ),
  },
  {
    key: "roster", label: "Roster", short: "Roster", segment: "roster",
    icon: (
      <>
        <circle cx="8" cy="5.6" r="2.6" />
        <path d="M3 13.5c0-2.5 2.2-4.1 5-4.1s5 1.6 5 4.1" />
      </>
    ),
  },
  {
    key: "history", label: "School History", short: "History", segment: "history",
    icon: (
      <>
        <rect x="3" y="2.5" width="10" height="11" rx="1.2" />
        <path d="M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h2.8" />
      </>
    ),
  },
  {
    key: "shooting", label: "Shooting", short: "Shots", segment: "shooting",
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="1.6" />
      </>
    ),
  },
  {
    key: "lineups", label: "Lineups", short: "Lineups", segment: "lineups",
    icon: <path d="M2.8 13V7.4M6.3 13V3.4M9.7 13V9.2M13.2 13V5.6" />,
  },
  {
    key: "onoff", label: "On/Off", short: "On/Off", segment: "on-off",
    icon: (
      <>
        <path d="M2.5 8h11" />
        <circle cx="5.4" cy="8" r="2.1" />
        <circle cx="10.6" cy="8" r="2.1" />
      </>
    ),
  },
];

function Glyph({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

type NavProps = {
  active: TeamTab;
  /** "routes" = real sub-pages. "anchors" = one-page scroll. */
  mode: "routes" | "anchors";
  slug: string;
  year: number;
  /**
   * Where Overview points in route mode. The bare /teams/<slug> route renders
   * the same content as /teams/<slug>/<year>, so it passes its own URL here
   * rather than sending a reader already on Overview to a second address.
   */
  overviewHref?: string;
};

function hrefFor(t: (typeof TABS)[number], p: NavProps): string {
  if (p.mode === "anchors") return `#${TAB_ANCHORS[t.key]}`;
  if (t.key === "overview") return p.overviewHref ?? `/teams/${p.slug}/${p.year}/`;
  return `/teams/${p.slug}/${p.year}/${t.segment}/`;
}

/**
 * The rail. Sticky rather than fixed, so it scrolls with the page until it
 * reaches the top and then holds — a fixed rail on a short viewport would
 * clip its own last item with no way to reach it.
 */
export function TeamRail(props: NavProps) {
  return (
    <nav
      aria-label="Team sections"
      // order-2 puts it after the content in the flex row; the content column
      // is order-1. Source order stays content-first so a screen reader and a
      // keyboard reach the page before its navigation.
      // mt-5 matches the top margin the first section in every tab carries, so
      // the rail's first item lines up with the content beside it rather than
      // with the column box, which sits 20px higher. It is a constant and not
      // read from the section, deliberately: the whole point of one container
      // width is that this navigation holds still between tabs, and matching
      // each tab's own first margin would start it moving again.
      className="hidden lg:block order-2 shrink-0 w-52 mt-5 sticky top-4 self-start z-20"
    >
      <ul className="flex flex-col gap-0.5">
        {TABS.map((t) => {
          const isActive = t.key === props.active;
          return (
            <li key={t.key}>
              <Link
                href={hrefFor(t, props)}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                title={t.label}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg py-2 px-3 transition-colors",
                  isActive
                    ? "text-ink"
                    : "text-ink-muted hover:text-ink hover:bg-[color-mix(in_oklab,var(--accent,var(--color-coral))_8%,transparent)]",
                )}
                style={
                  isActive
                    ? {
                        color: "var(--accent, var(--color-coral))",
                        backgroundColor:
                          "color-mix(in oklab, var(--accent, var(--color-coral)) 12%, transparent)",
                      }
                    : undefined
                }
              >
                {/* Marker on the OUTER edge — the rail sits to the right of
                    the content, so the bar belongs against the page edge and
                    not between the label and the thing it labels. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                  style={{ backgroundColor: "var(--accent, var(--color-coral))" }}
                />
                <Glyph className="w-[1.15rem] h-[1.15rem] shrink-0">{t.icon}</Glyph>
                <span className="text-sm font-medium whitespace-nowrap">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The bottom bar. Below lg only.
 *
 * Fixed, and the page pads itself by BOTTOM_BAR_CLEARANCE to match. The
 * safe-area inset is what keeps the labels off an iPhone's home indicator —
 * without it the bottom ~34px of the bar is under the system gesture area and
 * the taps land on the wrong thing.
 */
export function TeamBottomBar(props: NavProps) {
  return (
    <nav
      aria-label="Team sections"
      // Marks the document for the footer-clearance rule in globals.css. The
      // bar is fixed, so it covers whatever the page ends with — and the page
      // ends with the site footer, which is a sibling of the team page rather
      // than a child of it. Padding the team wrapper therefore cannot clear it:
      // it adds space BEFORE the footer, and the footer is still the last
      // thing under the bar. The rule keys off this attribute so it applies on
      // exactly the pages that render a bar.
      data-team-bottom-bar=""
      className={cn(
        "lg:hidden fixed inset-x-0 bottom-0 z-40",
        "border-t border-hairline bg-card/95 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex items-stretch">
        {TABS.map((t) => {
          const isActive = t.key === props.active;
          return (
            <li key={t.key} className="flex-1 min-w-0">
              <Link
                href={hrefFor(t, props)}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-0.5 pt-2 pb-1.5 transition-colors",
                  isActive ? "" : "text-ink-muted",
                )}
                style={isActive ? { color: "var(--accent, var(--color-coral))" } : undefined}
              >
                <Glyph className="w-[1.3rem] h-[1.3rem]">{t.icon}</Glyph>
                {/* 0.6rem and tracking-tight: six labels across 390px leaves
                    about 62px each, and "Overview" is the longest. Truncation
                    here would be worse than small type — a clipped label is a
                    label you cannot identify. */}
                <span className="text-[0.6rem] leading-none font-semibold tracking-tight truncate max-w-full">
                  {t.short}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
