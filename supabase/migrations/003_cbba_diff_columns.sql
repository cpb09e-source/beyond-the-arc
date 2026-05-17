-- Migration 003: add CBB Analytics' raw count-based DIFF columns + raw 3PT
-- counts so we can compute 3P% defense (which CBB doesn't pre-compute).
--
-- Run in Supabase SQL editor. Idempotent.
-- After running, re-execute `npm run sync:cbb-teams` to populate.

ALTER TABLE team_cbba_stats
  -- raw 3-point counts (needed to derive opp 3P%, which CBB doesn't expose)
  ADD COLUMN IF NOT EXISTS fg3_made         integer,
  ADD COLUMN IF NOT EXISTS fg3_attempts     integer,
  ADD COLUMN IF NOT EXISTS fg3_made_def     integer,
  ADD COLUMN IF NOT EXISTS fg3_attempts_def integer,

  -- CBB's ready-made *Diff fields (own minus allowed; positive = better)
  ADD COLUMN IF NOT EXISTS fg3_made_diff    integer,   -- fgm3Diff
  ADD COLUMN IF NOT EXISTS fg3_att_diff     integer,   -- fga3Diff
  ADD COLUMN IF NOT EXISTS fg2_made_diff    integer,   -- fgm2Diff
  ADD COLUMN IF NOT EXISTS fg2_att_diff     integer,   -- fga2Diff
  ADD COLUMN IF NOT EXISTS fg_made_diff     integer,   -- fgmDiff
  ADD COLUMN IF NOT EXISTS ft_made_diff     integer,   -- ftmDiff
  ADD COLUMN IF NOT EXISTS ft_att_diff      integer,   -- ftaDiff
  ADD COLUMN IF NOT EXISTS reb_diff         integer,   -- rebDiff
  ADD COLUMN IF NOT EXISTS orb_diff_ct      integer,   -- orbDiff (count, distinct from orb_pct diff)
  ADD COLUMN IF NOT EXISTS drb_diff         integer,   -- drbDiff
  ADD COLUMN IF NOT EXISTS tov_diff_ct      integer,   -- tovDiff (count)
  ADD COLUMN IF NOT EXISTS fbpts_diff       integer,   -- fbptsDiff (fast-break points)
  ADD COLUMN IF NOT EXISTS pitp_diff        integer,   -- pitpDiff (paint points)
  ADD COLUMN IF NOT EXISTS pts_diff         integer,   -- ptsScoredDiff (total points)
  ADD COLUMN IF NOT EXISTS scp_diff         integer;   -- scpDiff (second-chance points)

-- Helpful indexes for the explorer's likely filter targets.
CREATE INDEX IF NOT EXISTS idx_cbba_fg3_made_diff ON team_cbba_stats (fg3_made_diff);
CREATE INDEX IF NOT EXISTS idx_cbba_fbpts_diff    ON team_cbba_stats (fbpts_diff);
CREATE INDEX IF NOT EXISTS idx_cbba_orb_diff_ct   ON team_cbba_stats (orb_diff_ct);
CREATE INDEX IF NOT EXISTS idx_cbba_pts_diff      ON team_cbba_stats (pts_diff);
