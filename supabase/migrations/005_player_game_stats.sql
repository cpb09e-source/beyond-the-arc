-- Migration 005: per-player per-game box scores from CBB Analytics.
-- Powers the "Career → click season" game-log modal on the player profile.
--
-- One row per (game, player). Unique key is `cbba_game_player_id` (CBB's `_id`).
-- `bart_player_id` is filled at sync time when the (team_id, normalized name)
-- match against `players` succeeds; left null when CBB lists a player Bart
-- didn't (walk-ons, transfers mid-season, etc.).
--
-- Run in Supabase SQL editor. Idempotent. After running, execute
-- `npm run sync:cbb-player-game-stats` to populate (~15 min).

CREATE TABLE IF NOT EXISTS player_game_stats (
  id                      bigserial PRIMARY KEY,
  cbba_game_player_id     text     NOT NULL UNIQUE,        -- CBB `_id`
  cbba_game_id            integer  NOT NULL,               -- CBB `gameId`
  year                    integer  NOT NULL,
  game_date               date,

  -- Player identity
  cbba_player_id          integer  NOT NULL,               -- CBB `playerId`
  bart_player_id          integer,                         -- joined at sync time; nullable
  full_name               text     NOT NULL,
  jersey_num              text,
  position                text,

  -- Game context
  team_id                 bigint   NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  opp_team_id             bigint   REFERENCES teams(id),
  opp_team_market         text,
  is_home                 boolean,
  is_neutral              boolean,
  is_starter              boolean,
  won                     boolean,

  -- Box score
  mins                    numeric(5,1),
  poss                    numeric(6,2),
  pts_scored              integer,
  fgm                     integer,
  fga                     integer,
  fgm2                    integer,
  fga2                    integer,
  fgm3                    integer,
  fga3                    integer,
  ftm                     integer,
  fta                     integer,
  orb                     integer,
  drb                     integer,
  reb                     integer,
  ast                     integer,
  stl                     integer,
  blk                     integer,
  tov                     integer,
  pf                      integer,
  plus_minus              integer,

  -- Pre-computed shooting % (saves UI work)
  fg_pct                  numeric(5,3),
  fg3_pct                 numeric(5,3),
  ft_pct                  numeric(5,3),
  efg_pct                 numeric(5,3),
  ts_pct                  numeric(5,3),
  usage_pct               numeric(5,3),

  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pgs_bart_year       ON player_game_stats (bart_player_id, year);
CREATE INDEX IF NOT EXISTS idx_pgs_team_year       ON player_game_stats (team_id, year);
CREATE INDEX IF NOT EXISTS idx_pgs_cbba_game_id    ON player_game_stats (cbba_game_id);
CREATE INDEX IF NOT EXISTS idx_pgs_cbba_player_id  ON player_game_stats (cbba_player_id);

-- Public read; only the service-role sync writes.
ALTER TABLE player_game_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read player_game_stats" ON player_game_stats;
CREATE POLICY "public read player_game_stats" ON player_game_stats FOR SELECT USING (true);
