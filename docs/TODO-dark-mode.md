# TODO — dark mode, chosen from the account page

Requested 2026-08-24. Dark mode should come back, and the control for it should
live in the signed-in user's own settings rather than floating in the chrome.

## The palette — decided 2026-08-24

**Azure After Hours**, chosen from five candidates. Colin liked all five and may
switch later, so the alternates are worth keeping: Hardwood (amber `#e2a55c`),
Scoreboard (amber + cyan, two accents), Newsprint (near-monochrome, slate
`#7d9bc4`), Cold Open (mint `#4fd1a9`). Comparison page:
https://claude.ai/code/artifact/95c54e75-8ad9-4bc0-9956-5fd80a21d568

The ground is fixed at `#1C1C1C` — a true NEUTRAL, which is the part that makes
this a rewrite rather than a tweak. The dormant theme in `globals.css` is navy
`#0e1320` and keeps the brand by swapping editorial roles: navy becomes the
page, cream becomes the ink. On a neutral ground that trick is unavailable, so
the accent carries the identity alone.

```css
[data-theme="dark"] {
  --paper:       #1C1C1C;   /* the brief */
  --paper-deep:  #242424;   /* cards, banners */
  --card:        #242424;
  --popover:     #2b2b2b;
  --hairline:    #333331;

  --ink:         #ece8e0;   /* warm cream, unchanged in spirit */
  --ink-soft:    #a6a29a;
  --ink-muted:   #736f68;

  --coral:       #4d9bff;   /* the azure, lifted to carry on #1C1C1C */
  --coral-soft:  #84baff;
  --accent-foreground: #0b1a2e;

  --good:        #5fb87a;
  --bad:         #e2706e;
}
```

Azure was chosen for continuity: `--coral` keeps meaning what it means at all
~390 call sites, and the only real work is the lift. `#0c6bd6` reaches just
2.4:1 on this ground; `#4d9bff` clears AA.

### The percentile ramp must be re-baked

Not optional, and easy to miss. The live seven-band ramp in
`src/components/percentile-chip.tsx` is authored FOR PAPER — pastel fills
carrying dark text, deliberately light enough that type never flips to white.
Put those same fills on `#1C1C1C` and every chip becomes a headlight, on a page
that is mostly chips.

The dark ramp inverts it: deep fills, light type, and the same rule the current
one keeps — the middle band drops nearly all chroma so *average* recedes rather
than shouting. Author in OKLCH and bake to sRGB, exactly as the existing comment
in that file describes, so nothing depends on `oklch()` support.

### Still to come

Colin is supplying a dark-mode SVG for the nav mark.

## What already exists

Most of this is built and switched off, not missing.

- **The palette.** `src/app/globals.css` still defines the full dark token set
  under `[data-theme="dark"]` — `--hairline: #262c3b`, the lot. It has not
  rotted; it just never gets selected.
- **The control.** `src/components/theme-toggle.tsx` is intact: a segmented
  Light / Dark control that writes `data-theme` on `<html>` and persists to
  `localStorage` under `bta-theme`. It is not mounted anywhere.
- **What was removed.** The pre-hydration script in `src/app/layout.tsx`. The
  comment there is the handover note.

## The landmine, before anything is switched on

The old pre-hydration script **defaulted every phone under 768px to dark**. So
there are returning visitors carrying `bta-theme=dark` in localStorage who never
chose it. Re-enable the script naively and they land in dark on first paint.

Whatever ships must therefore either ignore the legacy stored value outright, or
migrate it once and drop it. Do not treat the presence of `bta-theme` as an
expressed preference — for phone users it is a bug's fingerprint.

## What the work actually is

1. Move the preference from `localStorage` to the account. It is a user setting
   now, so it belongs next to the rest of the profile in Supabase, and it should
   follow the user between devices.
2. Keep a `localStorage` mirror anyway — it is the only thing that can be read
   before paint. The account value is the source of truth; the mirror exists so
   the first frame is not wrong. Reconcile after auth resolves.
3. Restore the pre-hydration script in `layout.tsx`, reading the mirror and
   applying the legacy-value rule above.
4. Mount `ThemeToggle` on the account page. Three states, not two — Light, Dark,
   System — because `prefers-color-scheme` is what a signed-out visitor gets and
   the signed-in default should be able to agree with it.
5. Signed-out visitors: decide whether they get the control at all. If not, they
   follow `prefers-color-scheme` and nothing is stored.
6. Audit the palette before trusting it. It was written against an earlier
   version of the site; everything added since — the transfer-portal sheets, the
   compare modals, the filter sheets, the mobile header bar — has only ever been
   looked at in light. Expect hard-coded colours that were fine when there was
   one theme.

## Related

- [[project_paywall_feature]] — accounts already exist, so there is a settings
  surface to put this on.
