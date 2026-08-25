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

### 2. Build measured — DEPLOY is the risk, not the build

Measured 2026-08-25 with `npm run build` on this machine, after the full bake:

```
build time      8m 12s
HTML pages      30,649
files in out/   319,479
out/ size       11.34 GB
```

**The 60-75 minute estimate given earlier in that session was wrong by roughly
8x.** It came from extrapolating dev-server render times (~125 ms/page), which
do not resemble build-time prerendering at all — dev compiles per request and
caches nothing between them. Never estimate a build from dev renders again;
the documented expectation of ~7 min was right and 8m12s is consistent with it.

Where the size goes:

```
.txt   267,975 files   5.73 GB   RSC payloads, ~8 per route
.html   30,649 files   5.03 GB   ~164 KB average
.webp   20,198 files   0.29 GB
teams/  149,763 files  5.85 GB
players/141,488 files  4.75 GB
```

The `.txt` files are LOAD-BEARING — see the standing note about the May 2026
infinite-404 incident. Do not strip them.

**What actually changed:** file count went from ~215k to 319k. The deploy memory
records ~30 min for the first upload of 215k files after a clean CDN cache, with
Netlify deduping by content hash so later deploys push only what changed
(typically under 2 min). Most team pages changed here, so the next deploy is
closer to a first deploy than an incremental one — budget 45 min or more, run it
BACKGROUNDED, and verify with `netlify api listSiteDeploys` rather than the exit
code.

Note the measured build used `npm run build`, not the documented production
entry point `node scripts/build-with-r2-stash.mjs`. The wrapper additionally
strips `data/players-by-year` (48 MB), so a production build is marginally
smaller than the number above.

### 3. Smaller, carried over

- **`npx eslint src scripts` reports 45 errors and 60 warnings**, measured
  2026-08-25. Nearly all are `react-hooks/set-state-in-effect`, spread across
  `searchable-multi-select.tsx`, `theme-toggle.tsx` and others. All
  pre-existing. Lint does NOT gate the build — `next build` passes — so this is
  cleanup, not a deploy blocker.
- **`useSearchParams` refactor** — `/` and `/players/` still ship zero `<tr>`
  and blank the table for 1-2s while JS boots.
- **`assist-network.json` is 12 MB and committed** — probably belongs in R2 like
  `assist-players/`.
- **Nine files still use fixed Tailwind palette colours** that cannot follow
  dark mode: `schedule-ticker`, `overview-tab`, `season-by-season-table`,
  `find-game-modal`, `where-they-rank`, `seed-chip` and three others.

### 4. Stripe — VERIFIED WORKING 2026-08-25

Previously recorded here as "set up, not verified", with a guess that the
products were made in TEST mode and a list of env vars (`STRIPE_PRODUCT_ID`,
`STRIPE_PRICE_3MONTH`, `STRIPE_PRICE_6MONTH`) that DO NOT EXIST. That whole
section was wrong. Measured against the live API:

```
STRIPE_SECRET_KEY      sk_live_…  (107 chars)
STRIPE_PRICE_MONTHLY   price_…    GET /v1/prices/{id}  ->  200   livemode  $8/month
STRIPE_PRICE_YEARLY    price_…    GET /v1/prices/{id}  ->  200   livemode  $50/year
```

Both price ids resolve against the LIVE key, so they are live-mode prices, and
the amounts match the copy in `account-client.tsx` exactly. `PAID_PLANS` in
`netlify/shared/billing.mts` maps `monthly`/`yearly` to those two var names and
nothing else. Checkout is reachable in production: `/pricing` is in MOBILE_NAV,
which routes to `/account` and its "Continue to payment" button.

Verify without printing secrets — read the values into shell vars, print only
prefixes and lengths, and let curl report the status code:

```sh
KEY=$(netlify env:get STRIPE_SECRET_KEY --context production | tr -d '\r\n ')
PM=$(netlify env:get STRIPE_PRICE_MONTHLY --context production | tr -d '\r\n ')
curl -s -o /dev/null -w "%{http_code}\n" -u "$KEY:" https://api.stripe.com/v1/prices/$PM
```

Test-mode and live-mode price ids are both `price_…` and the same length, so
SHAPE CANNOT TELL THEM APART. A 404 from the live key is the only real test.

**All four are now flagged secret** (2026-08-25). Use
`netlify env:set <KEY> --secret --force` — it converts an EXISTING variable in
place and needs no value argument, so there is no read-back-and-rewrite step to
corrupt. Verified through the API rather than the CLI, because the CLI masks
secrets and a masked read cannot distinguish "set" from "wiped":

```sh
TOKEN=$(node -e "const c=require(process.env.APPDATA+'/netlify/Config/config.json');\
const u=c.users;process.stdout.write(u[Object.keys(u)[0]].auth.token)")
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.netlify.com/api/v1/accounts/cpb09e/env?site_id=$SITE_ID"
```

That returns `is_secret` plus a per-context list of which contexts hold a
value. Note every secret's value reads as 20 characters there regardless of its
real length — that is the mask, not the value.

**Flagging EMPTIES the `dev` context.** Netlify refuses to hand secrets to
local dev, so all four now read `dev:EMPTY` while `production`,
`deploy-preview`, `branch-deploy` and `dev-server` keep their values. `.env.local`
already carries `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`, but NOT
`STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` — so `npm run dev` can no longer
exercise checkout. Add TEST-mode values for those two to `.env.local` if that
matters; do not put the live key there.


### 5. Canonical host — FIXED AND BUILT, NOT YET DEPLOYED

Found 2026-08-25 while checking `NEXT_PUBLIC_SITE_URL`. The variable was not
set anywhere, and the fallback is NOT the real domain:

```
src/app/layout.tsx:61   metadataBase  ->  https://beyond-the-arc.netlify.app
src/app/robots.ts:6     Host, Sitemap ->  https://beyond-the-arc.netlify.app
src/app/sitemap.ts:23   every <loc>   ->  https://beyond-the-arc.netlify.app
netlify/shared/billing.mts:102  Stripe return URLs (runtime, req origin)
```

The site's actual custom domain is `btacbb.xyz`. Both hosts answered HTTP 200
with no redirect between them, so all 30,000 pages were live and indexable
twice, and the live `robots.txt` was naming the WRONG one as `Host`.

Three parts, two of them done:

1. `.env.local` now sets `NEXT_PUBLIC_SITE_URL=https://btacbb.xyz`. This is the
   one that matters most and the one easiest to get wrong: the first three
   consumers are BUILD-time, builds run LOCALLY, and a local build does not
   read the Netlify dashboard. Setting it only in Netlify would have fixed
   nothing about the sitemap.
2. `netlify.toml` gained a `force = true` 301 from the subdomain to the custom
   domain. `force` is required — a redirect without it loses to an existing
   file, and every matching path exists in the export.
3. Netlify also has the variable now, for `siteOrigin()` in the functions.

Rebuilt 2026-08-25 and verified in `out/`:

```
robots.txt   Host: https://btacbb.xyz   Sitemap: https://btacbb.xyz/sitemap.xml
sitemap.xml  40,022 <loc> on btacbb.xyz,  0 on beyond-the-arc.netlify.app
og:url       https://btacbb.xyz/teams/vermont/2026/   (deep pages too)
```

**Still not live** — it takes the deploy. The 301 in netlify.toml also only
takes effect once deployed, so until then both hosts keep answering 200.

### 6. Enforcement layer — RESEARCH DONE, PLAN STILL OWED

Nothing gates anything. `describeMembership()` still has one consumer, the
account badge. The decisive constraint has not changed: prebuilt pages EMBED
old-season data in their HTML, so gating the JSON fetches would not hold.

The tab split makes option 3 more attractive than it was — gating by DEPTH
rather than by SEASON is now a routing decision, and the deep tabs (Lineups,
On/Off, School History) are exactly the surfaces nobody needs indexed.

### 7. The production deploy itself

The build is not the risk; the upload is. Sequence, when authorized:

0. `out/` was rebuilt 2026-08-25 after the canonical-host fix and is current.
   Rebuild anyway if anything in `src/`, `public/data/` or `.env.local` has
   changed since.
1. `node scripts/build-with-r2-stash.mjs` — the entry point netlify.toml names.
   The 8m12s measurement used `npm run build` instead. Same strip runs either
   way (`postbuild` fires it), but the wrapper does it inside the build's own
   Node process, and the wrapper is what has been proven on this project.
2. Confirm the strip: `out/data/lineup-stats` and `out/data/team-seasons` must
   NOT exist, alongside the nine older R2 dirs. Confirm the host too —
   `head -8 out/robots.txt` should say `btacbb.xyz`, not the netlify.app one.
3. `netlify deploy --prod --dir=out --no-build`, run BACKGROUNDED. A 10-minute
   Bash timeout once killed the CLI mid-upload and orphaned a deploy stuck at
   `uploading`.
4. `netlify api listSiteDeploys` until `ready`. NEVER trust the exit code.

Budget 45 minutes or more. File count went ~215k -> 319,479. Netlify dedupes by
content hash, so a normal incremental deploy runs under 2 min, but nearly every
team page changed in this redesign — this one behaves like a first deploy.

## Things learned the hard way — do not re-derive these

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
