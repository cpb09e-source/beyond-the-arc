-- Migration 008: add ft_att_diff to game_logs.
-- The original 004_game_logs.sql shipped ft_made_diff but skipped attempts.
-- Adding the column here so the cbbanalytics ftaDiff field can be synced
-- per game and surfaced in /calc (FTA Diff condition).
--
-- Run in Supabase SQL editor. Idempotent. After running:
--   1. npm run sync:cbb-game-logs   (back-fills all years, ~12 min)
--   2. npm run export:data           (refreshes public/data/game-logs-by-year)

ALTER TABLE game_logs ADD COLUMN IF NOT EXISTS ft_att_diff integer;

CREATE INDEX IF NOT EXISTS idx_game_logs_fta_diff ON game_logs (ft_att_diff);
