# Game Log Explorer

`/players/games` — one row per player per game, across every season on the
site. Built 2026-08-30.

The other explorers aggregate a season, a career or a conference. This one
refuses to: the unit is a single night, which is the only unit that can answer
"who went for 40 and 20", "how many triple-doubles were there", "has anyone had
a 5×5".

## The corpus

`scripts/build-game-index.mjs` → `public/data/game-index/<year>.json`
(gitignored, mirrored to the public R2 bucket — see
`docs/data-storage-and-backup.md`)

    node scripts/build-game-index.mjs                # every season
    node scripts/build-game-index.mjs --season 2026  # one

Reads `public/data/player-games/<bartId>.json` (24,653 files, 569 MB, 1.37 M
rows) and pivots it into season-shaped files. Player identity — name, team,
conference, class, whether a profile page exists — is joined from
`public/data/players-explorer/<year>.json`, which is the same source the
players table uses, so the two agree by construction. A player-game whose
player has no explorer row is dropped: those are non-D1 roster rows riding
along in the per-player files, and there is nothing to name them with.

Output, per season: ~115k rows, ~7 MB raw, ~2.3 MB gzipped.

| season | rows | | season | rows |
|---|---|---|---|---|
| 2014 | 112,561 | | 2022 | 111,582 |
| 2015 | 112,001 | | 2023 | 115,992 |
| 2016 | 113,912 | | 2024 | 116,924 |
| 2017 | 113,513 | | 2025 | 118,245 |
| 2018 | 112,761 | | 2026 | 118,533 |
| 2019 | 113,859 | | | |
| 2020 | 107,741 | | | |

2021 has no file — the COVID season is absent site-wide.

**Rerun it whenever `player-games` or `players-explorer` is rebuilt.** Nothing
runs it automatically; it is a data build like the other `pull:`/`build:`
scripts, not part of `next build`.

### Shape

A per-season player table holds every string; rows are all integers.

    { season, epoch, fields, classes,
      players: { ids, names, teams, confs, cls, page, rank },
      opps: [...],
      rows: [[p, d, f, o, min, pts, fgm, fga, fg3m, fg3a, ftm, fta,
              orb, reb, ast, stl, blk, tov, pf, usg, ortg, drtg], ...] }

- `p` indexes the player table, `o` the opponent table.
- `d` is days since `epoch` (the season's first game).
- `f` is flags: 1 home, 2 neutral, 4 won, 8 started.
- `usg` is per mille; `ortg`/`drtg` are ×10. Everything else is a raw count.

**Nothing derivable is stored.** FG%, 3P%, FT%, eFG%, TS%, DRB, P+R+A, STL+BLK
and Game Score are all computed in the browser by `src/lib/game-index.ts`. A
stored percentage costs six bytes a row and the division costs nothing.

The field order is written twice — `FIELDS` in the build script and `F` in
`src/lib/game-index.ts`. They are one contract; change both.

## The page

`src/app/players/games/page.tsx` prerenders a shell. Nothing is passed from the
server — a season is 7 MB and serialising one into the RSC payload would put it
in the HTML of a page most people open to look at one season.
`src/components/games/games-client.tsx` fetches
`/data/game-index/<year>.json` on demand and keeps what it has fetched.

**The default IS an answer**: current season, sorted by Game Score descending,
so the first screen is the best games anyone had before a control is touched.

Controls: seasons (multi), conference, team (narrowed by the conference
picker), class, view, a shortcuts row, a filter builder, a player search, and a
row cap. Everything lives in the URL, so any table here is a link.

Views: Overview, Scoring & Shooting, All-Around, Advanced, Everything.

Shortcuts are filter sets, not modes — clicking one leaves you inside the
builder with its chips showing: 40-point games, triple-doubles, 20 & 10, 5×5,
8+ threes, 7+ blocks, 12+ assists, perfect 15+.

### Filters

`?f=pts:ge:30,reb:ge:10` — stat, comparison (`ge`/`le`/`eq`), value, ANDed.

Percentages are typed as percentages and stored as fractions (`TS% ≥ 70` →
`0.7`). A blank stat fails every comparison rather than passing one, so
`3P% ≥ 50` cannot return games where nobody attempted a three.

### Why it is fast

115k rows a season, 1.37 M across the archive, and the screen shows at most
500. `selectRows` does one linear pass that allocates nothing per row and keeps
a bounded sorted array of `limit` hits, comparing each row against the worst
one kept. Player-level filters (conference, team, class, name) resolve once per
player into a `Uint8Array`, not once per game.

Rows stay packed number arrays for their whole life. Materialising them as
objects would allocate 115,000 to display 100.

## Gating

The whole page is one **preview** — `GAME_LOG_ACCESS` in `src/lib/access.ts`.
Not a per-view map like the other two tables, because every view here is the
same box score from a different angle and none of them is "the free one".

What a Pass buys is the **ranking**: the full list rather than its top five,
sorting by any column, more than one season at once, and the download. What a
free reader gets is real: shortcuts, filters and search all run, so picking
"40-point games" returns the actual top five of the games that cleared it.

Enforced on the query (`scoped`), never on the controls — a URL can carry a
twelve-season sort no picker on the page would have built. Under a preview the
sort is forced back to Game Score desc, or the padlocked headers would be
decoration. The URL is never rewritten, so subscribing restores the exact table
the reader was looking at.

## Not done

- **No percentiles**, deliberately. A single game's rank among a hundred
  thousand is not a number anyone reads, and an empty chip column would look
  like data we failed to compute.
- **No team-game mode.** `public/data/game-logs-by-year/<year>.json` already
  holds team game logs (12k rows a season, with margins and four-factor
  diffs) if a "best team performances" table is ever wanted — same page shape,
  different corpus, no new pipeline.
- **No game link.** `player-games` carries a `game_id`, but the box-score
  route was not wired up here.
