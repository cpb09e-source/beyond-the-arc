# Where we are — handoff

Written 2026-08-25, last updated **2026-09-01**. Read this first after a `/clear`.
Everything below is state that lives nowhere else: decisions made in
conversation, findings from investigation, and constraints that are not
derivable from the code.

Delete sections as they land. Keep the constraints.

**2026-09-01 was a large session — 21 commits.** The site's architecture changed
in one important way: the season being played is no longer prebuilt. Read
"The live season is data" below before touching anything under `/teams`.

---

## Standing constraints — these override any instinct to be helpful

**PUSHING IS NOW ALLOWED; BUILDING AND DEPLOYING ARE NOT.** The old rule was
"no push, no build, no deploy". Colin lifted the push half on 2026-09-01 ("you
can push") and 50 commits went up. Build and deploy still have not been run
this session and remain his call. Ask before either.

**PRODUCTION IS OLD.** The last deploy is 2026-08-31. Every commit after it —
the live-season architecture, per-team game files, the admin page, the site
banner — exists only in git. Do not describe any of it as live.

**Never commit these stray untracked files.** They sit in the tree
permanently and are not part of the project:
`deno.lock`, `has_about.html`, `he_blog.html`, `public/images/Untitled-4.ai`,
`public/images/newbtalogo-01.svg`.

**12 `porpag-*.json` files are `built_at`-only churn.** They dirty on nearly
every script run. Check the diff and `git checkout --` them before committing.

**Data freeze until 2026-10-01** — but read the next paragraph, because the
guard is not where it looks like it is.

**THE INGEST SCRIPTS DO NOT GUARD THE FREEZE THEMSELVES.** `assertUnfrozen`
lives in `daily-refresh.mjs`, `build-season-preview.mjs` and (since
2026-09-01) `nightly-refresh.mts`. It is in NONE of `cbbd-ingest.mjs`,
`pull-team-box-v2.mjs`, `pull-player-box-v2.mjs`, `pull-rankings.mjs`,
`pull-adjusted-ratings.mjs`, `pull-shooting-splits.mjs` or `sync-bart.mts`.
Running any of them directly pulls live data mid-freeze. Found the bad way on
2026-09-01: a wrapper was assumed to be guarded because the scripts under it
looked like they would be, and the run pulled Bart's 2027 feed and upserted 365
teams and 4,965 players into Supabase. Damage was limited — 2027 is the living
preview season, not the frozen archive, and the tree stayed clean — but this is
the second recurrence of the same mistake. Escape hatch is still
`BTA_ALLOW_NETWORK=1`.

**Deploy, when authorized:** `netlify deploy --prod --dir=out --no-build`,
run BACKGROUNDED. A 10-minute Bash timeout once killed the CLI mid-upload and
orphaned a deploy stuck at `uploading`. Verify with
`netlify api listSiteDeploys` showing `ready` — never trust the exit code.

**Secrets never enter the transcript.** Check key shapes only (`sk_live`,
`whsec_`, `price_`). Netlify masks secret-flagged vars as `************`;
that is NOT the same as the variable being missing.

**Screenshots must be under 2000px on the long edge** or the API cannot read
them. Ask for a resize rather than guessing at what an image shows.

---

## Open work

### THE LIVE SEASON IS DATA, NOT A REBUILD — the 2026-09-01 change

The problem it solves: publishing a night's numbers used to mean an 8-minute
build and an upload of 319,000 files. Right for an archive, absurd for a season
being played.

**`LIVE_SEASON` in `src/lib/seasons.ts` is `null` today.** When 2026-27 tips
off it becomes `2027`. That one line is the switch, and NOTHING nightly does
anything until it is set — the pipeline exits 1 saying there is no season.

How it works: a team page for `LIVE_SEASON` renders `LiveTeamPage`, which
fetches `/data/live/team/<slug>.json` (~132 KB) and renders the SAME
`TeamPageView` the frozen routes use. That works because `TeamPageView` carries
no `"use client"` directive, which makes it a *shared* component — server in
the server routes, client in the live one. The archive pays no bundle cost and
there is no second renderer to drift. Full argument in
`src/lib/live-team-page.ts`.

The page still ships the last build's numbers as HTML and passes them down as
the fallback, so it is not a spinner, Google still gets a complete page, and a
failed fetch keeps real numbers and says so.

Built by `scripts/build-live-team-pages.mts`, which verifies its own codec on
every team — decode the JSON again and deep-compare. That caught a real
discrepancy on its first run.

**Not yet done: player pages.** They are still baked, and this is the gap that
will show. A player page is a CAREER page — the live season is one row inside a
mostly-frozen page — so the team trick does not transfer, and the route is 384
lines of inline loads with no `loadPlayerPageData` to swap. The design is an
overlay that patches just the live row, leaving the frozen ones baked. The
forcing function is consistency: Duke's roster row will be live and Cooper
Flagg's career table will not.

### THE NIGHTLY PIPELINE — built, on GitHub, currently OFF

`scripts/nightly-refresh.mts` is `daily-refresh.mjs`'s documented in-season
chain, wired, minus its last two steps (the build and the deploy — no longer
needed). Phases: `ingest` (network, freeze-guarded), `derive` (local),
`publish` (writes the files, then syncs R2), and `rollback`.

`sync-bart` was moved from the documented publish step into ingest: it fetches
barttorvik.com, and a pull inside publish would cost that phase the one
property it exists to have.

`.github/workflows/nightly-refresh.yml` runs it at 11:00 UTC. **The workflow is
`disabled_manually`** — and disabling ALSO blocks `workflow_dispatch`, so it
cannot be run by hand either until `gh workflow enable`.

**Before it can run:** eight repository secrets (`CBBD_API_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ARCHIVE_BUCKET`).
All eight are in `.env.local` and can be piped to `gh secret set` without being
typed or shown.

Triggers are limited to `schedule` and `workflow_dispatch` deliberately: the
repo is PUBLIC, and a workflow that runs on a fork's PR is how secrets leak.
Public also means Actions minutes are free and unlimited.

The 907 MB CBBD archive rides in the Actions cache keyed by run id so it rolls
forward, seeded from R2 on a cold start. **That cold start is proven** — the
archive backup verified 2026-09-01 at 2,106 files / 945.3 MB / 0 missing.

**Rollback** is `scripts/r2-snapshot.mjs`: one generation under `_prev/`,
server-side copies, snapshotted BEFORE each publish (taken after, "previous"
would mean the run that just happened, and rolling back a bad night would
restore it). It refuses when there is no snapshot rather than reporting success
for restoring nothing.

### THE ADMIN PAGE — `/admin`, behind `role = 'admin'`

Reachable from `/account` (a staff card), deliberately not in the nav — the
header's width budget is argued over in `account-nav.tsx`.

Both `cpb09e@gmail.com` and `test@test.com` are `role = 'admin'`. Note that
makes the test account no longer a clean free-tier test.

The page's own role check is PRESENTATION — a static export ships its JS to
everyone. The real boundary is `requireAdmin` in `netlify/shared/billing.mts`,
which every write goes through. Nothing on the page decides anything.

What it does today: shows the last pipeline run from
`/data/live/refresh-status.json`; edits the **site banner**; adds, withdraws
and restores **manual transfers**. The four Run buttons are STUBS — there is no
dispatch endpoint yet, and they need a GitHub PAT plus the workflow re-enabled.

`supabase/migrations/011_admin_control.sql` is APPLIED. Verify any time with
`npm run verify:admin` — 7 checks, including that anon cannot read
`manual_transfers`, tested against a deliberately seeded row because an empty
table passes that check for the wrong reason.

**The banner is in Supabase, not R2**, because R2 serves an hour of cache and
an announcement nobody sees for an hour is not an announcement. Its look lives
in `BannerView`, shared with the admin preview so the preview cannot drift.

**The manual transfer list is now ONE table**, read by both
`patch-preview-manual-transfers.mjs` and `patch-portal-manual.mts` through
`scripts/lib/manual-transfers.mjs`. 213 lines of duplicated literal deleted.
The reader THROWS if it cannot reach the table — an empty list would run to
completion and publish 53 players at the schools they left.
`scripts/seed-manual-transfers.mjs` carries the original 53 moves as a frozen
fixture, for bootstrapping a fresh environment or restoring the table.

**An admin change does NOT appear instantly.** The patchers rewrite
`season-preview.json` (fetched at runtime → live after a file upload) and
`portal.json` (read with `fs.readFile` at BUILD time → needs a rebuild). So a
transfer reaches team previews quickly and the portal page only after a build.

**The paywall line cannot be made runtime-controllable** without the
presigned-URL work. `stage-gated-data.mjs` reads `FREE_SEASONS` at build time
and physically moves gated corpora into the function bundle; the wall is
enforced by where files sit, so a runtime toggle would only make the client
disagree with the filesystem. Checked 2026-09-01 before promising it.

### PER-TEAM GAME FILES — landed 2026-09-01

A team page's Game Log used to download the whole season's 1.6 MB corpus to
draw ~30 rows, because the percentile chips are ranked against every game in
the season and a client holding one team cannot compute that.
`scripts/build-team-season-games.mts` splits each season into one ~9 KB file
per team with the ranking already done, over the same cohort. 4,631 files,
40 MB, gitignored, R2-mirrored.

It imports `TEAM_GAME_STATS` and `midrankPercentileMap` from `src/` rather than
restating 45 column formulas, so the two paths cannot drift.

This also closed a real paywall hole: team pages are free at every season, so a
free 2019 team page was fetching the whole gated 2019 corpus.

A miss falls back to the season file, so it is safe to deploy in either order
relative to the R2 sync.

### THE PAYWALL IS ON — and it covers the EXPLORERS ONLY

Deployed 2026-08-31. `FREE_SEASONS = [2026, 2025]` in `src/lib/access.ts`;
2013-14 through 2023-24 are paid. Entity pages (team, player, coach) are free
at every season by decision — a gate on team pages shipped in that deploy and
was reverted within the hour, because a static export gates subscribers too.
See the note at the top of §1 in `src/lib/access.ts`.

Still leaking deliberately: player and coach pages embed old-season rows in
their HTML and always will. A career table is the entire point of the page, and
the archive's value is cross-sectional, which is gated.

**Still owed: the presigned-R2 work.** The game-log corpora
(`game-index/*.json` at ~6.3 MB, `team-game-index/*.json` at ~1.6 MB) are on
the PUBLIC bucket for every season including paid ones.
`netlify/functions/data-url.mts` is the signing endpoint — built, not live.
Remaining: create the private bucket, route paid-season files there, delete
them from the public bucket, switch the client path, extend
`verify-deploy-ready.mjs`. **Ordering: the client must deploy BEFORE the
objects move**, or production's game logs break.

### CBBD_API_KEY — status uncertain, probably fixed

Recorded 2026-08-30 as returning 401 on every endpoint; Colin said he would
sort the subscription. During the accidental freeze crossing on 2026-09-01 the
CBBD pull scripts all exited 0, which suggests the key works again. Not
confirmed deliberately. Nine scripts read it.

Also settled 2026-08-30: **CBBD has no women's basketball.** `?gender=women`,
`?league=womens` and `?division=women` are all silently ignored (identical 364
men's teams returned). Women's coverage needs a different source entirely.

### 1. Redesign the Shooting tab — AGREED, NOT STARTED

The one tab only relocated, never rethought. It is where the new play-by-play
columns belong and do not yet appear: `rima`/`rimm`/`mida`/`midm` are in every
lineup row, so rim rate, rim FG% and mid-range splits are already computed per
five-man unit and per player, and the Shooting tab shows none of them.

### 2. Build measured — DEPLOY is the risk, not the build

Measured 2026-08-25 with `npm run build`, after the full bake:

```
build time      8m 12s
HTML pages      30,649
files in out/   319,479
out/ size       11.34 GB
```

**The 60-75 minute estimate given earlier was wrong by roughly 8x.** It came
from extrapolating dev-server render times (~125 ms/page), which do not
resemble build-time prerendering at all — dev compiles per request and caches
nothing. Never estimate a build from dev renders again.

The `.txt` RSC payloads (267,975 files, 5.73 GB) are LOAD-BEARING — see the
May 2026 infinite-404 incident. Do not strip them.

### 3. Smaller, carried over

- **`npx eslint src scripts` reports 19 errors and 23 warnings**, measured
  2026-09-01. An earlier note said 45/60; that was stale. Nearly all are
  `react-hooks/set-state-in-effect`, all pre-existing. Lint does NOT gate the
  build.
- **The `useSearchParams` refactor for `/` and `/players/` is DONE.** An
  earlier note said both shipped zero `<tr>`; measured 2026-09-01 they ship 128
  and 29 real rows, rendered by `TablePreview` as the Suspense fallback. What
  DOES still ship header-only markup is the two game log explorers —
  `/teams/games/` and `/players/games/`, 2 `<tr>` each — which have no
  TablePreview equivalent.
- **`assist-network.json` is 12 MB and committed** — probably belongs in R2
  like `assist-players/`.
- **The fixed-Tailwind-palette item is DONE.** An earlier note claimed nine
  files still used palette colours that cannot follow dark mode; zero remain.
- **The View dropdowns in both game log explorers are still native
  `<select>`s** and draw the OS panel on dark. Same fix the teammate picker
  got: `usePopoverAnchor` + a portal.
- **`stat-picker`, `download-menu` and `saved-filters-menu`** each hand-rolled
  the popover arithmetic before `usePopoverAnchor` existed. Cleanup, not a bug.
- **The Find-a-game button is hidden** on team pages pending a decision.

### 4. Stripe — VERIFIED WORKING 2026-08-25

`STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_PRICE_MONTHLY` ($8/month) and
`STRIPE_PRICE_YEARLY` ($50/year) all resolve against the LIVE key, so they are
live-mode prices. `PAID_PLANS` in `netlify/shared/billing.mts` maps
`monthly`/`yearly` to those two var names and nothing else.

Test-mode and live-mode price ids are both `price_…` and the same length, so
SHAPE CANNOT TELL THEM APART. A 404 from the live key is the only real test.

All four are flagged secret, which **EMPTIES the `dev` context** — Netlify
refuses to hand secrets to local dev, so local checkout is broken by design and
returns a clear 503 from `getStripe()`'s shape check. To restore it, put
TEST-mode keys in `.env.local`. Never the live key: a local dev server pointed
at live Stripe creates real checkout sessions.

Flagging a var secret makes it unreadable by CLI, including to you. If the live
key is ever needed again it comes from the Stripe dashboard, not from Netlify.

**Functions are served on custom paths.** Every one declares
`export const config = { path: "/api/<name>" }`, so `/.netlify/functions/<name>`
404s. Hit `/api/create-checkout-session`.

### 5. Canonical host — DONE, LIVE (verified 2026-08-30)

`https://btacbb.xyz/robots.txt` says `Host: https://btacbb.xyz`, and
`beyond-the-arc.netlify.app` answers **301 → btacbb.xyz**. Nothing left to do.

`NEXT_PUBLIC_SITE_URL` is in `.env.local` — it must be, because the first three
consumers (`layout.tsx` metadataBase, `robots.ts`, `sitemap.ts`) are BUILD-time
and builds run locally. Setting it only in the Netlify dashboard would have
fixed nothing about the sitemap. `netlify.toml` also carries a `force = true`
301 from the subdomain; `force` is required, because a redirect without it
loses to an existing file and every matching path exists in the export.

### 6. The production deploy itself

The build is not the risk; the upload is. Sequence, when authorized:

1. `node scripts/build-with-r2-stash.mjs` — the entry point netlify.toml names.
   (`npm run build` runs the same strip via `postbuild`, but the wrapper is
   what has been proven on this project.)
2. Confirm the strip: `out/data/lineup-stats`, `out/data/team-seasons`,
   `out/data/team-season-games` and `out/data/live` must NOT exist, alongside
   the older R2 dirs. `head -8 out/robots.txt` should say `btacbb.xyz`.
3. `npm run sync:r2` — the new `team-season-games` and `live` dirs need it.
4. `netlify deploy --prod --dir=out --no-build`, run BACKGROUNDED.
5. `netlify api listSiteDeploys` until `ready`. NEVER trust the exit code.

Budget 45 minutes or more. Netlify dedupes by content hash, so a normal
incremental deploy runs under 2 min — but this one follows a redesign that
touched nearly every team page.

### 7. The COVID season's per-player game logs — BLOCKED ON THE KEY ONLY

2020-21 is FLAGGED, not excluded — see `FLAGGED_SEASONS` in
`src/lib/seasons.ts`. Team pages, the team explorer and the Team Game Log
Explorer carry it in full. Gonzaga's 31-1 has a page; so does Jalen Suggs.

What is missing: `data/cbbd/2021/` holds 3 files where every neighbouring
season holds 163. Absent are `box-players-full.json.gz` and ~157
`plays-*.json.gz`. So there are no per-player game logs for that season and no
`game-index/2021`, which is why `GAME_SEASONS` in `src/lib/game-index.ts` stops
at 2020 while `TEAM_GAME_SEASONS` does not.

**No local workaround exists.** Checked 2026-08-31 and do not re-check:
`shooting-players.json.gz` is season-level per player, `box-epm-2021.json` is
model output, and `build-player-games-cbbd.mjs` reads
`box-players-full.json.gz` and nothing else.

The chain, verified step by step — only step 1 is blocked:

```bash
node scripts/pull-player-box-v2.mjs      --season 2021   # needs a live key
node scripts/build-player-games-cbbd.mjs --season 2021
node scripts/build-game-index.mjs        --season 2021
node scripts/sync-data-to-r2.mjs --only game-index
```

Then one line: add `2021` to `GAME_SEASONS`, where the doc comment already says
it is waiting for exactly this.

`build-player-games-cbbd.mjs --season 2021` **merges** — it reads each existing
player file, drops that season's rows and appends the new ones, so it will not
clobber the other twelve seasons across 24,653 files. Both builders accept
`--season`, so no `SEASONS` constant needs editing.

The pull is small: 2021 ran 2020-11-25 to 2021-04-05, **124 distinct game
days**, 8,243 team-game rows. A couple of minutes, well under a hundred
requests. The same file also unblocks `porpag-2021`.

Still out of reach after that: shot charts, lineups, on/off, assist networks,
clock splits. Those need the ~157 `plays-*.json.gz` day files via
`pull-missing-plays.mjs` — a separate and much larger pull. The pages already
degrade honestly ("No lineup data for 20-21"), so this is a gap, not a bug.

If the key is a dead end, the fallback is an ESPN backfill for 2021 player box
scores — parity exists (see `docs/womens-basketball-feasibility.md`) but it
means a new scraper plus a name-matching join onto Bart IDs. Do not start that
without Colin saying so.

---

## Things learned the hard way — do not re-derive these

**A production build clobbers a RUNNING dev server.** `next build` writes to
`.next/`, which `next dev` is reading from. After the 2026-08-25 build the dev
server still held ports 3000, 8899 and 9999 but served NOTHING — every route
timed out at 90 seconds with a zero-byte body. A port check says "up"; only a
real request says "serving". Kill the tree and restart:
`taskkill /PID <npm run dev pid> /F /T` takes all six processes with it.

**`next build` SURVIVES its parent dying; the wrapper does not.** A build
launched through `scripts/build-with-r2-stash.mjs` was orphaned when the
controlling process exited. The `next build` child kept running to completion
on its own, but the wrapper and the npm lifecycle runner were both gone — so
NEITHER the wrapper's own strip NOR the `postbuild` hook fired. The export
finished looking healthy while carrying ~90 MB that should have been removed.

After any interrupted build, check for a live `next build` before starting
another one — a second build would clear `out/` from under the first:

```sh
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*next*build*' }
```

If it is still running, wait for it and then run the strips BY HAND. There are
TWO lists and `strip-r2-mirrored-from-out.mjs` only covers one of them:

```sh
node scripts/strip-r2-mirrored-from-out.mjs   # the 11 R2-mirrored dirs
rm -rf out/data/players-by-year               # BUILD_ONLY_DIRS, wrapper-only, 50 MB
```

`public/data/players-by-year` must SURVIVE — 19 pipeline scripts and
`readPlayersForYear()` read it off disk. Only the `out/` copy goes.

**A build's `out/` is destroyed the moment the next build starts.** Next clears
the export directory before writing. An interrupted build therefore leaves NO
deployable artifact — not the new one and not the previous one. Do not treat a
half-populated `out/` as a fallback.

**Never pipe a long build through `tail`.** `tail` buffers everything until the
process exits, so a killed build leaves a ZERO-BYTE log and no clue how far it
got. Redirect straight to the file instead.

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

**Tailwind v4 compiles `rotate-90` to the standalone `rotate` property, not
`transform`.** `getComputedStyle(el).transform` reports `"none"` for an element
that is visibly rotated; read `.rotate` instead. This nearly got a working
caret reported as broken.

**Disabling a GitHub workflow blocks `workflow_dispatch` too.** `gh workflow
disable` stops every trigger, not just the schedule — `gh workflow run`
afterwards answers "could not find any workflows named …". There is no way to
hold the cron while keeping manual runs with a plain disable; that needs a gate
job inside the workflow.

**A Supabase session lives in localStorage, not cookies.** `context.clearCookies()`
does not sign a test browser out. Clear `localStorage` and `sessionStorage`.

**PostgREST returns an empty set, not an error, when RLS denies a read.** So
"zero rows" and "no access" are indistinguishable unless there is a row that
should have come back. Any test that RLS is protecting a table must seed a row
with the service key first, or it passes for the wrong reason on an empty
table — which is its state on exactly the day someone runs the test.

**`season-preview.json` is fetched at runtime; `portal.json` is read at build
time.** `season-preview.tsx` does `fetch("/data/season-preview.json")`, while
`app/portal/page.tsx` does `fs.readFile`. So a manual transfer reaches team
preview pages with a file upload and the portal page only after a rebuild. Two
files, same patch script, different publishing costs.

**A component with no `"use client"` directive is SHARED, not server-only.**
Imported from a Server Component it renders on the server; imported from a
Client Component the bundler compiles a client copy. That is what lets
`TeamPageView` serve both the frozen routes and `LiveTeamPage` with no second
renderer and no bundle cost to the archive. Next's `use-client` docs are
explicit that the directive is only needed on entry points from a Server
Component.

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
