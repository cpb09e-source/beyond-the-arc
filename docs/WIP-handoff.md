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

The team page redesign landed. Six tabs — Overview, Roster, School History,
Shooting, Lineups, On/Off — with real routes on the recent seasons plus every
Vermont season, and an anchor fallback everywhere else.

### 1. Redesign the Shooting tab — AGREED, NOT STARTED

The one tab that was only relocated, never rethought. It is still the two
DistributionPanels (Shooting, Four Factors) plus the clock-splits and
assist-network panels that used to be a separate Play-by-play tab.

It is also where the new play-by-play columns belong and do not yet appear:
`rima`/`rimm`/`mida`/`midm` are in every lineup row, so rim rate, rim FG% and
mid-range splits are already computed per five-man unit and per player, and the
Shooting tab shows none of them.

### 2. Bake the remaining 367 teams for School History

`npx tsx scripts/build-team-seasons.mts` with no flags. Only Vermont is baked,
so every other team still renders the older SortableSeasonsTable. Nothing is
broken; the tab just does not gain the new grid until this runs.

DO NOT run it with `--team` and expect the benchmarks to survive. That flag
filters the accumulation, and a single-team run used to overwrite the season's
league percentile field with one team's units. Guarded now — a `--team` run
leaves benchmarks alone and says so — but the same shape of bug is easy to
reintroduce in any script that writes a shared artifact.

### 3. Measure a real production build

Every build and deploy number in this session was extrapolated from dev-server
renders, never a real build. What is known:

- team-ish pages went from 5,009 to roughly 14,000 (tab routes on the recent
  seasons plus all of Vermont)
- `public/data/lineup-stats/` is 29 MB across 2,008 files
- two hot reads were uncached and now are: `readAllTeams` (12 MB, 51 ms a call)
  and `readPlayersForYear` (~4 MB, 19 ms), together ~72 ms per team page

The first deploy after this is the risk, not the build. Run it BACKGROUNDED and
verify with `netlify api listSiteDeploys`; the 10-minute Bash timeout that
orphaned a deploy once will be much easier to hit now.

### 4. DESIGN.md is wrong about the accent colour

It documents `--coral` as `#c8553d`, "basketball-leather". globals.css line 21
says `--coral: #0c6bd6` — azure. So `text-coral` is the site's blue, and the
theme lifts it to `#4d9bff` where contrast needs it. Anything reading DESIGN.md
to pick a colour will pick the wrong one.

### 5. The on/off caveat is nowhere

The On/Off tab's footnote was removed on request. It was the only place saying
that an on/off split is not a rating of the player — it is what the team did
with him and without him, which also carries whoever replaced him and whoever
he shared the floor with. A collapsed `<details>` is the pattern the rest of
the site uses for methodology, if it should come back.

### 6. Smaller, carried over

- **Footer is 80rem**, team content is 88rem and the two data tabs are 96rem
  and 100rem. The footer reads inset on team pages.
- **`lineup-stats/` (29 MB) is an R2 candidate**, alongside the directories
  already mirrored there.
- **Three pre-existing lint errors** in `searchable-multi-select.tsx`
  (setState-in-effect at 75, 84, 127). Confirmed pre-existing, not introduced.
- **`useSearchParams` refactor** — `/` and `/players/` still ship zero `<tr>`
  and blank the table for 1-2s while JS boots.
- **`assist-network.json` is 12 MB and committed** — probably belongs in R2 like
  `assist-players/`.
- **Nine files still use fixed Tailwind palette colours** that cannot follow
  dark mode: `schedule-ticker`, `overview-tab`, `season-by-season-table`,
  `find-game-modal`, `where-they-rank`, `seed-chip` and three others.

### 7. Stripe — SET UP, NOT VERIFIED

Unchanged from before. Four env vars in Netlify, `STRIPE_SECRET_KEY` is
`sk_live_…`, and the products may have been created in TEST mode. Test-mode
price IDs do not work with a live key. Verify before any checkout is exercised.
`STRIPE_PRODUCT_ID`, `STRIPE_PRICE_3MONTH` and `STRIPE_PRICE_6MONTH` are still
read by nothing. Stripe keys are not flagged secret in Netlify and should be.

### 8. Enforcement layer — RESEARCH DONE, PLAN STILL OWED

Nothing gates anything. `describeMembership()` still has one consumer, the
account badge. The decisive constraint has not changed: prebuilt pages EMBED
old-season data in their HTML, so gating the JSON fetches would not hold.

The tab split makes option 3 more attractive than it was — gating by DEPTH
rather than by SEASON is now a routing decision, and the deep tabs (Lineups,
On/Off, School History) are exactly the surfaces nobody needs indexed.

## Things learned the hard way — do not re-derive these

**The CBBD plays endpoint buckets by UTC, so 21.3% of games appear in TWO
daily files.** Measured on 2026: 1,337 of 6,263. Any builder that walks
`plays-*.json.gz` must dedupe by gameId or every count from that fifth is
doubled. `cbbd-build-stints.mjs` always did; `build-assist-network.mjs` and
`build-clock-splits.mjs` did not, and shipped inflated for a long time. Rates
survive it only partly — each game's own numerator and denominator double
together, but a season rate is a weighted average and the duplicated games
carry double weight in it. About 1% on Vermont's early-clock eFG.

**Turnovers do NOT undercount in the play-by-play.** `Lost Ball Turnover` is
CBBD's single catch-all; there is no separate travel or offensive-foul type.
With dedup it matches the box score 99.8% exactly. Do not go looking for
missing turnover types — the discrepancy was always the duplicate games.

**`onFloor` is on EVERY play from 2024 and on NONE before it.** 100% coverage
in 2024-26, 0.0% in 2022 and 2023. That single field is why lineups, combos and
on/off exist at all, and why they stop at 2024. Both those seasons produce zero
valid stints; there is nothing to salvage without a different source.

**A translucent background on a sticky cell lets the scrolled columns show
through it.** Highlight rows must MIX the accent against the opaque surface
(`color-mix(in oklab, accent 10%, var(--card))`), never lay it over at 8%
alpha. Hit twice now: the explorer's honour cells first, then the Totals row in
the lineup grid and the current-season row in School History.

**Tailwind Preflight resets `text-transform: none` on `button`.** A `<th>` with
`uppercase` whose label sits inside a button renders mixed-case. Anchors are
unaffected, which is why the explorer's sortable headers never showed it. Repeat
`uppercase` on the button.

**A JSX comment cannot sit inside `{cond && (` before the element.** It has to
go above the guard. Costs a parse error that reads as an unclosed tag.

**Percentiles must be ranked against a distribution of the SAME KIND of
number.** An on/off difference is not a rating: a +7 net rating is a good
lineup, a +7 net swing is enormous. `lineup-stats` ships two distributions,
`q` for values and `qd` for differences, and `percentileOf` takes which one.

**Counting stats cannot be ranked across aggregation levels.** +/- and GP scale
with playing time, so a 3-man combo pools several lineups and chips at 100 on
every row. Rank the per-100 form instead, and suppress GP on any pooled row —
it counts unit-games and read 573 for a team that played 34.

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
