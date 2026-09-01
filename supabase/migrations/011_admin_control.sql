-- 011_admin_control.sql — the two things an administrator can change without
-- a production deploy.
--
-- WHY A DATABASE AND NOT A FILE IN R2. Both of these have to be editable from
-- a browser and readable a moment later. R2 objects are served with an hour of
-- cache (lib/r2-cache.mjs), which is right for a season's numbers and wrong
-- for "scores are delayed tonight" — a banner nobody sees for an hour is not a
-- banner. Supabase is also already wired into the functions, so this needs no
-- new credentials on the deploy, which the R2 route would.
--
-- NEITHER TABLE HAS A CLIENT WRITE POLICY, and that is the same posture
-- 010_profiles.sql takes with its trigger: writes arrive only through a
-- function holding the service key, which checks role = 'admin' first. A
-- browser never needs insert or update rights here and therefore never has
-- them. Editing the client cannot change what these return.

create extension if not exists "uuid-ossp";

-- ── site_config ───────────────────────────────────────────────────────────
--
-- Small runtime settings the site reads on every page. One row per key; the
-- value is jsonb so a setting can grow a field without a migration.
--
-- Keys in use:
--   banner  {enabled, message, tone, href, label}
create table if not exists public.site_config (
  key        text primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users (id) on delete set null
);

alter table public.site_config enable row level security;

-- PUBLICLY READABLE, deliberately. The banner has to reach a signed-out
-- visitor — that is most of the audience and the whole point of having one.
-- Nothing secret goes in this table; it holds text meant to be displayed.
drop policy if exists "site_config: public read" on public.site_config;
create policy "site_config: public read"
  on public.site_config for select
  using (true);

-- ── manual_transfers ──────────────────────────────────────────────────────
--
-- Hand-confirmed portal moves that the automated feeds miss.
--
-- WHAT THIS REPLACED. The same list was hardcoded TWICE, in
-- patch-preview-manual-transfers.mjs and in patch-portal-manual.mts, and each
-- file carried a comment telling whoever edited it to keep the other in step —
-- a contract enforced by nothing. A move added to one and not the other left
-- the portal table and the team pages disagreeing about where a player is.
-- Both scripts read this table now, through scripts/lib/manual-transfers.mjs.
--
-- `active` rather than DELETE: a move that turns out to be wrong is a thing
-- that was believed on a date and then withdrawn, and the withdrawal is worth
-- keeping. It also makes "remove a transfer" reversible from the admin page,
-- which a hard delete would not be.
--
-- confirmed_on is not decoration. The header of the script this replaces makes
-- the argument: a manual claim ages, and knowing when it was made is what lets
-- a later reader decide whether it still holds.
create table if not exists public.manual_transfers (
  id             uuid primary key default uuid_generate_v4(),
  player_name    text        not null,
  -- Bart's player id, when it is known. See the note on ambiguity below.
  bart_player_id integer,
  destination    text        not null,
  confirmed_on   date        not null default current_date,
  note           text,
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid        references auth.users (id) on delete set null
);

-- AMBIGUOUS NAMES ARE THE REASON bart_player_id EXISTS, and the reason this
-- index is shaped the way it is rather than the obvious way.
--
-- The header of patch-preview-manual-transfers.mjs records the case: two
-- Curtis Williamses played in 2025-26, both 6-6 juniors, separated only by a
-- suffix. A wrong id silently grafts one man's career onto the other's row,
-- which is worse than no id at all — so that script refuses to guess and
-- attaches nothing when a name resolves to more than one player.
--
-- A unique index on the name alone would therefore be actively wrong here: it
-- would let the FIRST Curtis Williams be recorded and reject the second as a
-- duplicate, which is not a duplicate at all. Including the id in the key
-- lets two same-named players coexist while still refusing a genuine repeat.
--
-- coalesce(-1) because NULLs do not collide in a unique index, and without it
-- the same player could be entered any number of times as long as nobody
-- supplied an id — which is precisely the case where a duplicate is most
-- likely and hardest to spot.
create unique index if not exists manual_transfers_active_player
  on public.manual_transfers (lower(player_name), coalesce(bart_player_id, -1))
  where active;

create index if not exists manual_transfers_active
  on public.manual_transfers (active, confirmed_on desc);

alter table public.manual_transfers enable row level security;

-- NO POLICIES AT ALL, which means no anon or authenticated access of any kind.
-- Only the service key reaches this table: the admin function for writes, and
-- the nightly pipeline for reads. This is editorial work in progress — a move
-- entered here has not been published yet, and a roster claim that leaks
-- before it is applied reads as a report rather than as a draft.
