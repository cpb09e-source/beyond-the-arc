-- 010_profiles.sql — accounts and membership.
--
-- PROVENANCE, READ THIS FIRST. This table already exists in the live database
-- and did NOT come from this repo: it was created by hand (the oldest row
-- dates to 2026-05-26) along with a Stripe customer, and until now it appeared
-- in no migration, no schema.sql and no generated type. That is why it is
-- captured here — an undocumented table holding billing state is one dashboard
-- accident away from being unreproducible.
--
-- THE LIVE TABLE IS AUTHORITATIVE. This file is a faithful reconstruction, not
-- a dump: the columns are exact, and every behaviour asserted below was
-- verified against the live database by creating throwaway users and observing
-- what happened. What could not be read back over PostgREST is the precise
-- DDL of the policies and triggers, so those are written to reproduce the
-- observed behaviour rather than copied byte for byte. Do not run this against
-- the existing project expecting a no-op diff; it exists so a fresh
-- environment can be stood up, and so the schema stops being invisible.
--
-- VERIFIED BEHAVIOUR (2026-08-21, against the live project):
--   * signUp() creates the auth user AND a profiles row automatically, with
--     role='free' and subscription_status='inactive'.
--   * Email confirmation is OFF — signUp returns a live session immediately.
--   * anon SELECT on profiles returns zero rows; anon INSERT is refused 42501.
--   * An authenticated user reads exactly one row: their own.
--   * An authenticated user CANNOT change role, subscription_tier or
--     subscription_status — the write is accepted and the values do not move.
--     They CAN change their own email.
--   * Deleting the auth user removes the profile row (cascade).

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  text,
  role                   text        not null default 'free',
  stripe_customer_id     text,
  subscription_status    text        not null default 'inactive',
  subscription_tier      text,
  subscription_price_id  text,
  subscription_renews_at timestamptz,
  subscription_cancel_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read and update your own row, and only your own. There is deliberately no
-- INSERT policy: rows are created by the trigger below, running as definer,
-- so a client never needs insert rights and therefore never has them.
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- THE ENTITLEMENT BOUNDARY.
--
-- The update policy above lets a user write their own row, which on its own
-- would let them set subscription_tier and hand themselves a Season Pass. This
-- trigger is what stops that: on any update that is not made by the service
-- role, the billing columns are forced back to their previous values. The
-- write still succeeds — it simply cannot move the fields that decide access.
--
-- Membership is therefore decided here and by whatever writes with a service
-- key (Stripe webhooks). It is never decided by the browser, and no amount of
-- editing client code can change what this returns.
create or replace function public.profiles_protect_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    new.role                  := old.role;
    new.stripe_customer_id    := old.stripe_customer_id;
    new.subscription_status   := old.subscription_status;
    new.subscription_tier     := old.subscription_tier;
    new.subscription_price_id := old.subscription_price_id;
    new.subscription_renews_at := old.subscription_renews_at;
    new.subscription_cancel_at := old.subscription_cancel_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_billing on public.profiles;
create trigger profiles_protect_billing
  before update on public.profiles
  for each row execute function public.profiles_protect_billing();

-- Every new auth user gets a profile. security definer so it can insert
-- despite there being no INSERT policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
