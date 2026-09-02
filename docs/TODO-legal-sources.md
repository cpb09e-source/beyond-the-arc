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

### 2.1 Three separate threads, not one

**a) Contract, with Disney/ESPN.** Their terms prohibit each of the three
things we do — "reproduce, distribute, communicate to the public, make
available to the public"; "use the Disney Products for any commercial or
business-related use"; "access, monitor, copy or extract ... using a robot,
spider, script, or other automated means". This is a breach of contract, and
the realistic remedy is a cease-and-desist or an IP block, not damages.

**b) Copyright — and the owner is NOT ESPN.** College headshots are produced
by the schools' athletics departments; copyright sits with the university or
with the photographer who shot them. ESPN is a distributor we took them from.
So the party with a copyright claim is each of ~360 athletics departments,
not Disney.

That cuts both ways. It means more potential claimants — but their damages are
weak: statutory damages require registration with the Copyright Office, and
routine team headshots are almost never registered. Unregistered works get
actual damages only, and the actual damages from a stats site showing a
2cm-wide headshot are close to nothing. **The realistic worst case is a DMCA
takedown, not a judgment.**

**c) Right of publicity — the thread nobody expects, and the sharpest one.**
Everything else on this site is protected by the same reasoning that decided
*C.B.C. Distribution v. MLB Advanced Media*, 505 F.3d 818 (8th Cir. 2007):
names and playing statistics are factual data, and the First Amendment beats a
right-of-publicity claim over them.

Read the opinion carefully and the shield has a hole in exactly our shape. The
court expressly noted that **CBC did not use the players' images** — only names
and publicly known statistics. Photographs are not the factual data that case
protects, and since 2021 college athletes hold commercial NIL rights in their
own likeness. Our stats are inside the shield. Our headshots are outside it.

### 2.2 What the comparable sites do

Sports-Reference's college basketball section — the largest, best-resourced
site in this space, with actual lawyers — shows **no player photograph at all**.
Checked directly: their Cooper Flagg page carries 42 images and not one is him.
Their NBA pages do have headshots, which they licence. KenPom and Bart Torvik
show none either.

The entire competitive set has independently landed on the same answer.

### 2.3 Replacements, researched

| Option | Verdict |
|---|---|
| **College Pressbox** — 8,000+ D-I headshots, $9.99/mo | **No.** Licence is "personal, noncommercial use only ... with no right to reproduce, distribute, communicate to the public, make available to the public". Scrapers "strictly prohibited". $9.99 buys media *access*, not redistribution |
| **Sportradar Images API** (bundles College Pressbox + Getty for NCAA MBB) | **The real licensed path.** Enterprise pricing, custom quote, sales contact required. Correct if faces matter enough to pay for |
| **Direct from the schools** | Plausible in principle — they produce headshots *for* publicity and want media using them — but it is ~360 separate permissions. The top 50 programmes would cover most traffic |
| **Wikimedia Commons** | Coverage for 20,000 college players is far too thin to be a system |

### 2.4 Decision — KEEP AND MITIGATE, settled 2026-09-02

Colin's call, made with the analysis above in front of him: **the headshots
stay.** The research recommended dropping them; the decision went the other
way, and this section records what was decided and what shipped alongside it
rather than re-arguing it.

**The reasoning that supports it.** Realistic enforcement risk at this size is
low and, more to the point, *cheap to be wrong about*. The copyright holders
are the athletics departments, not Disney; routine team headshots are almost
never registered with the Copyright Office, so there are no statutory damages
and actual damages from a 2cm-wide face on a stats site round to nothing. The
realistic first contact is a takedown notice, not a claim. What converts a
notice into something worse is ignoring it — so the whole mitigation strategy
below is aimed at making compliance fast rather than at making discovery
unlikely.

**Logos are a separate and much easier question** and were never really in
doubt: using a school's mark to identify that school's team is nominative fair
use, the disclaimer is live in the footer bottom bar and on `/sources`, and the
entire industry does the same thing. No action needed.

**Mitigations shipped with this decision:**

| # | What | Where |
|---|---|---|
| 1 | `X-Robots-Tag: noindex` on `/images/players/*` and `/images/coaches/*` | `netlify.toml` |
| 2 | Config kill switch — two commented `[[redirects]]` that 404 every photo path, no rebuild required | `netlify.toml` |
| 3 | Build-time kill switch — `NEXT_PUBLIC_BTA_PHOTOS=off` | `player-photo.tsx`, `coach-photo.tsx` |
| 4 | Takedown address, already live | `/sources` §corrections |

Why two kill switches. The build flag is the correct permanent state but costs
a full rebuild and upload — the better part of two hours. The redirect is
config-only: `out/` does not change, Netlify re-uploads nothing, and the photos
are gone in minutes. Comply with the fast one, then rebuild with the flag when
convenient. Both land on the initials monogram that `player-photo.tsx` already
renders for every player without a headshot, so nothing breaks either way.

**Runbook if a notice arrives:** uncomment the two redirect blocks in
`netlify.toml` → `netlify deploy --prod --dir=out --no-build` → poll
`netlify api listSiteDeploys` until `ready` → reply to the sender confirming
removal. Target the same day. Then rebuild with `NEXT_PUBLIC_BTA_PHOTOS=off` to
make it permanent.

**What this does not do.** None of it makes the images licensed. It makes the
exposure low-consequence and fast to unwind, which is the right trade for a
business at this stage — not a legal defence. Two things would change the
calculus and are worth revisiting at the time: meaningful growth (press, a
viral chart, real subscriber numbers), and any raise, sale or partnership,
where diligence will find 20,164 unlicensed files. If faces are worth real
money by then, get a Sportradar quote and put them back licensed.

**Loose end:** the 34 coach photos ship in the export but nothing renders them
— `coach-photo.tsx` has held `SHOW_PHOTOS = false` since the coverage was
judged too sparse (17 of 804). They are still fetchable at their own URLs, so
they carry the full risk and deliver no product value. Deleting
`public/images/coaches/` would be a free reduction in exposure with zero
visible change. Colin's call, not done unilaterally.

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

- [x] **Governing law — SETTLED 2026-09-02. Texas**, confirmed by Colin, who
      operates from there. `/terms` §10 now names Texas and the placeholder
      warning is gone from the file.
- [ ] **Confirm the refund promise.** `/terms` §4 offers 14 days, no questions.
      That is a real commitment; it should be one he wants to make.
- [ ] **Confirm the contact address.** Both pages use `cpb09e@gmail.com`. A
      role address would age better on a paid product.
- [x] **§2 (ESPN images) — SETTLED 2026-09-02. Keep and mitigate**, decided by
      Colin against the recommendation to drop. noindex headers and both kill
      switches shipped with the decision; see §2.4 for the runbook. Open
      sub-item: whether to delete the 34 unrendered coach photos.
- [ ] Solicitor pass once the above are settled.

## 7. Still worth doing later

- Account self-deletion in the UI. `/privacy` promises deletion on request
  within 30 days, which is honest and manual; a button would be better.
- A cookie/consent banner is **not** needed today and should stay unnecessary —
  it only becomes required if an analytics or ad script is ever added.
