# CBBD API quota — what we're on, and what we can buy

The scoreboard, the ticker and the game page all read live from
CollegeBasketballData through Netlify Functions. CBBD meters calls: every
response carries `x-calllimit-remaining`, and the whole caching design exists
because that number is finite.

## The lever

**The quota is a $10–$30/month purchase decision, not a hard constraint.**
CBBD's paid tiers (requests are shared between the football and basketball
APIs):

| Tier | Price | Monthly requests |
|---|---|---|
| 3 | $10 | 75,000 |
| 4 | $15 | 125,000 |
| 5 | $20 | 200,000 |
| 6 | $30 | 500,000 |

**We are on Tier 3 — $10/month, 75,000 requests**, confirmed by Colin
2026-09-02 from the Patreon page, along with the key being active again after
the 401s of late August. Before that the tier was never written down anywhere,
only the table, which made every "can we afford this?" question unanswerable.

The number is now also the repo variable `CBBD_MONTHLY_LIMIT` (75000), which
is what turns the admin quota tile from a bare count into a gauge that warns at
80% and fails at 100%. If the tier changes, BOTH have to change — the variable
is the one the dashboard believes.

Note the tiers were renumbered and repriced at some point: `monetization-strategy.md`
still records CBBD as "Free / $1 / $5 / $10", where $10 was the TOP tier. Today
$10 is the bottom paid one. Any older note referring to "the $10 tier" is
therefore ambiguous and should not be trusted to mean the top plan.

Measured remaining while building this doc (2026-07-28, same plan): ~19,500.

## Why it usually doesn't matter

`Netlify-CDN-Cache-Control` decouples reader traffic from CBBD calls. A
thousand people watching the same slate cost the same as one, because the edge
answers almost all of them and only the cache miss reaches CBBD. Reader volume
is not what spends the quota — **refresh interval and number of distinct
resources are**.

Rough arithmetic at the current 60-second refresh:

- Ticker + `/scoreboard` page: ~1 call/minute during game hours → ~9,000/month.
- Each *distinct* live game page being watched: ~4 calls/minute while live.

So the ceiling isn't traffic, it's how many different games are open at once
and how fast each one refreshes.

## What more quota would actually buy

In rough order of value:

1. **Faster live refresh.** 60s → 30s doubles the spend. On the current plan
   that alone would eat the budget; on Tier 4+ it's comfortable.
2. **Play-by-play on the same cadence as the score.** PBP is the expensive
   payload (474 KB raw for one game, ~150 KB trimmed). Today it can be given a
   slower refresh than the scoreline to save calls; more quota removes the
   need to split them.
3. **Dropping the monthly-window workaround.** See below — not a quota problem,
   but more headroom makes the extra calls it costs a non-issue.

## Hard limit that is NOT about quota

**Any CBBD list response is capped at 3,000 rows.** No error, no paging cursor,
no indication in the body — it just stops. `/games?season=2026` returns 3,000
rows ending 6 January and silently omits the rest of the season.

This is why `recordsBefore()` in `netlify/functions/scoreboard.mts` fetches
month by month rather than a season at a time. Before that fix every W-L record
on the scoreboard was frozen at its 6 January value. Busiest month measured:
1,534 rows, so a monthly window has comfortable headroom.

**Buying a bigger plan does not raise this cap.** Any new query that could
return more than 3,000 rows has to be windowed or scoped (by conference, by
team, by date range) regardless of tier.
