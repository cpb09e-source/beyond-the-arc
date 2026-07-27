-- Migration 009: drop the CBB Analytics tables.
--
-- BTA no longer pulls from CBB Analytics at all. Every stat these tables held
-- is now derived from CollegeBasketballData play-by-play and box scores and
-- written to public/data as static JSON — see docs/data-sources.md for the
-- replacement per table:
--
--   team_cbba_stats      → scripts/build-team-season-stats.mjs
--                          (+ build-adjusted-ratings.mjs for the rating set)
--   player_game_stats    → scripts/build-player-games-cbbd.mjs
--   player_on_off_stats  → scripts/build-player-season-adv.mjs
--   player_cbba_stats    → never populated (0 rows); superseded before use
--
-- Verified unread before dropping: the only tables any code path queries are
-- teams, players, player_bart_stats, team_trank_stats, seasons and sync_runs.
-- The four below appear in the repo solely in comments explaining what
-- replaced them.
--
-- Row counts at drop time (2026-07-27):
--   player_game_stats    1,590,094
--   player_on_off_stats     39,467
--   team_cbba_stats          4,949
--   player_cbba_stats            0
--
-- NOT DROPPED HERE: `game_logs` (159,852 rows) is also dead — it was ours,
-- not CBB Analytics', and was replaced by scripts/build-game-logs-cbbd.mjs
-- writing public/data/game-logs-by-year/. Left standing deliberately; retiring
-- it is a separate decision.
--
-- Run in the Supabase SQL editor, or via the Management API. Idempotent.

DROP TABLE IF EXISTS player_game_stats;
DROP TABLE IF EXISTS player_on_off_stats;
DROP TABLE IF EXISTS team_cbba_stats;
DROP TABLE IF EXISTS player_cbba_stats;
