# PRODUCT.md

**Beyond the Arc** — editorial-grade college basketball analytics: team and player splits, shot charts, lineup data, and the transfer portal.

## Register

`product` — design serves the data. This is an app UI / explorer / dashboard, not a marketing surface. Visual choices should make the numbers legible, comparable, and trustworthy. Decoration that doesn't carry information is drift.

## Users

Hoop-literate readers, not casual fans. Specifically:

- **Bracket watchers / hoop sickos** — people who know what TS%, PORPAG, eFG, KenPom-style adjusted stats mean. They want depth they can't get from ESPN or even Bart Torvik's raw tables.
- **CBB journalists and bloggers** — researching team-season profiles, coach résumés, transfer-portal moves. They want fast filterable views and shareable evidence.
- **Bettors and DFS players** — looking for matchup edges via per-game/per-cohort splits and percentile chips.
- **Coaches and analysts** — scouting against player composites, conference-adjusted ratings.

They are NOT learning what a 3-point percentage is. Assume vocabulary; over-explain methodology in tucked-away disclosure (collapsed `<details>`), not inline.

## Voice & tone

**Editorial sports magazine, not SaaS dashboard.** Think Grantland obit for a college program crossed with FiveThirtyEight's evidence layout. Authoritative, dry, confident — the data does the talking, the copy stays out of the way.

- Kicker → headline → body, magazine-style. Never lead with a card title that restates the section heading.
- One coral accent rule + ALL-CAPS tracked-out kicker is the recurring "we're starting a section" signal. Use it once per section, not as decoration.
- Numbers belong in display serif, tabular figures. Labels belong in tracked, lowercase / small-caps sans.
- Caption tone: terse, footnoted. Sentence case. Periods on full sentences, not on labels.
- **No em dashes** (the design system has them; the copy doesn't). Use commas, colons, semicolons, parentheses.
- Never write "Welcome to Beyond the Arc." Never write feature copy like a product tour.

## Anti-references

What this product is NOT:

- **Not ESPN.com / CBS Sports.** Big banner ads, headshot collages, autoplaying video — none of it. We're not chasing impressions.
- **Not a SaaS dashboard.** No teal-and-purple gradient cards, no "Welcome back, Colin 👋" empty states, no kitchen-sink filter sidebar.
- **Not KenPom 2003.** We respect the lineage (data-first, opinionated, niche) but the typography and layout should not look like a static HTML table with `width="100%"`.
- **Not crypto / Web3 dark mode.** No neon-on-black, no glow, no monospace-everywhere.
- **Not Linear / Vercel.** Beautiful, but their aesthetic family is saturated and would erase the editorial register.
- **Not first-order category reflex** ("sports → bold red + headlines"). The coral is muted (`#c8553d`, basketball-leather, not Bulls red). The display serif (Fraunces) is editorial, not athletic-cliché slab.

## Strategic principles

1. **Methodology earns trust by being legible, not hidden.** Every composite (BTA PRTG, conference multipliers, percentile chips) has a `<details>` block explaining how it's computed. Buried, not absent.
2. **Density is a feature.** Hoop sickos want to scan 100 rows, not 10. Tables, not cards-of-cards. White space serves rhythm, not airiness.
3. **Comparability is the product.** Percentile chips, conference-adjusted ratings, season-cohort processing — every number is presented in context. Never a raw value with no scale.
4. **Static-first, fast.** ~23k pre-rendered pages on Netlify + bulk JSON on R2. UI choices should not assume a live API; design for instant nav and progressive disclosure.
5. **Iterative, opinionated, solo-built.** Colin ships fast and changes his mind. Designs should be confident commitments, not committee compromises. One bold choice beats three timid ones.
6. **Editorial consistency across surfaces.** /coaches, /teams, /players all share the kicker → display headline → table pattern. New surfaces inherit the shape unless there's a reason to break it.
