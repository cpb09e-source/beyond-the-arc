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

## Done on 2026-09-13, afternoon

- **Test accounts renamed, at your request:** `admin@btacbb.xyz` (admin + Season Pass) and `premium@btacbb.xyz` (Season Pass, not admin), both on the short password you chose. Both signed in and checked: admin sees paid seasons and /admin, premium sees paid seasons and is refused /admin. Change or delete both before promotion.
- **Migration 012 applied** to the live Supabase project (the one-time sign-in codes table, row level security on, no client policies). Run alone with `supabase db query --linked -f`, not `db push`, so no older migration was replayed.
- **The desktop app requires an account with Season Pass**, and says so:
  - The sign-in screen: "Log in to Beyond the Arc", one button that finishes in the browser, a still of the workbench beside it on wide windows.
  - Waiting shows the three steps, reopens the page, or copies the link.
  - A free account is told the desktop app comes with Season Pass, with Get Season Pass, "I have subscribed, continue", and a different-account link. The site's connect page says the same before Allow.
  - The login is kept, encrypted with Windows' own protection, and renewed in the background, so closing and reopening the app does not ask again. The first screen waits for the saved login, so a signed-in reader never sees the sign-in screen flash.
- **Download for Windows** on the account page, for every account the app is open to. `/api/desktop/download` follows the same rule as signing in (Season Pass and admins).
- **Installer 0.1.0 built and published** to R2 `desktop/` (installer, blockmap, update feed), with `desktop/scripts/publish-release.mjs`, which uploads the feed last and only after the installer checks out. Unsigned: Windows SmartScreen warns until code signing.
- **Zone column removed** from the Team Explorer.
- **Linear sizing:** menu rows 32 px, Ctrl K 720 px wide with 40 px rows.
- **No clipped names or headers**, from an audit of every view: wider Win Calculator opponents, Coaches conference and titles, coach seasons headers, game log stat headers. The only ellipsis left is a long tab title when several tabs share the strip, as in a browser.
- **Coach page fixes committed** (Altman's record, tied chips, sort order, stale comments).
- **In progress, then the deploy:** the small site fixes from the notes, and the sources, terms and privacy pages.

## Done on 2026-09-13, evening

- **One action registry** (`desktop/src/renderer/src/objects/`). Every team, player, coach, game, game log row and conference is an object with one list of actions: open, open in a new tab, open beside, Peek, compare (C), favorite (F), Go to (Team Explorer, Team Scatter, game log, Matchup, Win Calculator), the related team, coach or opponent, Filter (conference, opponents, roster), Snapshot card, Copy stats, Copy link, Open on btacbb.xyz. The same list drives:
  - right-click on every table row, scoreboard card, scatter crest and linked name, with Go to, Filter and Share folded to the side;
  - `.` or Shift+F10 on the focused row, and C and F on it;
  - Peek's new buttons (Open, Beside, Compare, ⋯);
  - Ctrl K: the page's own actions, and Tab on any result for everything that result can do;
  - record page headers (buttons, then ⋯) and the details rail's Go to and Share;
  - a tab's right-click menu, which now starts with the page's own actions;
  - drag: a row, card, crest or name drops on the compare tray, the tab strip (new tab), the right of the pane (open beside) or the sidebar (favorite).
- **Column headers right-click:** sort either way, reset, hide a column (remembered per table), bring hidden columns back.
- **Exact filters, in words:** `team: Michigan`, `conf: Big 10`, `opponents: Michigan`, `player: Cooper Flagg`. The Filter and Game log actions write them into the filter box, where they can be read, changed or cleared with Esc. A filter set this way is a step in the tab's history, so Alt+Left returns to the whole table.
- **Copy stats:** a few lines of the object's numbers with their percentiles and the page's link.
- **Snapshot cards** (`desktop/src/renderer/src/snapshot/`): team, player, coach and game, Wide 1200 × 675 or Square 1080 × 1080, previewed at size, then Copy image or Save PNG. Captured from the window's own pixels, so crests draw exactly as they do on screen. Ctrl+Shift+S copies the whole view as an image with a foot naming it. Player cards follow your notes: PPG, RPG, APG over FG%, 3P%, FT%; position and class badges and the Drafted badge with the NBA mark in place of Bart's "Stretch 4"; an Impact ledger (EPM, offense, defense, eWins, TS%, USG%) in place of the bars.
- **NBA marks** load through the app's own asset protocol (`bta://nba/`): the page itself does not reach ESPN, the main process does.
- **Contender zone removed** from team pages, the team Peek and team cards, at your request. Team Scatter keeps its trapezoid chart, which is what that view is.
- **Electron 44's clipboard** is the W3C shape now (`clipboard.write([ClipboardItem])`, and `writeText` returns a promise); `writeImage` is gone.
- **Site deploy:** built and checked locally (overtime headings, the push line, TBD tip times, the conference logo halo in dark, the matchup wash). Every game page changed, so all 743,070 are uploading to R2 before `netlify deploy`.
- **Lasso and linked views** (`desktop/src/renderer/src/selection/`). One selection of teams in a season, shared by every tab and both panes of split view:
  - Team Scatter: drag across the empty chart to lasso (Shift adds, Alt takes away, a click on the chart lets go), Shift-click a crest to toggle it, Ctrl+A for every team shown, Esc to let go. Picked crests take an accent ring and the rest fade; "Selected teams" is a field.
  - Team Explorer: picked rows are tinted; Ctrl-click, Shift-click, X, Shift with the arrows and Ctrl+A pick; "Selected only" narrows the table; `teams: Duke, Houston` filters exactly.
  - Linked hover: the row under the pointer rings its crest in the other pane, and a crest outlines its row.
  - A floating selection bar: the count, the picked teams' average net, offense, defense and tempo and their record together, with Compare (two to four), Team Explorer, Team Scatter, Game logs, Win Calculator, Copy as a table and Clear. The same actions lead Ctrl K and the right-click menu of a picked team.
  - In a narrow pane the scatter's team list steps aside, so the chart keeps the room.

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

## Done on 2026-09-13, midday

- **Profiles show the site's stat cards.** Player and team Overviews draw the
  Player Overview and Team Stats cards from btacbb.xyz, with View, Split and
  Basis, read from `player-splits/<bartId>.json` and `team-splits/<year>.json`.
  The card definitions moved to `src/lib/player-stat-cards.ts` and
  `src/lib/team-stat-cards.ts`; the site imports them from there.
- **Best games and last 5 side by side** on a player's page, Game Score not shown.
  A team's page pairs its record splits with its last five games.
- **Profile game logs are plain numbers**, no chips, with the site's column
  views (Everything by default, remembered).
- **Game page:** team stats on the left and larger, one ink for both teams with
  the row winner heavier; four factors removed; Game info is its own tab.
- **Team splits on R2** (13 files, 23 MB, uploaded 2026-09-13 with Colin's OK):
  the site reads them only while building, so they were never deployed; an
  installed app reads `team-splits/<year>.json` from the public bucket.
  `scripts/sync-data-to-r2.mjs` now includes the folder.

## Done on 2026-09-13, afternoon

- **Focus.** Point at a team, player or conference and hold Q: every open pane
  follows it. The Team Explorer lights the row, Team Scatter isolates the crest,
  the game logs, the Player Explorer and the Win Calculator narrow to it, the
  Scoreboard dims other games and marks the team's nights, and Conference Power
  Rankings lights the league. Letting go restores every pane; a tap locks it
  until Q or Esc; "Focus every pane" is in every object's menu. Code:
  `desktop/src/renderer/src/focus/focus-mode.tsx`. Rows, crests and object links
  declare their object with `data-obj`, which is how Q reads what is under the
  pointer.
- **Stat Lens.** Alt-click or right-click a number in the Team or Player
  Explorer, or click a stat card row or a profile tile: every game as a bar
  against the season line, the number rebuilt for home and away, wins and
  losses, conference play, the last 5 and 10 and each month, and the best and
  worst games, each opening its box score. An adjusted rating shows the raw game
  figure and what the schedule adjustment is worth. Pooling rules are in
  `desktop/src/renderer/src/lens/lens-stats.ts`: shooting from makes and
  attempts, ratings from points and possessions; rebound rates and opponent eFG%
  weighted by possessions, and usage and player ratings by minutes, because the
  logs carry those per game. No lens for EPM, eWins or SOS.
- Both verified in split view over CDP with no errors.

## Done on 2026-09-13, evening

From the second feedback round, in the order agreed: the shared explain engine,
the Difference Explainer, What Changed, research history capture, and export.

- **The explain engine** (`desktop/src/renderer/src/explain/explain-model.ts`).
  A rating gap taken apart into shooting, turnovers, offensive rebounds, free
  throws and possession count at each end of the floor, plus the schedule, in
  parts that add up to the gap exactly. Points per possession is an identity in
  eFG% and turnovers, offensive rebounds and free throws per possession; the gap
  is shared among those groups by Shapley value (each group's effect averaged
  over every order), so no part depends on which went first. Defense is rebuilt
  from the opponent's own box score: every game now carries its opponent's row
  (`TeamGame.oppRow`), which exists for every game in all thirteen seasons.
  `desktop/scripts/check-explain.mts` checks about 50 pairs a season in 2014,
  2019 and 2026: the parts equal the gap to 1e-14, and raw ratings equal the
  Stat Lens's.
- **The possession count is its own part, not a rounding error.** The log counts
  possessions its own way (closest to the rounded average of both teams'
  box-score counts, still about 0.9 off per game). A team's own box-score count
  runs from 0.994 to 1.019 of the log's across 2025-26, worth up to about 2.5
  points between two teams, so it is shown and labeled rather than folded into
  another part. It hides itself when it is worth under a tenth.
- **Difference Explainer** (Tools; `views/difference/`). Two teams, from any
  seasons. Full season against the published adjusted ratings, or conference,
  non-conference or last 10 games raw; net, offense or defense. Each part opens
  into both teams' numbers at each end; each number opens its Stat Lens. Ways
  in: Explain on the selection bar with two teams picked, a team's right-click
  Go to ›, a team game log row ("Explain Duke vs Auburn"), Compare's Explain the
  difference, and typing "Duke vs Auburn" into Ctrl K.
- **What Changed** (Teams; `views/what-changed/`). One team: last 10 or last 5
  against the games before, since January 1, conference play against
  non-conference, or against last season on adjusted ratings with the BTA rank
  change. Who they played sits under the headline (record, average opponent,
  home, away and neutral), because a stretch of games has no adjusted rating.
  The games behind the change are arithmetic: each game's distance from the
  earlier figure, weighted by possessions, and the shares add up to the change.
  On every team page's header and in team menus.
- **New Stat Lens stats** for the explainer's numbers, from opponent rows:
  turnovers forced, offensive rebounds per 100 possessions and allowed, free
  throw attempts per 100 and allowed, opponent free throw %. Opponent eFG% is
  now pooled exactly from what opponents made and attempted, instead of the
  per-game rate weighted by possessions.
- **Research history** (`desktop/src/renderer/src/shell/research-history.ts`):
  captured, not shown yet. A visit once a tab has settled on a place, every
  registry and selection action, Focus, the Stat Lens and exports, each in plain
  words ("Michigan St.: what changed 2024-25", "Stat Lens: Duke, eFG%"), the
  newest 2,000 in localStorage under `bta.research-history`.
- **Export.** Right-click a column header, or a row's Export ›: copy the rows for
  a spreadsheet (tab-separated, pastes into cells) or save them as CSV (UTF-8
  with a byte-order mark so Excel keeps accents; Documents by default). All rows,
  or only the selected ones. Also Ctrl K "Copy this table for a spreadsheet" and
  "Save this table as CSV", and CSV on the selection bar. What is exported is
  what is on screen: the visible columns in order, the filter and sort, each
  cell's own text without its percentile chip, dates in full. No XLSX. The
  sources and terms review (docs/TODO-legal-sources.md) still applies before this
  is promoted, since it hands out numbers built on other people's data.
- Small: an exact name now comes first in pick lists, so typing "Michigan" into
  a team chooser picks Michigan rather than Michigan St.
- Verified over CDP with no errors: the Ctrl K typed row, a part opened and a
  number into its lens, both pickers, What Changed by window and against last
  season, the Go to › entries, both export menus, a 364-row copy read back off
  the Windows clipboard, the history steps, Explain from the selection bar and
  from Compare, and the dark theme.
- **Needs installer 0.1.1** to reach an installed copy, like everything since
  0.1.0.

## Done on 2026-09-13, night

- **Peek opens beside the name.** It sits just past the pinned rank and name
  columns, on the row's own line, instead of against the window's right edge.
  In a table too narrow for that it stays inside the right edge.
- **Filters with conditions** (`desktop/src/renderer/src/ui/filter-query.ts`).
  The filter box takes plain words, exact names and conditions together, in any
  order, every clause required: `conf: SEC net>20 tempo<68`,
  `team: Duke ts>60`, `margin>30 home=0`, `pts>=40`. Still words in the box, so
  favorites, history and Esc keep working on them.
  - Operators `>`, `>=`, `<`, `<=`, `=` (also ≥ and ≤). Numbers are typed as the
    table prints them (`efg>55`, not .55), and a row is compared as printed, so
    `net>20` never keeps a row that reads +20.0. A blank fails every condition.
  - Stat names come from the column headers (`3p`, `adjo`, `oppefg`, `oreb`) with
    the site's keys and a few common spellings as aliases (`pace` for tempo,
    `pts` for PPG). The game logs and Player Explorer take every stat in the
    site's catalogs, whichever column view is showing.
  - Half-typed clauses (`net>`, `conf:`) narrow nothing yet, so the table does
    not blink empty while typing. An unknown stat keeps nothing and says so:
    "No stat here is called “temp”."
  - `teams: A, B` now works on both player tables too.
- **Autocomplete** under the filter box: stats and `team:`/`conf:` forms for a
  word being typed; conferences, teams and players for a name; and once a stat
  has its operator, the values that cut the season at its highest or lowest
  10%, 25% and half, with how many rows each keeps and the season's range.
  Tab takes the first offer, ↑ ↓ and Enter take another, Esc closes the list.
  Enter with nothing picked still opens the focused row, as before.
- `desktop/scripts/check-filter.mts` checks the parser, the comparisons, the
  catalog names and the offers.
- Verified over CDP with no errors: Peek 8 px past the Team column;
  `conf:SEC net>20 tempo<68` (1 team), `efg>55 3p>=36` (26), the team game log
  `margin>30 home=0` (49 games), `ppg>20 3p>38` (13 players),
  `team: Duke ts>60` (3), `pts>=40` (42 player games); Tab, ↓ and Enter, Esc,
  and the unknown-stat message.

## Done on 2026-09-13, late night

- **The tables work as the site's pages do.** Team Explorer, Player Explorer
  and both game logs have:
  - the site's column views with their band captions: fourteen for teams,
    twelve for players, seven and five on the game logs;
  - Team, Conference, Class, Position and Opponent pickers, several names at once;
  - "Add a filter" rows (stat, comparison, value, with the season's typical
    range as the placeholder) and an "Add columns" picker, grouped and
    searchable. A stat filtered on or added leads the table under "Your
    columns", as on the site;
  - Save view: a favorite that keeps the filter, the view and the added columns;
  - Download: Excel workbook (formatted, percentile colors, an About sheet),
    Excel with one tab per chosen view, raw CSV, and Copy for a spreadsheet.
    The same builders as the site, so the same files, through a Save dialog and
    then Show in folder. Conference Power Rankings has Download too.
- **Still words underneath.** Every picker and row writes the filter box
  (`conf: SEC wab>=3`), and typing the words redraws them. A tab keeps its view
  and added columns beside its query, through Alt+Left, favorites and restarts
  (`desktop/src/renderer/src/shell/table-layout.ts`). New words: `class: Fr, So`,
  `pos: G`, and several conferences in one `conf:`.
- **The Player Explorer's extended stats** (the site's stat packs: a hundred more
  numbers in ten group files) load through a new `player-stats` corpus when a
  view or a filter needs them.
- **Moved on the site, unchanged.** The Team Explorer's columns, the Player
  Explorer's grid, and the game-log and conference export descriptors now live
  in `src/lib` (`team-explorer-columns.ts`, `player-explorer-columns.ts`,
  `game-log-export.ts`, `conference-export.ts`), and the site imports them, so
  both apps build from one copy. The site typechecks. Nothing it shows changed,
  so it can ride along with the next deploy.
- **Find Similar** (Tools, or Go to › Find similar on any team or player): the
  team-seasons (4,620) or player-seasons (31,959) since 2013-14 whose numbers look
  most like one, each number measured as it stood in its own season.
  - Match on Overall, Style, Offense or Defense for teams; Overall, Role,
    Scoring or Impact for players. Every season, other seasons, or the same one.
  - The chosen row leads the table, "Most alike in" and "Differs most" say why,
    and Peek sets the two side by side, stat by stat.
  - Withheld ratings are left out rather than guessed, and 2020-21 is tagged.
  - Houston 2025-26's closest is Houston 2024-25 (78). Cameron Boozer's is Riley
    Minix 2023-24, then Dylan Windler and Cooper Flagg.
  - `desktop/src/renderer/src/similar/` holds the model; the rarity detector
    should build on it.
- Development only: `BTA_EXPORT_DIR` writes a download there with no dialog, for
  scripted checks, as `BTA_CDP_PORT` opens the debugging port. A change to the
  main process needs the dev app restarted; electron-vite does not reload it.
- Verified over CDP with no errors: views and bands, `wab>=3` (35 teams) and
  `conf: SEC` (6), Add columns, Save view, three real files (a CSV of 6 rows with
  its Pctl columns, a workbook, a 13-tab workbook), the stat packs
  (`class: Fr pts>=500`, 30 players), the Opponent picker (38 games against
  Duke), Find Similar for a team and a player with both pickers, Peek, and the
  row menu.

## What still has to happen

**To put the desktop app in people's hands (in order):**
1. ~~Apply migration 012~~ done.
2. ~~Build and publish the installer~~ done (0.1.0).
3. ~~Deploy the site~~ done 2026-09-13: the connect page and the sign-in and download functions answer on btacbb.xyz. The legal pages stay on `legal-pages` until the entity name is filled in.
4. Install from the account page and sign in with both test accounts.
5. Code signing (Azure Trusted Signing), so SmartScreen stops warning.

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
