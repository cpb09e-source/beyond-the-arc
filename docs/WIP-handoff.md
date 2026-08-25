# Where we are — handoff

Written 2026-08-25. Read this first after a `/clear`. Everything below is
state that lives nowhere else: decisions made in conversation, findings from
investigation, and constraints that are not derivable from the code.

Delete sections as they land. Keep the constraints.

---

## Standing constraints — these override any instinct to be helpful

**No push. No build. No deploy.** Colin's words: "dont push or build anything
need to make a bunch more changes you can commit work thats it for now."
Committing IS allowed and expected. This stands until he explicitly lifts it.

**Never commit these stray untracked files.** They sit in the tree
permanently and are not part of the project:
`deno.lock`, `has_about.html`, `he_blog.html`, `public/images/Untitled-4.ai`,
`public/images/newbtalogo-01.svg`.

**12 `porpag-*.json` files are `built_at`-only churn.** They dirty on nearly
every script run. Check the diff and `git checkout --` them before committing.

**Data freeze until 2026-10-01** — `scripts/lib/data-freeze.mjs` blocks
network fetches. Escape hatch is `BTA_ALLOW_NETWORK=1`. Reading the local
`data/cbbd/` archive is unaffected and is how all the new builders work.

**Deploy, when authorized:** `netlify deploy --prod --dir=out --no-build`,
run BACKGROUNDED. A 10-minute Bash timeout once killed the CLI mid-upload and
orphaned a deploy stuck at `uploading`. Verify with
`netlify api listSiteDeploys` showing `ready` — never trust the exit code.

**Secrets never enter the transcript.** Check key shapes only (`sk_live`,
`whsec_`, `price_`). Netlify masks secret-flagged vars as `************`;
that is NOT the same as the variable being missing. This already caused one
wrong conclusion about `SUPABASE_SERVICE_ROLE_KEY`.

**Screenshots must be under 2000px on the long edge** or the API cannot read
them. This blocked four separate requests in the last session. Ask for a
resize rather than guessing at what an image shows.

---

## Open work

### 1. Teams page soft redesign — AWAITING COLIN'S DECISION

He asked "thoughts?" on splitting the team page into an Overview tab plus
sub-pages, modelled loosely on CBB Analytics (whose visual design he dislikes
— explicitly no Conference Comparison logo graphs).

His proposed Overview: schedule ticker, where they rank best, where they rank
worst, Team Stats, By Season. Sub-pages: Roster and everything else.

**My recommendation, already given to him:**

The page stacks ELEVEN sections today, two of which were added last session
(assist network, shot clock). It is past the point where a reader can find
anything. His split is right.

The constraint he cannot see is build cost. There are **5,009 team pages**
today out of 21,551 total. Real sub-routes for three tabs takes team pages to
roughly 20,000 and close to doubles the build.

So: **real routes for the current season only, single page for history.**
`/teams/duke/roster/` gets a URL; `/teams/duke/2015/roster/` does not — 2015
stays one long page. Caps the increase at ~1,100 pages instead of ~15,000,
and matches how people read: current season gets explored, old seasons get
glanced at.

The alternative — client-side tabs, zero build cost — hides the roster from
Google entirely, and those pages are presumably part of how people find the
site.

**The part worth deciding alongside it:** sub-pages are a natural paywall
boundary. "Overview free, deeper tabs paid" is a far cleaner story than
"2 seasons free, 13 paid", and much easier to enforce — a tab that never
renders is a tab whose data never ships. See section 5.

He has not answered yet. Do not start building this.

### 2. "By Season should show a view like this" — BLOCKED ON A SCREENSHOT

Colin sent a screenshot that exceeded the size limit and could not be read.
Ask for it again resized under 2000px.

### 3. "Remove FTA Rate and 3PA Rate" — NEEDS DISAMBIGUATION

These do NOT appear in the team page's By Season table. They live in five
places:

- `src/components/coaches/coach-filters.tsx:38-39`
- `src/components/teams/compare-teams-modal.tsx:109-110`
- `src/components/teams/explorer-client.tsx:92,94`
- `src/components/table/sortable-th.tsx:45-46`
- `src/components/teams/team-stat-filters.tsx:71,73`

Ask which surface he means before touching any of them.

### 4. "Put a Coach column in the conf, season, record section" — ALREADY EXISTS

`src/components/teams/sortable-seasons-table.tsx:112-120` already renders:
Season · Conf · Record · Conf Rec · Tournament · **Coach** · BTA Rank ·
Adj ORtg · Adj DRtg.

He is looking at a different table. Ask which page.

### 5. Enforcement layer — RESEARCH DONE, PLAN OWED

Promised twice, never written. What the investigation established:

**Nothing gates anything today.** `describeMembership()` has exactly ONE
consumer — `src/components/account/account-client.tsx`. It renders a badge.
No content anywhere checks it. All 19 seasons ship publicly while the pricing
page sells "2 seasons free, 13 paid".

**The decisive constraint:** prebuilt pages EMBED old-season data in their
HTML. Verified directly — a player page server-renders a Career table naming
2017 and 2021 through 2025. So gating the JSON fetches would not hold; the
data is already in the markup before any JS runs.

That leaves three real options:

1. **Don't prebuild gated seasons.** Old-season pages become client-fetched
   shells. Cuts the build substantially. Loses SEO on historical pages.
2. **Move gated data to an authenticated edge function.** Pages prebuild
   without it; a Netlify function checks the Supabase JWT and serves the
   payload. Keeps SEO for the free surface, adds a runtime dependency.
3. **Change what is sold.** Gate by DEPTH rather than by SEASON — the
   sub-page split in section 1 does this naturally, and the deep tabs are
   exactly the surfaces nobody needs indexed.

Option 3 is the one to argue for. It converts a hard technical problem into
a routing decision he is already half-way to making.

### 6. Stripe — SET UP, NOT VERIFIED

Four env vars are in Netlify. `STRIPE_SECRET_KEY` is `sk_live_…`.

**The open risk:** the products and prices were created while walking through
the dashboard in TEST mode, but the secret key is LIVE. Test-mode price IDs
do not work with a live key. **Verify before any checkout is exercised.**

Also outstanding:
- `STRIPE_PRODUCT_ID`, `STRIPE_PRICE_3MONTH`, `STRIPE_PRICE_6MONTH` are read
  by NOTHING in the codebase.
- The publishable key is read by nothing either — checkout is redirect-based,
  so this is correct, not a bug.
- Stripe keys are NOT flagged secret in Netlify and are readable in
  plaintext. Should be flagged.

### 7. Nine files use fixed Tailwind palette colors that cannot follow dark mode

`schedule-ticker.tsx`, `overview-tab.tsx`, `season-by-season-table.tsx`,
`find-game-modal.tsx`, `where-they-rank.tsx`, `seed-chip.tsx`, plus three
others. They need to move to the CSS custom properties in `globals.css`.

### 8. Dark-mode nav SVG

Colin said he would supply one. The wordmark is already handled —
`src/components/site-logo.tsx` swaps `newbtalogo-white-01.svg` in via CSS
`display:none` on two `<img>` tags, so exactly one is in the a11y tree.

### 9. `useSearchParams` refactor

`/` and `/players/` ship zero `<tr>` elements and blank the table for 1–2s
while JS boots.

### 10. Open decision: `assist-network.json` is 12MB and committed to the repo

Should probably go to R2 like the other eight directories. `assist-players/`
(~17MB) is already gitignored with the reasoning written into `.gitignore`.

---

## Things learned the hard way — do not re-derive these

**`touch-action` RESTRICTS, it does not delegate.** The effective value is
the INTERSECTION down the whole ancestor chain. Do not reintroduce `pan-x`
anywhere in the table stack; it is documented at the call sites.

**`overscroll-behavior: contain` was not enough** to stop the whole table
being dragged around on iOS. `contain` stops scroll chaining but KEEPS the
local rubber-band. Only `none` suppresses both. Colin was emphatic about this
one: "i can drag and drop the enitre table .. i dont want that at all!!!"

**`position: sticky` needs a scrollport.** `overflow-x: auto` silently forces
`overflow-y: auto`, which makes the wrapper a scroll container in both axes.

**iOS auto-zoom on inputs under 16px** shrinks the VISUAL viewport while
`inset-x-0` stays on the LAYOUT viewport. The "slight zoom" and the "search
box bleeds off screen" were one bug, not two. Fixed globally with a 16px
floor under `@media (max-width: 47.99rem)`.

**`window.open()` after any `await` is treated as an unsolicited popup** on
iOS and gets blocked. The share flow has to open synchronously on the tap.

**`loading="lazy"` never fetches an off-screen element** — the share card
renders 20,000px off-screen, so crests need `eager` plus an awaited
`img.decode()`.

**`svh` not `dvh`** for full-height sheets — svh is measured with the URL bar
out, so there is no height animation mid-scroll.

**Python patch scripts that `sys.exit(1)` before the file write silently
revert earlier edits in the same batch.** This ate a set of imports in
`players/[id]/page.tsx` once.

**Assist/clock builders MUST import `norm` from `scripts/lib/cbbd-join.mjs`**
— it is the TEAM normalizer and rewrites `st.` to `state`. A hand-rolled one
left 18.8% of teams unresolved; theirs leaves 1.7%.

**Colin spells it Offense and Defense.** The British spellings were mine.

---

## The two new play-by-play features, in one paragraph each

**Assist networks** — `scripts/build-assist-network.mjs` emits
`public/data/assist-network.json` (4,272 team-seasons) and
`public/data/assist-players/<year>.json`. There is no pass, touch or dribble
anywhere in the play-by-play; the only pass ever recorded is the one before a
MADE field goal. So every connection is an ASSIST connection, and the panels
say "assisted" and never "passes". The number worth reading is the rim
assisted rate — threes run 75–95% assisted for nearly everyone and separate
nobody, while the rim runs from under 20% to over 80% and cleanly divides
players who get there themselves from players who are delivered there.

**Shot clock splits** — `scripts/build-clock-splits.mjs` emits
`public/data/clock-splits.json` (4,278 team-seasons). Clock position is
reconstructed, not reported. The reset rule is the whole model: an offensive
rebound IS a reset, because NCAA men's basketball puts the shot clock back to
20 on one. Free throws are excluded on both sides (an and-one is
indistinguishable from the last of two). Out-of-range elapsed times are
DROPPED, not clamped — clamping would pile them onto "late" and manufacture
the finding. `dropped_rate` is reported per team.

**Why the clock model is trusted:** league eFG comes out .547 early, .520
middle, .483 late — monotonic, and never fitted for. The extremes are
credible too (Princeton and Iowa slow; Clemson forces opponents latest, at
.426 opponent eFG).
