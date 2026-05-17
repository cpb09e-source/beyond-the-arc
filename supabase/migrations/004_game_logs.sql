-- Migration 004: per-game logs from CBB Analytics.
-- Powers the win-probability calculator (/calc).
--
-- Each row is one team's perspective on one game (so a single game produces
-- two rows — one for each team). Unique key is (cbba_game_id, team_id).
--
-- Run in Supabase SQL editor. Idempotent. After running, execute
-- `npm run sync:cbb-game-logs` to populate (~12 min).

CREATE TABLE IF NOT EXISTS game_logs (
  id              bigserial PRIMARY KEY,
  cbba_game_id    text    NOT NULL,            -- CBB's `_id` for the game
  year            integer NOT NULL,
  game_date       date,
  team_id         bigint  NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  opp_team_id     bigint  REFERENCES teams(id),
  opp_team_market text,
  is_home         boolean,
  is_neutral      boolean,
  won             boolean NOT NULL,
  -- Scoring
  pts_scored      integer,
  pts_against     integer,
  pts_diff        integer,                     -- pts_scored − pts_against
  -- Possession-level
  poss            numeric(6,2),
  pace            numeric(6,2),
  -- Count diffs (team minus opponent — positive = our advantage)
  fg3_made_diff   integer,
  fg3_att_diff    integer,
  fg2_made_diff   integer,
  fg_made_diff    integer,
  ft_made_diff    integer,
  reb_diff        integer,
  orb_diff        integer,
  drb_diff        integer,
  tov_diff        integer,
  ast_diff        integer,
  stl_diff        integer,
  blk_diff        integer,
  fbpts_diff      integer,
  pitp_diff       integer,
  scp_diff        integer,                     -- second-chance points
  -- Shooting (offense)
  fg3_pct         numeric(5,3),
  fg2_pct         numeric(5,3),
  ft_pct          numeric(5,3),
  efg_pct         numeric(5,3),
  ts_pct          numeric(5,3),
  -- Shooting (defense / allowed)
  fg3_pct_def     numeric(5,3),
  efg_pct_def     numeric(5,3),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cbba_game_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_game_logs_year       ON game_logs (year);
CREATE INDEX IF NOT EXISTS idx_game_logs_team       ON game_logs (team_id);
CREATE INDEX IF NOT EXISTS idx_game_logs_won        ON game_logs (won);
CREATE INDEX IF NOT EXISTS idx_game_logs_pts_diff   ON game_logs (pts_diff);
CREATE INDEX IF NOT EXISTS idx_game_logs_tov_diff   ON game_logs (tov_diff);
CREATE INDEX IF NOT EXISTS idx_game_logs_fg3m_diff  ON game_logs (fg3_made_diff);
CREATE INDEX IF NOT EXISTS idx_game_logs_reb_diff   ON game_logs (reb_diff);
CREATE INDEX IF NOT EXISTS idx_game_logs_fbpts_diff ON game_logs (fbpts_diff);

-- Public read; only the service-role sync writes.
ALTER TABLE game_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read game_logs" ON game_logs;
CREATE POLICY "public read game_logs" ON game_logs FOR SELECT USING (true);
