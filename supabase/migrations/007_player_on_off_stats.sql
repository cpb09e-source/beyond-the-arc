-- Migration 007: per-player season on-off impact from CBB Analytics.
--
-- CBB's `on-off-agg-stats` endpoint exposes a pre-computed `diff` row per
-- (player, scope) that contains net-rating differential when the player is
-- ON vs OFF the court. We pull `scope=seasonAll` + `onOffDiff=diff` +
-- `isOffense=true` — that's the single row whose `netRtg` is the player's
-- season-long net impact in points per 100 (folds offense AND defense).
--
-- Powers BTA PORTG (composite with PIR + PORPAG) and a future on-court
-- impact chip on the player page.
--
-- Run in Supabase SQL editor. Idempotent. After running, execute
-- `npm run sync:cbb-player-on-off` to populate (~15 min).

CREATE TABLE IF NOT EXISTS player_on_off_stats (
  id                     bigserial PRIMARY KEY,
  cbba_row_id            text     NOT NULL UNIQUE,    -- CBB `_id`
  year                   integer  NOT NULL,
  competition_id         integer  NOT NULL,

  cbba_player_id         integer  NOT NULL,
  bart_player_id         integer,                     -- joined at sync time (nullable)
  full_name              text     NOT NULL,

  team_id                bigint   NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- The pre-computed on-off diffs (offense-perspective row)
  net_onoff              numeric(6,2),                -- net rating diff (on minus off)
  ortg_onoff             numeric(6,2),                -- offense diff
  drtg_onoff             numeric(6,2),                -- defense diff (flipped sign, see below)

  -- Sample-size context for qualification filtering
  mins_on                numeric(7,1),
  mins_off               numeric(7,1),
  mins_pct               numeric(4,3),                -- 0..1 share of team minutes
  is_qualified           boolean,

  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poos_bart_year       ON player_on_off_stats (bart_player_id, year);
CREATE INDEX IF NOT EXISTS idx_poos_team_year       ON player_on_off_stats (team_id, year);
CREATE INDEX IF NOT EXISTS idx_poos_cbba_player_id  ON player_on_off_stats (cbba_player_id);

ALTER TABLE player_on_off_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read player_on_off_stats" ON player_on_off_stats;
CREATE POLICY "public read player_on_off_stats" ON player_on_off_stats FOR SELECT USING (true);
