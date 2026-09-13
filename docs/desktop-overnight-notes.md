# Desktop app: overnight notes for Colin (2026-09-13)

Working log from the overnight build-out. Nothing was deployed, nothing was
written to the live Supabase project, nothing was purchased, and no network data
pulls ran. Every change below is committed on `main` and pushed as a backup
(pushes do not deploy: `netlify.toml` has `ignore = "exit 0"`). The only live
change is the paywall fix, which is storage, not a deploy.

## Done on 2026-09-13, after your answers

- **Test accounts, on the live Supabase project, both verified by signing in:**
  - Admin: `cpb09e+bta-admin@gmail.com` (role admin, Season Pass). Paid seasons 200, admin overview 200.
  - Premium: `cpb09e+bta-premium@gmail.com` (Season Pass, not admin). Paid seasons 200, admin overview 404.
  - Passwords were given to you in chat and are not written anywhere in the repo. Gmail `+` aliases, so a password reset lands in your own inbox.
  - `test@test.com` is retired: random password, role free, subscription inactive. It was an admin with a four-character password on a domain whose mail someone else controls. Delete it before launch.
- **Paywall hole closed.** The 22 paid seasons of `game-index/` and `team-game-index/` (2014-2024) are deleted from the public R2 bucket. Before deleting, each one was checked byte for byte against its copy in the private bucket and the local file in `public/data/`, so any of them can be put back. Paid public URLs now 404, free seasons still 200, and `/api/data-url` signs paid seasons for subscribers (200) and refuses signed-out readers (401). This change is live; nothing else below is until you deploy.
- **Desktop app open to Season Pass holders:** `DESKTOP_ACCESS = "paid"` (`d62e631959`).
- **`/api/parse-query` rate limited:** 10 requests a minute per IP at Netlify's edge (`d62e631959`). Anonymous asks still work, so /calc is unchanged for a person.
- **Account button, bottom left** of the desktop sidebar: name, plan, account and billing, admin dashboard for admins, theme, shortcuts, updates, sign in and out. Workspaces keep the top (`12b2b29d72`).
- **Records never wrap** in any table cell (`8fa91531f1`).
- **Coach page bugs on the site** (the Altman record, tied chips, sort comparators, stale comments) are being fixed in a separate pass; see its commit when it lands.
- **Record panes (question 1):** the app keeps to data that is already public or already gated. Publishing `teams-all.json` and the other build-only files to the public bucket would reopen the paywall for the team explorer, so richer record panes wait on a gated endpoint for them.
- **Coach data (question 4):** stays bundled. The data freeze runs to 2026-10-01, so nothing in it changes before then; move it to published data when the freeze lifts.

## Was open overnight (now handled above)

### 1. Paywall hole on the live site (fixed 2026-09-13)

The public R2 bucket still serves **paid game-log seasons**:

    https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev/team-game-index/2019.json   -> 200
    https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev/game-index/2019.json        -> 200
    .../team-game-index/2024.json, .../game-index/2023.json                          -> 200

`/api/data-url` and the private `R2_GATED_BUCKET` work as designed, but the old
public copies were never removed when the gate moved to the private bucket on
2026-09-02. Anyone with those URLs gets every paid season of both game logs with
no account. Fixing it means deleting `team-game-index/<paid years>.json` and
`game-index/<paid years>.json` from the public bucket (keep 2025, 2026). That is
a destructive change to live storage, so it is yours to approve and run. The
desktop app needs no change when you do: it already falls back to signed URLs
when the public copy is gone.

### 2. `/api/parse-query` is open to anyone (rate limited 2026-09-13, not yet deployed)

The Win Calculator's plain-English endpoint has no sign-in requirement and no
rate limit of its own, and each call spends Anthropic tokens (up to two model
calls, ~60 s). Anyone can script it. Worth at least a per-IP rate limit, or
requiring a signed-in user. The desktop app calls it from the main process with
the reader's session token and never a key of its own, so requiring an account
would not break the app.

## Built tonight

Each one driven end to end over CDP with no console errors, and each one reuses
the site's logic: where that logic was trapped in a component it moved to
`src/lib`, the site imports it from there, and the site's output was proven
unchanged against the HEAD code on real data.

| Piece | Commit | Shared out of the site |
| --- | --- | --- |
| Team Scatter | `d62a23e2ce` | `topByNet` into `lib/scatter-team.ts` |
| Matchup Predictor | `532754707c` | `lib/matchup-inks.ts`, `lib/use-tween.ts`, counterfactuals, ledger, URL state and moves into `lib/matchup.ts` |
| Conference Power Rankings | `2885efa4c7` | splits, formatting, split reader, per-season percentiles |
| Transfer Portal | `1fb03a1952` | `lib/portal.ts`: types, baseline, board order, rating text |
| Compare (tray + view) | `84f80d56be` | none needed |
| Favorites, tab titles, tab menu | `14741bcba5` | none needed |
| Split view | `c3a51ff177` | none needed |
| Panes lay out by their own width | `f9f4655733` | none needed |
| Ctrl K acts on the page in front | `2f1857eceb` | none needed |
| Get started checklist | `cfe5f0c33f`, `5ce898a842` | none needed |
| Win Calculator | `9b191d824d`, `d9175842ee` | `lib/win-calc.ts`, `lib/condition-stats.ts` (`f2ac21fd89`) |
| Scoreboard and game pages | `60a750a284` | `lib/scoreboard-core.ts`, `lib/game-stats.ts` (`663034bd28`), `lib/side-colors.ts` (`a45210b443`) |
| Ctrl K: questions, nights, matchups | `dd80bc7dc1` | none needed |
| Workspaces | `feda915f37` | none needed |
| Home | `f07d2e4df6` | none needed |
| Game log rows open their game | `548bc9d9be`, `5fbcc30389` | none needed |
| Details rail on team and player pages | `9624606b61` | `overrideTeam` exported from `lib/win-calc.ts` |
| Pinned tabs; Ctrl K opens on Recent and finds open tabs | `03ec71a816` | none needed |
| Coaches table and coach pages | `bd7f111935` | `lib/coaches-core.ts`, `lib/coach-views.ts` (`7caf084b3a`) |

How the extractions were checked. `win-calc`: every prepared row of four real
seasons, 400 random questions (record, margin, the exact matching games), 36
parse-and-merge cases and every formatter, all equal. `scoreboard-core` and
`game-stats`: 2,758 component renders byte-identical across 22 slates and 17
game bundles in 7 states, plus every day from 2013-09 to 2027-07 and all 74,307
archived games. `side-colors`: all 142,884 ordered pairs of team names equal.
`coaches-core` and `coach-views`: 539,671 data checks (all 804 profiles, every
pipeline step, every sort key both ways, filter and scope combinations, the
bracket name matcher) and 3,564 rendered-markup comparisons (/coaches under 145
URL states, all 804 profile pages and their metadata), all identical.

### How the new pieces work

- **Win Calculator.** The question is a row of chips (Season is 2025-26, Team is
  Duke, 3P% ≥ 40 %). Filter adds any scope or stat from one searchable list; a
  stat left without a value is a dashed chip and a column. Drag a chip by its
  name, or Alt+← → from its value box, to reorder the columns. No Calculate
  button: the answer follows every change. Ask in plain English at the top. A note
  says when games in scope have no value for a condition. The question lives in
  the tab. A row now opens its game.
- **Scoreboard.** `[` and `]` step to the previous and next night with games; the
  week strip and calendar jump anywhere from 2013-14 to next season's fixtures.
  Filter by tournament, Top 25, tier or one conference; Ctrl F by team. Arrow keys
  walk the cards; Enter opens the game (Ctrl new tab, Shift beside).
- **Game page.** Overview (leaders, four factors, each team's last five and the
  last meetings, team stats, game info, standings), Box score, Play by play.
- **Game logs open games.** Team and player logs carry no game id, so a row finds
  its game on that night's slate. Measured on every team row from 2014 to 2026:
  about 95% find their game, and none finds the wrong one. The rest fall on nights
  the archive's slate is short (it holds 23 of the games on 2025-11-06), and those
  rows open what they opened before, with a toast saying why. Wired into both game
  logs, both profiles' game tabs, Recent games, Best games and the Win Calculator
  (95.5% in 2025-26, 88.8% in 2020-21).
- **Details rail** (Attio's record details, Linear's issue sidebar). Down the right
  of a team page: conference, coach, how the NCAA tournament went, then every
  season on record grouped under each coach's run, each one a click to that
  season, then the Win Calculator and the page on btacbb.xyz to open or copy. A
  player's rail names the team around him that season and his seasons. Ctrl+I
  shows or hides it on every profile at once; it only appears in a wide pane.
- **Coaches.** Under Teams. The table ranks every coach since 2012-13 the way
  /coaches does, chips against all 804 coaches, active coaches by default. A
  coach page has six numbers with chips, Overview (schools, signature seasons,
  every NCAA run, career marks), a Seasons table with that season's ratings, and a
  rail with the ranks. Every school and season opens that team in that season;
  coach names on team and player rails and in Ctrl K open the coach page.
- **Workspaces.** The account menu at the top of the sidebar: separate sets of
  tabs, each remembered, switch from the menu or Ctrl K. Delete has Undo.
- **Home.** The first tab on a fresh launch: an Ask box for the Win Calculator,
  Jump back in (the last places visited), how last season ended, the top teams
  and players with chips.
- **Pinned tabs.** Right-click a tab, or Ctrl K "Pin tab". A pinned tab is its
  mark alone at the left. Going somewhere else from it opens a new tab instead of
  replacing it; Close other tabs leaves it; it survives a relaunch.
- **Ctrl K.** With nothing typed it leads with Recent (Notion's search opens that
  way). Typing searches teams, players, coaches, open tabs by name (with the Ctrl
  number for each), and views; a question asks the Win Calculator, a date opens
  that night, "A vs B" predicts it. On a record page it leads with that page's
  actions.
- **Favorites, split view, Compare, Get started** as before: Ctrl+D stars a tab;
  Shift+Enter opens a row beside the table (F6 between panes); C or drag adds to
  the compare tray; five tips in the sidebar tick themselves off.

### Against Linear, Attio and Notion

I had the three read closely (Linear's published CSS tokens, Attio's and Notion's
help centers, and the actual Windows installers). Where the app already matched:
28 px sidebar rows at 13 px on a dimmer chrome ground, section headers that fold,
a per-tab history, Ctrl+T / Ctrl+W / middle-click, a keyboard-first table with
Peek on Space, three-part filter chips (Win Calculator), a bottom-right toast, and
a "Restart to update" row when an update is ready (Slack's pattern). Adopted
tonight: pinned tabs, Recent before typing in Ctrl K, open tabs searchable in
Ctrl K, the record details rail with Ctrl+I, and a Home.

The installer matches what Linear and Notion ship today: electron-builder NSIS,
one click, per user with no admin prompt, launches when done, updates silently in
the background. Not adopted on purpose: Inter and Linear's near-black palette. The
app keeps the site's Schibsted Grotesk, paper, ink and azure, so it reads as
Beyond the Arc.

## Site issues found while porting (not changed on the site)

- **Matchup card, light theme.** The right half's wash is painted over the left
  team's full-width wash, so the right team shows as a mix of both colors.
- **Conference marks on the dark theme.** About a third of the league marks are
  navy or black ink and nearly vanish. The app adds a faint light halo.
- **Conference pace chips.** The site paints Pace good-to-bad; the Team Explorer
  treats tempo as having no better end. The app paints them neutral.
- **Portal returners.** Four players' ratings come from an earlier season, but the
  hover text spells out last season's terms.
- **Game page, Total row.** A total equal to the over/under reads "under", and a
  live game reads "under at" its running total (`gameInfoRows`).
- **Game leaders.** The assists line prints "null TO" and "null MIN" when the feed
  has no count.
- **Play by play.** Overtime headings read "OT half" and "2OT half".
- **Head to head.** A meeting with no recorded winner counts as a home loss and
  wears the opponent's crest under "Won" (`h2hTally`).
- **Score ticker.** Ignores `tbd` and prints a midnight tip time for fixtures.
- **Team links on the scoreboard and game header.** Two local `teamSlug` copies
  build links from CBBD's spelling without the name matcher, so some 404.
- **Win Calculator, partial stats.** Fast break, paint and second-chance points
  are missing from 30 to 55% of games before 2022-23, and a condition on them
  quietly answers from the games that have them. The app says how many it could
  not see; the same note would fit /calc.
- **parse-query and 2021.** The function still tells the model 2021 is absent,
  but `seasons.ts` now keeps 2020-21, so that season cannot be asked about.
- **Coach profile tournament record.** Built from round labels, while the rank
  beside it and the index count the bracket: Dana Altman reads 17-9 on his
  profile and 16-9 in the index.
- **Tied coaches get different chips** on /coaches: `coachStatPercentiles` ranks
  by sorted position, the method `percentile.ts` warns against.
- **Coach sort comparators** return 1 when both values are null, or NaN when both
  seasons have no rank (`coach-views.ts`).
- **Composite comment.** Says the blueblood missed-tournament penalty is -2.5; the
  code gives -3.5.
- **2012-13 coach seasons** carry no conference or ratings (the ratings window
  starts in 2014), yet the pages say the data covers 2012-13. The style panel's
  comment says 30 coaches have no style data; 291 do not.
- **Coach slugs.** "Donte Jackson" and "Donte' Jackson" produce the same slug.

## Decisions I made that you may want to overrule

- **The Win Calculator answers live.** No Calculate button.
- **Win Calculator columns.** Quad always shown, and every condition column
  carries a percentile chip against that season's games (the site shows none).
- **Chips on the Player Game Log.** The site's page shows none. The app ranks each
  stat against every player-game of the season.
- **The details rail is open by default** on every profile in a wide pane.
- **A game log row opens the game**, not the team or player, on every log. Where
  the slate lacks the game it falls back and says so.
- **Coaches default to active.** The table opens on the 362 active coaches.
- **Coaches wear initials**, with the school's crest tucked in at larger sizes:
  the data has no coach headshots.
- **Update files are public.** The installer and `latest.yml` live on the public
  R2 bucket under `desktop/`. The app opens nothing until an entitled account
  signs in.
- **Early access is admins only.** `DESKTOP_ACCESS` in
  `netlify/shared/desktop-auth.mts`; change "admin" to "paid" to open the app to
  Season Pass holders.

## Built, but waiting on you to go live

- **Sign-in handoff** (PKCE, per docs/desktop-app-plan.md):
  `supabase/migrations/012_desktop_auth.sql` (not applied),
  `netlify/functions/desktop-authorize.mts`, `desktop-token.mts`,
  `desktop-download.mts`, `src/app/desktop/connect`, and a guarded `?next=` on
  the login page. To go live: apply the migration, deploy, then sign in from the
  app.
- **Installer.** `cd desktop && npm run dist` builds
  `release/Beyond-the-Arc-Setup-<version>.exe`. Unsigned, so SmartScreen warns
  until Azure signing.
- **Auto-update.** Checks the public feed every 6 hours once installed.

## Not done yet

- **Record panes** on team and player pages beyond the rail (question 1).
- **Saved views** beyond favorites and workspaces.
- **Linear-style menu and palette sizing.** Linear's menus use 32 px rows and a
  720 px palette with 46 px rows; ours are 30 px and 640 px with 36 px. Left as
  they are until you have seen them side by side.

## What still has to happen

**To put the desktop app in people's hands (in order):**
1. Apply `supabase/migrations/012_desktop_auth.sql` to the live project.
2. Deploy the site: desktop sign-in functions, `/desktop/connect`, the parse-query rate limit, Season Pass access, and the coach fixes.
3. Sign in from the app with both test accounts; confirm the premium one sees everything but admin.
4. Code signing (Azure Trusted Signing), so SmartScreen stops warning.
5. `npm run dist`, upload the installer and `latest.yml` to R2 `desktop/`, and open the site's download button to Season Pass holders (it is behind the admin gate today).

**Still to build:**
- **Admin dashboard in the app** (you asked for it later): subscribers and trials, webhook heartbeat, data checks, the site banner, hand-confirmed transfers, and who is on which app version. The site's /admin has most of this; the app would read the same `admin-config` function.
- **Richer record panes** once their data has a gated endpoint.
- **Menu and palette sizing** to Linear's (32 px menu rows, 720 px palette), after you compare them.
- **Site issues listed above**, each a small fix, none urgent.
- **Before promotion:** the sources and attribution page with a terms review (docs/TODO-legal-sources.md).

## Questions

1. Deploy when you are ready? Everything above except the paywall fix waits on it, and it is a shared-component change, so expect the long upload.
2. Apply migration 012 to the live project (needed for desktop sign-in)?
3. Delete `test@test.com` now, or keep it retired until launch?
