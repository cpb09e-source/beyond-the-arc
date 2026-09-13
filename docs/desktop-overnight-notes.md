# Desktop app: overnight notes for Colin (2026-09-13)

Working log from the overnight build-out. Nothing was deployed, nothing was
written to the live Supabase project, nothing was purchased, and no network data
pulls ran. Everything below is committed and pushed unless it says otherwise.

## Needs your attention first

### 1. Paywall hole on the live site (found, not fixed)

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

### 2. `/api/parse-query` is open to anyone

The Win Calculator's plain-English endpoint has no sign-in requirement and no
rate limit of its own, and each call spends Anthropic tokens (up to two model
calls, ~60 s). Anyone can script it. Worth at least a per-IP rate limit, or
requiring a signed-in user. The desktop app now calls it too (from the main
process, never with a key of its own) and already sends the reader's session
token, so requiring an account would not break the app.

## Built tonight

Each one driven end to end over CDP in both themes with no console errors, and
each one reuses the site's logic: where that logic was trapped in a component it
moved to `src/lib`, the site imports it from there, and the site's output was
proven unchanged (rendered before and after, or checked function by function
against the HEAD code on real data).

| View | Commit | Shared out of the site |
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
| Ctrl K: questions, nights, matchups, coaches | `dd80bc7dc1` | none needed |

The three extractions behind the new views were checked this way:
`win-calc`: every prepared row of four real seasons, 400 random questions
(record, margin, the exact matching games), 36 parse-and-merge cases and every
formatter, all equal. `scoreboard-core` and `game-stats`: 2,758 component renders
byte-identical across 22 slates and 17 game bundles in 7 states, plus every day
from 2013-09 to 2027-07 and all 74,307 archived games. `side-colors`: all
142,884 ordered pairs of team names equal.

Shell changes that came with them: history carries each tab's query, views can
be pinned to one season or be seasonless (Compare, the Win Calculator, the
Scoreboard: no season on their tab or favorite), a shared popover and keyboard
list for every chip and picker, a game record kind (tabs and favorites draw its
two crests), and Enter or the arrows in any field other than a table's own
filter box now stay in that field.

### How the new pieces work

- **Win Calculator.** The question is a row of chips (Season is 2025-26, Team is
  Duke, 3P% ≥ 40 %). The Filter button adds any scope or stat from one searchable
  list; a stat left without a value is a dashed chip and a column. Drag a chip by
  its name, or Alt+← → from its value box, to reorder the columns. There is no
  Calculate button: the answer follows every change. Ask in plain English at the
  top. The answer shows win rate, record, margin and games, a bar per season (click
  one to see its games), and a note when games in scope have no value for a
  condition (Kansas road games under Bill Self: 93 of 139 have no fast break
  points, most before 2022-23). The whole question lives in the tab.
- **Scoreboard.** `[` and `]` step to the previous and next night with games; the
  week strip and the calendar jump anywhere from 2013-14 to next season's
  fixtures. Filter by tournament, Top 25, tier or one conference; Ctrl F by team.
  Arrow keys walk the cards; Enter opens the game (Ctrl new tab, Shift beside).
- **Game page.** Overview (leaders, four factors, each team's last five and the
  last meetings, team stats, game info, standings), Box score, Play by play. Every
  school opens its team page, every player his profile, every form cell that game.
- **Ctrl K.** Type a question to ask the Win Calculator, a date to see that
  night, "A vs B" to predict it. Coaches are searchable and open the calculator on
  their games. On a team or player page, Ctrl K leads with that page's actions.
- **Favorites.** Ctrl+D stars the tab in front: the view, season, filter and
  record, under the tab's name. They sit at the top of the sidebar and lead
  Ctrl K. Double-click renames; × removes with Undo.
- **Split view.** Shift+Enter on any row (or in Ctrl K) opens it beside the
  table, and the table keeps the keyboard. F6 moves between panes; Ctrl+Shift+\
  turns it on and off; drag the divider.
- **Compare.** C on a row, drag a row to the tray, or Compare on a page. Up to
  four, any seasons.
- **Get started.** Five things worth knowing, in the sidebar, ticking themselves
  off wherever they are first done. × hides it for good.

## Site issues found while porting (not changed on the site)

- **Matchup card, light theme.** The right half's wash is painted over the left
  team's full-width wash, so the right team shows as a mix of both colors. The
  app mixes each wash against the card instead.
- **Conference marks on the dark theme.** About a third of the league marks are
  navy or black ink and nearly vanish. The app adds a faint light halo in dark
  mode only.
- **Conference pace chips.** The site paints Pace good-to-bad; the Team Explorer
  treats tempo as having no better end. The app paints them neutral.
- **Portal returners.** Four players' ratings come from an earlier season, but the
  hover text spells out last season's terms. The app's Peek names the season.
- **Game page, Total row.** A total equal to the over/under reads "under", and a
  live game reads "under at" its running total (`gameInfoRows`).
- **Game leaders.** The assists line prints "null TO" and "null MIN" when the feed
  has no count (the app shows a dash).
- **Play by play.** Overtime headings read "OT half" and "2OT half".
- **Head to head.** A meeting with no recorded winner counts as a home loss and
  wears the opponent's crest under "Won" (`h2hTally`).
- **Score ticker.** Ignores `tbd` and prints a midnight tip time for fixtures.
- **Team links on the scoreboard and game header.** Two local `teamSlug` copies
  build links from CBBD's spelling without the name matcher, so some 404.
- **Win Calculator, partial stats.** Fast break, paint and second-chance points
  are missing from 30 to 55% of games before 2022-23 (second-chance entirely in
  2020-21), and a condition on them quietly answers from the games that have them.
  The app now says how many games in scope it could not see; the same note would
  fit /calc.
- **parse-query and 2021.** The function still tells the model 2021 is absent
  from the data, but `seasons.ts` now keeps 2020-21 (flagged, not excluded), so a
  question about that season cannot be asked in plain English.

## Decisions I made that you may want to overrule

- **The Win Calculator answers live.** No Calculate button; typing a value updates
  the answer. The site's button existed partly for phones.
- **Win Calculator columns.** Quad is always shown (the site shows it only when
  narrowed), and every condition column carries a percentile chip against that
  season's games (the site shows none).
- **Coaches in Ctrl K open the Win Calculator** filtered to that coach, until
  there is a Coaches page.
- **Chips on the Player Game Log.** The site's page shows none. The app ranks each
  stat against every player-game of the season, with no chip on the five stats
  that are zero in most games and neutral chips on minutes, attempts and usage.
- **Update files are public.** The installer and `latest.yml` are meant to live
  on the public R2 bucket under `desktop/`. The app opens nothing until an
  entitled account signs in, so a shared installer is harmless.
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
  `release/Beyond-the-Arc-Setup-<version>.exe` (one-click, per user, registers
  btacbb://). Unsigned, so SmartScreen warns until Azure signing.
- **Auto-update.** Checks the public feed every 6 hours once installed.

## Not done yet

- **Coaches page.** The coach data lives in `src/data` (see question 4).
- **Record panes** on team and player pages (question 1).
- **Win Calculator rows open the team, not the game.** The game logs key games by
  CBB Analytics id and the game pages by CBBD id, and no deployed file joins the
  two (question 6).
- **Saved views beyond favorites, and workspaces.**

## Questions

1. The team and player record pages on the site read files that are never
   deployed (`teams-all.json`, `team-splits/`, `players-by-year/`,
   `lineup-stats/`, `team-seasons/`, `assist-network.json`). An installed app
   cannot reach them. Publish them to R2 for the app, or should the app's record
   panes use only what is already public?
2. Apply the paywall fix above?
3. Open the desktop app to Season Pass holders now, or keep it admin-only?
4. Coaches: `src/data/coach-history.json` (1.2 MB) is bundled into the app today,
   so a coaching change needs an app update. Publish it with the site's data
   instead, so the app reads it like everything else?
5. Put a sign-in requirement or a rate limit on `/api/parse-query`?
6. Worth building a small CBBA-to-CBBD game id join at export, so Win Calculator
   rows can open their game pages?
