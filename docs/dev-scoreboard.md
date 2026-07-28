# Working on the scoreboard, ticker and game pages

These three surfaces are the only ones on the site that read live data through
a Netlify Function, so they are the only ones that need more than `next dev`.

## Start the dev server

```
npm run dev
```

That runs `netlify dev` behind `scripts/dev.mjs`, which clears orphaned
processes first and gives Next's render fork an 8 GB heap. Use it rather than
`netlify dev` directly — see *When it goes wrong* for what those two guards
are actually for.

- **http://localhost:8899** — the whole site, functions included. Use this.
- **http://localhost:3000** — plain `next dev`, no functions. `/api/*` 404s
  there, so the ticker renders nothing, the scoreboard is empty and a game page
  shows its error state. That is correct behaviour, not a bug.

## Look at a specific day or game

Both take URL parameters, so you never have to wait for the right night:

```
/scoreboard?date=2026-02-07          any date, past or future
/game?id=214837&date=2026-02-07      one game; both parameters required
```

The game page needs the date because CBBD's per-game endpoints ignore a
`gameId` filter — everything upstream is scoped by season plus a date window,
so the id alone finds nothing. That is also why the links the scoreboard builds
carry both.

## See the LIVE states at any hour

Games are live for about four hours a night. To work on the pulsing clock, the
"N live" rail label, the half-filled line score or the live card border at any
other time:

```
/scoreboard?sim=live
/scoreboard?date=2026-02-07&sim=live
```

`sim=live` rewinds whatever slate was resolved: roughly a third of the games
stay final, a third go in-progress with a plausible second-half clock, and a
third go back to scheduled — so one page shows all three states at once instead
of a wall of identical live cards. The clock is derived from each game's index,
so a reload gives you the same picture rather than reshuffling underneath you.

The ticker picks the parameter up from the page URL, so the rail simulates
alongside the page it is on.

**It cannot fire in production.** The flag is gated on `NETLIFY_DEV`, which the
Netlify CLI sets locally and which is never set in a deployed function. A live
request carrying `?sim=live` gets the real slate.

## Out of season

`DEMO_DATE` at the top of `netlify/functions/scoreboard.mts` pins the feed to a
fixed day when no date is given, because CBBD's live endpoint returns `[]` for
eight months of the year and both surfaces correctly render nothing.

**Set it to `null` before the season starts.** That is the only step to go
live. During the season, leave it null and use `?date=` for specific days.

## Testing a function without the browser

The fastest and most reliable loop, and the one to reach for when `netlify dev`
is misbehaving — it calls the handler directly, with no dev server and no proxy
in the way:

```js
// scripts/_tmp-check.mts   (delete when done)
import fs from "node:fs";
process.env.CBBD_API_KEY = fs.readFileSync(".env.local", "utf8")
  .match(/^CBBD_API_KEY=(.+)$/m)[1].trim();

const mod = await import("../netlify/functions/game.mts");
const res = await mod.default(new Request("http://x/api/game?id=214837&date=2026-02-07"), {});
const j = JSON.parse(await res.text());
console.log(res.status, j.game.away.team, j.game.away.points, "@", j.game.home.team, j.game.home.points);
```

```
npx tsx scripts/_tmp-check.mts
```

This is how every function change in the original build was verified. It
answers in about two seconds and never lies to you about the proxy.

## When it goes wrong

**"Another next dev server is already running"** — `netlify dev` spawns its own
`next dev`, and that child outlives the parent when the parent is killed. The
zombie keeps port 3000 and the next start fails. `npm run dev` clears these
before starting; if you started `netlify dev` by hand, kill stray node
processes and retry.

**"Jest worker encountered 2 child process exceptions, exceeding retry limit"**
— this is a memory failure wearing a confusing hat. Next renders in a forked
child; when the dev server has grown past a few GB the fork cannot allocate and
the OS kills it. Next reports the death without naming the cause or the page.
Coach pages trip it first because one of them parses ~140 MB of game logs.
Restart the dev server. The 8 GB heap in `scripts/dev.mjs` makes it rare.

**The dev server dies mid-session, often mid-request** — the Netlify CLI's dev
proxy leaks memory and then aborts. This is upstream and cannot be fixed from
this repo, but it is fully understood, and `npm run dev` now recovers from it
by itself.

Measured on this project (CLI 26.0.1): the proxy process climbs about **16 MB
per request**, near enough regardless of response size — a 15 KB favicon costs
almost as much as the 1.8 MB search index — and never gives any of it back.
It went 131 MB → 4,988 MB in 126 seconds across twenty requests while
`next dev` held flat. When it reaches its heap ceiling V8 aborts through
`__fastfail`, and Windows reports **exit 3221226505** (`0xC0000409`) with no
message, no `npm ERR!` and no Windows Error Reporting entry. That silence is
why it reads as the server having simply vanished, and why the log's last line
is always whatever request it happened to be serving — which makes an innocent
request look like the culprit.

Two things follow, both already handled:

- The render fork's `--max-old-space-size=8192` lives on the `[dev] command` in
  `netlify.toml`, NOT in `NODE_OPTIONS`. Every node process in the tree
  inherits `NODE_OPTIONS`, so setting it there handed the leak an 8 GB ceiling
  — and a proxy sitting at 5-8 GB is also what starved Next's render fork and
  produced the "Jest worker" deaths on the coach pages above. One cause, two
  symptoms.
- `scripts/dev.mjs` supervises the proxy: on an unexpected exit it clears the
  orphaned `next dev` (which survives, because the proxy is the process that
  died, and then holds port 3000 against the restart) and starts it again. A
  crash costs a few seconds instead of the session.

**Upgrading the CLI does not fix it.** Measured across 26.0.1 → 27.0.1 on the
same test: 16.3 → 14.3 MB per small request, 27.1 → 28.5 MB per large one.
Noise. Don't spend time on it again.

**Why it started mattering on 28 July 2026 and never before.** Until the
site-wide score ticker landed (`7f5e5842b7`), the only function on the site was
`parse-query`, used on one page and only when you type a question — so almost
nothing went through the proxy and `next dev` on port 3000 was enough for
nearly all work. The ticker put an `/api/scoreboard` call on *every page load*,
and the scoreboard, ticker and game pages are exactly the surfaces that cannot
be worked on without the proxy. Traffic through the leak went from roughly zero
to every navigation. The leak is old; the exposure is new.

Which points at the practical mitigation: **plain `next dev` on port 3000 has
no proxy in it at all** and is the right place to work on anything that isn't
function-backed.

**A function returns 500 or the connection resets, but curl says 200** — both
the ticker and the game page retry once before showing anything, which absorbs
it. If it persists, verify the function directly with the tsx recipe above
before changing any code.

**The page sits on "Loading the game…"** — the request hung. The client gives
up after 15 seconds and retries once, then shows an error. If you see the
loading state for longer than that, the client bundle did not hydrate; check
the browser console rather than the function.

## Call budget

Every one of these loads spends real CBBD quota. A cold game page is about 15
calls; a scoreboard load is one to five. That is fine for ordinary work — see
`docs/cbbd-api-quota.md` for the ceiling and what raising it costs.
