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

**Unresolved: how they get Game Pace.** 67.6 is consistent with *both* the
simple average of the two paces ((65.5+69.6)/2 = 67.55) and the KenPom-style
formula (65.5 × 69.6 / 67.42 = 67.62). Duke and Michigan sit either side of
league average, which is exactly the case where the two methods agree. One
observation cannot separate them, and I am not going to guess — pick a
lopsided pair (a very slow team against a very fast one) and the two formulas
diverge by a possession or more.

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

1. **Game pace formula** — simple average or KenPom's product-over-league?
   Resolve by testing a lopsided pace pair, or just pick the KenPom form and
   document the choice.
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
