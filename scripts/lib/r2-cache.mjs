/**
 * The Cache-Control header every object in the R2 data bucket carries.
 *
 * Lives in its own module because two scripts must agree on it forever:
 * sync-data-to-r2.mjs stamps it on upload, and backfill-r2-cache-headers.mjs
 * rewrites it across objects already in the bucket. If those two ever drifted,
 * the bucket would end up with a mix of policies and the difference would only
 * show up as some users seeing stale data — the hardest kind of bug to notice.
 *
 * WHY NOT `immutable`: the bucket used to serve
 * `public, max-age=31536000, immutable`. That header is a promise that a URL's
 * bytes will never change, and it is only ever correct for content-addressed
 * names like `app.a3f9c2.js`. Our keys are stable paths (`shots/77082.json`)
 * whose CONTENT changes every time the data is rebuilt — daily during the
 * season, via daily-refresh.mjs. `immutable` also tells the browser not to
 * revalidate on an ordinary reload, so a visitor who loaded a page once kept
 * that snapshot for a year: no reload, no redeploy, and no amount of
 * re-syncing R2 would dislodge it. Observed in dev on 2026-07-27, where a
 * rebuilt shot file kept serving the old season list until a forced reload.
 *
 * WHY THESE NUMBERS: an hour of staleness is invisible for a dataset that
 * changes at most once a day, and within a browsing session everything still
 * comes from cache. Past the hour, stale-while-revalidate hands the browser
 * the cached copy IMMEDIATELY and refreshes in the background, so the reader
 * never waits on a network round trip — they just see the new numbers on the
 * next view. A week of SWR means even a long-absent visitor gets an instant
 * first paint.
 *
 * RELATIONSHIP TO netlify.toml: the JSON that ships in the build already used
 * this shape — `/data/*.json` is served `max-age=600, stale-while-revalidate=86400`.
 * Only the R2 mirror was on `immutable`, so the two halves of the same dataset
 * disagreed about whether they could ever change. The numbers here are longer
 * because these are per-entity files (one per player, per team, per game)
 * rather than the handful of top-level exports Netlify serves: there are far
 * more of them and any individual one changes less often. Same policy, tuned
 * for a different access pattern — not accidental drift.
 *
 * WHY NOT VERSIONED URLS (`?v=<stamp>` + immutable): it propagates instantly,
 * and R2 does ignore query strings, so it would work. But it only holds if R2
 * is always synced BEFORE the deploy that references the new stamp. Get that
 * order wrong once and the new URL fetches the OLD object and pins it
 * immutably for a year — strictly worse than the bug this replaces, and
 * unrecoverable. Not worth it for daily-changing data. If instant propagation
 * is ever wanted, layer it ON TOP of a finite max-age so a mis-ordered deploy
 * still heals itself.
 */
export const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=604800";
