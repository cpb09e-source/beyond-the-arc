-- 012_desktop_auth.sql — the one-time codes behind the desktop app's sign-in.
--
-- NOT YET APPLIED to the live project. Written 2026-09-13 with the desktop
-- sign-in handoff; apply it when that feature is approved to go live.
--
-- THE FLOW THIS SERVES (docs/desktop-app-plan.md, "Sign-in"):
--   1. The app makes a random verifier and opens
--      /desktop/connect?challenge=S256(verifier)&state=…  in the browser.
--   2. The reader, already signed in on the site, presses Allow. The authorize
--      function stores a row here: a hash of a fresh code, the challenge, the
--      user, and an expiry five minutes out.
--   3. The browser hands the code to the app through btacbb://auth?code=…
--   4. The app sends code + verifier to the token function, which claims the
--      row (used_at from null, exactly once), checks S256(verifier) against the
--      stored challenge, and only then mints a session.
--
-- WHY THE CODE IS STORED HASHED. A row read out of this table, through a
-- dashboard or a leaked backup, must not be a usable code. The token function
-- hashes what it is given and looks that up; nothing here can be replayed.
--
-- WHY A CODE ALONE IS WORTHLESS. PKCE: the code is bound to a challenge whose
-- verifier never left the app. Something that intercepts the btacbb:// URL
-- (another program registered for the scheme, a log) holds a code it cannot
-- redeem.
--
-- NO CLIENT POLICY AT ALL. Row level security is on and no policy grants
-- anything, so anon and authenticated roles can neither read nor write. Only
-- the functions, holding the service key, touch this table. Same posture as
-- 011_admin_control.sql's write paths.

create table if not exists public.desktop_auth_codes (
  -- sha256 of the code, hex. The code itself exists only in flight.
  code_hash  text        primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  -- base64url(sha256(verifier)), 43 characters, as sent by the app.
  challenge  text        not null,
  -- The app's own random value, echoed back so it can refuse a callback it did
  -- not start.
  state      text        not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Set once, by the claim. A code is spent the moment anyone tries it, right
  -- or wrong verifier, so it cannot be guessed at.
  used_at    timestamptz
);

alter table public.desktop_auth_codes enable row level security;

-- The token function sweeps expired rows as it goes; this keeps that cheap.
create index if not exists desktop_auth_codes_expires_at
  on public.desktop_auth_codes (expires_at);
