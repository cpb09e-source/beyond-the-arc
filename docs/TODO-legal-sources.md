# TODO — Legal / Sources page (review before paywall launch)

Site is going behind a paywall and being promoted, so we need a public
**Sources & Attribution** page (and a light legal review) before launch.

## Why
We display third-party data. Facts (stats, ranks, records) aren't copyrightable,
but a paid product raises the bar on attribution + ToS hygiene. A visible sources
page is the cheap insurance.

## Add a `/sources` (or `/about/data`) page listing every data source
- **Bart Torvik (barttorvik.com)** — player/team stats, projections, T-Rank.
- **On3 (on3.com)** — transfer portal moves; recruit *membership* (who committed
  where — facts). NOTE: we do NOT display On3's proprietary rank number.
- **RSCI — Recruiting Services Consensus Index (rscihoops.com)** — the recruit
  national-rank badge (#N / UR). Already attributed inline on preview rosters:
  "Recruit rankings: RSCI (Recruiting Services Consensus Index), rscihoops.com".
- **NBA draft data** — nba-draftees scrape (source: check scrape-nba-draftees.mjs).
- Any others surfaced during audit (tournament box scores, conference data, etc.).

## Legal review checklist
- [ ] Confirm each source's ToS re: commercial / paywalled reuse of *facts*.
      Riskiest = proprietary single-service rankings (247/ESPN/On3/Rivals) — we
      intentionally avoid citing their rank numbers; keep it that way.
- [ ] Decide: keep On3 for freshman membership, or restrict incoming freshmen to
      RSCI top-100 only (drops the "UR" rows) to remove On3 from the pipeline.
- [ ] Add a general Terms of Service + Privacy Policy for the paid site.
- [ ] Add "not affiliated with / endorsed by" disclaimer for logos + school marks
      (team logos are trademarks — nominative fair use, but state it).
- [ ] Consider a lawyer pass once the sources page + ToS drafts exist.

## Context
- Rank-source research + decision: RSCI chosen as the legally-safest recruit-rank
  source (consensus index, built to be reproduced with attribution). Rank numbers
  are non-copyrightable facts (Feist v. Rural; Sports-Reference states it plainly).
- Implemented in: scripts/scrape-recruits.mjs (RSCI join), season-preview.tsx
  (attribution footnote), sortable-roster-table.tsx (RsciBadge).
