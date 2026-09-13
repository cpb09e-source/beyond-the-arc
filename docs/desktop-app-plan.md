# BTA Desktop — plan of record

Started 2026-09-12. A standalone Windows app for BTA premium users (admins only at
first). This file is the source of truth across sessions; the readable version was
published as the "BTA Desktop Blueprint" artifact. Update this file as decisions
land, and delete sections once they are built and self-documenting in code.

## Status

**P0 shipped 2026-09-12** (416931d9ab, 9c3b937f98, 1fbc2fe01c). Windows, development mode only.

Run it: `cd desktop && npm install && npm run dev`. If it reports a missing Electron
binary, run `node node_modules/electron/install.js` once; Electron 44 no longer fetches
it reliably during install.

What is in it: a frameless window with the site wordmark in both inks; thirteen seasons
in the sidebar, 2025-26 opening; a virtualized team table with the site's percentile chip
on every stat (the explorer's percentiles, tempo in the neutral band); BTA rank computed
live through `processTeams`, never the baked `bta_rank`; Peek (hold, tap to pin,
arrows, Esc) with national ranks as ramp chips and the contender zone; Ctrl K focusing
the filter, where number words fold to digits so "big ten" finds Big 10; system, light
and dark themes.

Gotchas already paid for:
- VS Code exports `ELECTRON_RUN_AS_NODE=1` into its terminal. `npm run dev` goes through
  `desktop/scripts/electron-vite.mjs`, which strips it. `npx electron-vite dev` run
  directly from a VS Code terminal dies on the first line of main.
- A running dev server keeps the `electron.vite.config.ts` it started with. After a
  config change, restart it; a reload reports "Failed to resolve import".
- Scripted checks: `BTA_CDP_PORT=9223 npm run dev` opens Chromium's debugging port
  (development only) and shows the window without taking focus.

**Build order, revised 2026-09-12 at Colin's direction:** one view at a time, each designed,
driven in the real window, screenshotted and fixed before the next. His goal: anyone who picks
the app up should feel they can do anything and find anything, which moves universal search
forward.

1. Foundation: shared DataTable (sort, keyboard, virtualization, Peek, pinned columns), one
   data layer, a frame with a view registry, workspace season switcher. **Done.**
2. Player Explorer with a player Peek. The cohort, impact attachment, leaderboard floor and
   percentile pass moved out of players-client.tsx into `src/lib/player-cohort.ts`, proven
   identical to the old code on six seasons (every player, every percentile) before the site
   switched to it. The # column is place-in-sort, as on the site; BTA's overall rank rides with
   the name as the site's top-100 mark. **Done.**
3. Ctrl K: universal search plus actions. **Built:** the palette (cmdk for keys and
   accessibility, ranking in `palette/rank.ts`), views, actions on the current view, every
   season, theme, and every team-season and player-season from the search indexes the site
   already builds, with its team aliases (UConn, Zags). A player or team collapses to its best
   season unless the query names one. Enter lands on the row in its explorer, filter cleared,
   Peek pinned. Ctrl F and / now filter the table. **Still to come:** coaches and games join
   when their views exist, so a result never opens onto nothing; actions on the selection
   (compare, copy, open on the site) arrive with the record panes.
4. Team Game Log, then Player Game Log (pinned identity columns; percentiles over the whole
   season, never the filtered rows, as the site does). **Team Game Log built:** every game of
   a season with crests and AP ranks, the seven column views of the site in a picker that is
   remembered, the shortcuts composing through passesTeamFilters, and a game Peek (result,
   efficiency, four factors offense against defense, shooting). The whole-season percentile
   function moved from the explorer component into `src/lib/team-game-index.ts`, and the two
   web-only modules it imports get desktop stand-ins through Vite aliases
   (`desktop/src/renderer/src/stand-ins`). **Player Game Log built:** every player-game of a
   season on the table (118,533 in 2025-26, where the site shows its top 500), the five column
   views, eight shortcuts, a Peek with the line, shooting as makes and attempts, and the rates.
   The site page has no chips; the app ranks each stat against every player-game of the
   season, with no chip on the five stats that are zero in most games (blocks 77%, made threes
   58%, steals 57%, offensive rebounds 51%, made free throws 51%) and neutral chips on minutes,
   attempts and usage. The midrank is counted rather than sorted (`data/midrank-by-value.ts`),
   checked equal to the site function on 18.1 million values across three seasons.
5. Win Calculator. Plain-English questions go through the site's /api/parse-query, because the
   Anthropic key must never ship inside a desktop app.
6. Team Scatter with the trapezoid.
7. Matchup Predictor, Transfer Portal, Coaches, Conference Power Rankings, Scoreboard, then
   team and player record panes.

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

- **P0 — shell, real data, Peek.** Window + frame, 2025-26 teams in a virtualized
  table, Peek working.
- **P1 — everything is an action.** Registry, Ctrl K palette over every object,
  right-click, keyboard map, record pane, persistent split view.
- **P2 — selection you can carry.** Dock, drag-to-compare, saved views, workspaces.
- **P3 — installable and live, by tip-off.** Sign-in handoff, paid seasons, admin
  download, auto-update, signing (on approval), nightly live-season sync.
- **P4 — connected analysis.** Linked scatter/table + lasso, Find Similar, What Changed.
- **P5 — ask and share.** NL filter proposals, snapshot cards, styled xlsx + viewer.
- **P6 — time.** One-time replay of frozen seasons, scrubber, Stat Lens.

## Open decisions for Colin

- Azure signing ($9.99/mo) — before any non-admin download.
- CBBD tier for the Nov–Apr nightly refresh (month to month if possible).
- Go-ahead on the P3 site changes (page, functions, table).
- Mac: when subscribers ask.
