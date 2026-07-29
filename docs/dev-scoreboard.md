# Working on the scoreboard, ticker and game pages

These three surfaces are the only ones on the site that read live data through
a Netlify Function, so they are the only ones that need more than `next dev`.

## Start the dev server

```
npm run dev
```

`scripts/dev.mjs` clears orphaned processes, then starts three:

| port | process | what it serves |
|------|---------|----------------|
| 3000 | `next dev` (8 GB heap for the render fork) | the app |
| 9999 | `netlify functions:serve` | the three functions, on their real `/api/*` paths |
| 8899 | `scripts/dev-proxy.mjs` | front door: `/api/*` → 9999, everything else → 3000 |

**Do not use `netlify dev` (`npm run dev:netlify`) for ordinary work.** Its
proxy leaks 16–28 MB per response until V8 aborts, and well before that it
starts silently dropping client-side navigations — on `/` nothing could write
the URL at all, including the teams table's own sort and row-count controls,
with no error to show for it. Our proxy streams instead of buffering: measured
flat at 75 → 88 → 87 MB across 240 requests, against 131 → 4,988 MB across 20.

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

## Demo mode

`SCOREBOARD_MODE` in `src/lib/flags.ts` is `"demo"` until the season is close.
In demo mode the ticker, `/scoreboard` and `/game` read two baked static files
instead of the function:

```
public/data/demo-slate.json    128 games, 65 KB   the ticker AND /scoreboard
public/data/demo-game.json     one bundle, 100 KB  every game link opens this
```

No function call, no CBBD quota, no polling, and one shared fetch between the
two surfaces. Rebuild them with `node scripts/build-demo-slate.mjs` — it runs
the real handlers, so the baked files are the exact shape the live path
returns.

**To go live:** set `SCOREBOARD_MODE` to `"live"`, set `DEMO_DATE` to `null` in
`netlify/functions/scoreboard.mts`, and delete the two demo files.
`npx tsx scripts/check-schedule.mts` says when CBBD has a schedule to serve.

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

**It cannot fire in production.** On the live path the flag is gated on
`NETLIFY_DEV`, which the Netlify CLI sets locally and which is never set in a
deployed function. In demo mode the same transform runs on the client, gated on
the hostname being `localhost` or `127.0.0.1`. Either way a deployed request
carrying `?sim=live` gets the ordinary slate.

Do NOT reach for `process.env.NODE_ENV` for that client-side gate. `process` is
not a browser global, and where the bundler does not inline the expression the
reference throws inside the fetch chain — which shows up as the scoreboard
stuck on "Loading…" and the ticker rendering nothing, with a clean console and
a 200 on the data file. It costs a while to find.

## Out of season

`DEMO_DATE` at the top of `netlify/functions/scoreboard.mts` pins the feed to a
fixed day when no date is given, because CBBD's live endpoint returns `[]` for
eight months of the year and both surfaces correctly render nothing.

**Set it to `null` before the season starts.** That is the only step to go
live. During the season, leave it null and use `?date=` for specific days.

## Testing a function without the browser

The fastest and most reliable loop, and the one to reach for when a dev server
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

**"Another next dev server is already running"** — a previous `next dev`
outlived its parent and still holds port 3000. `npm run dev` clears ports 3000,
8899 and 9999 before starting; if you started something by hand, kill stray node
processes and retry. Two supervisors running at once produce a restart loop,
each clearing the other's children — check for a second `scripts/dev.mjs` first.

**"Jest worker encountered 2 child process exceptions, exceeding retry limit"**
— this is a memory failure wearing a confusing hat. Next renders in a forked
child; when the dev server has grown past a few GB the fork cannot allocate and
the OS kills it. Next reports the death without naming the cause or the page.
Coach pages trip it first because one of them parses ~140 MB of game logs.
Restart the dev server. The 8 GB heap in `scripts/dev.mjs` makes it rare.

### The Netlify CLI proxy — why it is no longer in the stack

**Fixed on 29 July 2026 by removing it.** Kept here because the symptoms are
distinctive and you will recognise them if `dev:netlify` is ever used again.

Measured on this project (CLI 26.0.1): the proxy process climbed about **16 MB
per request**, near enough regardless of response size — a 15 KB favicon cost
almost as much as the 1.8 MB search index — and never gave any of it back.
131 MB → 4,988 MB in 126 seconds across twenty requests, while `next dev` held
flat. At its heap ceiling V8 aborts through `__fastfail`, and Windows reports
**exit 3221226505** (`0xC0000409`) with no message, no `npm ERR!` and no Windows
Error Reporting entry. That silence is why it read as the server having simply
vanished, and why the log's last line was always whatever request it happened
to be serving — making an innocent request look like the culprit.

**The worse symptom, found later: it silently drops client-side navigations.**
Long before the crash, `router.replace` on `/` stopped doing anything at all —
the teams explorer could not write its own URL, so filter chips, the row-count
select and column sorting were all dead. No error, no failed request, no
navigation. The same interactions ran in 800 ms in production and 3 s on port
3000, and this was reproduced on unmodified code with local changes stashed. A
proxy that fails by doing nothing costs far more than one that crashes, because
every symptom points at your own code.

**Upgrading the CLI did not fix it.** Measured across 26.0.1 → 27.0.1 on the
same test: 16.3 → 14.3 MB per small request, 27.1 → 28.5 MB per large one.
Noise. Don't spend time on it again.

**What replaced it** is `scripts/dev-proxy.mjs`, about forty lines that pipe
instead of buffering: `/api/*` to `netlify functions:serve`, everything else to
`next dev`, and a raw `upgrade` handler so HMR's WebSocket still connects.
Measured across 240 requests: **75 → 88 → 87 MB**, i.e. flat — the first 13 MB
is V8 warm-up and the second 120 requests cost nothing. Fast Refresh rebuilds
also dropped from ~4.5 s to ~2.0 s, since nothing is sitting at 7 GB any more.

One thing that did NOT change: the render fork's `--max-old-space-size=8192`
still belongs to Next alone, never `NODE_OPTIONS`, which every child inherits.

**Why it started mattering on 28 July 2026 and never before.** Until the
site-wide score ticker landed (`7f5e5842b7`), the only function on the site was
`parse-query`, used on one page and only when you type a question — so almost
nothing went through the proxy and `next dev` on port 3000 was enough for
nearly all work. The ticker put an `/api/scoreboard` call on *every page load*.
Traffic through the leak went from roughly zero to every navigation. The leak
was old; the exposure was new.

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
