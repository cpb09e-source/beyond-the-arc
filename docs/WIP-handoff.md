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

**PUSHING IS ALLOWED; BUILDING AND DEPLOYING ARE STILL HIS CALL.** Colin
lifted the push half on 2026-09-01 ("you can push"), then authorised one build
and deploy that same day ("build and deploy go ahead"). That authorisation was
for THAT deploy. Ask again before the next one.

**PRODUCTION IS CURRENT as of 2026-09-01 23:08 UTC** — deploy
`6a974a4a10f35a71b4b98c0b`, state `ready`, verified through
`netlify api listSiteDeploys` rather than the CLI's exit code. Everything
through commit `b688a7422e` is live: the live-season architecture, per-team
game files, the admin page and banner, the portalled dropdowns, the nav fix.

Numbers from that run, for the next estimate: build 32,868 pages; hashing
343,647 files and 9 functions; **322,726 files uploaded, 71 minutes**. The 45
minutes budgeted was low — a deploy that touches nearly every page dedupes
almost nothing (161,098 of 343,647 requested by the CDN).

Netlify's own auto-build fires on every push and fails with `Canceled build
due to no content change` at the "checking build content for changes" stage.
Those `error` rows in the deploy list are expected and publish nothing — the
pattern predates today. The `ready` rows are the manual CLI deploys.

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

**THE PIPELINE REQUIRES NODE 24 AND SILENTLY COULD NOT START ON 22.**
`nightly-refresh.mts` is `.mts` so Node treats it as ESM; package.json has no
`"type"` field so every `.ts` it imports transpiles as CommonJS. Node 22 cannot
see a named export across that boundary and dies before running a line:
`SyntaxError: The requested module '@/lib/seasons' does not provide an export
named 'LIVE_SEASON'` — an export that is plainly there at seasons.ts:83. Node
24 resolves it. The workflow pinned 22; every local run has been on 24, which
is exactly why a script that could never start in CI looked finished. Fixed
2026-09-02 after run 33656543383. Do not lower the pin.

`.github/workflows/nightly-refresh.yml` runs it at 11:00 UTC. **The workflow is
`disabled_manually`** — and disabling ALSO blocks `workflow_dispatch`, so it
cannot be run by hand either until `gh workflow enable`.

**IT IS TEN SECRETS, NOT EIGHT.** The eight listed here for weeks —
`CBBD_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_ARCHIVE_BUCKET` — were set 2026-09-02 and are correct as far as they go,
but the archive bucket has **its own credentials**: `R2_ARCHIVE_ACCESS_KEY_ID`
and `R2_ARCHIVE_SECRET_ACCESS_KEY`. Both are in `.env.local` and both were
missing from this list and from the workflow.

That split is deliberate. The archive bucket is private — no public access, no
r2.dev subdomain — and its token is scoped to that bucket alone, so it cannot
share the public data bucket's wide keys. See the header of
`scripts/backup-archive-to-r2.mjs`.

Found by the first real dispatch (run 33655219414). Everything up to it passed
— checkout, node, python, `npm ci`, the cache restore — which is the useful
half of the result: **the eight secrets inject correctly.** The cold-start seed
then died on `Missing from .env.local: R2_ARCHIVE_ACCESS_KEY_ID,
R2_ARCHIVE_SECRET_ACCESS_KEY`, because the workflow was handing that step the
PUBLIC bucket's keys, which the script never reads. The workflow is fixed; the
two secrets still need setting.

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

Layout, since the 2026-09-01 redesign: a left rail, a sticky bar, and ONE
PANE AT A TIME (`admin-shell.tsx`). The pane is the URL hash — `#overview`,
`#pipeline`, `#data`, `#checks`, `#subscribers`, `#banner`, `#transfers`, with
`#run`/`#history` aliased to `#pipeline` — read through `useSyncExternalStore`,
not an effect, so there is no wrong-pane flash and no set-state-in-effect. Back
works because navigation is `pushState`. Every rail item carries the health dot
its tile carries, so a pane you are not looking at can still raise its hand;
green and off draw NO dot on purpose.

Files: `admin-shell.tsx` frame · `admin-dashboard.tsx` everything read (hook,
tiles, sections) · `admin-client.tsx` gate, panes, run panel · `admin-panels.tsx`
banner + transfers.

EVERY TILE METER IS MEASURED. The strip under a tile's number is real data —
last 40 nights, one cell per check, one cell per commit waiting to deploy, the
monthly/yearly split, elapsed against the webhook's quiet window — and a tile
with nothing to measure gets no strip. Do not add a decorative one; a bar that
is not a measurement teaches the eye to skip the four that are.

What it does today (a dashboard since 2026-09-01, committed, NOT deployed —
Colin wants to test first): six tiles, each with its own source, each failing
on its own —

  - **Nightly pipeline** — `/data/live/refresh-status.json` + `refresh-history.json`
    on R2 (Actions' disk is ephemeral; `scripts/publish-run-record.mjs` uploads
    both after every run). Dry runs are shown but never count as "current".
  - **Data checks** — `/data/live/checks.json`, written by
    `scripts/check-live-data.mts` as the LAST publish step (after the R2 sync,
    so it can HEAD what it uploaded). Slate vs index, index vs yesterday, one
    team file per team, one live page per team, R2 has tonight's objects. A
    REPORT, not a gate: exit 0 on findings; `counts` in the file is what
    tomorrow compares against, read back from R2. `--no-upload` reads/writes
    the local file only; `--date YYYY-MM-DD` picks a slate.
  - **Site checks** — `src/components/admin/probes.ts`, the requests a reader
    makes, made from the admin's browser now. The paywall-leak probes are
    prodOnly (dev has the files in public/ legitimately).
  - **Subscribers** / **Stripe webhook** — `/api/admin-config?what=overview`;
    the webhook writes a heartbeat to `site_config.stripe_webhook`.

  - **CBBD quota** — `quota` inside `checks.json`. `scripts/lib/cbbd-meter.mjs`
    keeps a per-month count at `data/cbbd/.meter.json`, which the ingest adds
    to at the end of every run (including one that dies on a 429 — the calls
    were still spent). It lives inside the archive directory because that is
    what survives: Actions caches `data/cbbd` on a rolling key and the R2
    archive backup walks dotfiles too. THE NUMBER IS A FLOOR — `scoreboard.mts`
    and `game.mts` call CBBD live from the same quota and cannot write to it,
    and a lost cache resets the month. Set the repo VARIABLE
    `CBBD_MONTHLY_LIMIT` (a number, not a secret) to turn the count into a
    gauge that warns at 80% and fails at 100%; unset, the tile is grey and
    says so rather than inventing a ceiling the API never reports.
  - **Deploy** — `/build-info.json` (written into `out/` by
    `scripts/build-with-r2-stash.mjs`) plus GitHub's `compare` for how far main
    has moved. "Behind" is normal between deploys, not an alarm.

Plus the **site banner** editor and **manual transfers**, each its own pane.
The four Run buttons POST to `/api/dispatch-run` (`netlify/functions/dispatch-run.mts`,
`requireAdmin` + `GITHUB_DISPATCH_TOKEN`); the page reads run state straight
from api.github.com with no token, because the repo is public — 60 req/hr, so
it polls only while a run is going (`src/lib/github-runs.ts`). Still needed
from Colin: the PAT, and `gh workflow enable "Nightly refresh"` — GitHub
currently reports the workflow `disabled_manually`, which the panel says.

Dev gotcha: `NEXT_PUBLIC_DATA_BASE` is set locally, so the dashboard reads
`/data/live/*` from R2 even on :8899. To see a local report, route
`**/live/checks.json*` to `http://localhost:3000/data/live/checks.json` in
Playwright. Known quirk the checks surfaced: the frozen 2026 `games-*` archive
is short 28 games on 2026-03-07 and 24 on 03-08 (the box archive has them all,
and the index is built from box) — "more in the index than the slate" is fine.

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

**The presigned-R2 work — CODE DONE 2026-09-02, three manual steps left.**

The game-log corpora (`game-index/*.json` ~6.3 MB, `team-game-index/*.json`
~1.6 MB) are still on the PUBLIC bucket for every season including paid ones,
so the archive is still readable without an account until the steps below run.
The Game Log Explorer's five-row preview is a sign, not a door — the browser
already holds every row it declines to draw.

Built and committed:

  - `src/lib/gated-corpus.ts` — asks `/api/data-url` for a signature on a paid
    season, fetches the public object on a free one. Both loaders
    (`game-index.ts`, `team-game-index.ts`) now go through it.
  - `scripts/sync-gated-corpora.mjs` — `--push`, `--verify`,
    `--purge-public --yes`.
  - `verify-deploy-ready.mjs` — 4 new checks (25 → 29) that the signing client
    is actually in the build.
  - `netlify/functions/data-url.mts` was already written; unchanged.

**THE THREE STEPS, IN THIS ORDER. Getting it wrong breaks every game log in
production:**

  1. **Cloudflare dashboard.** Create an R2 bucket, e.g. `bta-gated`. Do NOT
     enable public access, an r2.dev subdomain or a custom domain — that is the
     entire gate, and a public bucket makes the presigning theatre. Add
     `R2_GATED_BUCKET=bta-gated` to `.env.local` AND to Netlify.
  2. **Deploy**, so the browser knows to ask for a signature, then
     `node scripts/sync-gated-corpora.mjs --push` and `--verify`.
  3. **Only then** `node scripts/sync-gated-corpora.mjs --purge-public --yes`.

Purge before the deploy and production 404s until the deploy lands. The script
refuses to delete a public object whose gated copy it cannot HEAD, which is the
one unrecoverable mistake available here — but it cannot protect you from the
ordering, so read the header before running it.

### CBBD_API_KEY — SUBSCRIPTION ACTIVE, KEY IS STALE. Needs replacing.

**The subscription is Tier 3: $10/month, 75,000 requests**, shared with CBBD's
football API, confirmed by Colin 2026-09-02. That number is the repo variable
`CBBD_MONTHLY_LIMIT`, which is what makes the admin quota tile a gauge rather
than a bare count.

**But the key in `.env.local` is dead.** Tested directly 2026-09-02:
`GET /teams?season=2021` returns `401 {"message":"Unauthorized"}` with no
`x-calllimit-remaining` header at all. The string is 152 chars starting `Tyfn`.

**Re-subscribing does not revive a revoked key.** CBBD revokes on lapse and
issues a NEW one, so an active Patreon membership and a working key are two
separate facts. This was assumed to be one fact for most of a day. **Action:
get the current key from collegebasketballdata.com and replace `CBBD_API_KEY`
in `.env.local`.** Nine scripts read it. It is also one of the eight GitHub
secrets, so set it there only after it is known good.

Why the 2026-09-01 evidence was misleading: the pull scripts "all exited 0"
during the accidental freeze crossing, which was read as the key working. It
was not — they exited 0 *while failing*, which is the bug fixed below.

**§7's 2021 backfill is still blocked, on the new key.** Everything else about
it is ready and the pull is under a hundred requests.

#### The pull scripts used to fail silently — fixed 2026-09-02

Found by running the 2021 backfill. `pull-player-box-v2.mjs` walked all 24
windows of the season, logged 24 identical 401s, then **wrote a 22-byte
`box-players-full.json.gz` containing `[]` and exited 0**, printing
`✓ 2021: 0 rows` and `✗ MISSING 10564 of 10564` on the same line. Any caller
reading `$?` would have seen success.

The empty file was the worse half. `[]` makes a season look pulled, and the
`already pulled (use --force to redo)` guard at the top of the season loop then
refuses to retry it.

`pull-team-box-v2.mjs` had the identical defect, and there it compounds: it
writes `box-teams-full.json.gz`, which is the expected-row set the PLAYER pull
checks itself against. An empty team box makes the player pull's completeness
verdict read `✓ complete vs team box (0)` and pass.

Both now: bail on the first 401/403 rather than grinding the season (1 API call
instead of 24), refuse to write an empty result, leave existing files untouched,
and set `process.exitCode = 1`. The player pull also exits 1 when its row-parity
check against the team box finds anything missing, which it previously only
printed. Verified against the live 401.

The other CBBD pulls (`pull-rankings`, `pull-adjusted-ratings`,
`pull-shooting-splits`, `pull-missing-plays`) do not special-case 401 either and
were not audited for the empty-write half. Worth a look before trusting an exit
code from any of them.

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

- **Lint is at 0 errors, 30 warnings** (2026-09-01). Three things got it
  there: `.netlify/**` is ignored (esbuild's function bundles were 24,048
  warnings of nobody's code, burying the real ones); five reset-derived-state
  effects became render-phase adjustments; ten genuine false positives carry a
  one-line disable with the reason. The 30 left are Netlify's required
  default-export shape (7), `<img>` in a static export (4) and unused locals in
  data scripts. Lint does NOT gate the build.
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
- **Every dropdown on the site is now the portalled listbox** — the native
  `<select>` is gone, including both game log explorers' View pickers. Three
  bugs came out of that work and are fixed: a 4px bleed above sticky section
  headings (`py-1` → `pb-1`, since a sticky offset resolves against the
  scrollport's PADDING edge), an 87px trigger opening a 588px panel
  (`width: max-content` is defeated by `w-full` children — the options are
  `min-w-full` now), and the scope bars' View select being `compact` while
  every field beside it was h-10.
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

**The strip lists were unified 2026-09-01, and they had drifted.**
`scripts/lib/out-strip-lists.mjs` is now the only copy of "what must not be in
`out/`"; `build-with-r2-stash.mjs`, `strip-r2-mirrored-from-out.mjs` and
`verify-deploy-ready.mjs` all import it. Before that the wrapper — the script
netlify.toml names, and the only one that runs on Netlify, because the npm
`postbuild` hook does not fire when it is invoked directly — was missing
`data/team-season-games` (4,631 files, 40 MB), `data/live` and
`data/team-splits` (~14 MB). The gate that exists to catch exactly this held a
third copy that was four dirs short, so it would have reported a pass.

The build is not the risk; the upload is. Sequence, when authorized:

1. `node scripts/build-with-r2-stash.mjs` — the entry point netlify.toml names.
   (`npm run build` runs the same strip via `postbuild`, but the wrapper is
   what has been proven on this project.)
2. `node scripts/verify-deploy-ready.mjs` — 25 checks, exits 1 on any
   failure, and it reads the strip list from the same module the strippers do.
   It replaces the by-hand confirmation this step used to describe.
3. `npm run sync:r2` — the new `team-season-games` and `live` dirs need it.
4. `netlify deploy --prod --dir=out --no-build`, run BACKGROUNDED.
5. `netlify api listSiteDeploys` until `ready`. NEVER trust the exit code.

Budget 45 minutes or more. Netlify dedupes by content hash, so a normal
incremental deploy runs under 2 min — but this one follows a redesign that
touched nearly every team page.

### 7. The COVID season's per-player game logs — LANDED 2026-09-02

2020-21 is FLAGGED, not excluded — see `FLAGGED_SEASONS` in
`src/lib/seasons.ts`. Team pages, the team explorer and the Team Game Log
Explorer carry it in full. Gonzaga's 31-1 has a page; so does Jalen Suggs.

What is missing: `data/cbbd/2021/` holds 3 files where every neighbouring
season holds 163. Absent are `box-players-full.json.gz` and ~157
`plays-*.json.gz`. So there are no per-player game logs for that season and no
`game-index/2021`, which is why `GAME_SEASONS` in `src/lib/game-index.ts` stops
at 2020 while `TEAM_GAME_SEASONS` does not.

**DONE. The pull ran 2026-09-02** once Colin replaced the dead CBBD key. It
was never a data problem — the archive pull worked first time on a valid key.

  - 10,564 team-game rows, **complete against the team box with 0 missing**
  - 81,312 player-game rows across 4,867 players, merged into the existing
    24,653 player files without touching the other twelve seasons
  - `game-index/2021.json` at 5.0 MB, verified same-shaped as 2022 (same 7
    keys, 22 fields, 6 classes) and synced to R2 (1 uploaded, 25 skipped)
  - `2021` added to `GAME_SEASONS`, which now matches `TEAM_GAME_SEASONS`
  - 46 API calls against a 75,000 monthly quota

**2021 is smaller than its neighbours and that is correct** — 81,312 rows and
493 distinct opponents against 2022's 111,582 and 680. Cancelled games and
gutted non-conference schedules. Do not read the gap as a short pull.

**NOT YET REBUILT, and this is the open half.** Ten scripts read
`box-players-full.json.gz` and only four have run. Still missing:
`public/data/porpag-2021.json` (the only gap in an otherwise complete 2014-2026
run) and `data/cbbd/2021/box-epm-2021.json`. The blockers are cost, not
correctness: `build-player-season-adv.mjs`, `build-player-stat-pack.mjs`,
`build-cbbd-player-season.mjs` and `build-team-season-stats.mjs` take **no
`--season` flag**, so each one rebuilds all thirteen seasons and churns the
twelve `built_at`-only porpag files. `compute-epm.py` is a Python refit on top.
Worth doing deliberately in one pass, not incidentally.

Historical detail, kept because it explains the years of delay:

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
