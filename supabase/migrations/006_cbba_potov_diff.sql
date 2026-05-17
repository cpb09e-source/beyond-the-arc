-- Migration 006: add Points Off Turnovers Diff to team_cbba_stats.
-- Needed by the BTA RTG composite as a DRTG-side defensive contribution
-- (forcing turnovers AND converting them).
--
-- CBB exposes `potovDiff` on the team-agg-stats endpoint
-- (own points off turnovers minus opp points off turnovers).
--
-- Run in Supabase SQL editor. Idempotent.
-- After running, re-execute `npm run sync:cbb-teams` to populate.

ALTER TABLE team_cbba_stats
  ADD COLUMN IF NOT EXISTS potov_diff integer;

CREATE INDEX IF NOT EXISTS idx_cbba_potov_diff ON team_cbba_stats (potov_diff);
