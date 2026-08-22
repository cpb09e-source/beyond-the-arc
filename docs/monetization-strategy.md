# Beyond the Arc — Monetization & Competitive Strategy

**Drafted:** 2026-07-25
**Status:** Research complete. §5 decisions taken and partly built — see [Decisions taken](#decisions-taken-2026-08-20) at the end.
**Related:** [`TODO-legal-sources.md`](TODO-legal-sources.md) (must land before/with launch)

---

## 0. Positioning (the north star)

> **Dunks & Threes' look and feel, applied to college basketball, with CBB Analytics' depth.**

That sentence should govern every product and pricing decision below. It implies:

- **Design is the product**, not a wrapper on the product. See §3 — our metric layer is not a moat, but our UX genuinely is.
- We are a **consumer/prosumer** product first (D&3's shape), with a **B2B tail** (CBB Analytics' shape) that is where the economics actually work. See §6.
- The comparison set is *not* "another Torvik." It's "the site that made NBA impact metrics legible and beautiful, for CBB."

---

## 1. Competitive landscape

### 1.1 Market map

| Product | Free tier | Paid entry | Top tier | Model |
|---|---|---|---|---|
| **Bart Torvik** | Everything, 20 seasons (2008–2027) | — | — | Free, **no ads** |
| **Haslametrics** | Everything (team-only) | — | — | Tip jar + merch |
| **Hoop Explorer** | Everything (lineups, on/off, shot charts) | — | — | Free, **no ads** |
| **College Hoops Data (CHD)** | Everything | — | — | Free, ads declared but **not serving** |
| **KenPom** | Limited | **$24.95/yr** | — | Annual only |
| **EvanMiya** | **Very generous** | **$5/mo · $30/yr** | $29.99/mo · $179.99/yr, + quote-only Front Office | Freemium ladder |
| **CBB Analytics** | Thin (one team, demos) | **$30/mo · $299/yr** | $100/mo Pro, + quote | 1-wk trial, no cheap tier |
| **TeamRankings** | Free stats hub (ad-monetized) | $49/mo · $249 yr 1 → $299 renew | — | Picks/pools, not stats |
| **Hoop Vision** | — | $10/mo · $100/yr | — | Indie comp |
| **CBBD (API)** | Free tier | $1/$5/$10 per mo (Patreon) | — | Developer API |

### 1.2 The model: Dunks & Threes (NBA)

Not a CBB competitor — **the template.** Solo operator (Taylor Snarr / Snarr Data Science LLC, ex-Utah Jazz analytics). EPM launched Feb 2020. SvelteKit SPA. **Zero ads** — scanned for every major network, only GA4 + Stripe. 100% subscription-funded.

**Pricing — annual only, no monthly, no free trial:**

| Tier | Price |
|---|---|
| Basic | **$24.95/yr** |
| **Premium** (marked POPULAR, pre-selected) | **$49.95/yr** |
| Premium + API | **$250/yr** |

Basic gets EPM + E-Skills, team ratings for every date, stats, comparison tool. Premium adds win probabilities, boxscore predictions, custom minutes, playoff odds, CSV, live dashboards. API tier is a 5× jump — priced to *filter*, not to sell. Terms: auto-renew annually, non-refundable, commercial use requires separate written agreement.

**Depth:** 25 seasons (2001-02 → 2025-26), EPM for *every day* of basketball since 2001-02, 5.5M+ possessions. SPM prior trained 2001-02→2018-19 RAPM + a tracking model.

**Three patterns worth stealing:**

1. **The gate is a lock glyph in the cell, not a wall.** Full table structure always renders; only the numbers are withheld (901 lock glyphs on the playoff page, 1,105 on game pages). No blur, no interstitial, no modal. Maximum "see exactly what you're missing" pressure at near-zero UX cost — **and every page stays fully indexable.** `robots.txt` disallows only `/auth/login` and `/api/`. Note: custom-date gating is a *soft nag* — values still render.
2. **Dual-encoded cells.** Every cell shows the value on top and a small 0–100 **percentile** beneath it, tinted on a green→grey→red diverging scale. Each cell carries raw value *and* league context with no tooltip. This one pattern does most of the analytical work on the site. (We already do percentile chips — theirs is denser and more systematic.)
3. **Free is broad, paid is deep.** Logged out you get the *entire* 652-row EPM leaderboard with every column, all 30 team ratings, full team stats, game index with win prob. What's gated: custom dates/seasons, playoff probabilities, live dashboards, CSV, API.

**Design vocabulary (the actual look-and-feel spec):**

- **Dark is the hard default** — inline `<head>` script sets `class='dark'` and writes `localStorage.theme` when unset. Toggle exists, but you land in dark.
- **OKLCH tokens, and every neutral has zero chroma** — `--background oklch(22.5% 0 0)`, `--card oklch(24% 0 0)`, `--border oklch(100% 0 0 / .1)` (10% white hairlines). Chrome is strictly monochrome so **100% of the color budget goes to data.** One accent: `--primary oklch(52% .095 166.913)` (desaturated emerald/pine). `theme-color #027a5a`.
- **`--radius: 0.15rem`** — essentially square corners. The quietest but most defining choice: reads as instrument panel / terminal, not 2020s SaaS.
- **Nunito Variable for everything, including all numerals.** A *rounded humanist* sans against brutal numeric density — that tension is why it doesn't feel like Basketball-Reference. `h1` 48px/700/−1.2px tracking; `td` **12px**/400; `th` 12px/**700**. A 4× ratio between display and data type. Column-group labels UPPERCASE (`ROLE`, `EST +/-`, `SKILL PERCENTILES`).
- **Charts favor distribution over decoration:** vertical beeswarm of the whole league beside the table; coxcomb/polar-bar "skill percentile" wheels on player cards; diverging horizontal bars for OFF/DEF; quadrant scatter "ratings map"; win-prob line with draggable scrubber. A `Heatmap: Edge` toggle renders heat as a colored *edge bar* rather than a full fill so tables stay readable.
- **Persistent game strip** pinned under the nav on every page, with a **"Hide scores" checkbox** (spoiler protection).
- **Mobile is real, not degraded** — SUBSCRIBE and LOGIN stay pinned in the header (conversion-first); tables keep the sticky player column and the value+percentile stacking intact.

Characterization: **a Bloomberg terminal designed by someone who likes Nunito.**

**Audience:** @taylor_snarr only ~3,000 X followers — but individual posts hit 30k views. Traffic unverified. EPM is widely treated as the best public all-in-one metric; note the accuracy comparison (EPM 2.48 error vs RPM 2.60, RAPTOR 2.63, BPM 2.71) is **self-published**, not independent.

### 1.3 Per-competitor notes

**Bart Torvik** — Free, no ads. Has an AdSense tag in `<head>` **commented out** (pub ID `ca-pub-2627413647443635`) — set it up, deliberately disabled it. His "Subscribe" nav link points at **KenPom's** signup, not his own. Practicing attorney; hobby site. **Now an official NCAA team-sheet metric** (committee vote July 2024) — a credibility moat nobody can replicate. Distinctive: hyper-customizable deep-linkable query URLs ("the Torvik query" is a CBB Twitter meme), T-Rank Time Machine, RosterCast. Dense jQuery 1.10.2 UI. ~22.5k X followers.

**Haslametrics** — Free ratings, voluntary PayPal/Venmo donations, merch ($20.99 tees, $36.74 hats) via rge-store.com. For-profit LLC, run by an electrical engineer. **No ads and no analytics at all.** Team-level only — no player pages, no lineups, no on/off. 12 seasons. Distinctive: dual time-dependent/time-independent ratings, shot-location-first methodology, "Analytically Final" as a consumer brand.

**Hoop Explorer** — 100% free, zero monetization code. Anonymous solo dev (@ItsATerp_CBB, ~1.6k followers), launched 2019, Next.js on Vercel. *Not* Cracked Sidewalks and *not* Paul Bessire — those are unrelated. **The deepest free lineup and on/off tooling in CBB**, plus shot charts, RAPM decomposed into four-factor components, play-style breakdowns (offense *and* defense), arbitrary sample splits. Player profiles 2018+. Men's and women's. Self-labeled "beta(-ish!)".

**College Hoops Data (CHD)** — **Our closest analogue and a warning.** Solo operator (Brian Coleman), founded 2024, **Next.js / React / Tailwind / Supabase** — essentially our stack. Broad feature set: NET + quadrants, efficiency ratings, Four Factors, player analytics (TS%, usage, percentiles), "CHD Scout" prediction model, bracketology, portal, recruiting, coaching carousel, editorial. **100% free.** Aggressively SEO'd at `/guide/kenpom-alternative`. Declares AdSense + Monumetric in its privacy policy and links a `/premium` ad-removal tier — **but `/premium` 404s and no ad code actually serves.** Someone with our stack and scope is two years ahead on SEO, gives it all away, and has not solved monetization either.

**KenPom** — $24.95/yr, annual only. The category price anchor. One product, no monthly, no pause logic, no offseason churn event.

**EvanMiya** — R/Shiny app by Evan Miyakawa (Ph.D., Baylor stats). MBB D-I only. **The free tier is the threat: full D-I team *and* player ratings (OBPR/DBPR/BPR, box priors, advanced metrics) back to 2009, no login.** Paid adds game predictions vs Vegas lines, portal rankings, lineup ratings, CSV export ($5/mo · $30/yr); Premium adds skill projections, lineup optimizer, injury adjustments ($29.99/mo · $179.99/yr); Front Office Suite (quote-only) adds NIL valuation, Big Board, market-rate settings. **"Trusted by 120+ D1 Programs."** Distinctive: Kill Shots (10-0 runs, went mainstream via ESPN), Indispensability/MVP Score, NIL market valuation, lineup projection for never-seen 5-man combos. No shot charts, no WBB. ~54k X followers. No free trial, no student discount.

**CBB Analytics** — React SPA by Canova Analytics, Inc. Founder Nick Canova (ex-Warriors, ex-Knicks data scientist); COO Peter Newmann (10 yrs ESPN basketball research). **MBB + WBB, D-I + D-II + D-III — 2,000+ teams.** Exact Stripe plans (extracted from app bundle): $30/mo · $85/3mo · $160/6mo · $299/yr User Tier; $100/mo Pro. 1-week free trial. Portal/NIL gated to Pro. Public REST API sold by quote. Distinctive: WBB parity, D-II/D-III coverage (only serious platform there), zone shot charts, **DIY shot charts from your own practice data**, automated pre/post-game PDF scout reports, live in-game stats, Matchup Calculator, Season Explorer 2011-12→present with per-season percentiles for cross-era comparison. Their own RAPM/ORAPM/DRAPM. **Best design of the incumbents.** Testimonials: Stanford, UCLA WBB, Virginia, Trail Blazers, Big Ten Network. ~20.1k X followers.

**TeamRankings** — Not a stats competitor; a **picks/pools** company (three brands: TeamRankings free stats, BetIQ picks, PoolGenius pools). All-Access $249 first year → **$299 renewal**, $49/mo, $29/week. **NCAA Bracket Picks $39 one-time** (Mar 15–Apr 15); March Madness Pass $119 one-time. Free stats hub runs **Freestar** ads; the conversion funnel (BetIQ/PoolGenius pages) is **deliberately ad-free**. Claims 5,000+ bracket subscribers, $2.8M reported subscriber prize winnings. Heavy discount-anchoring: strikethrough list price, "Save $X", deadline urgency, intro year materially below renewal.

**CBBD (collegebasketballdata.com)** — Our upstream data source. Developer API, Patreon-billed: Free / $1 / $5 / $10 per month. Claims 9,000+ users, 100M+ API calls/season. **Caps the ceiling on any API product we might sell.**

---

## 2. What BTA actually ships

**Scale:** 17,271 player profiles · 16,403 player pages · 378 teams × 13 seasons (~5,000 team-seasons) · 812 coach pages · 22,568 static pages.

| Asset | Coverage |
|---|---|
| **EPM** (real RAPM + SPM box prior, D&3-style) | 2025, 2026 |
| **Box-EPM** (estimated, era-normalized) | **13 seasons, 2014–2026** |
| Shot splits (rim / mid / 3PT, assisted%) | 2014–2026 |
| eWins, on/off, 5-man lineups | 2025, 2026 |
| Team adjusted O/D/Net (self-computed, iterated) | 13 seasons |
| Coaches (812 pages), transfer portal, RSCI recruits, NBA draftees, season preview | live |
| Tools: `/32-0` game, `/calc`, search | — |

---

## 3. Honest competitive read

### Where we are NOT differentiated

**Our metric layer is not a moat. An EPM-style metric is not unique in CBB — three competitors already ship one.**

- **EvanMiya's BPR is a direct architectural equivalent of our EPM.** "Bayesian Performance Rating," published as OBPR/DBPR/BPR *and* a separate **Box OBPR/DBPR/BPR** — a regularized/Bayesian plus-minus with a box-score prior, plus a box-only variant. That maps almost exactly onto our EPM + Box-EPM split. Theirs covers **2009–present (17 seasons) and is free with no login**; our real EPM is 2025–26 (2 seasons).
- **CBB Analytics** ships in-house **RAPM / ORAPM / DRAPM**, and their docs *explicitly* benchmark against the NBA's RPM, EPM, and LEBRON.
- **Hoop Explorer** ships **RAPM decomposed into four-factor components** — which nobody else publishes.
- EvanMiya gives away **full D-I player ratings back to 2009, free.** Five more seasons than we have, no paywall.
- Hoop Explorer gives away **deeper lineup and on/off tooling than ours**, free.
- CBB Analytics already does **era-normalized cross-season comparison** (Season Explorer, per-season percentiles) — so Box-EPM's era normalization isn't unique either.
- CBB Analytics and Hoop Explorer both have **shot charts**; we have shot splits but no chart.
- CHD replicates most of our feature breadth, free, with a 2-year SEO head start.

### Where we ARE differentiated

1. **Design and flow.** Verified across the set: Torvik is jQuery 1.10.2; Haslametrics is dense 2014-era tables with no analytics; Hoop Explorer self-labels "beta(-ish!)"; EvanMiya is a Shiny app with loading spinners, filter-panel navigation, and no real mobile story. **Only CBB Analytics is modern** — and its editorial section is stale since 2022. This is a genuine edge and it aligns exactly with the D&3 positioning.
2. **812 coach pages.** Nobody in the set does coach-centric pages. Real, uncontested gap.
3. **The Win Calculator (`/calc`) — an uncontested tool.** Conditional win% over 12,358 game records: chain AND conditions across **24 stats** (Margin, Differentials, Shooting, Pace) with 5 operators, filtered by **season (or all years) × conference × team × coach**. e.g. *"TOV Diff < 0 AND 3PM Diff > 0 AND FB Pts Diff > 0 → what's the win rate?"*

   *Competitive check:* the closest analogue is **TeamRankings' Custom Trends Tool** — but that is betting-oriented (spread / O-U / closing-line trends) and paywalled at $49/mo. CBB Analytics has Game Explorer and Split Comparisons; Torvik's query URLs filter team-seasons by date/opponent/venue. **None do conditional win% on box-score differentials.**

   **The coach filter is flatly uncontested** — no competitor has coach-linked game data at all. *"What is Calipari's record when he loses the turnover battle but wins the three-point battle?"* is a question no other CBB site can answer. Pairs with the 812 coach pages to make the coach dimension a category we own outright.
4. **One coherent site.** Every competitor is a single narrow tool. We're the only one where players, teams, coaches, portal, recruits, and history live in one navigable product.
5. **Era-normalized Box-EPM across 13 seasons.** CBB Analytics does per-season percentiles, but a single backfilled impact number *designed* for 2015-vs-2026 comparison is genuinely ours.
6. **Arbitrary multi-season selection — and it's the strongest single differentiator we have.** `?ys=2015,2019,2026` pools any **non-contiguous** set of seasons into one ranked table, z-scored *within each season cohort separately* so no era is unfairly penalized (`team-filters.ts:451`). It's the default behavior of the main players table, not a separate tool, and it's deep-linkable.

   *Competitive check:* CBB Analytics has a **Season Explorer** (2011-12→present, per-season percentiles) and Hoop Explorer has cross-season charts — so multi-season itself isn't unheard of. But both are **separate dedicated tools**, and no competitor supports **arbitrary non-contiguous year sets**; everyone else is single-season or a contiguous range.

   **The compounding claim (this is the marketable one):** the multi-year selector is only valuable *because* Box-EPM covers all 13 seasons. EvanMiya has 17 seasons of BPR but shows one season at a time; CBB Analytics has multi-season pooling but no backfilled all-in-one impact metric across it. **We are the only site where you can select 2015 + 2019 + 2026 and rank those players against each other on a comparable impact number.** Hook: *"Who were the 25 best players of the last 13 seasons?"* — a question no other CBB site can answer in one query, and inherently shareable.

**The D&3 precedent matters here.** EPM's *math* was never D&3's edge either — the NBA already had RPM, LEBRON, DARKO, RAPTOR. D&3 won on **making it legible**: clean player pages, one number you trust, no spreadsheet energy. The same gap exists in CBB. EvanMiya's BPR is buried in a Shiny app with loading spinners, filter-panel navigation, and no mobile story; Hoop Explorer self-labels "beta(-ish!)". **The metric exists — nobody has made it feel good to use.**

The honest claim is therefore *not* "we're the only CBB site with an EPM." It's **"we're the only one where it's pleasant to look at."** Weaker technically, stronger commercially, and exactly the D&3 playbook.

### The strategic problem, stated plainly

Four of the seven competitors are **free**, and they are good. The paywall cannot be justified by "we have a metric they don't" — it must be justified by **breadth + polish + convenience in one place**. That is a real business (it's essentially the D&3 pitch), but it means **UX is the product** and the roadmap must reflect that.

---

## 4. Advertising: recommendation is **NO**

### Why

**Kill the number you've seen first.** Every "sports AdSense RPM = $9–18" figure online traces to SEO content farms with no underlying data. Realistic page RPM for a US sports stats site is **$2–5**.

| Monthly ad revenue | Pageviews needed @ $3 page RPM |
|---|---|
| $100 | 33,000 |
| $1,000 | **333,000** |
| $5,000 | 1,670,000 |

**Three structural problems specific to us:**

1. **Our calendar is inverted against ad pricing.** January CPMs run **30–40% below Q4**; Mediavine's own guidance calls January the annual low with sluggishness through March, plus a separate summer slump. Our traffic peak (March) lands in the **annual CPM trough**, and our dead season lands in the second trough.
2. **Session-vs-page RPM trap.** Networks quote *session* RPM; AdSense quotes *page* RPM. A stats site has high pages/session (team → player → lineup → back). At 5 pages/session, a "$15 session RPM" is a **$3 page RPM**. This is the single most common way data sites overestimate ad revenue.
3. **Real approval risk.** Google Publisher Policies restrict ads on "low-value content." 16,403 templated, table-heavy player pages is the textbook rejection profile. Our computed metrics (EPM, Box-EPM, eWins) are a legitimate "adds value / curation" defense — but it's a fight, not a formality.

**The comparison that settles it:** 1,000 subscribers at $34/yr = **$34k/yr**. Matching that with ads requires roughly **170,000 sessions every month, forever.**

**Also:** ads compete for exactly the screen real estate our value lives in, and a cluttered stats table reads as amateur — which undercuts price credibility. **Torvik reached the same conclusion and commented his AdSense tag out.** CHD declared ad partners and never shipped them. TeamRankings runs ads *only* on free pages and keeps the conversion funnel clean.

### If we ever do run ads

- **Journey by Mediavine**, not AdSense — 1,000 sessions/mo entry (lowered Jan 15 2026), **70% rev share**, auto-upgrades to Official at $5k trailing-12mo revenue.
- **Raptive Insider** next rung — 25,000 monthly pageviews (dropped from 100k Oct 2025), needs ≥50% US/UK/CA/AU/NZ traffic.
- **Ezoic is closed to us** — 250,000 MAU minimum as of Feb 19 2026. The old low-traffic ladder is gone.
- **Carbon is not applicable** — its advertiser base is developers/creators; no CBB fit. Yielded $1.60 RPM even on a well-fit dev blog.
- **Rule: free/marketing pages only, never behind the wall.**

### Note on the betting angle

Google treats gambling content as a **demand restriction, not a ban** — betting-adjacent pages don't get banned, their CPMs get quietly gutted. Meanwhile sportsbook affiliate CPA runs **$50–200 per first-time depositor**; one conversion is worth ~15,000–60,000 pageviews of display at $3 RPM. The economics aren't close — but it's an **either/or**, and it drags ToS/legal posture somewhere we may not want. **Decide this explicitly and early; do not drift into it.**

---

## 5. Subscription: recommendation

### 5.1 Price

**$34/yr season pass, annual-first. Optional $8/mo.**

Rationale, in order of weight:

- **Churn.** Sports newsletter subscribers churn at **7.76%/month** (~12.9-month lifetime — the average sports subscriber renews *once*). It's the second-worst category measured. Annual eliminates the offseason churn event entirely.
- **Stripe fees.** At 2.9% + $0.30 + 0.7% Billing: a **$5/mo plan loses 9.6%** to fees twelve times a year; **$34/yr loses ~4.4%**, once.

  | Price | Effective fee rate |
  |---|---|
  | $5/mo | **9.6%** |
  | $10/mo | 6.6% |
  | $30/yr | 4.6% |
  | $100/yr | 3.9% |

- **Anchors.** KenPom $24.95/yr and EvanMiya Basic $30/yr set the floor. $34 sits just above both — defensible on breadth, not greedy.
- **D&3 validates annual-only hard.** Our design model has **no monthly plan at all** and **no free trial** — $24.95 / $49.95 / $250, all annual, auto-renewing. If the site we're explicitly modeling ourselves on can sell an NBA product (far larger market) with annual-only, a CBB product has no excuse to take on monthly billing complexity.
- **Operational simplicity.** Annual-only is what the category leader does and it removes monthly billing, pause logic, and dunning cadence for a solo operator.

**Market structure note:** CBB fan/analytics tools cluster at **$25–100/yr**. Betting tools cluster at **$60–400/month**. Almost nothing sells at $10–30/mo to CBB fans, because that price implies betting utility and betting customers pay 5x more. Our realistic band is **$25–60/yr**.

### 5.2 Term structure

| Plan | Price | Notes |
|---|---|---|
| **Season Pass (annual)** | **$34/yr** | The default. Push hard. |
| Monthly | **$8/mo** | Annual = 4.25 months → **~58% effective discount** |
| **March Madness Pass** | **$19–29 one-time** | *Consider.* See below. |

**Why ~58% and not the standard 16.7%.** Industry convention is "two months free" (~16.7% off). **That is wrong for a seasonal sport.** If a user can pay monthly for only the 5 months they care about, a 16.7% discount makes monthly the rational choice. DAZN hit exactly this problem and landed at ~58% off ($19.99/mo vs $99.99/yr). Our annual must beat a 5-month monthly run.

**Skip 3- and 6-month tiers.** CBB Analytics offers them, but that's a $30/mo product where the math works. At our price point they add Stripe overhead and decision paralysis. Two choices convert better than four.

**The March one-time SKU is worth serious consideration.** TeamRankings' **$39 one-time bracket product** is the price point CBB consumers actually meet most often — not the annual. It converts the exact impulse moment when our traffic peaks. Risk: it cannibalizes season-pass conversions, and INMA data flags **price shock at intro-offer expiry as the leading cause of preventable churn** — so if we run it, it should be a *separate product*, not a discounted season pass.

**Renew in November, not on signup anniversary.** Someone who subscribes in March and renews the following March is renewing at the exact moment their interest evaporates for seven months.

**Staged path to two tiers.** D&3 runs a proven **anchor + real product** structure: Basic $24.95 exists mostly to make Premium $49.95 (pre-selected, marked POPULAR) look like the obvious choice. We should *not* launch that way — at current depth we lack the Premium-justifying features (D&3's Premium is predictions, playoff odds, live dashboards; we have none of those). Recommended sequence:

| Phase | Structure |
|---|---|
| **Launch** | Single tier, **$34/yr** |
| **Once predictions / live game data ship** | **$29 Basic + $49 Premium**, Premium pre-selected |
| **If B2B demand materializes** | Add quote-only tier (both EvanMiya and CBB Analytics do this) |

### 5.2b Gating pattern — copy D&3, not CBB Analytics

**Use a lock glyph in the cell, not a wall.** Render the full table structure always; withhold only the numbers. D&3 puts 901 lock glyphs on its playoff page and 1,105 on game pages — no blur, no interstitial, no modal.

Three reasons this is the right call for us specifically:

1. **Maximum "see what you're missing" pressure** at near-zero UX cost — the user perceives the shape and volume of the withheld data.
2. **Pages stay indexable.** Critical given CHD's 2-year SEO head start — a hard wall would forfeit organic traffic we haven't earned yet. D&3's `robots.txt` disallows only `/auth/login` and `/api/`.
3. **It preserves the design.** A blur or modal is visually louder than the data; a 12px lock glyph is not. Since UX *is* our product (§3), the paywall must not be the ugliest thing on the page.

Also worth copying: D&3's **free tier is broad, its paywall is deep.** Logged out you get the entire 652-row EPM leaderboard with every column. What's gated is *custom dates/seasons, playoff probabilities, live dashboards, CSV, API* — depth and utility, not access.

### 5.3 Free vs paid split

Given Torvik / Hoop Explorer / CHD / EvanMiya-free, a stingy free tier just routes people to a free competitor that is also good. **Be generous.**

| Free | Paid |
|---|---|
| Browse all players / teams / coaches | Full 13-season history |
| Current-season basics | Real EPM, lineups, on/off, eWins |
| Box-EPM | Shot-split filters + advanced filter ranges |
| `/32-0`, `/calc`, search | CSV export |
| Enough to be shareable + SEO-visible | Portal / preview depth |

### 5.4 Build free accounts BEFORE the paywall

**Registered users convert at ~10x anonymous ones** (Piano: 19% registered→subscriber vs >2.2% anonymous→subscriber for top performers). This is the **single largest multiplier in all the research** — bigger than any price you pick.

Conversion planning numbers:
- **1–2% of registered/engaged users**
- **0.2–0.5% of raw monthly uniques**
- Sports newsletters free→paid: **1.93%** (beehiiv, n=158 paid sports pubs)
- Traditional freemium SaaS average: **3.7%** — do *not* plan on this for media

---

## 6. Targets

⚠️ Current BTA traffic is unknown — these are funnel models, not forecasts. **Instrument analytics before committing to any of it.**

| Stage | Subs | Revenue | Roughly needs |
|---|---|---|---|
| Year 1 | 150–300 | $5–10k | ~50–100k in-season uniques + free accounts live |
| Year 2 | 500 | $17k | steady March spike + retention |
| Year 3 | 1,000+ | $34k+ | ~300–500k annual uniques |

### The B2B tail is where the economics actually work

Both paid incumbents have proven it:
- **EvanMiya:** "Trusted by 120+ D1 Programs," quote-only Front Office Suite.
- **CBB Analytics:** $100/mo Pro + quoted institutional deals; testimonials from Stanford, UCLA WBB, Virginia, Trail Blazers, Big Ten Network.

**20 program licenses at $1,000–2,500/yr = $20–50k** — more than 1,000 consumer subs, with a fraction of the support surface, and institutional budgets are annual so they don't churn seasonally.

**Compliance gate:** recruiting/scouting products need NCAA bylaw approval. EvanMiya carries this language on their portal page: *"This service has been approved in accordance with NCAA bylaws… coaches are permitted to subscribe to this recruiting/scouting service."* Required before selling portal/recruiting data to staffs.

---

## 7. Decision summary

| Decision | Call | Confidence |
|---|---|---|
| AdSense | **No** | High |
| Any ads | Only later, Journey by Mediavine, free pages only | High |
| Price | **$34/yr** single tier at launch; $29/$49 two-tier once predictions ship | Medium-high |
| Billing shape | **Annual-only** (D&3 has no monthly at all) | High |
| 3/6-month tiers | **Skip** | High |
| Gating pattern | **Lock glyph in cell**, never a wall or blur | High |
| March one-time pass | **Consider** at $19–29, as separate SKU | Medium |
| Renewal anchor | **November**, not signup date | High |
| Free tier | **Generous** | High |
| Build order | **Free accounts → paywall** | High |
| Biggest revenue line | **B2B program licensing** | Medium-high |

---

## 8. Open questions / next steps

1. **Instrument analytics.** Every target above is unanchored without real traffic numbers.
2. **Decide the betting question explicitly** — it's an architecture decision that interacts with ToS, ad CPMs, data freshness, and `/sources`.
3. **Free-account layer** (Supabase Auth) — highest-leverage build, precedes paywall.
4. **Static-export constraint:** paywall gating is client-side + edge, not server middleware. Gated data must not ship in the static bundle — needs an authenticated fetch path distinct from the current R2 public reads.
5. **Legal:** [`TODO-legal-sources.md`](TODO-legal-sources.md) — `/sources` attribution page, ToS, Privacy Policy (required for any ad network *and* for Stripe), "not affiliated" trademark disclaimer, lawyer pass.
6. **Close the two obvious feature gaps** if UX is the product: **shot charts** (CBB Analytics + Hoop Explorer both have them, we don't) and **deeper lineup tooling** (Hoop Explorer gives away more than we sell).
7. **Refresh the Win Calculator's condition list against the new CBBD data.** `STAT_OPTIONS` in `src/components/calc/calc-client.tsx` currently exposes 24 fields (Margin / Differentials / Shooting / Pace) sourced from `GameLog`. Since that was written we've ingested shooting splits (rim / mid / 3PT, assisted%), team box, and play-by-play. Audit what's now available and add the missing conditions — this is our most defensible tool, so it should be the most complete.
8. **Decide the Win Calculator's free/paid split.** Candidate: free = current season + a capped number of conditions; paid = all-years + the coach filter + unlimited conditions. TeamRankings proves people pay for this exact shape (Custom Trends, $49/mo).

### Tabled

- **`/32-0`** — parked, not part of the current strategy framing.

---

## Appendix: source reliability

Verified directly from live sites or app bundles: all EvanMiya tier prices, all CBB Analytics Stripe plan prices, TeamRankings All-Access + archived PoolGenius SKUs, CBBD API tiers, Torvik's commented-out AdSense tag, CHD's 404ing `/premium`, Stripe fee schedule, Mediavine/Raptive/Ezoic thresholds.

Secondary/directional: RPM ranges (no credible primary source exists for "sports AdSense RPM" — all top results are content farms), churn and conversion benchmarks (beehiiv, Recurly, Piano, INMA), dynamic-paywall lift figures (vendor-adjacent marketing — treat magnitudes as optimistic, direction as sound).

Unverified: X/Twitter follower counts (x.com blocks fetching), TeamRankings Similarweb figures, CBBD basketball rate limits, CBB Analytics `MIDMAJOR` discount code.

---

## Decisions taken (2026-08-20)

What moved from proposed to decided, and what shipped with it. Everything above
this line is the research that argued for it; this section is the record of what
was actually chosen.

### Tiers — three, not one

§7 recommended a single tier at launch. Built as three, because the Ramp-style
pricing layout the design follows needs three columns and §6's B2B tail supplies
the third honestly:

| Tier | Price | Role |
|---|---|---|
| Free | $0 | The funnel. Deliberately generous, per §5.3 |
| Season Pass | $50/yr, or $8/mo | The only thing actually being sold |
| Program | Quote | §6's B2B tail — staff seats, feed, bulk export |

**Price revised to $50/yr on 2026-08-21** (from the $34 argued in 5.1). This is
a deliberate move away from the anchor-hugging position that section reasoned
to: KenPom is $24.95 and EvanMiya Basic is $30, so $50 is roughly double the
cheaper anchor rather than "just above both". The analysis in 5.1-5.2 and the
revenue projections in 6 still quote $34 and have NOT been recomputed — they
are the reasoning as it stood, and 1,000 subscribers now implies $50k rather
than $34k.

Two knock-on facts, both arithmetic rather than opinion:

- The monthly break-even moved. At $34, five months of $8 beat the year; at $50
  it takes seven ($56 against $50, where six is $48 and still cheaper). Every
  place that sentence appears has been updated — the pricing card and the FAQ.
- The annual saving is now 48%, not 65% ($96 against $50).

**The Stripe price object must be changed to match.** The page states $50; what
a customer is actually charged is whatever `STRIPE_PRICE_YEARLY` points at, and
that price was created for the old figure. Until it is updated in Stripe, the
page and the checkout disagree.

Season Pass carries the "most popular" mark. Ramp shows no such badge and lets
the middle column's copy do that work, but Ramp is selling all three columns;
here the outer two are a funnel and a mailto.

### Ask the Calculator

The plain-English query box on `/calc` — previously unnamed, labelled only
"Ask in plain English" — is now **Ask the Calculator**, named in both the
pricing page and the calculator itself.

Sold as a paid feature with a monthly quota:

| Plan | Calls per month |
|---|---|
| Free | none |
| Monthly billing | 100 |
| Season Pass | 300 |
| Program | set per contract |

Two things the copy commits to, deliberately:

- **It proposes, never answers.** It fills the filters and stops; the reader
  presses Calculate. This is what the function already does and why —
  "a wrong parse that silently returned a number would be worse than no
  feature at all."
- **Pressing Calculate is free and always will be.** The quota is on turning
  English into filters, not on running queries. Without that stated, "300
  questions a month" reads as though the Win Calculator itself is metered.

**Why this feature is the one to gate first.** It is the only thing on the site
with a marginal cost per use — every call is a `claude-opus-5` request on our
key — and it is the only gate that is enforceable today, because the function is
real server code that can check a session before it spends money. The data
paywall still needs the payload split described in §8.4. It was also, until
gated, an open unauthenticated LLM proxy on a public domain: no auth, no rate
limit, no origin check.

**Unit economics.** At roughly 2,900 input and ~300 output tokens per call,
uncached Opus 5 is about $0.022 a call — 300 of those is ~$6.60 a month against
the $2.83 a month a Season Pass brings in. Two levers close that gap:

1. **Prompt caching — done.** The system prompt is static and dwarfs the
   question, so it is now sent as a cached block. Cache counters are logged on
   every call; watch `cache read=` in the function log.
2. **A cheaper model — not done, and deliberately left as a decision.** This is
   rigid schema extraction, which is what the small models are for, and it is
   the difference between breakeven and comfortable margin. It is a quality
   trade against the prompt's ambiguity rules ("shot more threes" -> attempts,
   winning the turnover battle -> `tov_diff < 0`), so it wants an eval against
   real questions before it is made.

### Still open

- `/pricing` is reachable by URL only — not in the nav, and the Season Pass
  button points at `/pricing/checkout`, which does not exist.
- No accounts, no Stripe, no quota enforcement yet. §5.4's build order still
  holds: free accounts first, they convert at ~10x anonymous.
- The API tier D&3 sells at $250/yr does not price across to college
  basketball — CBBD already sells a CBB API at $1-10/month, and some of our own
  data comes from them. Any API product has to be sold on the derived metrics
  (EPM, Box-EPM, eWins, PIR, the boards, coach data), and redistribution is a
  separate ToS question from display — see `TODO-legal-sources.md`.
