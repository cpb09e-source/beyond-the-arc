/**
 * Pricing content, in one place.
 *
 * Every number here is a decision from docs/monetization-strategy.md, not a
 * placeholder — §5.1 argues the yearly price, §5.2 argues annual-first with
 * monthly priced so a partial year beats it, §5.3 sets the free/paid split and
 * §6 sizes the B2B tail. Keeping them in a module rather than in the page means
 * a price change is one edit and the comparison table cannot drift out of sync
 * with the cards.
 *
 * The free tier is deliberately generous. Four of our seven competitors are
 * free and good; a stingy free tier does not convert people, it routes them to
 * Torvik.
 */

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  price: string;
  period?: string;
  priceNote?: string;
  cta: string;
  ctaHref: string;
  /** Named tier whose features this one includes without restating them. */
  inherits?: string;
  /** This card renders its own price and CTA (the Season Pass period toggle). */
  customCta?: boolean;
  features: string[];
  accent: string;
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "The whole site, this season",
    price: "$0",
    period: "forever",
    cta: "Create a free account",
    ctaHref: "/account/signup/?plan=free",
    accent: "var(--ink-muted)",
    features: [
      "Every player, team and coach page",
      "This season and last, in full",
      "Box-EPM, the impact number built from the box score",
      "Scoreboard, search, glossary",
      "Win Calculator on the current season",
      "Transfer portal and the 26-27 preview",
    ],
  },
  {
    id: "season",
    name: "Season Pass",
    tagline: "For the person who opens ten tabs",
    price: "$50",
    period: "/year",
    cta: "Get the Season Pass",
    ctaHref: "/account/signup/?plan=yearly",
    accent: "var(--coral)",
    featured: true,
    customCta: true,
    inherits: "Free",
    features: [
      "All thirteen seasons, back to 2013-14",
      "Ask the Calculator — 300 plain-English questions a month",
      "Real EPM — the plus-minus fit from play-by-play",
      "Lineups, on/off and eWins",
      "Pick any seasons at once: 2015 + 2019 + 2026, ranked together",
      "Win Calculator across all years, filtered by coach",
      "Shot splits and the full filter ranges",
      "CSV export",
    ],
  },
  {
    id: "program",
    name: "Program",
    tagline: "Staff rooms and front offices",
    price: "Custom",
    cta: "Talk to us",
    ctaHref: "mailto:hello@btacbb.xyz?subject=Program%20licence",
    accent: "var(--court-ink)",
    inherits: "Season Pass",
    features: [
      "Seats for a whole staff",
      "Ask the Calculator, at a limit set with you",
      "Bulk export and a data feed",
      "Portal and recruiting depth",
      "Priority on new metrics",
    ],
  },
];

type Cell = boolean | string;

export const COMPARISON: Array<{
  group: string;
  rows: Array<{ label: string; cells: [Cell, Cell, Cell] }>;
}> = [
  {
    group: "Coverage",
    rows: [
      { label: "Player, team and coach pages", cells: [true, true, true] },
      { label: "Seasons available", cells: ["2 seasons", "13 seasons", "13 seasons"] },
      { label: "Pick any combination of seasons", cells: [false, true, true] },
      { label: "Transfer portal and season preview", cells: [true, true, true] },
    ],
  },
  {
    group: "Metrics",
    rows: [
      { label: "Box-EPM (box-score impact)", cells: [true, true, true] },
      { label: "EPM (fit from play-by-play)", cells: [false, true, true] },
      { label: "Offensive / defensive split", cells: [false, true, true] },
      { label: "eWins and on/off", cells: [false, true, true] },
      { label: "Lineup data", cells: [false, true, true] },
      { label: "Percentile ranks and Top 100 boards", cells: [true, true, true] },
    ],
  },
  {
    group: "Tools",
    rows: [
      { label: "Win Calculator", cells: ["Current season", "All years", "All years"] },
      { label: "Ask the Calculator (plain English)", cells: [false, "300/mo", "Custom"] },
      { label: "Coach filter in the Win Calculator", cells: [false, true, true] },
      { label: "Conditions per query", cells: ["3", "Unlimited", "Unlimited"] },
      { label: "Player comparison", cells: [true, true, true] },
      { label: "Shot splits and advanced filters", cells: [false, true, true] },
      { label: "CSV export", cells: [false, true, true] },
    ],
  },
  {
    group: "Account",
    rows: [
      { label: "Saved players and teams", cells: [true, true, true] },
      { label: "Seats", cells: ["1", "1", "Staff"] },
      { label: "Data feed", cells: [false, false, true] },
      { label: "Support", cells: ["Email", "Email", "Priority"] },
    ],
  },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What do I actually lose on the free tier?",
    a: "Depth, not access. Every page stays open and every current-season number is there. "
      + "What the pass adds is the eleven older seasons, the plus-minus built from play-by-play "
      + "rather than the box score, and the tools that let you ask your own question.",
  },
  {
    q: "What is Ask the Calculator?",
    a: "Type the question the way you would say it — \"Roy Williams games where UNC had more "
      + "fast break points and shot more threes than their opponent\" — and the Win Calculator "
      + "fills its own filters in. It proposes the query and stops there; you read it and press "
      + "Calculate. It never answers on its own, because a wrong reading that quietly returned a "
      + "number would be worse than no feature at all.",
  },
  {
    q: "What counts against the 300 a month?",
    a: "One question read is one call. Pressing Calculate is free and always will be — the limit "
      + "is on turning English into filters, not on running the numbers. Monthly billing includes "
      + "100 a month, and the count resets on the first of the month. For most people this is "
      + "headroom rather than a ceiling.",
  },
  {
    q: "Why annual rather than monthly?",
    a: "College basketball has an offseason and subscriptions do not. Annual means you are not "
      + "deciding whether to keep paying in July. Monthly exists if you want it, priced so that "
      + "the seven months you would actually use cost more than the year.",
  },
  {
    q: "When does it renew?",
    a: "Every November, before the season tips — not on the anniversary of the day you joined. "
      + "Subscribing in March and renewing the next March means renewing at the exact moment "
      + "the sport goes quiet.",
  },
  {
    q: "Where does the data come from?",
    a: "Bart Torvik for the statistical base, the CBBD API for play-by-play and box scores, and "
      + "RSCI for recruiting ranks. Every source is credited on the sources page.",
  },
  {
    q: "Do you run ads?",
    a: "No, and not on the paid tiers ever. A stats table with a banner in it is harder to read, "
      + "and the numbers are the product.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, and you keep the pass until the term you paid for runs out.",
  },
];
