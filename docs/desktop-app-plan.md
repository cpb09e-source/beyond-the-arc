# BTA Desktop — plan of record

Started 2026-09-12. A standalone Windows app for BTA premium users (admins only at
first). This file is the source of truth across sessions; the readable version was
published as the "BTA Desktop Blueprint" artifact. Update this file as decisions
land, and delete sections once they are built and self-documenting in code.

## Status

**As of 2026-09-14:** P0 through P4 are built, P5 and P6 in part, all pushed. Installer 0.1.0 is on
R2; everything built since reaches an installed copy only with 0.1.1. What each pass built and how:
`docs/desktop-overnight-notes.md`. Features, stack and architecture, readable: the "BTA Desktop
Blueprint" artifact.

Run it: `cd desktop && npm install && npm run dev`. If it reports a missing Electron
binary, run `node node_modules/electron/install.js` once; Electron 44 no longer fetches
it reliably during install.

Gotchas already paid for:
- VS Code exports `ELECTRON_RUN_AS_NODE=1` into its terminal. `npm run dev` goes through
  `desktop/scripts/electron-vite.mjs`, which strips it. `npx electron-vite dev` run
  directly from a VS Code terminal dies on the first line of main.
- A running dev server keeps the `electron.vite.config.ts` it started with, and never rebuilds
  main. After a config or main-process change, restart it.
- Scripted checks: `BTA_CDP_PORT=9223 npm run dev` opens Chromium's debugging port
  (development only) and shows the window without taking focus. `npm run verify` runs every
  check; `npm run verify -- --smoke` also drives the real window.

### Release: 0.1.1, the first build for Season Pass holders

In this order. The candidate that is tested is the one that is signed, and the one that is
signed is the one that is published.

1. Guardrail hooks and the verify agent (`.claude/hooks/`, `.claude/agents/bta-verify.md`, `npm run verify`).
   **Done 2026-09-14** (318a692046, fc79bf5816): verify passes, smoke suite 75 of 75.
2. A local installer build, installed the way a subscriber installs it. **Built 2026-09-14**:
   `desktop/release/Beyond-the-Arc-Setup-0.1.1.exe`, rebuilt from f5712416c8 (several seasons in the explorers,
   named Save view, folding rail), unsigned, SHA256 74CF4951…1521F2. **Installed and tested by Colin
   2026-09-14.**
3. Sign-in end to end: admin@btacbb.xyz, premium@btacbb.xyz, and a free account, which must get
   the Season Pass screen. **Passed 2026-09-14** (free test account: free@btacbb.xyz), along with
   several seasons, Save view and the folding rail.
4. Sources and terms review (`docs/TODO-legal-sources.md`), sharper now that exports hand out
   derived datasets.
5. Research history as a versioned event log (ids, season, action, filters, table layout), so
   installed copies record the shape Save Trail needs from their first day.
6. Discovery hints for Q (Focus) and Alt-click (Stat Lens): a few times each, then never.
7. Find Similar's score explains itself: where the points went, stat by stat.
   **5 to 7 done 2026-09-14** (fc79bf5816, 81e6135772). Step 4's findings are in §8 of the legal doc,
   waiting on Colin's decisions.
8. Build and test the 0.1.1 release candidate. **Done 2026-09-14**: smoke 93 of 93, installed and
   tested by Colin.
9. Code-sign that exact candidate; verify the signed installer and the 0.1.0 to 0.1.1 update.
   Colin asked for one change after testing (no bar in Find Similar's Match column), so the signed
   build comes from that later commit and gets a short retest, not f5712416c8.
10. Publish 0.1.1 (Colin's go; it writes to R2).

### After 0.1.1

2. **Insight Radar, two detectors:** a trend break, and an elite team's weakness. Clicking an
   insight opens the analysis that proves it (What Changed, Explain, a Lens). No generic paragraph.
3. **History panel, then Save Trail.** Reads like a notebook ("Michigan: What Changed, last 10");
   a step restores its state. A trail keeps when each step was taken, so a live-season step can
   say its numbers have moved since.
4. **Rarity detector** on the Find Similar model: "Only 14 of 4,620 team-seasons have looked this
   similar", with Show the 14 opening Find Similar's own list. Cheap, because the model exists.
5. **Several seasons in one table.** Explorers first; the player game log across seasons (about
   1.5M rows) waits for a worker.
6. **Lens Stack**, once history has made research state legible.
7. **Season Time Machine.** Keep saving the live season nightly from November; the screens wait.
8. **Admin dashboard** when running the business needs it, not before.

Idea bank: **Delta Preview**, hold over a filter to see what it changed (net rating, the four
factors, rank), reconciled by the explain engine. Needs a date clause in the filter grammar
first, and a trigger other than Alt, which is Stat Lens.

### The grammar to protect

See something: Peek. Want it: select or drag it. Need an action: right-click or Ctrl K. Want
everything to follow it: Focus. Understand a number: Lens. Understand a gap: Explain. Understand
movement: What Changed. Want precedent: Find Similar.

A new feature ships only if:
- it is an action in `objects/actions.tsx` on an object, so every surface offers it;
- it answers a question the verbs above do not, and otherwise becomes an option of the one it extends;
- every number it derives can be opened and explained;
- Home stays restrained (jump back in, recent research, ask, start somewhere): nothing is added
  without something removed.

Site modules with web-only dependencies (`@/lib/gated-corpus`, `@/lib/data-url`) get small
desktop stand-ins through Vite aliases, rather than copying the modules that import them.

## What it is

An analytics workspace where every team, player, game, coach, conference and
transfer is an object you can inspect (Peek), compare (dock / drag), and act on
(action registry → Ctrl K, right-click, drag targets). Objects and views — NOT a
page-for-page port of the site's 40 routes.

## Decisions

**Shell: Electron 44 + electron-vite, not Tauri.**
- Tauri cannot build on this machine: no MSVC build tools (the `link.exe` on PATH
  is Git's coreutils). Rust 1.98.1 msvc toolchain is installed but useless without it.
- One Chromium engine everywhere; the motion work needs identical rendering.
- TypeScript end to end → imports the site's pure stat logic.
- Tauri 2 has open bugs in Windows deep-link + single-instance (NSIS).
- Cost accepted: ~150 MB installer, ~200 MB idle RAM.

**Code: `desktop/` in this repo, own package.json.** Root `tsconfig.json` and
eslint must exclude it. Imports these pure modules from `src/lib` instead of
copying them (they only import each other): `team-filters`, `cbbd-rating-trust`,
`trapezoid`, `team-scatter-metrics`, `scatter-team`, `seasons`, `percentile`,
`xlsx`. A copy WILL drift — that bug was fixed twice in the week this started.

**Data: two kinds of season.**
- FROZEN: 2013-14 through 2025-26, plus every later season after its final
  night. Never changes. Download once, never revalidate, work offline. Derived
  artifacts (similarity profiles, time-machine replays) are built once.
- LIVE: 2026-27, nightly refresh from ~2026-11-01 to ~2027-04-06, then it
  freezes. One rule for every year: a season is live only while its version file
  says so; the last nightly marks it final and the app stops checking. The site
  already has the live path (`LIVE_SEASON` in `src/lib/seasons.ts`,
  `/data/live/` on R2, `npm run refresh:nightly`).
- Free seasons load from R2 like the site. Paid seasons go through the existing
  `/api/season/<kind>/<year>` with the app's bearer token — `requireUser` already
  validates any Supabase access token, so no server change.
- A season of teams is `teams-by-year/<year>.json`, 1.27 MB, 365 rows, 140
  season stats, plus `national_ranks.top/bottom` (Peek's best/weakest is a read).
- Paid data on disk is purged on sign-out or lapse. No new exposure: paid users
  can already export the full table to xlsx.

**Sign-in: our own PKCE handoff, not Supabase's OAuth 2.1 server.** Supabase's
OAuth server rejects custom schemes on registration and exact-matches loopback
ports, so it can't serve a desktop client today. Flow:
1. App creates `state` + `code_verifier`, opens
   `https://btacbb.xyz/desktop/connect?challenge=S256(verifier)&state=…`.
2. User (already signed in on the site) presses Allow.
3. Function (with the user's bearer) stores a single-use code (5 min TTL) with
   the challenge in a service-role-only table.
4. Browser redirects to `btacbb://auth?code=…&state=…`; app POSTs code + verifier
   to a token function, which verifies S256 and mints a real Supabase session
   (admin `generateLink` → `verifyOtp`). Refresh token stored with Electron
   `safeStorage`.
Touches the live site: 1 page, 2 functions, 1 table. Needs Colin's go-ahead.

**Distribution.** `/api/desktop/download` → `requireAdmin` → presigned URL from
`R2_GATED_BUCKET` (credentials already exist). The app re-checks entitlement at
sign-in, so a shared installer opens nothing. Widening admin → Season Pass is a
server one-liner. electron-updater generic provider on R2.

**Signing.** Unsigned is acceptable while admin-only. Azure Artifact Signing
($9.99/mo, individuals in US OK) before any non-admin download. Mac later:
$99/yr Apple Developer + a Mac or macOS CI to notarize.

## The twelve interaction ideas — verdicts

| Idea | Verdict | Phase |
|---|---|---|
| Universal Peek (hold Space / tap to pin / arrows) | Build first | P0 |
| Context actions, Ctrl K on the selection | Build first — the registry is the architecture | P1 |
| Right-click everything (incl. column headers → stat actions) | Build | P1 |
| Comparison dock (one entity kind, ~6 max) | Build | P2 |
| Drag → compare (drop zones after a few px of movement) | Build | P2 |
| Research workspaces (local-first; sync later) | Build | P2 |
| Linked scatter ↔ table + lasso → floating toolbar | Build (shared selection store) | P4 |
| Find similar / historical comps | Build — respect rating-trust gaps and the 2021 flag | P4 |
| What changed (split switch) | Changed: ~300ms motion + persistent delta chip, not 1.5s | P4 |
| Ask Beyond the Arc (NL → UI) | Changed: proposal not action (Enter applies, Esc discards); local grammar for common phrasings, model fallback. No AP poll data exists. | P5 |
| Snapshot cards | Build — Electron `capturePage` → clipboard | P5 |
| Stat Lens | Changed: `L` / right-click toggle; hold-Alt only as shortcut; one consistent lens panel | P6 |
| Season time machine | Data first — replay frozen seasons once with our own model (`scripts/build-team-ratings.mjs`, r=0.995 vs CBBD); live season saves a snapshot nightly. Label that time-mode ratings are BTA's model, not Torvik's. | P6 |

## Phases

- **P0 — shell, real data, Peek.** Built.
- **P1 — everything is an action.** Built: registry, Ctrl K, right-click, keyboard map, split
  view, details rail. Richer record panes wait on a gated endpoint.
- **P2 — selection you can carry.** Built: dock, drag to compare, favorites, workspaces, saved
  table views.
- **P3 — installable and live, by tip-off.** Built: sign-in handoff, paid seasons, download,
  auto-update, live-season revalidation. Open: sign-in end to end, signing, 0.1.1.
- **P4 — connected analysis.** Built: linked scatter and table with lasso, Find Similar, What
  Changed, the Difference Explainer.
- **P5 — ask and share.** Built: snapshot cards, the site's xlsx and CSV downloads, plain-English
  Win Calculator questions. Not built: NL filter proposals.
- **P6 — time.** Built: Stat Lens. Not built: replay of frozen seasons, the scrubber.

## Open decisions for Colin

- Azure Artifact Signing ($9.99/mo): release step 9; needs Colin's Azure account and identity validation.
- CBBD tier for the Nov–Apr nightly refresh (month to month if possible).
- The legal entity name, which holds the legal pages back.
- Sources and terms review before promotion.
- Test account passwords: change them or delete the accounts before promotion.
- Mac: when subscribers ask.
