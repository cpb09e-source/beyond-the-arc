# Data sources

Every number on the site comes from one of the sources below. This is the
engineering reference; the user-facing attribution page (`/sources`, still to be
built — see `TODO-legal-sources.md`) is a separate, shorter thing.

---

## Current sources

### CollegeBasketballData (CBBD) — `api.collegebasketballdata.com`

The backbone. A licensed developer API, Patreon-billed, authenticated with
`CBBD_API_KEY`.

**Server-side only.** The key must never reach the client (CBBD's terms) and is
never committed. It lives in `.env.local` and in Netlify's env for the one
function that needs it.

Everything is archived raw and gzipped under `data/cbbd/<season>/` (gitignored;
~450 MB and growing):

| Endpoint | Archive file | Feeds |
|---|---|---|
| `/plays/date` | `plays-YYYYMMDD.json.gz` | stints → lineups, on/off, EPM, shot distribution |
| `/games/teams` | `box-teams-full.json.gz` | game logs, team season stats, box modal |
| `/games/players` | `box-players-full.json.gz` | player game logs, player season aggregates |
| `/rankings` | `rankings.json.gz` | AP rank as of each game |
| `/ratings/adjusted` | `ratings-adjusted.json.gz` | second opinion inside BTA RTG |
| `/stats/player/shooting/season` | `shooting-players.json.gz` | player shooting profile |

**We archive rather than re-pull.** History is fetched once and kept; the metric
pipeline reads the archive, not the network. Terms change, and a past season's
numbers should not move because a vendor backfilled something.

Two endpoints have **silent row caps** — no error, no cursor, just truncation:
`/games/teams` at 3,000 and `/games/players` at **1,000**. `pull-team-box-v2.mjs`
and `pull-player-box-v2.mjs` window and split adaptively around them, then verify
by exact row-count parity against each other. Do not replace them with a naive
date-range pull.

### Bart Torvik — `barttorvik.com`

Team and player season stats, T-Rank, projections, the offseason feed. Synced to
Supabase by `sync-bart.mts`; `export-static-data.mts` reads those tables. This is
the only thing Supabase is still used for.

**Bart's team names are canonical.** Every team page, slug, logo, coach link and
conference filter keys off them, which is why CBBD ids are mapped onto Bart names
(`src/data/cbbd-team-map.json`) and not the other way round.

### On3 — `api.on3.com/public/rdb/v2/transfers/latest`

Transfer portal entries. Public feed, no auth. `refresh-portal.mts`. We do not
display On3's proprietary recruit ranking.

### RSCI — `rscihoops.com`

Recruit national ranks (the `#N` / `UR` badge). Chosen over 247/ESPN/On3/Rivals
because it is a consensus index built to be reproduced with attribution.
Attributed inline on preview rosters.

### Sports-Reference

NCAA tournament box scores (`public/data/tournament-box/`, 2013-2026) and the NBA
draftee list. Scraped.

---

## Removed: CBB Analytics (July 2026)

**Nothing on the site derives from CBB Analytics.** No `cbbanalytics` reference
remains in `scripts/`, `src/` or `netlify/`.

### Why it was cut

The integration authenticated with a **scraped session token** read out of
`~/.config/cbb-analytics-pp-cli/config.toml`, which **expired roughly every 30
days**. Shipping a paid product whose numbers depend on a competitor's private
API via a personal expiring token is a materially worse exposure than the
attribution question — and it was already breaking the portal export monthly.

The data carried its own constraint too: on/off metrics were computed but
deliberately never published, because redistributing a vendor's derived metrics
breached their terms. That constraint disappears with the vendor. The on/off we
ship now comes from our own play-by-play.

### What it used to supply

| Was | Now |
|---|---|
| `team_cbba_stats` (32 of 49 team-explorer stats) | `build-team-season-stats.mjs`, summed from the CBBD box archive |
| `game_logs` (the per-game rows behind `/calc`) | `build-game-logs-cbbd.mjs` |
| `player_game_stats` (per-player logs + season aggregates) | `build-player-games-cbbd.mjs`, `build-player-season-adv.mjs` |
| `player_on_off_stats` | never published; on/off now from our own stints |
| `/vc-transfer-portal` | already replaced by On3 before the cut |
| `ortg_adj` / `drtg_adj` inside BTA RTG | CBBD `/ratings/adjusted` |

Those four Supabase tables are no longer read. Migrations 002/003/005/007 created
them; they can be dropped once nothing external depends on them.

### What got better

- `ast_diff`, `stl_diff`, `blk_diff`, `ft_att_diff`, `fg3_pct_def` were **null in
  100% of rows** of the old game logs. All five are populated now.
- Opponent names: **11,504/11,504** D-I rows carry a valid Bart name, up from
  9,287/12,358. The old `opp_team_market` held CBBA's own spellings — the source
  of the "UConn vs Connecticut" mismatches.
- The box sidecars join by id (both sides are CBBD), so the fuzzy date/name
  matcher and its ±1-day window are gone: **100% join, zero misses, every
  season**.
- Exhibitions and cancelled games are filtered at the source, not at read time.

### What was genuinely lost

Both are documented at the code that would otherwise mislead:

1. **Player plus/minus, 2014-2023.** On-court plus/minus needs to know who was on
   the floor. CBBD's play-by-play has **no `onFloor` and no substitution events
   before 2024** — measured: 2026 carries `onFloor` on 56,193/56,193 plays, 2015
   on 0/337,258. Not recoverable from anything we have. Replaced by `net_rtg`,
   a *different* statistic (individual ORtg − DRtg), labelled as one rather than
   relabelled "+/-".

2. **Fast-break / paint / points-off-turnover splits, 2014-2022.** CBBD reports
   untracked splits as `0`, not null, on 30-57% of pre-2024 games. Summing those
   dropped the 2014 league fast-break share to 0.069 against 0.129 in 2026 — a
   decade of tactical change that never happened. Now null, and recoverable from
   play-by-play (Offensive Rebound events and `shotInfo` go back to 2014).

---

## CBBD data-quality guards

Four corruption classes, every one of them silently wrong before it was caught.
All guarded in `scripts/lib/cbbd-stats.mjs` — **do not remove these without
re-measuring.**

| Problem | Scale | Guard |
|---|---|---|
| Cancelled games arrive as a real row with an all-zero stat line, and `0` passes a `typeof === "number"` check | ~34/season | reject when both sides scored 0 |
| `possessions` is sometimes a corrupt small integer — William & Mary 2020 had seven games reporting ~1 possession alongside 50+ FGA, deflating season pace to 53.0 and inflating DRtg to 158.8 | 0.35% overall, 2.90% in 2018 | use the provider value only within 35% of the standard estimator |
| Point splits exceeding the team's own final score (854 fast-break points in a 55-point game) | rare, catastrophic | reject a split greater than total points |
| Impossible adjusted ratings (ORtg 1148.5, ranked #1 offense *and* #351 defense) | 13 team-seasons | reject outside 60-150; falls back to Bart alone |
| Per-game individual `offensiveRating` ranging −2227.5 to +3238.3 | handful | bound components 0-300 before averaging |

### Known upstream limitation

`/plays/date` **504s after ~120 seconds** on the largest Saturday slates — the
1st of most months. Five days per season are missing for 2024 and 2025 as a
result. It is a CBBD backend failure, not a client timeout, so retrying at the
same granularity will not fix it; a per-game play fallback would. Watch for this
during the 2027 season, when it will hit the nightly refresh.

---

## Build order

Dependency-ordered — a downstream step reads a stale file otherwise. Full command
list lives in the header of `scripts/daily-refresh.mjs`.

```
ingest (network)
  └─ build-cbbd-team-map.mjs        ← BEFORE anything that resolves a team name
       └─ build-game-logs-cbbd.mjs  ← the keystone; everything else keys off it
            ├─ build-adjusted-ratings.mjs
            │    └─ build-team-season-stats.mjs
            ├─ build-shot-distribution.mjs
            ├─ build-player-season-adv.mjs
            ├─ build-player-games-cbbd.mjs
            ├─ export-game-box-json.mjs
            └─ export-game-players-json.mjs
                 └─ export-static-data.mts  ← READS the above; throws if absent
```

`export-static-data.mts` no longer generates game logs or team stats. It fails
loudly on a missing input rather than publishing a season of nulls.

---

## Our own derived metrics

Computed from the archive, licensed from nobody:

- **BTA EPM / Box-EPM** — ridge RAPM over CBBD stints (`compute-epm.py`), with a
  box-score estimate for the pre-2024 seasons that have no lineup data.
- **Schedule-adjusted team ratings** — `a_ortg` / `a_drtg` / `a_net` plus
  `sos` / `o_sos` / `d_sos`, ridge-regularized least squares over every game in a
  season (`build-adjusted-ratings.mjs`). Validated against Bart's independently
  computed T-Rank at **r = 0.986** on net rating. Home-court advantage is fit
  rather than assumed and lands at +2.1 to +2.9 pts/100 — with **2021 the lowest
  at +2.09**, the empty-arena COVID season, which the model recovered on its own.
- **Shot distribution** — rim / mid / three shares from `shotInfo.range`, whose
  values map one-to-one onto the three zones. League mid-range share falls from
  31.2% (2014) to 21.2% (2026) while threes climb 33.0% → 39.4%.
- **BTA RTG** — weighted z-score composite. Deliberately two-source: Bart's
  adjoe/adjde averaged with CBBD's `/ratings/adjusted`.
- **BTA PRTG** — portal production rating. Being retired; no new investment.
