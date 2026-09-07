# Matchup predictor — competitive teardown and design notes

Written 2026-09-07. Part 1: what CBB Analytics' Matchup Calculator actually
does, recorded in enough detail to argue with. Part 2 (our design) follows.

Source: `cbbanalytics.com/tools/matchup-calculator`, observed logged in on a
Free Tier account, 2025-26 season, Division I. Everything below is either
quoted from their own copy or read off a live Duke–Michigan projection. Their
methodology text is public; nothing here was reverse-engineered from code.

**We are not copying this.** The point of writing it down is to know exactly
what the bar is, and where it is low.

---

## 1. What their tool is

One sentence, theirs: *"Predict scores and win probabilities from
minute-weighted player RAPM ratings."*

It is a **lineup simulator**, not a team-rating calculator. You give it a
minutes distribution; it weights each player's RAPM by those minutes, builds
team-level offensive and defensive ratings, and projects a score. The headline
output is the chance Team 1 beats Team 2 **on a neutral court**.

That framing matters: their model's unit of analysis is the *player*. Ours
would be the *team*. Neither is more correct — they answer different questions,
and §6 argues we should answer the second one better rather than the first one
worse.

---

## 2. The controls, as shipped

**Scope row** — League (NCAA Mens), Competition (2025-26 Men's Basketball),
Division (Division I), Cross-Season (a toggle, disabled/"Off" on our tier).

**Model row**
- *Split for Minutes, Pace, Net* — which split feeds minutes, pace and net
  rating. Default "Season". Note their caveat: **RAPM itself is always
  full-season**, whatever split you pick. So the split moves the minutes and
  the pace but not the player ratings.
- *Model MPG Method* — three ways to spread 200 minutes across a roster:
  - "Minutes / Game": per-game average, scaled to 200
  - "Total Minutes": each player's share of total team minutes
  - "Both": the average of the two
- *RAPM Percentiles* — show/hide percentile chips on the rating columns
- *0-MPG Rows* — hide players the model gives no minutes

**Per team** — On/Off toggle, Rotation Minutes ("Full rotation"), and an
*Exclude Players* multi-select. This is how you model an injury: there is no
news feed, you take the player out by hand.

**Matchup row** — Team 1, a swap button (↔), Team 2, and a **Neutral Site
Game** toggle.

**Roster table**, per team: Player · Total GP · Total Minutes · Total MPG ·
**Model MPG (editable)** · ORAPM · DRAPM. A totals row sums the model minutes
to exactly 200.0 and reports the team ORAPM/DRAPM those minutes produce.

Editing any Model MPG cell re-runs the projection live.

---

## 3. The maths, worked

They print the formula and the arithmetic on the page. This is the single best
thing about the product and the thing most worth stealing *in spirit*: they
show their work.

**Constants** (2025-26): League ORtg **110.8**, Game Pace **67.6**.

**Inputs** for the Duke–Michigan projection:

| | ORAPM_team | DRAPM_team | Pace |
|---|---|---|---|
| Duke | 16.8 | 16.0 | 65.5 |
| Michigan | 15.0 | 14.6 | 69.6 |

**Projected score**

```
Score = (League ORtg + ORAPM_team − DRAPM_opponent) / 100 × Game Pace

Duke     = (110.8 + 16.8 − 14.6) / 100 × 67.6 = 113.0/100 × 67.6 = 76.4
Michigan = (110.8 + 15.0 − 16.0) / 100 × 67.6 = 109.8/100 × 67.6 = 74.2
```

Both ratings are per 100 possessions, so the division by 100 and the
multiplication by pace convert a rate into points. Standard.

**How they get Game Pace is undetermined, and it matters more than I first
thought.** 67.6 is consistent with *both* the simple average of the two paces
((65.5+69.6)/2 = 67.55) and the KenPom-style formula
(65.5 x 69.6 / 67.42 = 67.62). Duke and Michigan sit either side of league
average, which is the case where the two agree, so one observation cannot
separate them.

**CORRECTION.** The first draft of this section claimed the choice was
immaterial, on the grounds that the most extreme pace pair in the country --
Northern Iowa at 62.2 against Cal Poly at 74.1 -- separates the two formulas by
only 0.23 possessions. That test was wrong. It picked the extreme *gap*, and a
big gap is precisely the case where a fast team and a slow team cancel and the
two formulas agree. The case that separates them is the extreme *sum*:

| pair | simple average | KenPom product | difference |
|---|---|---|---|
| Northern Iowa 62.2 / Cal Poly 74.1 | 68.15 | 68.36 | 0.21 |
| two slow: 62.2 / 63.0 | 62.60 | 58.12 | **-4.48** |
| two fast: 74.1 / 73.0 | 73.55 | 80.23 | **+6.68** |

Two fast teams put the formulas 6.7 possessions apart, which at roughly 1.08
points per possession is about **15 points of combined scoring**. It is not a
rounding difference; it is the difference between a plausible total and an
absurd one.

Backtested against 15,969 games (see part 2), neither is right. The simple
average is badly biased -- +2.55 possessions for slow pairs, -1.11 for fast
ones -- and the KenPom product overshoots in the other direction, +1.70 for
fast pairs. The unbiased fit is the additive form shrunk to 0.83:

```
Game pace = L - 0.75 + 0.83 x (tempo_A + tempo_B - 2L)
```

flat to within 0.09 possessions across every tempo band.

**Win probability, two ways, both from the projected score:**

```
Pythagorean (exponent e, default 11)
  WP₁ = Score₁^e / (Score₁^e + Score₂^e)
      = 76.4¹¹ / (76.4¹¹ + 74.2¹¹) = 57.9%

Normal CDF (σ, default 11)
  WP₁ = Φ((Score₁ − Score₂) / σ)
      = Φ((76.4 − 74.2) / 11) = 57.9%
```

Both are editable, and they publish the sensitivity:

| e | Duke | | σ | Duke |
|---|---|---|---|---|
| 9 | 56.5% | | 9 | 59.6% |
| 10 | 57.2% | | 10 | 58.6% |
| **11** | **57.9%** | | **11** | **57.9%** |
| 12 | 58.6% | | 12 | 57.2% |
| 13 | 59.3% | | 13 | 56.7% |

Note the two methods move in *opposite* directions as their parameter rises,
and cross at 11. That is almost certainly why 11 is the default for both.

**A third, "reference" method** runs alongside: win probability from
season-level team adjusted net ratings only, no player RAPM, no rotations.
For this game it said Duke **51.9%** (+36.6 adjusted net) against Michigan
**48.1%** (+35.9). Their own framing: *"This baseline helps you see how
player-driven projections might diverge from a traditional team consensus."*

The gap is the interesting part — 57.9% from the player model against 51.9%
from the team model, on the same game.

---

## 4. What they say about their own method

Quoted, because it is unusually candid and it maps our opportunities:

> Our player RAPM ratings are basic 1-year RAPMs with no statistical prior
> used.

> We tried several common scoring formulas (KenPom-style additive, T-Rank,
> SABR) alongside the player-weighted RAPM-based method we ultimately used
> here. The player-weighted RAPM method calibrated best to game scores.

> Calibration is what we care about most: when the model says 70% favorite,
> the favorite actually wins close to 70% of the time.

**What they explicitly do not model**, their list:

- **No RAPM until late December — early-season projections are unavailable.**
- Travel, back-to-backs, motivation, scheme matchups, in-game adjustments.
- Injuries, except by hand via exclusions or Model MPG.
- Home court advantage is *"a single flat number — no per-team home-court
  tuning."*

And the disclaimers: *"All ratings are per 100 possessions; neutral court
assumed"*, and *"CBB Analytics does not endorse using these calculations for
betting."*

---

## 5. Packaging

Free Tier is a **10-team demo** — the picker offered Duke, Gonzaga, Indiana,
Michigan, North Carolina, Ohio St., South Carolina, Stanford, Texas, UCLA and
UConn. All teams require the paid User Tier. So the tool is a funnel: the maths
is fully public, the *coverage* is what you buy.

Worth noting for our own paywall thinking. They gate breadth, not method.

---

## 6. Where we stand, and where the gaps are

**What we have that they use:** adjusted offensive and defensive efficiency and
adjusted tempo for all 365 teams, every season back to 2014
(`team_trank_stats.adjoe / adjde / adjt`). League averages for 2025-26 come out
at **109.27 efficiency, 67.42 tempo**. That is everything their *reference*
model needs and everything a KenPom-style projection needs.

**What we do not have:** player RAPM. We have Box-EPM and real EPM, plus
`porpag`, but not a possession-level regularized plus-minus. So a like-for-like
clone of their headline model is not available to us today.

**Three places their own documentation says they are weak:**

1. **"No RAPM until late December."** Their flagship tool is dark for the
   first six weeks of every season — precisely the weeks when nobody knows
   anything and a projection is most interesting. Our adjusted efficiencies
   exist from the first week. *A matchup tool that works in November is a
   product they cannot ship.*
2. **Flat home court advantage, no per-team tuning.** We hold every game since
   2014 with a home/neutral flag (`T.f` bits `HOME`/`NEUTRAL` in
   team-game-index). Per-team home-court effects are computable from data we
   already ship.
3. **Injuries only by hand.** Same for us — but our roster and minutes data
   makes "remove this player" equally possible, and we could at least seed it
   from who has actually been playing recently rather than season averages.

**One place we are structurally better positioned:** they are a tool site.
Their calculator lives at `/tools/matchup-calculator` behind a scope picker.
Ours would live at `/teams/duke/2026/matchup` — one per team-season, ~1,812
prerendered pages, each one indexable and linkable. They have a calculator;
we would have a *page about a matchup*, which is the thing people search for.

---

## 7. Open questions before we build

1. ~~Game pace formula~~ — **settled, see §3, but not the way the first draft
   said.** The two candidates differ by nearly 7 possessions when both teams are
   fast; the first draft's "0.23 possessions" test measured the wrong extreme.
   Neither standard formula is unbiased. Use the fitted form.
2. **Which win-probability method?** Their backtest picked Pythagorean and
   Normal CDF over Log5. We can adopt both cheaply and show the disagreement,
   which is honest and is a differentiator.
3. **σ / exponent for our ratings.** Theirs are tuned to RAPM-derived scores.
   Ours will be adjusted-efficiency-derived; the right σ is an empirical
   question we can answer against our own 13 seasons of game results.
4. **Home court advantage** — a flat number to start (their approach), with
   per-team tuning as the follow-up that beats them.
5. **What is free and what is paid.** They gate teams. We gate seasons. A
   matchup page for the current season being free, with historical matchups
   behind the Pass, would be consistent with how the rest of the site already
   works.

---

## 8. The honest summary

Their maths is standard and they publish it. The moat is not the formula — it
is RAPM, which is genuinely hard and which they cannot compute until late
December. Everything else on the page is presentation, and the presentation is
good but beatable: a scope picker and a wall of controls, versus a page per
team-season that a search engine can index and a person can send to a friend.

If we build this, the thing to copy is the **transparency** — showing the
arithmetic on the page — and the thing to beat is the **calendar**.

---
---

# Part 2 — what actually predicts a college basketball game

Written 2026-09-07. Measured against our own archive:
`data/cbbd/<season>/box-teams-full.json.gz` — every team-game of 2023, 2024 and
2025, with 2026 held back and opened once, at the end, after the model was
frozen.

## 1. Method, and the trap it exists to avoid

`public/data/team-ratings-<season>.json` holds **end-of-season** adjusted
ratings. Predicting a January game with them scores the model on information it
could not have had, and every model looks brilliant that way. Nothing in this
study touched those files.

Instead, a **walk-forward backtest**: for every date a season played games, fit
ratings on everything strictly before that date, project that date's games,
record the residual. The ratings are the iterated fixed point that
`scripts/build-team-ratings.mjs` already ships, re-implemented with every
modelling choice exposed as a parameter.

Hyperparameters were fitted on **2023 + 2024**. **2025** was the holdout.
**2026** was never opened until the constants were frozen.

15,969 predicted games in the study seasons; 5,398 more in 2026.

## 2. A data bug to fix in production

17 games across 2023-2026 carry impossible possession counts — Duke–Purdue on
2022-11-27 logged at **2 possessions**, Robert Morris on 2025-11-11 at 10, and
two whole slates (2025-01-03, 2025-02-16) at around 40.

They are not harmless. One is enough to detonate the fixed point: Northwestern's
implied 8,700-points-per-100 propagated through opponents-of-opponents until
December 2023 projections read 460-point margins and the season's RMSE was
**30.1 against a true 11.7**.

`scripts/build-team-ratings.mjs` has the same hole. The gate:

```js
poss >= 45 && poss <= 110 && Math.abs(hPoss - aPoss) <= 4
```

**Action item, independent of this feature: add that gate to the production
ratings builder.**

## 3. What the rating engine should do

Swept one parameter at a time on 2023+2024, MAE of predicted margin:

| choice | result |
|---|---|
| Home-court advantage | best 2.0–2.4 per side per 100 (9.244 → 9.216) |
| Shrinkage `k` toward a prior | **k = 2–3 (9.244 → 9.072)** |
| Single-game efficiency cap | **±20–25 around league mean (→ 9.130)** |
| Recency weighting | **nothing** |
| Preseason prior = last season | **large, see §4** |

Two deserve stating plainly.

**Recency weighting does not work.** Half-lives from 200 days down to 25 were
tested. The best was 140 days, which over a 150-day season is indistinguishable
from no decay at all; 25 days is materially *worse* (9.341 vs 9.239). A team in
February is not better described by its February games than by its season.

**Last season should not be regressed before use.** Carry factors of 0.3, 0.5,
0.65, 0.8 and 1.0 were tested and 1.0 — last season's final rating, untouched —
was best. The shrinkage weight `k` already controls how fast the prior fades;
regressing it as well shrinks twice.

## 4. The finding that matters most commercially

CBB Analytics' own documentation: *"We do not have RAPM ratings for the season
until late-December. Early-season projections are not available."*

Accuracy by how many games the less-experienced team had played:

| games played | MAE, no prior | MAE, last season carried | log loss, no prior | with prior |
|---|---|---|---|---|
| **0–1** | 11.56 | **10.09** | 0.512 | **0.476** |
| 2–3 | 10.42 | 9.73 | 0.576 | 0.548 |
| 4–5 | 9.84 | 9.41 | 0.542 | 0.520 |
| 6–8 | 9.41 | 9.05 | 0.515 | 0.507 |
| 13–17 | 8.79 | 8.71 | 0.579 | 0.575 |
| 25+ | 9.15 | 9.06 | 0.569 | 0.566 |

A team's *first game of the season* is predictable to 10.1 points MAE — barely
worse than the 8.7 available in February — provided last season is carried
forward. **A matchup tool that works in November is a product they cannot
ship**, and it costs us one line of code.

## 5. Home court

Measured from conference games only, where schedules are balanced home-and-home
and the buy-game confound disappears:

| season | home margin, conference games |
|---|---|
| 2022-23 | 3.28 |
| 2023-24 | 2.91 |
| 2024-25 | 2.98 |
| 2025-26 | **2.60** |

Home advantage is **declining**, and smaller than folklore: under 3 points, not
3.5–4.

### 5a. Conference is not non-conference

Residual bias of a model carrying a single flat HCA:

| context | n | bias (points) |
|---|---|---|
| conference, home floor | 9,883 | **+0.28** |
| non-conference, home floor | 3,974 | **+2.20** |
| neutral site | 2,112 | −0.12 |

**The home edge is roughly two points larger in non-conference games.**

The obvious objection is ratings compression — that the model under-rates the
gap between a high-major and a low-major, and those games are all
non-conference. It is not. Sliced by predicted margin, **neutral-court games
show no bias at any level**:

| predicted margin | neutral-court bias | non-conference home bias |
|---|---|---|
| −9.0 | −0.71 ± 0.57 | +2.92 ± 0.52 |
| −3.2 | +0.25 ± 0.55 | +2.54 ± 0.54 |
| 0.1 | −0.09 ± 0.55 | +1.05 ± 0.50 |
| +3.6 | −0.22 ± 0.55 | +1.42 ± 0.53 |
| +9.4 | +0.19 ± 0.58 | +2.67 ± 0.53 |

Same teams, same period, same ratings — the bias appears only where there is a
home floor and no return fixture. It fades from November (+2.65) to December
(+1.94), consistent with visitors acclimatising. An interaction term
(non-conference × |predicted margin|) is **zero** (0.0006 ± 0.031), so the flat
split is the right specification.

### 5b. Per-team home advantage is almost all noise

The famous claim, tested three ways:

- Split-half within a season (odd vs even home games): r = **−0.03, 0.15, 0.05**
- Season to season: r = **0.163, 0.094**
- Observed spread of the per-team home edge: sd 2.13–2.47 points per season —
  *exactly* the sampling noise expected from ~15 home games at a residual sd of
  11.5.

Pooled across three seasons the spread is 1.49 against an expected noise of
1.21, leaving **true team-to-team variation of about 0.9 points**. Real, small,
and needing heavy shrinkage. CBB Analytics' flat number is defensible.

**Altitude is the exception**, and the only per-team effect with a mechanism
that survives testing:

| home arena elevation | teams | mean edge over a flat model |
|---|---|---|
| above 6,000 ft | 3 | +0.84 |
| **4,500–6,000 ft** | 12 | **+2.10** |
| 3,000–4,500 ft | 6 | +0.76 |
| below 3,000 ft | 336 | +0.71 |

Pooled, ≥3,000 ft is worth **+0.83 ± 0.36 points (2.3σ)**. Utah (+5.5), BYU
(+4.8) and Colorado (+3.6) top the whole list. Worth about a point, not five.

### 5c. Travel, crowd and rest

`data/cbbd/<season>/games-*.json.gz` carries venue, city, state and attendance —
for 2025 and 2026 only.

- **Travel**: within conference games, visitor distance does nothing (bias +0.39
  under 50 miles, +0.66 over 1,000). The apparent effect in non-conference games
  is the buy game, not the flight.
- **Crowd**: monotone, ~1.6 points from the smallest conference crowds to the
  largest — but inseparable from program size with this data.
- **Rest**: a home team on a back-to-back loses about **1.0 point** (−1.006 ±
  0.340, 3.0σ). The rest *differential* does nothing. College basketball is not
  the NBA; back-to-backs are rare and mostly November tournaments.

## 6. Pace

The simple average of two adjusted tempos is **wrong**, and not slightly:

| pair | simple avg | KenPom product | fitted |
|---|---|---|---|
| slow + fast (62.2 / 74.1) | 68.15 | 68.36 | 67.88 |
| two slow (62.2 / 63.0) | 62.60 | 58.12 | 58.67 |
| two fast (74.1 / 73.0) | 73.55 | 80.23 | 76.85 |

Two fast teams put the two standard formulas **6.7 possessions apart**. Measured
bias by tempo band: the simple average runs +2.55 high for slow pairs and −1.11
low for fast ones; the KenPom product runs +1.70 high for fast pairs. The fitted
form is flat to within 0.09 possessions across every band:

```
pace = L − 0.75 + 0.83 × (tempo_A + tempo_B − 2L)
```

Accuracy: **MAE 3.31, RMSE 4.19 possessions** (2026).

### 6a. Fast games are more volatile — in points, not in outcomes

| | both slow (adjT < 66) | both fast (adjT > 70) |
|---|---|---|
| n | 858 | 692 |
| sd of margin | 13.07 | **15.85** |
| decided by ≤5 | 32.4% | **23.7%** |
| decided by 20+ | 13.6% | **24.1%** |
| favourite won | 70.5% | **75.6%** |
| mean total | 132.2 | 158.0 |

Residual sd scales as **pace^0.59** — indistinguishable from the √pace a
possession-level random walk predicts, and nowhere near linear.

**But this does not produce upsets.** Favourites win *more* often in fast games,
because the same pace multiplier that widens the distribution also widens the
projected margin. Scaling σ by pace gains nothing (log loss 0.5474 vs 0.5473) —
the two effects cancel almost exactly. The most counter-intuitive result in the
study: **fast games produce more blowouts and no more upsets.**

## 7. Style matchups

The style engine adjusts each four-factor dimension for opponent, exactly as
efficiency is adjusted. It works — it predicts the *style* of the game well:

| dimension | correlation with what actually happened |
|---|---|
| 3PA share | **0.567** |
| turnover rate | 0.406 |
| eFG% | 0.371 |
| free-throw rate | 0.298 |
| offensive rebound % | 0.241 |
| **3P%** | **0.101** |

And yet almost none of it moves the scoreboard, because opponent-adjusted
efficiency has already priced it in. Every candidate, fitted on 2023+2024:

| feature | coefficient (pts of margin) | t | verdict |
|---|---|---|---|
| power conference hosting a non-power team | **+2.772** | 5.5 | **keep** |
| non-conference home floor | +1.900 | 4.7 | **keep** |
| expected 3P% edge | **−0.232** | **−8.9** | **keep — negative** |
| expected 3PA-share edge | +0.080 | 5.3 | keep |
| both teams strong (`qualSum`) | +0.032 | 5.3 | keep |
| expected turnover edge | −0.112 | −3.3 | keep |
| expected ORB edge | +0.083 | 3.2 | keep |
| conference home floor | +0.795 | 2.4 | keep |
| home back-to-back | −0.388 | −1.1 | drop |
| eFG% edge | −0.022 | −1.0 | drop |
| free-throw-rate edge | +0.005 | 0.4 | drop |
| rest differential | −0.033 | −0.5 | drop |
| **pace gap (fast vs slow clash)** | −0.024 | −0.5 | **drop** |
| **combined pace (two fast teams)** | −0.001 | −0.03 | **drop** |

### 7a. The three-point result

The **strongest style term in the model is negative**: a team projected to
out-shoot its opponent from three **under-performs** by 0.23 points per
percentage point of edge.

3P% is the least persistent thing a team does — r = 0.101 with the actual
outcome, against 0.567 for shot selection. A team whose efficiency rating is
inflated by hot shooting will regress, and the rating has already banked the
luck. **Fade the hot shooters.** Same insight as KenPom's and Torvik's luck
adjustments, arrived at independently here.

### 7b. Does a rebounding advantage cancel out?

**No, it does not cancel — but it is worth far less than it looks.**

| expected ORB edge | n | actual ORB% differential | margin residual |
|---|---|---|---|
| −6.6 pp | 3,193 | −4.56 | −0.59 ± 0.20 |
| −2.5 pp | 3,194 | −2.27 | +0.56 ± 0.20 |
| −0.1 pp | 3,194 | −0.71 | +0.61 ± 0.20 |
| +2.3 pp | 3,194 | +1.00 | +1.19 ± 0.20 |
| +6.4 pp | 3,194 | +3.82 | +1.77 ± 0.21 |

The collision *is* predictable — a great offensive rebounding team really does
out-rebound a great defensive rebounding team, at 0.375 percentage points per
point of edge. It just barely reaches the scoreboard: across the full observed
range, the swing is **3.6 points of margin**, and most matchups sit nowhere near
those extremes.

### 7c. Offence and defence are worth exactly the same

Regressing actual margin on all four rating components at once:

| component | coefficient | t |
|---|---|---|
| home offence | 1.080 | 50.9 |
| home defence | 1.058 | 45.4 |
| away offence | 1.014 | 46.9 |
| away defence | 1.044 | 44.7 |

Offence mean 1.047, defence mean 1.051, **ratio 0.996**. No asymmetry to
exploit. (All four exceed 1.00 slightly — the model is ~4.6% under-spread.
Correcting it improves MAE and worsens log loss; left alone.)

## 8. Which parts of an identity survive a mismatch

The question behind a matchup page: when a mid-major walks into a power
conference gym, what does it keep and what does it lose?

Conference tiers here are **derived, not asserted** — leagues ranked by the mean
adjusted net rating of their members, top six = power. In 2025 that is SEC, Big
Ten, Big 12, Big East, ACC and Mountain West, which is where the data puts them.

The measure is a **carryover slope**: regress what a team actually did on what
the style model expected it to do. 1.00 means the profile fully survives; below
1 means the matchup suppresses it; above 1 means it is amplified.

**Baseline, all 31,938 team-sides:**

| dimension | slope | reading |
|---|---|---|
| 3PA share | **1.036** | shot selection is fully portable |
| turnover rate | 0.883 | mostly portable |
| eFG% | 0.784 | | 
| ORB% | 0.748 | |
| FT rate | 0.745 | |
| **3P%** | **0.285** | barely portable at all |

**Conference vs non-conference** — the identity that degrades most in unfamiliar
buildings is rebounding:

| dimension | conference | non-conference |
|---|---|---|
| ORB% | 0.784 | **0.648** |
| eFG% | 0.747 | 0.850 |
| 3PA share | 1.005 | **1.131** |
| turnover rate | 0.863 | 0.915 |

### 8a. A mid/low-major facing a power team, split by venue

The control column is the same teams playing *away* in non-conference games
against non-power opponents, which separates "playing a power team" from
"playing on the road".

| dimension | at the power team | neutral court | CONTROL: away, non-power |
|---|---|---|---|
| **FT rate** — bias | **−5.82** | −1.70 | −3.15 |
| FT rate — slope | 0.599 | 0.898 | 0.599 |
| **3PA share** — slope | **1.346** | 1.121 | 1.083 |
| **eFG%** — bias | **−2.34** | −0.93 | −0.84 |
| eFG% — slope | 0.606 | 0.617 | 0.689 |
| **turnover rate** — slope | **1.033** | 0.984 | 0.813 |
| turnover rate — bias | +0.84 | −0.90 | +0.20 |
| ORB% — slope | 0.592 | 0.594 | 0.616 |
| 3P% — slope | 0.198 | 0.104 | 0.290 |

And the mirror, a power team facing a mid/low-major:

| dimension | hosting | neutral court |
|---|---|---|
| **eFG%** — bias | **+3.30** | +0.35 |
| 3P% — bias | +1.99 | +0.23 |
| ORB% — slope | 0.612 | 0.760 |
| turnover rate — bias | −1.37 | −0.20 |

Four things fall out of that, and only one of them is about talent.

**1. The shooting gap between a power team and a mid-major is a home-floor
effect, not a talent effect.** In the power team's gym the eFG% swing is
+3.30 / −2.34, about 5.6 points. On a neutral court it is +0.35 / −0.93, about
1.3. **Roughly three quarters of "power conference teams shoot better against
mid-majors" disappears when you move the game to a neutral floor.**

**2. Free-throw rate is where the road actually shows up.** A mid-major loses
3.15 points of FT rate simply by playing away; against a power team on its own
floor it loses **5.82**. On a neutral court against the same calibre of
opponent, only 1.70. The slope collapses from 0.90 on neutral to 0.60 away —
the identity is suppressed as well as the level. This is the single largest
context effect in any dimension, and it is the one people argue about most.

**3. Underdogs go variance-hunting, and it is specific to the opponent, not the
venue.** A mid-major at a power school shoots proportionally more threes than
its own profile predicts — slope **1.346**, against 1.083 in the road control.
That is a deliberate strategic response to being outmatched, visible in the
data, and it is not simply road behaviour.

**4. Turnovers get amplified by the matchup, rebounding does not.** A
turnover-prone mid-major is punished *more* at a power school (slope 1.033 vs a
0.813 control). Offensive rebounding, by contrast, degrades at about the same
rate against anybody away from home (0.592 vs a 0.616 control) — it is a
road effect, not a tier effect.

### 8b. Does any of that move the number?

One term does, and it is large. Adding a **power conference team hosting a
non-power team** dummy on top of the non-conference home floor:

| term | coefficient | t |
|---|---|---|
| non-conference home floor | +1.900 | 4.7 |
| **power hosts non-power (additional)** | **+2.772** | **5.5** |
| conference home floor | +0.795 | 2.4 |

So the effective home floor is **+4.67 points** when a power-conference team
hosts a non-power team, against **+0.79** for an ordinary conference home game —
a factor of six. It improves both untouched seasons (2025 RMSE 11.635 → 11.599;
2026 11.545 → 11.512).

The style shifts in §8a, by contrast, mostly cancel in the margin: they change
*how* the game is played without changing *who wins by how much*, because the
efficiency ratings already contain the result. The exception is the
three-point-rate term, which survives at 5.3σ.

## 9. Win probability

The functional form does not matter. Pooled over 15,969 games:

| model | best parameter | log loss | Brier |
|---|---|---|---|
| Normal CDF | σ = 10.55 | **0.5473** | 0.1857 |
| Logistic | s = 6.25 | 0.5474 | 0.1858 |
| Student t, df = 10 | 9.95 | 0.5474 | 0.1858 |
| Student t, df = 5 | 9.40 | 0.5475 | 0.1858 |
| Pythagorean on scores | e = 11.3 | 0.5481 | 0.1860 |

All within 0.001. **Use the normal CDF because it is simplest, and spend the
effort on σ.** Pythagorean is marginally the worst — worth knowing, since it is
what the competition leads with. Their e = 11 default is confirmed correct: our
independent fit lands on 11.3.

## 10. The model, frozen

```
ratings          iterated fixed point, 24 iterations
                 HCA 2.0 per side per 100
                 shrinkage k = 3 games toward last season's final rating,
                   carried unregressed
                 single-game efficiency clamped to ±25 of the league mean

pace             L − 0.75 + 0.83 × (tempo_A + tempo_B − 2L)

efficiency       eff_A = adjO_A + (adjD_B − M) + loc × 2.0
                 eff_B = adjO_B + (adjD_A − M) − loc × 2.0
score            eff × pace / 100

margin           −0.4965
correction       + loc × (1.900 non-conference | 0.795 conference)
                 + 2.772 if a power team is hosting a non-power team
                 + 0.083 × ORB edge
                 − 0.112 × turnover edge
                 + 0.080 × 3PA-share edge
                 − 0.232 × 3P% edge
                 + 0.032 × (net_A + net_B)

win probability  Φ(margin / 10.9)
```

Out-of-sample, constants fitted on 2023+2024 only:

| | 2025 (holdout) | 2026 (never opened) |
|---|---|---|
| MAE, base → final | 9.127 → **8.999** | 9.166 → **9.076** |
| RMSE, base → final | 11.782 → **11.599** | 11.634 → **11.512** |
| accuracy, base → final | 71.68% → **72.14%** | 71.06% → **71.32%** |
| log loss, base → final | 0.5359 → **0.5319** | 0.5400 → **0.5370** |
| bias, base → final | −0.80 → **−0.11** | −0.35 → +0.38 |

**Variance accounting on 2025**: actual margin variance 218.7 (sd 14.79). The
base model leaves 138.8 — it explains **36.5%**. Every correction together takes
that to **38.1%**.

That ratio is the headline of the whole study. **Opponent-adjusted efficiency,
home court and pace do about 96% of the achievable work. Every matchup nuance
anyone has ever argued about, combined and fitted generously, is the other 4%.**

## 11. What the model cannot do

Totals. On 2026:

| target | MAE | RMSE |
|---|---|---|
| margin | 9.08 | 11.51 |
| pace | 3.31 | 4.19 |
| **total points** | **13.74** | **17.36** |

Predicting the total is roughly 50% harder than predicting the margin: pace error
and shooting variance both feed it and neither cancels. **Lead the page with
margin and win probability. Show the total, but do not sell it.**

## 12. Worked example — the mockup

Belmont vs Northern Iowa, projected as of **2026-02-12**, using only the 4,680
games played before that date.

```
                     adjO     adjD   adjNet  adjTempo   rank
Belmont            117.36   105.74   +11.62     69.77     59
Northern Iowa      105.87    96.42    +9.45     63.30     79
league             108.88        -        -     68.23

pace    simple average 66.53    KenPom 64.72    THIS MODEL 64.66

Belmont       = 117.36 + (96.42 − 108.88) + 2.0  = 106.90  →  69.1
Northern Iowa = 105.87 + (105.74 − 108.88) − 2.0 = 100.72  →  65.1

corrections   intercept −0.50   conference home floor +0.79
              ORB −0.47  TOV −0.34  3PA −0.26  3P% −0.13  quality +0.66
              total −0.23

PROJECTED     Belmont 69.0   Northern Iowa 65.2      Belmont 63.5%
```

They played the next day, **2026-02-13: Belmont 91, Northern Iowa 86.**

Margin +3.8 projected against +5 actual. The total was 134 projected against
177 — the game ran at 71 possessions, not 64.7, and both teams shot far above
their season profile. Exactly the asymmetry §11 describes, in one game. Their
January meeting, the same two teams, ran at **58**.

## 13. Open questions for the page

1. **Free vs paid.** Consistent with the rest of the site: current season free,
   historical matchups behind the Pass.
2. **Show the arithmetic**, as they do. It is the best thing about their product
   and it costs nothing.
3. **Show the style panel, label it honestly.** §8 is genuinely interesting to
   read and mostly does not change the number. The page should not imply it
   does.
4. **Refit the home-court constants each season.** They are drifting (§5), and
   the 2023-24 constants already leave 2026 with a +0.38 bias.
5. **Route count.** `/teams/[slug]/[year]/matchup` is ~1,812 prerendered pages
   via `tabbedSeasonParams`. A matchup *pair* page is 365² and cannot be
   prerendered — opponent selection has to be client-side.

---
---

# Part 3 — the player data

Written 2026-09-07, after part 2 concluded that team-level matchup nuance was
worth about 4% of the achievable work. Part 3 opens the data part 2 did not
touch: per-player box scores, roster continuity, shot zones and clock splits.

Same discipline throughout. Constants fitted on 2023 + 2024, scored once on
2025, then once on 2026.

## 14. A data trap that silently reads zero

`athleteId` in `box-players-full.json.gz` is **a per-row surrogate key, not a
player identifier.** Cooper Flagg carries **37 different `athleteId` values
across his 37 games** of 2025. Duke's 15-man roster produces 419 distinct
`athleteId`s over a season and exactly 15 distinct `athleteSourceId`s.

Keyed on `athleteId`, every player is a stranger every night. The first run of
the availability engine reported that **not one rotation player missed a game
in three seasons** — a result that is obviously wrong, which is the only reason
it was caught. A subtler analysis would have silently returned a null finding.

**Use `athleteSourceId` for any player join against this archive.**

Audited afterwards: production already knows this. `scripts/build-bta-porpag.mjs`
documents it at line 31 ("CBBD's athleteId is unique per player-GAME") and keys
on `athleteSourceId`; `build-cbbd-player-season.mjs` does the same. So this is a
trap I walked into rather than a bug in the repo — recorded here so the next
person reads it before losing an hour, not after.

## 15. Availability — the largest single addition to the model

The team-efficiency model is structurally blind to who is dressed. It can only
learn that a team got worse *after* it has played several games short-handed —
by which point the rating is dragged down by games the missing player will
return from.

The engine reconstructs, for every team-game, who was expected to play and who
did not, using only prior games to set expectations. A player counts as
rotation if he has appeared at least 3 times and averaged at least 8 minutes
over his last 5 appearances.

It is common:

| | |
|---|---|
| team-games missing at least one rotation player | **64.7%** |
| mean expected minutes missing per team-game | 19.3 |
| team-games missing their best player | **4.9%** |

And it matters:

| case | n | margin residual |
|---|---|---|
| home missing its best player | 705 | **−1.70 ± 0.42** |
| away missing its best player | 749 | **+3.00 ± 0.44** |
| neither | 14,467 | +0.70 ± 0.10 |

Against the +0.70 baseline, **losing your best player costs about 2.3 points of
margin beyond what the ratings already know.**

Fitted and scored on the 2025 holdout:

| spec | MAE | RMSE | accuracy | log loss |
|---|---|---|---|---|
| part 2 model | 9.024 | 11.635 | 72.14% | 0.5325 |
| + missing minutes | 9.015 | 11.620 | 72.27% | 0.5317 |
| + missing value | 9.005 | 11.612 | 72.37% | 0.5308 |
| + best player out | 9.000 | 11.615 | 72.31% | 0.5308 |
| **+ both** | **8.994** | **11.607** | **72.48%** | **0.5302** |

That is a bigger gain than the entire style block of part 2.

**One nuance:** `missTop` is worth 0.75 points in November–December (t = 0.85,
noise) and **2.28 points in January–April** (t = 4.7). Early in a season "best
player" cannot be identified from three games, so the term should be suppressed
until a team has a real sample.

**What this means for the page.** In production you do not know who will play
in a future game — but the user does, and the injury news does. This coefficient
is exactly what a *"remove this player"* control needs in order to move the
line by the right amount. It is the one feature where the competition's
player-level structure has a genuine advantage, and it is available to us
without RAPM.

## 16. Roster continuity

Computed from the archive itself rather than the shipped
`preseason-continuity.json`, which only covers the upcoming season: for each
team, what share of last season's minutes are played by players who appear
again this season.

Continuity explains error in the carried preseason prior, strongly early and
decaying:

| phase | correlation with residual | swing across the continuity range |
|---|---|---|
| first 5 games | **0.093** | 0.15 → 3.08 (**2.9 points**) |
| games 5–11 | 0.069 | 0.31 → 2.24 |
| games 12–19 | 0.042 | −0.24 → 1.05 |
| games 20+ | 0.035 | −0.31 → 0.90 |

**The obvious fix does not work.** Regressing the carried prior toward the mean
as a function of continuity was tested across a grid and every setting made
things worse than a flat carry. The reason is that continuity is not a
regression-to-mean effect: a team that loses its roster gets *worse in absolute
terms*, it does not become *average*. Shifting the prior additively instead
helped on the training seasons (MAE 9.074 → 9.053) but **failed to replicate on
2025** (9.125 → 9.124, log loss slightly worse).

What does work is the direct form — continuity as a margin correction, where it
does not have to fight through the shrinkage machinery or perturb every
opponent's adjustment:

| spec | MAE | RMSE | log loss |
|---|---|---|---|
| model + availability | 9.001 | 11.620 | 0.5305 |
| **+ continuity** | **8.991** | **11.609** | **0.5304** |

Coefficient **+2.467 points** per unit of continuity differential, t = 5.75.
Small, real, and worth keeping.

## 17. Aggregating players does not beat reading the team

The direct test of the competition's structure. A player-derived team rating,
built exactly the way their Matchup Calculator builds one: each player's
box-derived offensive and defensive rating, weighted by expected minutes,
scaled to 200 minutes, summed to a team offence and defence.

Head to head, fitted on 2023+2024 and scored on 2025:

| model | MAE | RMSE | accuracy | correlation with margin |
|---|---|---|---|---|
| player-derived rating alone | 10.507 | 13.579 | 63.68% | 0.327 |
| **team adjusted efficiency alone** | **9.091** | **11.704** | **71.75%** | 0.588 |
| blend of the two | 9.093 | 11.706 | 71.77% | — |

**The blend puts a weight of −0.004 on the player model.** Not small — zero.
The team model already contains everything the player aggregation knows, and
the two correlate at 0.555.

The natural objection is that the player model should shine early, before the
team has results. It does not:

| team games played | weight on player model | t | MAE gain |
|---|---|---|---|
| 0–5 | +0.006 | 0.39 | −0.001 |
| 6–11 | −0.006 | −0.78 | −0.008 |
| 12–19 | +0.004 | 0.40 | +0.002 |
| 20+ | −0.017 | −1.31 | −0.002 |

Zero at every phase. Even in a team's first five games the team model
correlates 0.582 with the margin against the player model's 0.360 — because the
carried preseason prior already encodes last season's players, through last
season's results.

**The honest caveat.** This is a box-derived player rating, not RAPM. CBB
Analytics report that their player-weighted RAPM model calibrated *better* than
the team formulas they tried, and proper RAPM is a genuinely better input than
individual box ratings. This test does not prove player models are useless; it
proves that **aggregating box-score player ratings adds nothing to a
well-built team model**, and that the bar a player model has to clear is
higher than it looks.

The practical conclusion stands either way: **player data's value is in the
delta, not the level.** Knowing a rotation player is out is worth 0.03 of MAE.
Knowing how good the roster is on paper is worth 0.004.

## 18. Shot zones and clock splits: nothing, with hindsight

`shot-distribution.json` (rim / mid-range / three rates, offence and defence)
and `clock-splits.json` (early / mid / late shot-clock rates and efficiencies)
are season aggregates, so using them inside their own season **leaks**. They
were tested that way deliberately: a feature that cannot help *with* hindsight
cannot help without it.

| spec | MAE | RMSE | accuracy | log loss | max t |
|---|---|---|---|---|---|
| model as it stands | 8.931 | 11.455 | 72.42% | 0.5325 | — |
| + shot zones (rim/mid/three) | 8.933 | 11.438 | 72.25% | 0.5323 | 0.55 |
| + clock splits | 8.962 | 11.482 | 72.42% | 0.5331 | **4.97** |
| + both | 8.965 | 11.472 | 72.32% | 0.5332 | 4.73 |

Shot zones: nothing at all (max t = 0.55). Clock splits are the more
instructive failure — **t = 4.97 in training and a worse holdout in every
metric.** That is overfitting with a leaky feature, caught by the holdout, and
it is the reason the discipline is worth the trouble.

Both dropped. The one shot-selection axis that survives is the 3PA-share edge
already in the model from part 2, which is as-of-date and unleaky.

## 19. The final model

```
ratings          iterated fixed point, 24 iterations
                 home-court 2.0 per side per 100
                 shrinkage k = 3 games toward last season's final rating,
                   carried unregressed
                 single-game efficiency clamped to ±25 of the league mean

pace             L − 0.75 + 0.83 × (tempo_A + tempo_B − 2L)

score            eff_A = adjO_A + (adjD_B − M) + loc × 2.0     -> × pace / 100
                 eff_B = adjO_B + (adjD_A − M) − loc × 2.0     -> × pace / 100

margin           −0.5168
correction       + loc × (1.849 non-conference | 0.781 conference)
                 + 3.017  power-conference team hosting a non-power team
                 + 0.088 × ORB edge
                 − 0.071 × turnover edge
                 + 0.068 × 3PA-share edge
                 − 0.247 × 3P% edge
                 + 0.033 × (net_A + net_B)
                 + 0.058 × missing-value differential
                 + 1.851 × best-player-out differential
                 + 2.467 × roster-continuity differential

win probability  Φ(margin / 11.0)
```

Every constant fitted on 2023 + 2024 alone:

| | 2025 holdout | 2026 never opened |
|---|---|---|
| MAE — base | 9.138 | 9.167 |
| MAE — part 2 | 9.010 | 9.076 |
| **MAE — final** | **8.965** | **9.042** |
| RMSE — base → final | 11.798 → **11.570** | 11.640 → **11.470** |
| accuracy — base → final | 71.62% → **72.41%** | 71.06% → **71.36%** |
| log loss — base → final | 0.5366 → **0.5299** | 0.5398 → **0.5342** |

**Variance explained on 2025: 36.5% base → 38.9% final.**

The part 2 conclusion survives part 3 essentially intact. The base model is
still doing the overwhelming majority of the work; the player data roughly
doubled the size of the correction block, which took it from 4% of the
achievable work to about 6%.

## 20. The mockup, final version

Belmont vs Northern Iowa, as of 2026-02-12, with the player terms in:

```
base projection                     69.12 − 65.13    margin +3.99

  intercept                         −0.52
  conference home floor             +0.78
  availability                      −0.44   Belmont without Nic McClain (25 mpg)
                                            Northern Iowa without RJ Taylor (11 mpg)
  continuity                        −0.50   Belmont 46.1% returning, UNI 66.5%
  rebounding / turnovers            −0.49 / −0.21
  shot selection / three-point      −0.23 / −0.14
  matchup quality                   +0.69
                                    ─────
                                    −1.06

PROJECTED    Belmont 68.6   Northern Iowa 65.7    margin +2.9    Belmont 60.5%
ACTUAL       Belmont 91     Northern Iowa 86      margin +5
```

The player terms moved this projection about a point *away* from the eventual
result, which is what a one-game sample is worth. Across 10,676 out-of-sample
games they moved it toward the result.

## 21. What is left

Untouched, in rough order of expected value:

1. **Real RAPM.** The one input that could overturn §17. A serious build —
   possession-level stints from `plays-*.json.gz` — and their own documentation
   says it does not produce ratings until late December, which is precisely the
   window where our carried prior already wins.
2. **As-of-date shot zones from play-by-play.** §18 says do not bother: the
   leaky version could not help.
3. **Lineup data** (`lineups-*.json`). Untested. Likely to behave like §17 —
   the team's own results already contain it.
4. **Referee assignments.** Not in the archive. The free-throw-rate road effect
   in §8a is the largest unexplained context effect and this is the obvious
   candidate mechanism.
