import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Navigation for a team page's seven sections.
 *
 * TWO SHAPES, ONE LIST. Above lg it is a vertical rail beside the content;
 * below lg it is a bar fixed to the bottom of the screen. Both render the same
 * TABS array in the same order, so there is one place to add a section.
 *
 * WHY IT STOPPED BEING A STRIP. Six labels did not fit across a phone, and
 * there are seven now. The old strip scrolled horizontally, which meant On/Off
 * sat past the right edge with nothing but a scrollbar to say so — the last
 * two sections were effectively undiscoverable on the device most people read
 * on. A bottom bar fits them all, never scrolls, and sits under the thumb
 * instead of at the top of a page the reader has already scrolled past.
 *
 * THE RAIL IS ON THE LEFT, AND ITS POSITION NEVER MOVES. That second part is
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

export type TeamTab =
  | "overview" | "games" | "roster" | "history" | "shooting" | "lineups" | "onoff";

/** Anchor ids, also used as the section ids in team-page-view. */
export const TAB_ANCHORS: Record<TeamTab, string> = {
  overview: "overview",
  games: "game-log",
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
 * `short` is the bottom bar's label. A phone gives each of seven items about
 * 55px, so "School History", "Shooting" and "Game Log" have to shorten — and
 * "Shots" is what the tab is actually about, not an abbreviation of the word
 * above it.
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
    // SECOND, not last. The game log is the season's record of what happened,
    // so it belongs against Overview — everything below it (roster, shooting,
    // lineups) explains the games rather than listing them. It is also the
    // section that answers the question the schedule ticker in the hero raises
    // and cannot finish: the ticker shows 38 results in a strip you drag, this
    // is the same 38 with the box beside them.
    //
    // "Games" on the bottom bar. Seven labels across a 390px phone is about
    // 55px each — "Overview" still sets at roughly 53 — so the long form
    // would have been the one item that clipped.
    key: "games", label: "Game Log", short: "Games", segment: "games",
    // A list with markers, not another table glyph: the site header already
    // spends Table2 on the two explorers and ListOrdered on the two game logs,
    // and this is the same object as those, one team narrower.
    icon: (
      <>
        <path d="M2.6 4.4h1.3M2.6 8h1.3M2.6 11.6h1.3" />
        <path d="M6.8 4.4h6.6M6.8 8h6.6M6.8 11.6h6.6" />
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
/**
 * The rail's width and the gap after it, as classes rather than numbers.
 *
 * EXPORTED BECAUSE THE HERO HAS TO MATCH IT. The hero sits in its own row
 * above this one and indents itself by exactly this much so its left edge
 * lands on the content column rather than on the rail. Two rows agreeing on a
 * measurement is the kind of thing that drifts the first time one of them is
 * touched, so they read the same constants instead of both hardcoding 13rem.
 */
export const RAIL_WIDTH = "w-52";
export const RAIL_GAP = "lg:gap-6";

export function TeamRail(props: NavProps) {
  return (
    <nav
      aria-label="Team sections"
      // No order utility: the rail is first in the markup and first in the
      // row, so the visual order and the tab order agree. Placing it visually
      // before the content while leaving it after in the DOM would send a
      // keyboard through the entire page and back to reach the navigation.
      //
      // mt-5 matches the top margin the first section in every tab carries, so
      // the rail's first item lines up with the content beside it rather than
      // with the column box, which sits 20px higher. It is a constant and not
      // read from the section, deliberately: the whole point of one container
      // width is that this navigation holds still between tabs, and matching
      // each tab's own first margin would start it moving again.
      className={cn("hidden lg:block shrink-0 mt-5 sticky top-4 self-start z-20", RAIL_WIDTH)}
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
                {/* Marker on the OUTER edge — the rail sits to the left of
                    the content, so the bar belongs against the page edge and
                    not between the label and the thing it labels. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r",
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
 * TYPE, NOT ICONS. It used to set an icon over a 9.6px label in each cell,
 * which is the stock phone tab bar and reads like one. The label had to be
 * that small because six of them plus six glyphs is what fits, so the type
 * size was a consequence of the shape rather than a decision.
 *
 * Dropping the glyphs buys the labels their size back and lets the bar be what
 * this page actually needs: an index. A team page is tables, not an app, and
 * seven section names in small caps under an accent rule is how a printed
 * programme would list them. The icons were the weaker half anyway — a circle
 * inside a circle for Shooting and two overlapping discs for On/Off are marks
 * you learn from the label beneath them, not marks that save you reading it.
 *
 * THE ACTIVE MARKER IS ON TOP, not underneath. The bar is at the foot of the
 * screen, so a rule under the label sits against the home indicator where an
 * iPhone draws its own; a rule along the top edge reads as the tab's own and
 * has the whole bar below it to belong to.
 *
 * Fixed, and the footer pads itself to match — see the :has() rule in
 * globals.css. The safe-area inset keeps the labels off an iPhone's home
 * indicator; without it the bottom ~34px of the bar is under the system
 * gesture area and the taps land on the wrong thing.
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
        // A CONSTANT reserve, not env(safe-area-inset-bottom).
        //
        // That variable is not constant on a phone. iOS reports it as 0 while
        // Safari's bottom toolbar is on screen — the toolbar is already
        // covering the gesture area — and as roughly 34px once the toolbar
        // collapses on scroll. A bar padded by it therefore GROWS BY 34px
        // partway down the page and shrinks again on the way back up, which is
        // the one thing a fixed navigation must not do.
        //
        // 0.75rem always. The trade is deliberate and worth stating: on a
        // gesture phone with the toolbar hidden, the lower few pixels of the
        // tap target now sit inside the home-indicator strip. The LABELS are
        // clear of it either way — they are centred in the 46px row above this
        // padding — so what is at risk is the last sliver of a tap, not
        // readability, and a bar that changes height while you read is the
        // worse fault.
        "pb-3",
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
                  "relative flex items-center justify-center h-[2.875rem] px-0 transition-colors",
                  // 0.5625rem uppercase with a hair of tracking, AND THE
                  // NUMBERS ARE MEASURED RATHER THAN GUESSED.
                  //
                  // Seven labels across a 390px phone is a 54px cell. At the
                  // 0.625rem/0.04em this used to set, "OVERVIEW" measures 59px
                  // and was quietly truncating — six labels fitted, seven do
                  // not. At 0.5625rem/0.03em it measures 52, and dropping the
                  // cell's own px-0.5 gives back the 4px that padding was
                  // taking, so the longest label clears by two. Every other
                  // label is 33-44px and has room to spare.
                  //
                  // The alternative was shortening "Overview" the way Shooting
                  // and School History are shortened, and it was rejected: the
                  // bar is the phone's only view of this navigation, and the
                  // one item a reader taps most should not be the one whose
                  // name disagrees with the rail. A pixel of type size is the
                  // cheaper thing to spend. There is no room for an eighth
                  // section either way.
                  //
                  // Uppercase is doing real work: it evens out the ascenders so
                  // words of different shapes read as one row of equals.
                  "text-[0.5625rem] font-bold uppercase tracking-[0.03em] whitespace-nowrap truncate",
                  isActive ? "" : "text-ink-muted",
                )}
                style={isActive ? { color: "var(--accent, var(--color-coral))" } : undefined}
              >
                {/* Inset from the cell edges rather than spanning it: a rule
                    that runs the full width of its cell meets its neighbour's
                    and the six read as one continuous line with a coloured
                    segment, instead of as one tab that is marked. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[14%] right-[14%] top-0 h-[2.5px] rounded-b-sm",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                  style={{ backgroundColor: "var(--accent, var(--color-coral))" }}
                />
                {t.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
