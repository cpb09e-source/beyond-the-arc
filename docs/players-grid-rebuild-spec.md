# Players page rebuild — grouped stat-band grid (approved spec)

Approved mock: claude.ai/code/artifact/275004fc-db51-47b9-8cb2-14b96271e3a8 (variant B).
Rebuild `src/components/players/players-client.tsx` table to this design.

## Columns (in order)
| Band | Columns | Notes |
|---|---|---|
| — | RK · Player | RK = 1..N of the CURRENT sort (re-ranks when sort changes). Player cell: headshot/monogram + name + `Team · Cl · Ht` meta line |
| *(dynamic)* | user-filtered stats | Any stat used in a FilterBar stat-filter that is NOT a default column is prepended HERE (before MPG), e.g. FTA Rate, 2P% |
| Role | MPG (whole number, **no chip**) · USG | |
| EPM | Off EPM · Def EPM · EPM | Band label coral; cells get faint coral wash `rgba(220,82,54,.045)`; EPM value bold. Values from epm pipeline (join CBBD→Bart by name+team); show "—" until wired |
| Scoring | PIR · PPG | |
| Shooting | TS% · FG% · 3P% | |
| Rebounding | ORB · DRB · RPG | per-game |
| Handle | AST · TOV | TOV sorts ascending (lower = better percentile) |
| Defense | STL · BLK · HKM | HKM = Hakeem % (existing site formula / stl+blk-based) |

## Cell style (variant B)
Value on top, percentile chip stacked underneath (`inline-flex column, align-end, gap 2px`).
Chip = existing PercentileChip colors. MPG has no chip.

## Header style
Two header rows: band row (small-caps, letter-spaced, muted; EPM band coral) with
`border-left` between bands; column row = existing SortableTh behavior.

## Scroll behavior (D&3-style)
- Table lives in its own scroll container: `max-height` (~70-75vh), `overflow: auto`.
- BOTH header rows sticky: band row `top:0`, column row `top:<band row height>`,
  opaque backgrounds so rows scroll under them cleanly.
- Left columns (RK + Player) sticky horizontally: `position: sticky; left: 0/…`,
  z-index above cells, opaque bg.
- Vertical page scroll unaffected; only the table scrolls internally.

## Field audit (DONE — src/lib/players.ts PlayerSummary)
Available now: min_pg, usage_pct (fraction ×100 for display), pir, pts_pg, ts_pct,
fg_pct, fg3_pct, orb_pg, reb_pg, ast_pg, tov_pg, stl_pg, blk_pg, fta_rate, fg2_pct.
DRB = reb_pg − orb_pg (compute in summary or at render). HKM formula lives in
player-stats-grid.tsx / where-they-rank.tsx (reuse). PLAYER_STAT_COLUMNS (same file)
maps filter keys → fields: use it for the dynamic prepended-column logic
(filter key not among default grid columns → prepend column before MPG).

## Data gaps to verify/wire (step 1 of build)
- MPG: Bart raw_row minutes col; USG: `advanced_stats.usage_pct` (already exported).
- ORB/DRB per game: from Bart raw_row (or CBBD box-players once nightly runs).
- TOV: `advanced_stats.tov_pg` exists. STL/BLK: raw_row tail (fe offsets 5/4).
- HKM: check existing formula in codebase (search "hakeem"/"hkm"); if absent: stl_pg+blk_pg based %.
- EPM triple: `data/cbbd/<season>/epm.csv` → export joined-to-Bart JSON (name+team match, same cascade as refresh-portal matchBart) → client fetch like season-preview.
- Percentiles for new stats: extend the PctMaps cohort computation.

## Status of EPM pipeline (2026-07-24 night)
- CBBD key working. Ingest (`scripts/cbbd-ingest.mjs`) validated; utcOffset −5; archive `data/cbbd/2026/`.
- Stint builder (`scripts/cbbd-build-stints.mjs`): 125/125 score reconcile, p50 71.4 poss, 92.8% valid, UTC-dupe + monotonic-score fixes in.
- `scripts/compute-epm.py`: ridge RAPM works (Boozer #1 on partial data); `--priors` hook ready; λ default 2500 needs full-season tune; HCA inflated on Nov-only sample (expected).
- Backfill: resumable; relaunch `node scripts/cbbd-ingest.mjs --season 2026` until all ~156 slates archived, then rebuild stints + refit.
- Remaining: SPM prior from box, eWins, on/off, lineup ratings (/lineups), estimated skills, EPM trend; join to Bart ids; export JSON; wire grid.
