# Players Explorer — stat spec

Status: approved scope, not yet built. Written 2026-08-28.

Companion to `docs/players-grid-rebuild-spec.md`, which covered the grid's
*layout*. This one covers what goes in it.

Source glossary: `docs/reference/cbb-analytics-glossary.csv` (1,291 stats). That
is **CBB Analytics' catalogue, not our feed** — they were removed as a data
source (see `docs/data-sources.md`). Everything below is judged against what is
actually archived under `data/cbbd/`.

---

## 1. Scope decisions

Started from a 149-stat wishlist. Landed on **101 new stats** on top of the 36
we ship, for **137 total**.

### Cut — 6. The data does not exist.

Offensive and Defensive Personal Fouls (and their /40 and /Game forms).

CBBD's play-by-play carries exactly one foul type, `PersonalFoul`. Sampled
8,545 of them across three dates: **zero** carry an offensive-foul or charge
marker, and zero turnovers are tagged as offensive fouls. Not recoverable at
any effort.

### Cut — 4. Recoverable only as a biased undercount.

Personal Fouls Drawn, /40, /Game, and PF Drawn / FGA.

The foul play names the fouler and nobody else:

```
PersonalFoul | Foul on Khouri Carvey. | participants: [{ id: 3403, ... }]
```

The drawer can be inferred by adjacency — a foul followed by player X's free
throws means X drew it. Measured against 6,168 fouls: **43.9%** are followed by
free throws. The other **56.1%** are unattributable.

The size of the gap is not the problem. The *shape* is. Drivers draw shooting
fouls; screeners and post players draw the off-ball fouls we would lose. A team
in the bonus converts fouls into free throws; a team that is not, does not. So
the undercount is biased by position and by game state — and this is a rate stat
people use to rank players. A systematically biased rate feeding the percentile
ramp is worse than an empty column.

### Cut — 13. All-in-one metrics, all of them.

RAPM / ORAPM / DRAPM duplicate EPM / Off EPM / Def EPM — same method, ridge
regression over stints. WARP and WARP/40 duplicate eWins. Win Shares (and the
O/D split) and PER and Danny Miles VPS are box-only metrics that our EPM
strictly dominates: it reads the same box score *plus* schedule, shot detail,
luck adjustment, and the play-by-play fit.

We keep what we already have: **EPM, Off EPM, Def EPM, Box EPM, On/Off, eWins,
PIR, PORPAG, BTA PORP, PPP, Net Rtg.** Nothing new in this group.

### Season-limited — 1.

**Plus-Minus**, 2024 onward. Earlier play-by-play has no `onFloor` and no
substitution events, which is the same reason `plus_minus_pg` was removed from
`src/lib/players.ts`. Column renders `—` for 2014–2023.

---

## 2. The three derived stats, and how accurate each one is

None of Points in the Paint, 2nd Chance Points, or Fast Break Points is tagged
in the play feed, so each needs a definition of ours. **CBBD publishes the
official team-level total for all three** in `box-teams-full.json.gz` under
`teamStats.points.{inPaint, fastBreak, offTurnovers}`, which means we can
calibrate rather than guess: derive it per player, sum by team-game, compare.

Results below are 300+ team-games from three dates in 2026.

### Points in the Paint — ship it. MAE 0.42 pts.

| Definition | MAE | Bias |
|---|---|---|
| `shotInfo.range === "rim"` | 5.43 | −5.43 |
| **lane rect: `abs(x−250) ≤ 60 && y ≤ 190`** | **0.42** | **−0.25** |
| wider lane (70 × 190) | 0.69 | +0.10 |
| shallow lane (60 × 150) | 2.18 | −2.13 |

`range: "rim"` is dunks, layups and tip-ins only, so it misses every short paint
jumper — note the bias equals the error exactly, meaning it undercounts every
single game. The true lane rectangle in our existing court units
(`src/lib/shot-zones.ts`: 500×400 half court, tenths of a foot, rim at 250,52.5)
lands within half a point of the official figure. The residual is shots with no
coordinates.

**Use the lane rectangle.** Reuse `fold()` from `scripts/build-player-shots.mjs`.

### 2nd Chance Points — ship it.

Possession reconstruction: points scored on a possession that began with an
offensive rebound. Needs no clock, so none of the fast-break problems apply.
Validate against the archived team-level `second-chance.json.gz`.

### Fast Break Points — do not ship as a raw derivation.

Anchored made shots to their possession start (defensive rebound, steal, or
turnover) and swept the threshold. Official mean is **10.3 pts per team-game**.

| Threshold | MAE | Bias |
|---|---|---|
| ≤ 5s | **3.54** | −1.29 |
| ≤ 6s | 3.55 | +1.19 |
| ≤ 7s | 4.35 | +3.14 |
| ≤ 8s | 5.46 | +4.77 |
| ≤ 9s | 6.72 | +6.27 |

Best case is 3.5 points of error against a 10.3-point mean — **34% relative
error**. Compare Points in the Paint at 1.4%. It is not the same class of
number and should not sit in the same table pretending to be.

Worth noting the possession-elapsed distribution *is* clean — it peaks at 4s,
troughs at 9s, then climbs back as halfcourt offense sets up, which is exactly
the transition/halfcourt seam you would expect. The clock is not the problem.
The problem is that the official stat encodes a scorer's judgement that no time
threshold reproduces.

**Recommended instead: allocate the official team total.** Take CBBD's
`points.fastBreak` for the team-game — which is correct by definition — and
distribute it across players in proportion to their PBP-detected transition
scoring. Team totals then match the official number exactly, and the only error
left is in how it splits between teammates. Held for your decision; not in the
counts below.

---

## 3. Views

Mirrors the grouped dropdown, with our Impact group replacing "All-In-One".

```
— Traditional
    Traditional Boxscore
    Traditional Shooting
    Scoring Context
— Advanced
    Offensive Stats
    Defensive Stats
    Foul Related
— Impact
    EPM & Value            (what we already ship)
— Miscellaneous
    Double / Triple-Doubles
    Single-Game Leaders
    Player Info
— Build Your Own Table
    Select Your Own Columns
```

Overview stays the default view and is unchanged.

---

## 4. Stat table

`Dir` = percentile direction passed into `midrankPercentiles`. `↑` higher is
better, `↓` lower is better, `—` no percentile chip.

Source key: **box** = per-game rows in `box-players-full.json.gz`; **tbox** =
`box-teams-full.json.gz`; **pbp** = `plays-*.json.gz`; **bart** =
`players-by-year/<year>.json`; **adv** = `advanced_stats` on that row.

`✓` marks a stat we already ship — key must not change, it is in saved URLs.

### Player Info

| Key | Label | Fmt | Dir | Source / formula |
|---|---|---|---|---|
| `cls` | Class | text | — | bart. Exists as a filter; promote to column |
| `ht_in` | Height | text | ↑ | bart `height` `"6-3"` → 75 in. Sort and filter on inches, display `6'3"` |
| `pos` | Pos | text | — | bart notes / `derive-positions.mts`. Exists as a filter |
| `draft_pick` | Draft Pick | int | ↓ | `nba-draftees.json`. Null = undrafted |
| `draft_rd` | Draft Rd | int | ↓ | derived — see gotcha 6 |
| `draft_rd_pick` | Rd Pick | int | ↓ | derived — see gotcha 6 |

### Playing Time

| Key | Label | Fmt | Dir | Source / formula |
|---|---|---|---|---|
| `gp` ✓ | GP | int | ↑ | bart |
| `gs` | GS | int | ↑ | **`adv.gs` — already in the payload, displayed nowhere** |
| `mpg` ✓ | MPG | num1 | ↑ | adv |
| `min` | MIN | int | ↑ | box, sum of `minutes` |

### Traditional Boxscore

Totals and per-40 for every counting stat. Per-game forms we already ship.

| Key | Label | Fmt | Dir | Source / formula |
|---|---|---|---|---|
| `pts` | PTS | int | ↑ | box sum |
| `pts_40` | PTS/40 | num1 | ↑ | `pts / min × 40` |
| `ppg` ✓ | PPG | num1 | ↑ | |
| `reb` `reb_40` | REB, REB/40 | int, num1 | ↑ | box `rebounds.total` |
| `rpg` ✓ | RPG | num1 | ↑ | |
| `orb` `orb_40` | OREB, OREB/40 | int, num1 | ↑ | box `rebounds.offensive` |
| `orpg` ✓ | OREB/G | num1 | ↑ | |
| `drb` `drb_40` | DREB, DREB/40 | int, num1 | ↑ | box `rebounds.defensive` |
| `drpg` ✓ | DREB/G | num1 | ↑ | |
| `ast` `ast_40` | AST, AST/40 | int, num1 | ↑ | box |
| `apg` ✓ | APG | num1 | ↑ | |
| `stl` `stl_40` | STL, STL/40 | int, num1 | ↑ | box |
| `spg` ✓ | SPG | num1 | ↑ | |
| `blk` `blk_40` | BLK, BLK/40 | int, num1 | ↑ | box |
| `bpg` ✓ | BPG | num1 | ↑ | |
| `tov` `tov_40` | TOV, TOV/40 | int, num1 | ↓ | box |
| `tov_pg` ✓ | TOV/G | num1 | ↓ | |
| `pf` `pf_40` `pf_pg` | PF, PF/40, PF/G | int, num1, num1 | ↓ | box `fouls` |
| `blkd` | BLKD | int | ↓ | pbp — missed FG immediately followed by a `Block Shot`. The block play names only the blocker, so the shooter comes from the adjacent miss |
| `pm` | +/− | num1 | ↑ | pbp `onFloor`. **2024+ only** |
| `tech` `tech_40` `tech_pg` | TECH | int | — | pbp `Technical Foul`, participant named. **No chip** — see gotcha 3 |
| `ast_tov` ✓ | AST/TOV | num2 | ↑ | |

### Traditional Shooting

| Key | Label | Fmt | Dir | Source / formula |
|---|---|---|---|---|
| `fgm` `fga` | FGM, FGA | int | ↑ | box `fieldGoals` |
| `fga_40` `fga_pg` | FGA/40, FGA/G | num1 | ↑ | |
| `fg_pct` ✓ | FG% | pct1 | ↑ | |
| `fg2m` `fg2a` | 2PM, 2PA | int | ↑ | box `twoPointFieldGoals` |
| `fg2a_40` `fg2a_pg` | 2PA/40, 2PA/G | num1 | ↑ | |
| `fg2_pct` ✓ | 2P% | pct1 | ↑ | |
| `fg3m` `fg3a` | 3PM, 3PA | int | ↑ | box `threePointFieldGoals` |
| `fg3a_40` `fg3a_pg` | 3PA/40, 3PA/G | num1 | ↑ | |
| `fg3_pct` ✓ | 3P% | pct1 | ↑ | |
| `ftm` `fta` | FTM, FTA | int | ↑ | box `freeThrows` |
| `fta_40` `fta_pg` | FTA/40, FTA/G | num1 | ↑ | |
| `ft_pct` ✓ | FT% | pct1 | ↑ | |
| `tp_rate` ✓ | 3PT rate | num1 | ↑ | Three Point Attempt Rate — already shipped, filter-only today. Promote to column |
| `ts_pct` `efg_pct` `fta_rate` ✓ | TS%, eFG%, FTAR | pct1 | ↑ | |
| `rim_pct` `mid_pct` `asst_pct` `rim_rate` ✓ | | num1 | ↑ | Shooting profile, filter-only today |

### Scoring Context

| Key | Label | Fmt | Dir | Source / formula |
|---|---|---|---|---|
| `pitp` | PITP | int | ↑ | pbp, lane rectangle. MAE 0.42 vs official |
| `pitp_40` `pitp_pg` | PITP/40, PITP/G | num1 | ↑ | |
| `pitp_share` | % Pts Paint | pct1 | ↑ | `pitp / pts` |
| `scp` | 2ND CH | int | ↑ | pbp, possession beginning with an offensive rebound |
| `scp_40` `scp_pg` | 2ND CH/40, /G | num1 | ↑ | |
| `scp_share` | % Pts 2nd Ch | pct1 | ↑ | `scp / pts` |
| *fast break ×4* | | | | held — see §2 |

### Advanced — Offensive

Team inputs come from `tbox` (`teamStats` / `opponentStats`), which carries
possessions, assists, rebounds, turnovers, fouls and full shooting splits for
both sides of every game. `TmMP` = team minutes = `gameMinutes × 5`.

| Key | Label | Fmt | Dir | Formula |
|---|---|---|---|---|
| `pts2_share` | % Pts 2P | pct1 | ↑ | `2 × FG2M / PTS` |
| `pts3_share` | % Pts 3P | pct1 | ↑ | `3 × FG3M / PTS` |
| `ptsft_share` | % Pts FT | pct1 | ↑ | `FTM / PTS` |
| `ast_pct` | AST% | pct1 | ↑ | `100 × AST / ((MP / (TmMP/5)) × TmFGM − FGM)` |
| `ast_ratio` | AST Rto | pct1 | ↑ | `100 × AST / (FGA + 0.44×FTA + AST + TOV)` |
| `ast_usg` | AST/USG | num2 | ↑ | `AST% / USG%` |
| `ppr` | PPR | num1 | ↑ | `100 × ((2/3 × AST) − TOV) / PossPlayed`, Hollinger |
| `ftm_rate` | FTM Rate | pct1 | ↑ | `FTM / FGA` |
| `orb_pct` | ORB% | pct1 | ↑ | `100 × (ORB × (TmMP/5)) / (MP × (TmORB + OppDRB))` |
| `reb_pct` | REB% | pct1 | ↑ | `100 × (REB × (TmMP/5)) / (MP × (TmREB + OppREB))` |
| `usg_pct` `tov_pct` `ppp` ✓ | | | | |

### Advanced — Defensive

| Key | Label | Fmt | Dir | Formula |
|---|---|---|---|---|
| `blk_pct` | BLK% | pct1 | ↑ | `100 × (BLK × (TmMP/5)) / (MP × (OppFGA − Opp3PA))` |
| `stl_pct` | STL% | pct1 | ↑ | `100 × (STL × (TmMP/5)) / (MP × OppPoss)` |
| `drb_pct` | DRB% | pct1 | ↑ | `100 × (DRB × (TmMP/5)) / (MP × (TmDRB + OppORB))` |
| `stl_tov` | STL/TOV | num2 | ↑ | `STL / TOV` |
| `blkd_fga` | BLKD/FGA | pct1 | ↓ | `blkd / FGA` |
| `hkm` ✓ | HKM% | num1 | ↑ | `BLK% + STL%` — recompute from the new components |

### Foul Related

| Key | Label | Fmt | Dir | Formula |
|---|---|---|---|---|
| `pf_eff` | PF Eff | num2 | ↑ | `(STL + BLK) / PF` |
| `blk_pf` | BLK/PF | num2 | ↑ | `BLK / PF` |
| `stl_pf` | STL/PF | num2 | ↑ | `STL / PF` |
| `fouled_out` | FO | int | ↓ | box, count of games with `fouls ≥ 5` |

Plus `pf`, `pf_40`, `pf_pg`, `tech` mirrored from Traditional Boxscore.

### Double / Triple-Doubles

All from per-game box rows. **No percentile chips** — see gotcha 3.

| Key | Label | Definition |
|---|---|---|
| `dd` | DD | games with 10+ in two of PTS/REB/AST/STL/BLK |
| `td` | TD | games with 10+ in three |
| `g20p10a` | 20/10 A | games with 20+ PTS and 10+ AST |
| `g20p10r` | 20/10 R | games with 20+ PTS and 10+ REB |
| `g3x5` `g4x5` `g5x5` | 3×5, 4×5, 5×5 | games with 3+ / 4+ / 5+ in all five categories |

### Single-Game Leaders

Needs both teams' rows for a game; `box-players-full.json.gz` groups them
together, so both are present. **No percentile chips.**

| Keys | Label |
|---|---|
| `led_g_pts` `led_g_reb` `led_g_ast` `led_g_stl` `led_g_blk` | Led Game in PTS / REB / AST / STL / BLK |
| `led_g_pa` `led_g_pr` `led_g_pra` `led_g_prasb` | Led Game in Pts+Ast / Pts+Reb / Pts+Reb+Ast / all five |
| `led_t_*` | The same nine, team-only |

Ties: a player who ties for the game lead counts as a leader. Any other rule
requires a tiebreak we would have to invent.

### Record & Outcomes

| Key | Label | Fmt | Dir | Source |
|---|---|---|---|---|
| `win_pct` | Win% | pct1 | ↑ | team result across the games the player appeared in |

---

## 5. Build gotchas

**1. Per-40 needs a minutes floor.** A player with 12 total minutes and 4 points
posts 13.3 PTS/40 and tops the leaderboard. Recommend a **200-minute floor**;
below it, per-40 columns return null rather than a number. Same principle as the
20-team floor in `scripts/build-team-splits.mjs` — a rate over a thin sample
describes the sample, not the player.

**2. Percentiles on season totals rank availability, not skill.** A total is
partly a measure of how many games someone played. That is a legitimate thing to
rank, but it should be said in the tooltip, the way `eWins` already explains that
it rewards doing it for 34 minutes a night.

**3. Milestone, leader and technical-foul columns get no chips.** They are small
integers dominated by zero — technical fouls run about 0.026 per player-game.
After the midrank fix these correctly collapse to one shared percentile for the
whole zero block, which is the honest answer and also a useless colour. Show the
raw count.

**4. `hkm_pct` currently comes from Bart raw columns 22+23.** Once `blk_pct` and
`stl_pct` are computed from CBBD, HKM% must be recomputed from those components
or the page will show a Hakeem number that does not equal its own two parts.

**5. Coverage varies by group, and the play-by-play half is BLOCKED for ten of
twelve seasons.** Measured, at build time:

| Season | PBP games present | PBP stats |
|---|---|---|
| 2014–2023 | **51–58%** | withheld |
| 2024 | 98.4% | shipped |
| 2025 | 97.4% | shipped |
| 2026 | 99.2% | shipped |

`/plays/date` does not fail on a big slate, it returns 200 with a silently
truncated one — the header of `scripts/cbbd-repair-plays.mjs` documents this.
2024 and 2025 were ingested before the per-game fallback existed and have since
been repaired. **2014–2023 never were.**

Half a season of play-by-play does not make a half-confident number, it makes a
confidently wrong one — a player's paint points would read 200 where the truth
is 400, with nothing on the page to say so. So the 18 PBP-derived stats are
nulled wholesale below 90% coverage. The gate is measured per season rather than
hardcoded to a year, so running the repair lights them up on the next build with
no code change.

**Unblocking 2014–2023 costs roughly 2,700 missing games a season × 10 seasons
at ~1.1s a call — about 9 hours of wall clock and ~27,000 API calls.** It needs
network, so it is a data-freeze and quota decision (`docs/cbbd-api-quota.md`),
not something to start unasked.

Plus-minus has its own, stricter gate: 2024+, because it needs `onFloor` rather
than merely enough games.

**6. Draft round is derived, and the derivation is approximate.**
`nba-draftees.json` stores `{year, pick, team, college}` with no round. Deriving
`round = pick <= 30 ? 1 : 2` is right in a normal year and wrong in a year with
forfeited picks (2024 had 58). Either accept the edge cases or add `round` to the
scrape in `scripts/fetch-rsci-history.mjs`.

**7. Payload size is the real constraint.** The explorer payload is **1.68 MB
per season** for 36 stats, 21 MB across 13 seasons. Measured cost is roughly 6
bytes per stat per player, most of it the repeated JSON key. Naively going to 137
stats gives ~4.8 MB a season, **62 MB total** — on a static export whose own
build scripts already refuse to ship a 12 MB file (see the header of
`build-cbbd-player-season.mjs`).

Two fixes, and we want both:

- **Split the payload by view.** Ship identity plus Overview stats in the base
  file; lazy-fetch a group's block when its view is selected. This is already the
  pattern for `epm-<year>.json` and `shooting-<year>.json`.
- **Column-oriented encoding** for the blocks — `{cols: [...], data: [[...]]}`
  instead of an object per player. Drops the repeated keys, worth about 3×.

---

## 6. From the NBA / databallr glossaries

Reviewed against `https://databallr.com/stats/glossary`. (`nba.com/stats/help/glossary`
timed out twice — it is a client-rendered SPA. Its distinctive half is the
tracking family, which is ruled out below on grounds that do not depend on
reading the page.)

### Worth adding — cheap, and none of it was on the original list

| Stat | Why it is free | Note |
|---|---|---|
| **Age** | Bart's `raw_row` last column is a date of birth (`"2003-12-11"`, verified) | Age at season end. Real context for a site with a transfer portal and a draft board |
| **Assist Points** | `shotInfo.assistedBy` names the assister on **3,165 of 3,165** assisted made FGs — 100% attribution, verified | Points scored by teammates off this player's assists. Nobody in college basketball publishes it |
| **Points Created** | `PTS + Assist Points` | Follows from the above for free |
| **rTS%** and relative rates | `src/lib/league-averages.ts` already does exactly this for OREB%, generated by `build-league-averages.mjs` | Strictly more informative than raw TS% on a site spanning 2014–2026, because it removes era drift. Extending the generated table is a paste job |
| **Short vs Long Mid-Range FG%** | `src/lib/shot-zones.ts` already classifies 13 zones from shot x/y | The split exists; the explorer just never exposed it |
| **Self ORB% / Shot ORB'd** | pbp — did he rebound his own miss; how often his misses get rebounded by his team | Distinctive, and the same possession walk that builds 2nd chance points |

### Out of reach, and not because of CBBD

- **The whole tracking family** — deflections, screen assists, potential
  assists, contested shots, defended FGA, points saved, STOP%, DIFF%, OnBall%,
  speed and distance, touches, drives. These come from optical tracking
  (Second Spectrum / Sportradar). No public college equivalent exists at any
  price. This is not a gap in our feed.
- **Synergy playtypes** (Creation / Finish / Spacing / Transition TS%) —
  licensed, not public.
- **FTOVs, OFFD (charges)** — both depend on offensive fouls, which §1
  established CBBD does not carry.
- **Wingspan** — no source.
- **Multi-year and six-factor RAPM** (2Y–5Y, oTS/dTS/oREB/dREB/oTOV/dTOV) —
  genuinely buildable on our stint pipeline, and a large project. Parked with
  the rest of the RAPM family.

### Per-100 possessions instead of per-40

databallr normalises by possessions, not minutes. We have `teamStats.possessions`
on every team-game, so player possessions = `TmPoss × (MP / TmMP)`.

Per-100 is the better normaliser — per-40 rewards a player on a fast team, since
more minutes at a higher pace means more chances. **Open question:** replace the
per-40 family with per-100, or ship both? Shipping both doubles about twenty
columns for a distinction most readers will not use. Recommend per-100 replacing
per-40, or per-40 kept only for the counting stats people already quote that way.

---

## 7. Open

- Per-100 vs per-40 (§6)
- Fast break: allocate the official team total, or cut the stat? (§2)
- Win Shares O/D split: cut entirely as recommended, or keep as a known name?
- Free-tier gating for the new views — the Team Explorer pattern in
  `src/lib/access.ts` applies, but which of eleven views are free is undecided.
