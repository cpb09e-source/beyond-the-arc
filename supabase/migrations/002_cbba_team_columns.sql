-- Migration 002: promote CBB Analytics team season-agg columns from raw JSONB
-- to typed columns so the explorer can filter and sort on them with indexes.
--
-- Run this in the Supabase SQL editor (it's idempotent — re-runs are safe).
-- After running, execute `npm run sync:cbb-teams` to populate.

ALTER TABLE team_cbba_stats
  -- Four-factor offense
  ADD COLUMN IF NOT EXISTS efg_pct        numeric(5,3),     -- effective FG% (offense)
  ADD COLUMN IF NOT EXISTS ts_pct         numeric(5,3),     -- true shooting % (offense)
  ADD COLUMN IF NOT EXISTS tov_pct        numeric(5,3),     -- turnover % (offense)
  ADD COLUMN IF NOT EXISTS orb_pct        numeric(5,3),     -- offensive rebound %
  ADD COLUMN IF NOT EXISTS fta_rate       numeric(5,3),     -- FTA / FGA (free-throw rate)
  ADD COLUMN IF NOT EXISTS fg3_pct        numeric(5,3),     -- 3pt %
  ADD COLUMN IF NOT EXISTS fg2_pct        numeric(5,3),     -- 2pt %
  ADD COLUMN IF NOT EXISTS ft_pct         numeric(5,3),     -- FT %
  ADD COLUMN IF NOT EXISTS fg3a_rate      numeric(5,3),     -- 3PA / FGA (3-point rate)
  ADD COLUMN IF NOT EXISTS ast_pct        numeric(5,3),     -- assist % on FGM

  -- Four-factor defense (allowed)
  ADD COLUMN IF NOT EXISTS efg_pct_def    numeric(5,3),
  ADD COLUMN IF NOT EXISTS tov_pct_def    numeric(5,3),
  ADD COLUMN IF NOT EXISTS orb_pct_def    numeric(5,3),     -- = 1 - drbPct
  ADD COLUMN IF NOT EXISTS fta_rate_def   numeric(5,3),
  ADD COLUMN IF NOT EXISTS fg3_pct_def    numeric(5,3),

  -- Ratings (raw and adjusted)
  ADD COLUMN IF NOT EXISTS ortg           numeric(7,3),
  ADD COLUMN IF NOT EXISTS drtg           numeric(7,3),
  ADD COLUMN IF NOT EXISTS net_rtg        numeric(7,3),
  ADD COLUMN IF NOT EXISTS ortg_adj       numeric(7,3),     -- KenPom-style adjusted
  ADD COLUMN IF NOT EXISTS drtg_adj       numeric(7,3),
  ADD COLUMN IF NOT EXISTS net_rtg_adj    numeric(7,3),

  -- Pace
  ADD COLUMN IF NOT EXISTS pace           numeric(6,3),
  ADD COLUMN IF NOT EXISTS pace_adj       numeric(6,3),

  -- Volume / context
  ADD COLUMN IF NOT EXISTS gp             integer,          -- games played (CBB count)
  ADD COLUMN IF NOT EXISTS poss           numeric(8,2),     -- total possessions
  ADD COLUMN IF NOT EXISTS sos_cbb        numeric(7,3),     -- CBB's strength of schedule

  -- 3-point reliance / fast-break / paint
  ADD COLUMN IF NOT EXISTS fbpts_pct      numeric(5,3),     -- fast-break pts / total pts
  ADD COLUMN IF NOT EXISTS pitp_pct       numeric(5,3),     -- points in paint / total pts
  ADD COLUMN IF NOT EXISTS bench_pts_pct  numeric(5,3);     -- bench scoring share

-- Indexes on the columns we expect to sort/filter by most.
CREATE INDEX IF NOT EXISTS idx_cbba_year         ON team_cbba_stats (year);
CREATE INDEX IF NOT EXISTS idx_cbba_efg_pct      ON team_cbba_stats (efg_pct);
CREATE INDEX IF NOT EXISTS idx_cbba_ts_pct       ON team_cbba_stats (ts_pct);
CREATE INDEX IF NOT EXISTS idx_cbba_tov_pct      ON team_cbba_stats (tov_pct);
CREATE INDEX IF NOT EXISTS idx_cbba_ortg_adj     ON team_cbba_stats (ortg_adj);
CREATE INDEX IF NOT EXISTS idx_cbba_drtg_adj     ON team_cbba_stats (drtg_adj);
CREATE INDEX IF NOT EXISTS idx_cbba_net_rtg_adj  ON team_cbba_stats (net_rtg_adj);
CREATE INDEX IF NOT EXISTS idx_cbba_fg3_pct      ON team_cbba_stats (fg3_pct);
