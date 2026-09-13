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
requiring a signed-in user.

## Built tonight

Each one driven end to end over CDP in both themes with no console errors, and
each one reuses the site's logic: where that logic was trapped in a component it
moved to `src/lib`, the site imports it from there, and the site's output was
proven unchanged by rendering the component to static HTML before and after.

| View | Commit | Shared out of the site |
| --- | --- | --- |
| Team Scatter | `d62a23e2ce` | `topByNet` into `lib/scatter-team.ts` |
| Matchup Predictor | `532754707c` | `lib/matchup-inks.ts`, `lib/use-tween.ts`, counterfactuals, ledger, URL state and moves into `lib/matchup.ts` |
| Conference Power Rankings | `2885efa4c7` | splits, formatting, split reader, per-season percentiles |
| Transfer Portal | (this push) | `lib/portal.ts`: types, baseline, board order, rating text |

Shell changes that came with them: history carries each tab's query (Alt+Left
restores a filter or a matchup), views can be pinned to one season, `openView`
opens any view with a starting query (a team page's Matchup button), table
column bands and a pinned-first group, and conference marks through `bta://conf`.

## Site issues found while porting (not changed on the site)

- **Matchup card, light theme.** The right half's wash is painted over the left
  team's full-width wash, so the right team shows as a mix of both colors
  (Michigan against Duke draws Duke's half olive). The app mixes each wash
  against the card instead. Same two-line fix would apply to
  `matchup-view.tsx`.
- **Conference marks on the dark theme.** About a third of the league marks are
  navy or black ink and nearly vanish (Big Ten, ACC, C-USA, CAA). The app adds a
  faint light halo in dark mode only.
- **Conference pace chips.** The site paints Pace good-to-bad, while the chip's
  own guidance (and the Team Explorer) treats tempo as having no better end. The
  app paints them neutral.
- **Portal returners.** Four players' ratings come from an earlier season at the
  school they are returning to (`rating_basis: "return"`), but the site's
  hover text still spells out last season's terms, which do not add up to the
  rating. The app's Peek says which season the rating is from instead.

## Decisions I made that you may want to overrule

- **Chips on the Player Game Log.** The site's page deliberately shows none. You
  asked for chips throughout, so the app ranks each stat against every
  player-game of the season, with no chip on the five stats that are zero in
  most games (blocks 77%, made threes 58%, steals 57%, offensive rebounds 51%,
  made free throws 51%) and neutral chips on minutes, attempts and usage.
- **Update files are public.** The installer and `latest.yml` are meant to live
  on the public R2 bucket under `desktop/`. electron-updater forwards
  Authorization headers to storage that rejects them, and the app opens nothing
  until an entitled account signs in, so a shared installer is harmless. The
  download button stays admin-only.
- **Early access is admins only.** `DESKTOP_ACCESS` in
  `netlify/shared/desktop-auth.mts`; change "admin" to "paid" to open the app to
  Season Pass holders. Every sign-in and every hourly refresh re-checks it.

## Built, but waiting on you to go live

- **Sign-in handoff** (PKCE, per docs/desktop-app-plan.md):
  `supabase/migrations/012_desktop_auth.sql` (not applied),
  `netlify/functions/desktop-authorize.mts`, `desktop-token.mts`,
  `desktop-download.mts`, `src/app/desktop/connect`, and a guarded `?next=` on
  the login page (`src/lib/auth/safe-next.ts`). To go live: apply the migration,
  deploy, then sign in from the app.
- **Installer.** `cd desktop && npm run dist` builds
  `release/Beyond-the-Arc-Setup-<version>.exe` (one-click, per user, registers
  btacbb://). Unsigned, so SmartScreen warns until Azure signing.
- **Auto-update.** Checks the public feed every 6 hours once installed; "nothing
  published yet" reads as up to date.

## Questions

1. The team and player record pages on the site read files that are never
   deployed (`teams-all.json`, `team-splits/`, `players-by-year/`,
   `lineup-stats/`, `team-seasons/`, `assist-network.json`). An installed app
   cannot reach them. Publish them to R2 for the app, or should the app's record
   panes use only what is already public?
2. Apply the paywall fix above?
3. Open the desktop app to Season Pass holders now, or keep it admin-only?
