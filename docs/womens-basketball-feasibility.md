# Women's basketball on BTA — feasibility

Researched 2026-08-30. Nothing built; this is the decision record.

## The short version

CBBD has **no women's data**. ESPN's undocumented API does, at essentially the
same quality as its men's feed. Box scores and play-by-play go back to 2015 at
full coverage; shot coordinates and substitution events are a 2026-only feature
in **both** leagues. The four table pages are buildable with full history. Shot
charts and lineups are current-season or nothing.

## CBBD: no

Tested against the live API:

- `/teams?season=2025` returns 364 teams — D-I men's.
- `?gender=women`, `?league=womens`, `?division=women` are **silently ignored**:
  identical 364 rows, no error. A naive check would read as success.
- Rosters for UConn, USC and Notre Dame come back men's (McNeeley, Karaban,
  Claude, Burton). No schema field for gender or league anywhere.

## ESPN: yes

`https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball`
— the same host and shape the site already uses for player images and the men's
scoreboard. 362 teams, real schedule.

Per game, `/summary?event=<id>` gives:

- **Player box** — `MIN PTS FG 3PT FT REB AST TO STL BLK OREB DREB PF`
- **Play-by-play** — 445 plays on a sampled 2025 tournament game, 17 play types
- **Shot coordinates** — 137 shooting plays, 83 distinct coordinates (the same
  day's men's game: 142 shots, 112 distinct)
- **Rosters** with height, class, hometown, position, headshot

[wehoop](https://wehoop.sportsdataverse.org/) — the established R package on
these same endpoints — documents WBB play-by-play from 2004, schedules from
2002, team box from 2006. Its prebuilt releases would backfill history far
faster than scraping game by game.

## The coordinate survey

~15 games sampled per season per league, four dates spread Dec–Mar, 2015–2026.
"Charted" means ≥25 distinct shot coordinates in the game — a game where every
shot carries the same placeholder scores zero, which is the point of counting
distinct values rather than non-null ones.

| season | W box | W pbp | W charted | W subs | M charted | M subs |
|---|---|---|---|---|---|---|
| 2026 | 15/15 | 15/15 | **15/15** | **15/15** | **12/12** | **12/12** |
| 2025 | 13/13 | 13/13 | 6/13 | 5/13 | 5/17 | 5/17 |
| 2024 | 16/16 | 15/16 | 7/16 | 0 | 2/10 | 0 |
| 2023 | 18/18 | 18/18 | 3/18 | 0 | 6/13 | 0 |
| 2022 | 17/18 | 17/18 | 4/18 | 0 | 12/20 | 0 |
| 2021 | 13/14 | 13/14 | 2/14 | 0 | 6/15 | 0 |
| 2020 | 9/9 | 8/9 | 0 | 0 | 13/16 | 0 |
| 2019 | 16/16 | 11/16 | 0 | 0 | 9/15 | 0 |
| 2018 | 14/14 | 14/14 | 0 | 0 | 13/17 | 0 |
| 2017 | 20/20 | 18/20 | 0 | 0 | 8/16 | 0 |
| 2016 | 14/14 | 14/14 | 2/14 | 0 | 8/16 | 0 |
| 2015 | 16/16 | 15/16 | 5/16 | 0 | — | — |

**Read it as parity, not deficit.** Enrichment is a recent-seasons ESPN feature
in both leagues. Historical coordinates are better on the men's side but
inconsistent season to season.

**The site's men's shot charts and lineups do not come from ESPN — they come
from CBBD's play-by-play**, which is why they work historically. There is no
equivalent women's source, so those two features have no historical-parity path.

## What each feature needs, and whether it is there

| Feature | Needs | Women's? |
|---|---|---|
| Team Explorer, Conference Rankings | team results + box | ✅ 2015+ |
| Players Explorer, player pages | per-game player box, rosters | ✅ 2015+ |
| Game Log Explorer | per-game player box | ✅ 2015+ |
| Win Calc, clock splits, second chance | pbp with score + clock | ✅ 2015+ |
| Shot charts | pbp with coordinates | ⚠️ 2026 only |
| Lineups / On-Off | pbp with substitutions | ⚠️ 2026 only |
| Player ratings, PIR, portal grades | Torvik advanced stats | ❌ compute ourselves |
| Transfer portal, recruiting | On3, RSCI | ❌ men's only |
| Draft | NBA draftees | ❌ becomes WNBA |

Adjusted ratings are fine — `build-team-ratings.mjs` already computes ours from
game results.

## Architecture: a toggle, on this site, with a path prefix

**Decided 2026-08-30 with Colin.** A switch in the header, styled like the theme
toggle — but it is NAVIGATION, not a preference. `/w/players/games` beside
`/players/games`.

A theme is presentation and can live in localStorage. A league changes what the
data IS, so it has to be in the URL: otherwise shared links are ambiguous,
Google indexes one league, the back button does nothing, and a static export
cannot prerender the second league at all.

Not a separate site: it would duplicate the Netlify site, R2 wiring, Supabase
auth and Stripe entitlements, force a Season Pass holder to be entitled twice,
split SEO authority and double every component change.

Not a bare `?lg=w`: fine for the client-rendered tables, useless for entity
pages later, weaker for indexing. Pick the prefix once.

The switch swaps the prefix and preserves the rest, filters included, so it
reads as a lens rather than a different site.

Details settled: label it in words (M | W), not an icon; remember the last
choice for entry only and let an explicit URL always win; toggling from a page
with no counterpart lands on the nearest equivalent, never a 404; page headings
say "Women's" so a screenshot is unambiguous.

## Phasing

**Phase 1 — the four table pages.** Team Explorer, Players, Conferences, Game
Log. All four already fetch their data at runtime, so a league prefix costs
almost nothing at build time. Full history. This is a real product.

**Phase 2 — entity pages, narrowed.** `/teams/[slug]/[year]/*` and
`/players/[id]` are the expensive half: the men's side is already 30,686 pages,
13 GB, an 8-minute build and a 30–50 minute deploy. Doubling that is the single
biggest cost in the project and buys the least at first. Ranked players only,
recent seasons only.

**Phase 3 — the Torvik replacements.** porpag, PIR and the ratings that seed
the portal grades, computed from box + pbp.

Rough effort: ingest and backfill ~1 week, tables working ~1 week, metrics ~1–2
weeks. Not a weekend.

Also needs doing: `public/data/w/…` mirrored to an R2 `w/` prefix (four-list
rule — see `data-storage-and-backup.md`), per-league season lists and gates in
`access.ts`, per-league column masks so Torvik-derived columns do not render as
a broken table, and a women's `POWER_CONFS`. Logos need nothing — same schools.

## Legal

Not legal advice; `TODO-legal-sources.md` has a lawyer pass queued.

- **Our metrics are ours.** EPM, BTA porpag, portal ratings, the seal. No source
  has a claim on a formula we wrote, and applying it to women's inputs is no
  different from applying it to men's.
- **Facts are not copyrightable** (*Feist*), but the **terms of the pipe** still
  bind — contract, not copyright. That is why the CBBD key is server-side only.
- **Never republish another service's proprietary metric.** The existing
  discipline — On3 membership facts yes, On3 rank numbers no; RSCI because it is
  built to be reproduced with attribution — carries over exactly. Her Hoop
  Stats' ratings are theirs; their box scores are facts.
- **The women's side is legally cleaner than the men's**, because with no Torvik
  we compute from raw facts rather than from a third party's derived stats.
- **The exposure is ESPN**: undocumented, no license grant, ToS disfavours
  automated access. Same posture the site already carries for images and the
  men's scoreboard — this deepens it rather than creating a new category. If
  women's becomes paid, that is the moment to price a licensed vendor.

Two additions for the legal TODO: name **ESPN** on `/sources`, and note that the
**download/export** feature is the closest thing on the site to redistributing a
dataset rather than displaying facts — worth a line in the ToS.

## Alternatives considered

| Source | Cost | Verdict |
|---|---|---|
| ESPN endpoints | free | Everything above; same shape as existing men's ESPN code |
| wehoop releases | free | Prebuilt parquet — use for backfill, ESPN direct for daily |
| Her Hoop Stats | subscription | Good derived stats, but renting what we compute |
| SportsDataIO | paid | Licensed and clean; overkill unless redistribution matters |
