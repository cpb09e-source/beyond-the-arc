# DESIGN.md

Design system for Beyond the Arc. Source of truth: [src/app/globals.css](src/app/globals.css). This file documents the *why* and the conventions. Tokens are in CSS.

## Color

Editorial paper palette with a single basketball-leather accent. Restrained color strategy: tinted neutrals carry 90%+ of the surface, coral ≤10% as the accent.

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#faf7f2` | warm off-white page background |
| `--paper-deep` | `#f1ece2` | one shade deeper for cards, dividers, hover surfaces |
| `--ink` | `#1a2238` | deep navy display ink (headlines, primary body emphasis) |
| `--ink-soft` | `#3a425c` | 70% navy, body copy |
| `--ink-muted` | `#6b7280` | neutral grey, secondary text, captions |
| `--hairline` | `#e7e2d5` | paper-toned divider, never `border-gray-200` |
| `--coral` | `#c8553d` | basketball-leather accent (kickers, accent rule, hover ink) |
| `--coral-soft` | `#e08a76` | hover/secondary accent |
| `--court` | `#d4a574` | hardwood, used in dashed `court-divider` |
| `--good` | `#4a7c59` | chart positive (forest green, not bright) |
| `--bad` | `#b94c4c` | chart negative (muted red, not saturated) |

**Rules:**

- Never use `#000` or `#fff` for surfaces. Use `--ink` and `--paper`/white-cards.
- All neutrals are tinted toward paper warmth (very low chroma toward coral hue). Don't introduce `text-gray-500`.
- Coral above 10% surface area is wrong. It's an accent, not a brand color.
- Good/bad are for charts, never for UI affordances (success/error toasts, if needed, use `--ink` body + a left badge, not green/red panels).
- No gradient surfaces. The only gradient allowed: the 1px `from-coral via-coral to-coral/60` top-rule on headline cards.

## Typography

Three families, loaded via `next/font/google`:

| Family | Variable | Use |
|---|---|---|
| **Fraunces** (variable, opsz + SOFT) | `--font-display` | display headlines, lede stats, big numbers in editorial position |
| **Geist** | `--font-sans` | UI body, labels, table rows |
| **Geist Mono** | `--font-mono` | reserved for code/inline snippets — rarely used in UI |

Body font features: `ss01`, `cv11`. Display font features: `ss01`, `ss02`, `ss03`, letter-spacing `-0.02em`.

**Scale hierarchy** (≥1.25 ratio between adjacent steps; vary deliberately):

- Display XL: `text-4xl` to `text-5xl` (lede stats, page-level "Leaderboard"-class headlines)
- Display L: `text-3xl` to `text-4xl` (section headlines inside cards)
- Body XL: `text-xl` (single-stat callouts, tabular)
- Body: `text-sm` to `text-base` (table cells, paragraphs)
- Caption: `text-xs` with `uppercase tracking-[0.18em]` or `tracking-widest` (kickers, labels, footnotes)
- Footnote: `text-[0.6rem]` uppercase tracked (the smallest deliberate label — used in card kickers)

**Conventions:**

- Numbers in stat positions: `.tabular` class (font-variant-numeric: tabular-nums). Always.
- Kickers: `text-xs uppercase tracking-[0.18em] text-coral font-medium`, prefixed with `<span className="h-px w-8 bg-coral" />`. This is the recurring section-start signal.
- Body line length: cap at ~70ch (`max-w-3xl` is the typical container).
- Never use `<em>` for emphasis in tables; use weight only.

## Spacing

Tailwind default scale. Page containers: `mx-auto max-w-[97rem] px-6 lg:px-10`. Vertical rhythm: section padding usually `py-8 lg:py-10`, kicker-header section `pt-10 pb-6`, content sections separated by the `court-divider` (dashed hardwood line) inside `my-12`.

**Rules:**

- Cards: `rounded-xl` (radius scale defined by `--radius: 0.5rem` and derivatives). `rounded-lg` only for inputs.
- Card padding: `px-5 lg:px-7 py-5 lg:py-6` for headline cards; `p-4 lg:p-5` for control bars.
- Avoid arbitrary px values that aren't on the scale. Exception: `1px` hairlines (`h-px`), kicker rules (`h-px w-6` / `w-8`).
- Vary spacing for rhythm — don't pad everything identically. Headline card padding > control bar padding > table cell padding.

## Components & patterns

### Headline card (recurring pattern)

The "ledger card" used on /coaches "Head coaches", /teams "By season", /players "Leaderboard":

```
<div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5">
  <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />     {/* coral top rule */}
  <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30">
    <div className="kicker">…coral line + tracked label…</div>
    <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">…</h2>
    <div className="mt-2 text-sm text-ink-muted">…meta with lede-style number…</div>
  </div>
  <table>…</table>
</div>
```

This is the canonical surface shape. New surfaces should inherit it unless there's a reason to break it.

### Section kicker

```
<div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
  <span className="h-px w-8 bg-coral" />
  <span>The player explorer · 2012-26</span>
</div>
```

Used at the top of pages to set the "section" tone. Once per page, not as decoration. Variant inside headline cards uses `text-[0.6rem]` + `w-6` rule.

### Court divider

Dashed hardwood line (`.court-divider`) for vertical section breaks between unrelated content. Lives between content blocks, not inside cards.

### Percentile chip

`<PercentileChip pct={n} />` — small ranked bar/chip showing where a value sits within its cohort. Used in stat cells to provide comparability at a glance. Same color logic as good/bad chart tokens.

### Sortable column header

`<SortableTh statKey="…" label="…" />` — clickable th that flips sort direction. Visual states: default, hover (coral arrow visible), active (coral arrow + direction icon).

### Inputs

- Selects: `h-9` height, `border-ink/15`, `rounded-md`, white background, `text-sm`. Focus ring: `focus:ring-coral/40 focus:border-coral/40`.
- Search inputs: same as selects, with leading magnifier icon and trailing clear button when filled.
- Labels: kicker-style (`text-xs uppercase tracking-widest text-ink-muted font-medium`).

## Motion

Custom animations in [globals.css](src/app/globals.css): `bta-fade-up`, `bta-bar-grow-v`, `bta-bar-grow-h`, `bta-fill-circle`. All use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo-ish), 600–1100ms duration. They animate transform / opacity only — never layout properties.

**Rules:**

- Hover transitions: `transition-colors` only, default duration. No scale, no shadow growth.
- Page reveal: only the showcase / player-profile components use the fade-up + bar-grow animations. Tables and filter bars stay static.
- Always respect `prefers-reduced-motion: reduce` (globals.css already guards the custom animations).
- No bounce, no elastic, no spring physics. Easing is exponential ease-out, period.

## Iconography

No icon library imported wholesale. Inline SVGs for the rare icons used (magnifier in search, chevron in disclosures, sort arrows). All icons follow the same stroke style: `stroke-current` on the parent, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`. Size 16–20px (`w-4 h-4` to `w-5 h-5`).

Team logos and player photos are handled by `<TeamLogo />` and `<PlayerPhoto />` components, both with fallback states for missing assets.

## Don'ts (the bans for this product)

- No side-stripe borders (`border-l-4 border-coral` on a card or row).
- No gradient text.
- No glassmorphism / backdrop-blur.
- No SaaS-cliché hero-metric template (big number, small label, "+12% this week").
- No identical card grids (3-up of "Players / Teams / Coaches" with icon + heading + text).
- No modal-as-first-thought. The season games modal is the only modal that earns its place.
- No em dashes in copy or UI strings.
