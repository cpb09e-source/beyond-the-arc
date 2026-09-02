# Legal / sources — review findings, 2026-09-02

The `/sources`, `/terms` and `/privacy` pages are **written and in the repo**,
linked from the footer of every page. They are NOT deployed yet — production is
on `2b50ebe` and these landed after it.

**This is not legal advice and I am not a lawyer.** What follows is a source
audit done by reading the code and the upstreams' own published terms, with
the risky items separated from the tidy ones so a real solicitor can be pointed
at the short list rather than the whole site.

---

## 1. What actually flows in — audited from the code, not from memory

Every external host referenced by `scripts/` and `src/lib/`:

| Source | What we take | How | Terms position |
|---|---|---|---|
| `api.collegebasketballdata.com` | schedules, box scores, play-by-play, lineups | paid API | **Clear.** Commercial use expressly permitted |
| `barttorvik.com` | team/player season tables, T-Rank | fetch | No published terms; site is behind a bot challenge |
| `www.sports-reference.com` | tournament games + box scores | scrape | Republishing **welcomed with credit**; scraping needs permission |
| `www.basketball-reference.com` | NBA draftees, NBA careers | scrape | same as above |
| `www.on3.com` / `api.on3.com` | portal moves, freshman membership (facts only) | fetch | Terms behind a 403; assume restrictive |
| `sites.google.com` / `docs.google.com` | RSCI consensus recruit ranks | fetch | Published to be reproduced with attribution |
| `site.api.espn.com` + `a.espncdn.com` | **20,164 player headshots, 34 coach photos** | download + re-serve | **Prohibited.** See §2 |

## 2. The one finding that actually matters — ESPN images

`scripts/fetch-player-images.mjs` downloads ESPN headshots and writes them to
`public/images/players/`. There are **20,164** of them, plus 34 coach photos
from the same source. They are re-served from btacbb.xyz, which is now a paid
site.

Disney's terms of use, which cover ESPN, prohibit all three things we do:

- "reproduce, distribute, communicate to the public, make available to the
  public, or transform any Disney Product"
- "use the Disney Products for any commercial or business-related use"
- "access, monitor, copy or extract the Disney Products using a robot, spider,
  script, or other automated means"

**Why this is different from the statistics.** Everything else on this site is
facts, and facts are not copyrightable (*Feist v. Rural Telephone*, 499 U.S.
340). A photograph is not a fact. It is a copyrighted work with an owner, and
we are redistributing 20,000 of them commercially. This is the single largest
piece of legal exposure on the site and it is not close.

**It needs a decision from Colin, not from me.** The options, cheapest first:

1. **Drop the photos.** Rosters and player pages fall back to initials or a
   silhouette. Costs a visual nicety, removes the exposure completely.
2. **Replace the source.** School athletics sites publish headshots and many
   are more permissive; some conferences licence media. Real work, keeps faces.
3. **Accept and mitigate.** Keep them, respond fast to any takedown. The
   `/sources` page already carries a takedown line, which helps and does not
   cure it.

Nothing in this repo should be read as a recommendation to ignore it.

## 3. Sports Reference — attribution owed, method to fix

They are unusually generous about the data: sharing, repackaging and
publishing for commercial purposes is welcome **provided they are credited
explicitly**, which the `/sources` page now does by name.

The problem is the method, not the output: automated access needs express
written permission, and they ask people not to build sites on scraped data.
Their published rate ceiling is 20 requests a minute on the non-FBref sites.

Open: either write and ask for permission (they do grant it), or confirm the
scrapers stay well under the ceiling and run rarely. Worth checking
`scrape-tournament-games.mjs` and `scrape-nba-*.mjs` for their delay.

## 4. R2 bucket is public and machine-readable

CBBD's terms forbid operating "a public database mirror, proxy, substitute API,
or substantially equivalent data service". Our data files sit in a **public**
R2 bucket — 165,287 objects of structured JSON, fetchable by anyone who reads
the network tab, with no auth and no rate limit.

We are not doing it deliberately, but a third party could trivially treat that
bucket as a substitute API, and it is our name on the subscription. Worth a
look: the paid seasons are already gated into the function bundle, so the
exposure is the free-tier data, but "free to read on the site" and "free to
bulk-download 165k files" are not the same offer.

## 5. Settled and no longer open

- **Recruiting ranks.** RSCI only. No 247/ESPN/On3/Rivals rank numbers
  anywhere in the pipeline — checked. This was the right call and stays.
- **Trademark disclaimer.** `/sources` states plainly that the site is not
  affiliated with or endorsed by the NCAA, any conference or any school.
- **Privacy.** There is genuinely almost nothing to disclose: no analytics, no
  ad network, no tracking cookies, no marketing list, and card details never
  reach this origin. The page says so and every claim in it was checked
  against the code.

## 6. Before these pages deploy

- [ ] **Governing law is a placeholder.** `/terms` §10 says Ohio. That is a
      guess from nothing — the repo does not record where the business
      operates. Colin must confirm the state, or the clause points a dispute at
      the wrong court. Flagged in the file too.
- [ ] **Confirm the refund promise.** `/terms` §4 offers 14 days, no questions.
      That is a real commitment; it should be one he wants to make.
- [ ] **Confirm the contact address.** Both pages use `cpb09e@gmail.com`. A
      role address would age better on a paid product.
- [ ] Decide §2 (ESPN images).
- [ ] Solicitor pass once the above are settled.

## 7. Still worth doing later

- Account self-deletion in the UI. `/privacy` promises deletion on request
  within 30 days, which is honest and manual; a button would be better.
- A cookie/consent banner is **not** needed today and should stay unnecessary —
  it only becomes required if an analytics or ad script is ever added.
