-- ===================================================================
-- Beyond the Arc — Supabase schema
-- Run this in the Supabase SQL editor for project lfjdmeszdcdenlaxupjy.
-- Idempotent: safe to re-run, drops are commented out for safety.
-- ===================================================================

-- Helpful extension for case-insensitive text matching (used in name joins)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------
-- Reference: seasons. year = the END calendar year, so 2025 = 2024-25.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seasons (
  year integer PRIMARY KEY,
  label text NOT NULL              -- e.g. "2024-25"
);

INSERT INTO seasons (year, label) VALUES
  (2021, '2020-21'),
  (2022, '2021-22'),
  (2023, '2022-23'),
  (2024, '2023-24'),
  (2025, '2024-25'),
  (2026, '2025-26')
ON CONFLICT (year) DO NOTHING;

-- ---------------------------------------------------------------
-- Canonical team record per (season, team). Names come from Bart;
-- CBB Analytics team IDs are joined on later when sync-cbb runs.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  year integer NOT NULL REFERENCES seasons(year),
  name text NOT NULL,                -- canonical Bart spelling, e.g. "Duke"
  name_normalized text NOT NULL,     -- lowercase, no punctuation, for fuzzy joins
  conference text,                   -- short conf code from Bart, e.g. "ACC", "B12"
  cbba_team_id integer,              -- CBB Analytics team ID, filled by sync-cbb
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_year ON teams (year);
CREATE INDEX IF NOT EXISTS idx_teams_conf ON teams (conference);
CREATE INDEX IF NOT EXISTS idx_teams_name_norm ON teams (name_normalized);
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm ON teams USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------
-- Bart's T-Rank team-season stats. One row per team per season.
-- Joined 1:1 with teams via team_id.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_trank_stats (
  team_id bigint PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  year integer NOT NULL,
  rank integer,                      -- overall T-Rank
  record text,                       -- "35-5"
  wins integer,                      -- parsed from record
  losses integer,                    -- parsed from record
  adjoe numeric(7,3),                -- adjusted offensive efficiency
  oe_rank integer,
  adjde numeric(7,3),                -- adjusted defensive efficiency
  de_rank integer,
  barthag numeric(6,5),              -- Bart's "true talent" rating, 0..1
  proj_w numeric(5,2),
  proj_l numeric(5,2),
  proj_con_w numeric(5,2),
  proj_con_l numeric(5,2),
  conf_record text,                  -- "19-1"
  sos numeric(7,5),                  -- strength of schedule
  ncsos numeric(7,5),                -- non-conference SOS
  consos numeric(7,5),               -- conference SOS
  wab numeric(7,3),                  -- wins above bubble
  wab_rank integer,
  adjt numeric(6,3),                 -- adjusted tempo
  fun numeric(8,5),
  fun_rank integer,
  qual_o numeric(8,4),
  qual_d numeric(8,4),
  qual_barthag numeric(7,5),
  conf_oe numeric(8,4),
  conf_de numeric(8,4),
  conf_win_pct numeric(5,4),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_trank_year ON team_trank_stats (year);
CREATE INDEX IF NOT EXISTS idx_team_trank_adjoe ON team_trank_stats (adjoe);
CREATE INDEX IF NOT EXISTS idx_team_trank_adjde ON team_trank_stats (adjde);
CREATE INDEX IF NOT EXISTS idx_team_trank_rank ON team_trank_stats (rank);

-- ---------------------------------------------------------------
-- Canonical player record per (season, team, player).
-- A player who plays in multiple seasons has multiple rows, joinable
-- by bart_player_id.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id bigserial PRIMARY KEY,
  year integer NOT NULL REFERENCES seasons(year),
  team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  bart_player_id integer,            -- Bart's PlayerID (stable across years)
  cbba_player_id integer,            -- CBB Analytics player ID
  name text NOT NULL,
  name_normalized text NOT NULL,
  class text,                        -- Fr/So/Jr/Sr/Gr
  height text,                       -- "6-4"
  hometown text,
  dob date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, team_id, name)
);
CREATE INDEX IF NOT EXISTS idx_players_year ON players (year);
CREATE INDEX IF NOT EXISTS idx_players_team ON players (team_id);
CREATE INDEX IF NOT EXISTS idx_players_bart_id ON players (bart_player_id);
CREATE INDEX IF NOT EXISTS idx_players_name_norm ON players (name_normalized);
CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------
-- Bart's player advanced stats. One row per player per season.
--
-- IMPORTANT: getadvstats.php returns CSV WITHOUT A HEADER ROW, and the column
-- layout is undocumented (~66 columns). The known/verified columns are
-- materialized here; the full row is stashed in `raw_row` (JSONB array)
-- so we can promote more columns to typed fields as we verify them against
-- known-player ground truth.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_bart_stats (
  player_id bigint PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  year integer NOT NULL,
  games integer,                     -- CSV col 3
  notes text,                        -- "Combo G", "Stretch 4" — second-to-last
  projection numeric(7,4),           -- last numeric — pre-season projection
  raw_row jsonb,                     -- full CSV row as an array; promote cols as verified
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_bart_year ON player_bart_stats (year);

-- ---------------------------------------------------------------
-- CBB Analytics raw payloads. We stash the full JSON for now and
-- promote useful columns to first-class fields as we learn the shape.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_cbba_stats (
  team_id bigint PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  year integer NOT NULL,
  competition_id integer,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_cbba_stats (
  player_id bigint PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  year integer NOT NULL,
  competition_id integer,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Sync run history — log every sync invocation for debugging.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id bigserial PRIMARY KEY,
  source text NOT NULL,              -- 'bart' | 'cbba'
  year integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_inserted integer,
  rows_updated integer,
  notes text
);

-- ===================================================================
-- Row-Level Security
-- Public read on all stat tables (so the anon key works in the browser).
-- No public write (only the service_role key writes via sync scripts,
-- and service_role bypasses RLS).
-- ===================================================================
ALTER TABLE seasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_trank_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE players             ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_bart_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_cbba_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_cbba_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs           ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first so re-runs don't error.
DROP POLICY IF EXISTS "public read seasons"           ON seasons;
DROP POLICY IF EXISTS "public read teams"             ON teams;
DROP POLICY IF EXISTS "public read team_trank_stats"  ON team_trank_stats;
DROP POLICY IF EXISTS "public read players"           ON players;
DROP POLICY IF EXISTS "public read player_bart_stats" ON player_bart_stats;
DROP POLICY IF EXISTS "public read team_cbba_stats"   ON team_cbba_stats;
DROP POLICY IF EXISTS "public read player_cbba_stats" ON player_cbba_stats;
-- sync_runs intentionally not readable by the public.

CREATE POLICY "public read seasons"           ON seasons             FOR SELECT USING (true);
CREATE POLICY "public read teams"             ON teams               FOR SELECT USING (true);
CREATE POLICY "public read team_trank_stats"  ON team_trank_stats    FOR SELECT USING (true);
CREATE POLICY "public read players"           ON players             FOR SELECT USING (true);
CREATE POLICY "public read player_bart_stats" ON player_bart_stats   FOR SELECT USING (true);
CREATE POLICY "public read team_cbba_stats"   ON team_cbba_stats     FOR SELECT USING (true);
CREATE POLICY "public read player_cbba_stats" ON player_cbba_stats   FOR SELECT USING (true);
