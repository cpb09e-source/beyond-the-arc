# Legal / sources: status and open questions

First written 2026-09-02. **Re-audited and rewritten 2026-09-13.**

**This is a draft, not legal advice, and it was not written by a lawyer.** The
`/sources`, `/terms` and `/privacy` pages are drafts prepared by reading the
code. This document separates what is settled from what needs a human decision
or a lawyer, so a lawyer can be pointed at the short list rather than the whole
site.

---

## 0. Where the pages stand

- The 2026-09-02 versions are **live**: both production deploys since
  (`6fde38a1d8`, `d6289d4cf2`) contain the commits that added them.
- The 2026-09-13 rewrite of all three pages is **in the working tree only**. It
  needs a commit, a build and a deploy, and the deploy needs Colin's go-ahead.
- Shared facts and placeholders now live in one file,
  `src/components/legal/legal-facts.tsx`. Fill a placeholder there, not in the
  pages.

## 1. Source inventory, audited from the code 2026-09-13

Every host that `scripts/`, `src/`, `netlify/` and `desktop/src` reach, and
every file under `public/` that came from somewhere else. **No terms-of-use URL
for any source is recorded anywhere in the repo** (a grep for terms, tos, legal
and policy URLs finds none), so the "terms position" column comes from the
2026-09-02 review, not from a saved copy. When a source's terms are checked,
save a dated copy in `docs/reference/`.

### 1.1 Data and images

| Source | What we take | Where it shows up | How | Terms position |
|---|---|---|---|---|
| **CollegeBasketballData (CBBD)** `api.collegebasketballdata.com` | schedules, box scores, play-by-play (stints, lineups, on/off, EPM, shots, second-chance, lead states), AP rank per game, adjusted ratings (trust-gated input to BTA RTG), shooting splits, live slate and single games | team and player explorers, both game logs, Win Calculator, team pages (lineups, on/off, shooting), shot charts, `/scoreboard`, `/game`, matchup predictor, desktop app | paid API (Patreon key), raw archive in `data/cbbd/`; live through `netlify/functions/scoreboard.mts` and `game.mts` | Commercial use permitted. Key must stay server-side. No public mirror, proxy or substitute API (see 5.6) |
| **Bart Torvik** `barttorvik.com` | team T-Rank CSV and player advanced-stats CSV, 2008-2026; canonical team names and player ids; adjoe/adjde (half of BTA RTG); offseason feed | team and player explorers, team, player and coach pages, season preview, portal production numbers, desktop app | bulk CSV via `scripts/sync-bart.mts` into Supabase | No published terms found; site sits behind a bot challenge; no permission on file |
| **Sports Reference** `www.sports-reference.com/cbb` | NCAA tournament brackets 2013-2026, tournament box scores, year-by-year head coach for every program | coach pages, tournament box-score modal, coach links | scrape, 3,200 ms between requests, cached (`scrape-tournament-*.mjs`, `snapshot-historical-coaches.mjs`) | Republishing welcome with explicit credit; automated access needs written permission |
| **Basketball Reference** `www.basketball-reference.com` | NBA draft 2013-2025, NBA season totals 2013-2026, into `public/data/nba-draftees.json` | NBA marker on rosters and box scores, draft line on player pages | scrape, 3,200 ms, cached (`scrape-nba-*.mjs`) | Same as Sports Reference |
| **On3** `api.on3.com`, `www.on3.com` | transfer portal entries; 2026 class commitments (membership only, not ranks) | `/portal`, season preview rosters | `refresh-portal.mts` (public API), `scrape-recruits.mjs` (ranking pages) | Terms behind a 403; assume restrictive (see 5.5) |
| **RSCI** via `sites.google.com/site/rscihoops`, `docs.google.com` | RSCI Final top 100 per class, 2013-2026 | recruit badge on preview rosters, player pages, player atlas; freshman studies | Google Sheet CSV export (`fetch-rsci-history.mjs`, `scrape-recruits.mjs`) | Published to be reproduced with attribution. Credit is on `/sources` again |
| **ESPN** `site.api.espn.com`, `a.espncdn.com` | 20,164 player headshots; current head coach snapshot (`src/data/team-coaches.json`); 32 conference logos (`public/images/conf/`, commit `3af00054aa`); NBA team logos | headshots on team, player and game pages and in the desktop app; coach name on team pages; conference table; NBA logos hotlinked on player pages (`nbaLogoUrl`) | download and re-serve; logos hotlinked | Automated and commercial use prohibited (see 2) |
| **CBB Analytics** `cbbanalytics.com`, and the `storage.googleapis.com/cbb-image-files` bucket | team catalog `src/data/cbb-team-ids.json` (ids, market names, mascots, two colors, conference) built by `scripts/match-teams.mjs` from CBB Analytics' team list; team logos fetched by that id | logos on nearly every page (hotlinked at 86 of 89 `TeamLogo` call sites); 366 copies in `public/ttz-logos/`; those copies bundled into the Windows installer; team colors site-wide (`team-colors.ts`) | one-off match, download, hotlink | **New finding, see 3.** Their statistics were removed in July 2026, but this was not |

### 1.2 Methods credited

| Method | Where | Credit |
|---|---|---|
| Trapezoid of Excellence, Ryan Hammer | team scatter (site and app) | on the chart, with a link, and on `/sources` |
| Four Factors and the possession estimate, Dean Oliver; free-throw coefficient, Ken Pomeroy | glossary, team game index, matchup method | `/sources` |
| NCAA quadrant thresholds, applied to BTA's own ratings (`src/lib/quad.ts`) | Win Calculator | `/sources` |

### 1.3 Services (processors)

| Service | Role | On which page |
|---|---|---|
| Anthropic (`claude-opus-5`, `netlify/functions/parse-query.mts`) | reads Ask the Calculator questions; receives the question text only; function logs token counts only | `/privacy`, `/sources` |
| Stripe | hosted checkout, billing portal, webhooks | `/terms`, `/privacy`, `/sources` |
| Supabase | auth (email and password), `profiles`, `desktop_auth_codes`, `site_config`, editorial tables | `/privacy`, `/sources` |
| Netlify | hosting, functions, edge rate limit by IP on the parser, request logs | `/privacy`, `/sources` |
| Cloudflare R2 | public bucket (data files, Windows installer and update feed), private gated bucket, archive backup | `/privacy`, `/sources` |
| Google Cloud Storage | the third-party logo bucket above | `/privacy` |
| GitHub API | admin dashboard only, never for readers | not disclosed; not needed |
| Google Fonts | self-hosted at build time by `next/font`; no runtime request | not disclosed; not needed |

### 1.4 Not used, checked

- CBB Analytics statistics (removed July 2026; see `docs/data-sources.md`).
- KenPom or EvanMiya data. Both appear only as method references or in
  competitor pricing notes.
- 247Sports, ESPN, On3 or Rivals recruit rank numbers.
- `Sports-Roster-Data` on GitHub: used by `scripts/audit-rosters.mjs` for the
  women's feasibility study only; nothing on the site.
- No analytics, ad or tag script on the site (`src/app/layout.tsx` carries only
  the theme script) and no analytics or crash reporting in `desktop/src`.

## 2. ESPN images

`scripts/fetch-player-images.mjs` downloads ESPN headshots and writes them to
`public/images/players/`. There are **20,164** of them. They are re-served from
btacbb.xyz, which is a paid site, and the Windows app shows them too, fetched
from the same path.

### 2.1 Three separate threads, not one

**a) Contract, with Disney/ESPN.** Their terms prohibit each of the three
things we do: "reproduce, distribute, communicate to the public, make available
to the public"; "use the Disney Products for any commercial or business-related
use"; "access, monitor, copy or extract ... using a robot, spider, script, or
other automated means". This is a breach of contract, and the realistic remedy
is a cease-and-desist or an IP block, not damages.

**b) Copyright, and the owner is NOT ESPN.** College headshots are produced by
the schools' athletics departments; copyright sits with the university or with
the photographer who shot them. ESPN is a distributor we took them from. So the
party with a copyright claim is each of ~360 athletics departments, not Disney.

That cuts both ways. It means more potential claimants, but their damages are
weak: statutory damages require registration with the Copyright Office, and
routine team headshots are almost never registered. Unregistered works get
actual damages only, and the actual damages from a stats site showing a
2cm-wide headshot are close to nothing. **The realistic worst case is a DMCA
takedown, not a judgment.**

**c) Right of publicity, the thread nobody expects and the sharpest one.**
Everything else on this site is protected by the same reasoning that decided
*C.B.C. Distribution v. MLB Advanced Media*, 505 F.3d 818 (8th Cir. 2007):
names and playing statistics are factual data, and the First Amendment beats a
right-of-publicity claim over them.

Read the opinion carefully and the shield has a hole in exactly our shape. The
court expressly noted that **CBC did not use the players' images**, only names
and publicly known statistics. Photographs are not the factual data that case
protects, and since 2021 college athletes hold commercial NIL rights in their
own likeness. Our stats are inside the shield. Our headshots are outside it.

### 2.2 What the comparable sites do

Sports-Reference's college basketball section, the largest and best-resourced
site in this space, shows **no player photograph at all**. Their NBA pages do
have headshots, which they license. KenPom and Bart Torvik show none either.

### 2.3 Replacements, researched

| Option | Verdict |
|---|---|
| **College Pressbox**, 8,000+ D-I headshots, $9.99/mo | **No.** License is "personal, noncommercial use only ... with no right to reproduce, distribute, communicate to the public, make available to the public". Scrapers "strictly prohibited". $9.99 buys media *access*, not redistribution |
| **Sportradar Images API** (bundles College Pressbox + Getty for NCAA MBB) | **The real licensed path.** Enterprise pricing, custom quote, sales contact required |
| **Direct from the schools** | Plausible in principle, but ~360 separate permissions. The top 50 programs would cover most traffic |
| **Wikimedia Commons** | Coverage for 20,000 college players is far too thin |

### 2.4 Decision: KEEP AND MITIGATE, settled 2026-09-02

Colin's call, made with the analysis above in front of him: **the headshots
stay.** The research recommended dropping them; the decision went the other
way. Realistic enforcement risk at this size is low and cheap to be wrong
about, and the realistic first contact is a takedown notice. What converts a
notice into something worse is ignoring it, so the mitigations make compliance
fast.

| # | What | Where |
|---|---|---|
| 1 | `X-Robots-Tag: noindex` on `/images/players/*` | `netlify.toml` |
| 2 | Config kill switch: a commented `[[redirects]]` that 404s every headshot, no rebuild required | `netlify.toml` |
| 3 | Build-time kill switch: `NEXT_PUBLIC_BTA_PHOTOS=off` | `player-photo.tsx` |
| 4 | Takedown address, live | `/sources` corrections clause, `CONTACT_EMAIL` in `legal-facts.tsx` |

**The Windows app, checked 2026-09-13.** The app loads headshots from
`https://btacbb.xyz/images/players/`, and its `ui/player-photo.tsx` falls back
to initials when an image fails. So **kill switch 2 (the redirect) covers the
app as well**. Kill switch 3 does not: the app does not read
`NEXT_PUBLIC_BTA_PHOTOS`, and a player marked as having a photo still asks for
it. If a notice arrives, the redirect is the step that matters for both.

**Runbook if a notice arrives:** uncomment the two redirect blocks in
`netlify.toml`, then `netlify deploy --prod --dir=out --no-build`, poll
`netlify api listSiteDeploys` until `ready`, and reply to the sender confirming
removal. Target the same day. Then rebuild with `NEXT_PUBLIC_BTA_PHOTOS=off` to
make it permanent.

**What this does not do.** None of it makes the images licensed. Revisit on
meaningful growth, or before any raise, sale or partnership, where diligence
will find 20,164 unlicensed files.

**The 34 coach photos were deleted 2026-09-02**, with their manifests and the
dead `CoachPhoto` component. `scripts/optimize-coach-photos.mjs` survives as the
recipe for when coach photos come back licensed.

**ESPN exposure beyond headshots, found 2026-09-13.** Not covered by the
decision above, and smaller, but worth a line each for the lawyer:

- 32 conference logos pulled from ESPN, committed in `public/images/conf/`, and
  bundled into the Windows installer (`desktop/electron-builder.yml`).
- NBA team logos hotlinked from `a.espncdn.com` on player pages.
- The current head coach snapshot, taken through ESPN's API. Coach names are
  facts; the concern is only the automated access.

## 3. NEW: team logos and the team catalog trace to CBB Analytics

`docs/data-sources.md` says "nothing on the site derives from CBB Analytics".
That is true of the statistics and not true of the logos.

- `scripts/match-teams.mjs` built `src/data/cbb-team-ids.json` by matching Bart
  names to "CBB Analytics D1 MALE teams", from a JSON file of their team list.
  That file carries their team ids, market names, mascots, two brand colors and
  conference.
- `src/components/team-logo.tsx` fetches every logo by that id from
  `storage.googleapis.com/cbb-image-files/team-logos/<id>.png`. 86 of 89 call
  sites hotlink it; the other 3 use the 366 mirrored copies in
  `public/ttz-logos/`, which `fetch-ttz-logos.mjs` downloaded from the same
  bucket. Commit `3af00054aa` calls it "a bucket somebody else maintains".
- The Windows installer bundles those 366 files.
- `src/lib/team-colors.ts` themes every team page from the catalog's colors.

**The repo never says who owns the bucket.** The ids match CBB Analytics' team
list, so it very likely belongs to them or their data vendor. `/sources` now
says what the code shows (logos come from a Google Cloud Storage image library,
matched through CBB Analytics' team catalog, which also supplied the colors) and
no more.

Why it matters more than ordinary logo use: nominative fair use covers using a
school's mark to identify its team. It does not settle copying a competitor's
curated image files, serving them from their bucket at their bandwidth cost, or
shipping them inside a distributed installer. The bucket's owner can also swap
or block the images at any time.

**Questions for Colin:**

- [ ] Confirm who owns `cbb-image-files`, and how the team-list JSON that
      `match-teams.mjs` read was obtained.
- [ ] Decide: keep hotlinking; self-host the 366 copies everywhere (stops the
      dependency, not the copying question); or rebuild the logo set from a
      source with clear terms. Team ids and colors are facts and are the
      smaller half of this.
- [ ] Decide whether `/sources` should name CBB Analytics at all while this is
      open. The draft names them because the task was an accurate page.

## 4. Sports Reference: attribution done, throttle checked, permission open

Sharing and republishing for commercial purposes is welcome **provided they
are credited explicitly**, and `/sources` credits both Sports Reference and
Basketball Reference by name, with links.

- [x] **Throttle checked 2026-09-13.** Every scraper that touches their sites
      (`scrape-tournament-games.mjs`, `scrape-tournament-boxscores.mjs`,
      `scrape-nba-draftees.mjs`, `scrape-nba-players.mjs`,
      `snapshot-historical-coaches.mjs`) waits 3,200 ms between requests, which
      is 18.75 a minute, under their published ceiling of 20. All are one-shot
      runs with local caches, not part of the nightly refresh.
- [ ] **Permission.** Automated access needs express written permission, and
      they ask people not to build sites on scraped data. Writing to ask is
      still the clean fix; they do grant it.

## 5. Per-source questions for Colin or a lawyer

For each, the specific concern. No terms URL is recorded in the repo for any of
them (see section 1).

1. **CBB Analytics / logo bucket.** Section 3. Highest priority of the new
   findings.
2. **ESPN.** Headshots decided (section 2.4). Open: conference logos in the repo
   and in the installer, hotlinked NBA logos, the coach snapshot's automated
   access.
3. **Sports Reference / Basketball Reference.** Written permission for
   automated access on a commercial product (section 4).
4. **Bart Torvik.** No published terms, and the site uses a bot challenge,
   which reads as not wanting bulk automated access. A paid product is built
   substantially on his free data: team and player season tables, the names
   every row is keyed to, half of BTA RTG. The risk is more relationship than
   legal, but a short note asking permission, or offering a licensing
   arrangement, would close it.
5. **On3.** Terms were unreadable (403). `refresh-portal.mts` calls a public
   API while sending a browser user agent and `origin`/`referer` headers set to
   `on3.com`, which looks like presenting as their own site and weakens any
   "public feed" argument. Commitments come from scraping their ranking pages.
   The facts are free to use; the compiled feed is theirs. `/sources` now names
   On3; confirm that is wanted.
6. **CBBD.** Commercial use is permitted. Open: the public R2 bucket (165k
   machine-readable JSON files, see section 6), plus two new surfaces. The
   Windows app caches season data offline on subscriber machines, and
   subscribers can export tables. Ask whether either counts as a "substantially
   equivalent data service" under their terms, and whether their tier covers a
   paid desktop app. Also check whether CBBD asks for specific attribution
   wording; none is recorded in the repo.
7. **RSCI.** Attribution condition met on `/sources` with the exact string
   `scrape-recruits.mjs` records ("Recruit rankings: RSCI (Recruiting Services
   Consensus Index), rscihoops.com"). Open: whether the credit should also sit
   beside the badge, whose tooltip names RSCI but not the site.
8. **Ryan Hammer.** Credited on the chart and on `/sources`. A courtesy note
   telling him, since "Trapezoid of Excellence" is his name for it.
9. **EPM naming.** The glossary marks EPM as "original". "EPM, Estimated
   Plus-Minus" is also the name of Taylor Snarr's NBA metric at Dunks & Threes,
   which `docs/monetization-strategy.md` names as this site's template. Check
   whether "EPM" is a registered mark and whether the shared name could be read
   as implying a connection. `/sources` does not mention it either way.
10. **Anthropic.** Covered by their commercial API terms; nothing to decide.
    Keep `/privacy` true: the desktop app already sends the reader's session
    token to `/api/parse-query`, and the function ignores it today. If the
    parser ever starts reading it, the privacy wording changes.

## 6. R2 bucket is public and machine-readable

CBBD's terms forbid operating "a public database mirror, proxy, substitute API,
or substantially equivalent data service". Our data files sit in a **public**
R2 bucket, 165,287 objects of structured JSON, fetchable by anyone who reads
the network tab, with no auth and no rate limit. The paid seasons are gated, so
the exposure is the free-tier data, but "free to read on the site" and "free to
bulk-download 165k files" are not the same offer. The Windows installer and its
update feed also sit in this bucket; that part is deliberate and harmless (the
app opens nothing without an entitled sign-in).

## 7. Placeholders and facts to confirm

| Item | Where | Status |
|---|---|---|
| `[LEGAL ENTITY NAME]` | `legal-facts.tsx`; shown in `/terms` 1 and `/privacy` "Who is responsible" | **Placeholder.** A sole proprietor's legal name, or a DBA or LLC if one exists or is planned |
| Contact address | `CONTACT_EMAIL` in `legal-facts.tsx` | **Kept as `cpb09e@gmail.com`, not a placeholder**, because it is the live takedown route (2.4). `/pricing` uses `hello@btacbb.xyz` for the Program tier. Pick one and change it in one place |
| Governing law | `/terms` 13 | Settled 2026-09-02: Texas. Lawyer: county of venue, and whether to add arbitration or a class-action waiver (not drafted) |
| Refunds | `/terms` 5 | **No formal refund policy exists.** The position is discretionary with no retroactive refunds. The 14-day promise was removed 2026-09-02 when the trial went in; the old TODO item about it was stale. The pricing copy says nothing about refunds. Confirm discretionary is intended |
| Refund on account closure | `/terms` 10 | Promises the unused remainder if we close an account for anything short of serious abuse. A real commitment; confirm |
| Age to subscribe | `/terms` 1 | Drafting choice: an adult, or with a parent or guardian's agreement. `/privacy` keeps "not for under 13". Confirm |
| Email notice of material changes | `/terms` 12, `/privacy` | Promised. The repo has no bulk email tool (Supabase auth emails only), so it is manual |
| Stripe receipts | `/privacy` email clause | Says billing emails come from Stripe. Confirm receipts are switched on in the Stripe dashboard |
| Sales tax | checkout | `create-checkout-session.mts` sets no `automatic_tax`. Ask an accountant |
| Automatic-renewal laws | `/terms` 3 | Lawyer: do state auto-renewal laws require more (renewal reminders on the yearly plan, specific checkout wording, an acknowledgment email)? Online cancellation exists through Stripe's portal |
| Data location | `/privacy` | The Supabase region is not in the repo; the page says "the United States and wherever the services above operate" |

## 8. Contradictions found outside these pages (not edited; out of scope)

- [ ] **"Renews each November" is not what Stripe does.** `/pricing` says "The
      Season Pass renews each November" and the FAQ says "Every November ...
      not on the anniversary of the day you joined". `create-checkout-session.mts`
      sets no `billing_cycle_anchor`, so a subscription renews on the
      anniversary of its first charge. `/terms` describes the code. Fix the
      pricing copy, or add an anchor (which changes the first charge and
      proration, so it is a product decision).
- [ ] **"50 plain-English questions a month" is not enforced.** `/api/parse-query`
      needs no account and has no monthly count, only an edge limit of 10 a
      minute per IP. The site locks the box for free readers, but the endpoint
      is open. `/terms` puts no number on it.
- [ ] `docs/data-sources.md` says nothing derives from CBB Analytics (see 3) and
      still describes `/sources` as "still to be built".
- [ ] `netlify.toml`'s header comment still says the pipeline runs "against
      Supabase + CBB Analytics".
- [ ] `public/fonts/MonetaSans-Bold.otf` and `.woff2` are publicly served and
      unused (only a comment in `layout.tsx` mentions Moneta). Check the font's
      license or delete them.
- [ ] `/pricing`'s "Where does the data come from?" answer names Torvik, CBBD
      and RSCI only. Fine as a summary; it links to `/sources` for the rest.

## 9. Windows app items

- [x] `/terms` 6 covers the license while entitled, sign-in through the website,
      staying signed in until sign-out, hourly entitlement checks, automatic
      updates, and deleting paid data on sign-out or when the pass ends.
- [x] `/privacy` covers the encrypted session (Electron `safeStorage`, DPAPI),
      the data cache, preferences, no analytics, and that uninstalling leaves
      the folder (`deleteAppDataOnUninstall: false`).
- [ ] `supabase/migrations/012_desktop_auth.sql` is not applied to the live
      project yet. `/privacy` describes the sign-in code table it creates.
- [ ] `DESKTOP_ACCESS = "paid"` in `netlify/shared/desktop-auth.mts`, so sign-in
      is open to Season Pass holders, while `/api/desktop/download` is still
      admin-only. `/terms` says early access may limit downloads. Revisit when
      the download opens.
- [ ] The installer is unsigned (Azure Artifact Signing is the open decision in
      `docs/desktop-app-plan.md`).
- [ ] The installer bundles the CBB Analytics-bucket team logos and the ESPN
      conference logos (sections 2 and 3).

## 10. Checklist

Done:

- [x] Source inventory rebuilt from the code (section 1), 2026-09-13.
- [x] `/sources`: every data source named, linked and described; Sports
      Reference and RSCI credits; methods credited (Hammer, Oliver, Pomeroy,
      NCAA quadrants); services listed; what is not used; corrections and
      takedowns.
- [x] `/terms`: free versus paid, prices and periods, renewal, cancellation to
      period end, failed payments, the five-day trial, refunds (existing
      position kept), the Windows app, acceptable use (no scraping, mirroring,
      paywall circumvention or account sharing), as-is and not betting advice,
      limitation of liability, account, ownership, changes, governing law,
      contact.
- [x] `/privacy`: who is responsible, account fields, Stripe, Ask the
      Calculator and Anthropic, the Windows app, browser storage, processors and
      outside image hosts, email, retention and deletion, rights, children.
- [x] Fixed claims in the old copy that the code contradicts: "game logs are
      open to everyone" (the game log explorers preview five rows); "sign in
      with a one-time link" (sign-in is password only); "you can delete your
      account at any time" (deletion is by request); the page titles, which
      repeated "Beyond the Arc" on top of the layout's title template.
- [x] Governing law: Texas (2026-09-02).
- [x] ESPN headshots: keep and mitigate (2026-09-02); coach photos deleted.
- [x] Sports Reference throttle checked (section 4).
- [x] Recruit ranks: RSCI only.
- [x] Trademark disclaimer: footer and `/sources`.

Needs a human:

- [ ] Fill `[LEGAL ENTITY NAME]` (section 7).
- [ ] Choose the contact address (section 7).
- [ ] Confirm the refund position and the refund-on-closure promise (section 7).
- [ ] **Confirm the restored clauses.** Colin cut these 2026-09-02; this rewrite
      put them back because the Windows app and Ask the Calculator send data to
      services a reader would not otherwise know about. The clauses are
      `/sources` "Recruiting and the transfer portal" (the RSCI credit) and
      "Services that run the site", and `/privacy` "Who else handles it" and
      "What is stored in your browser". If they are cut again, the RSCI credit
      has to survive somewhere.
- [ ] Reconcile the November renewal claim and the 50-a-month claim (section 8).
- [ ] The CBB Analytics logo bucket (section 3).
- [ ] Per-source permission questions (section 5).
- [ ] Lawyer pass once the above are settled.
- [ ] Commit, build and deploy the 2026-09-13 pages (deploy needs Colin's
      go-ahead).

## 11. Still worth doing later

- Account self-deletion in the UI. `/privacy` promises deletion on request
  within 30 days, which is honest and manual; a button would be better.
- A cookie or consent banner is **not** needed today and should stay
  unnecessary. It only becomes required if an analytics or ad script is added.

## Colin's decisions, 2026-09-13

- **Clauses cut on 2026-09-02:** keep the RSCI credit (/sources, "Recruiting and the transfer portal") and the processor list (/privacy, "Who else handles it"). The other two stay cut: /sources "Services that run the site" (formerly "Who else touches the site") and /privacy "What is stored in your browser".
- **Contact email:** `hello@btacbb.xyz` on every legal page (set once in `src/components/legal/legal-facts.tsx`). That inbox must receive mail: it is the takedown route.
- **Legal entity name:** still open. The three legal pages are held on the `legal-pages` branch and are not in the 2026-09-13 deploy; they ship once `LEGAL_ENTITY` is filled in.
