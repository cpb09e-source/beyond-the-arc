/**
 * rescore-portal.mjs — re-rank the transfer portal on EPM.
 *
 * Rewrites public/data/portal.json in place: attaches `epm` and `pvs` to every
 * entry, recomputes `stars`, and rebuilds `transfer_classes`. Reads only what's
 * already on disk — no On3 call, no Supabase — so it's safe to re-run and it
 * respects the data freeze.
 *
 * RUN IT UNDER TSX, not node: the returner rule reads a season other than
 * the last one, and productionFor() in scripts/lib/bta-prtg.mts is the one
 * place the raw_row offsets for games, minutes and PIR are decoded.
 *
 *   npx tsx scripts/rescore-portal.mjs
 *
 * ---------------------------------------------------------------------------
 * THE SCORE
 *
 * Portal Value Score (PVS) = EPM × role weight.
 *
 *   EPM   points per 100 possessions the player adds over an average D-I
 *         player. Real play-by-play fit (epm-<year>.json) where we have it,
 *         box-score estimate (box-epm-<year>.json) filling the rest — the same
 *         precedence readImpactForYear and compute-player-ranks use, so the
 *         portal can never quote a different EPM than the player's own page.
 *
 *   role  min(1, MPG / 28) ^ 0.7. A rate stat alone would rank a 9-minute
 *         bench player off a hot 200-possession sample above a 32-minute
 *         starter. The exponent softens the taper: 14 MPG keeps ~62% of its
 *         weight rather than 50%, because a half-time contributor is worth
 *         appreciably more than half a starter, not exactly half.
 *
 * Negative EPM times a big role goes further negative, which is correct — a
 * below-average player who played 30 minutes did more damage than one who
 * played 12.
 *
 * NO CONFERENCE MULTIPLIER, and that's a measured decision rather than an
 * omission. Across all 4,953 ranked 2026 players, power-conference EPM averages
 * 1.65 against 0.37 for everyone else (p90: 3.85 vs 1.89) on effectively
 * identical possession counts. EPM already separates the tiers on its own, so
 * layering conf-tiers.ts on top — as BTA PRTG did — would count level of
 * competition twice and inflate every power-conference transfer.
 *
 * STAR TIERS hang off the Rating (see starsForRating), not off PVS — they were
 * left on PVS after the blend went in and immediately contradicted the page:
 * the #1 transfer by Rating wore four stars. Still fixed cutoffs, not
 * percentiles, so a tier cannot drift because someone else entered the portal.
 *
 * ---------------------------------------------------------------------------
 * CLASS NET is Σ Rating(in) − Σ Rating(out) over 2★-and-up moves: a straight
 * ledger of talent gained against talent lost, in Rating points.
 *
 * It used to sum PVS. The reason it does not any more is not that eWins is a
 * different opinion — measured across 535 scored portal entries the two
 * correlate at 0.983, so the ordering barely moves. It is that a class total
 * has to be ADDITIVE, and only one of them is.
 *
 * EPM is a rate: points per 100 possessions. Adding five players' EPMs does not
 * produce a team quantity, and PVS is EPM times a hand-tuned minutes curve —
 * min(1, MPG/28)^0.7 — so summing it produces a number in no unit at all. eWins
 * is EPM times the possessions the player actually played, divided by points
 * per win, so it is already denominated in wins and summing it means something:
 * "this class added 4.2 wins over what an average player would have."
 *
 * The minutes curve was also wrong in a specific way. It reads MPG and never
 * sees GAMES, so a player who missed two thirds of the season was weighted like
 * one who played it all: Markus Burton (10 games, 30.1 MPG) ranked 32nd of 535
 * on PVS and 185th on eWins. For "what did this school actually gain or lose",
 * ten games is ten games.
 *
 * WHAT THIS DOES NOT BUY, stated plainly because it would be easy to imply
 * otherwise: eWins is not better at PREDICTING a transfer's next season. Over
 * 1,326 transfers with a real fit in both seasons, next-year eWins correlates
 * r=0.464 with prior eWins, 0.474 with prior PVS and 0.476 with prior EPM alone
 * — all the same number. On the partial-season subset (GP<=20, n=108) eWins is
 * the WEAKEST of the three, 0.335 against 0.385, which is the Burton case in
 * reverse: a class total should not credit him for games he did not play, but
 * an estimate of what he will do next year should not dock him for them either.
 *
 * ONE FORWARD-LOOKING TERM: the sophomore leap. Class totals sum `ewins_proj`,
 * which is realized eWins plus a measured freshman development bump. Everything
 * else here is descriptive. See SOPH_LEAP below for the numbers and for the
 * mistake that nearly kept it out — an earlier pass measured the effect on
 * transfers alone, where the deciding cell holds 20 players, concluded there was
 * no class effect, and was contradicted by the full 17,455-pair population.
 *
 * NO STEP-UP DISCOUNT for mid-major players moving to a power league, and this
 * one is worth spelling out because the intuition behind it is CORRECT and the
 * conclusion still goes the other way.
 *
 * The role loss is real and large. Over 268 mid->power transfers, usage falls
 * 4.2 points and minutes 4.7 per game. So does the rate: among players who left
 * at EPM >= +1, mid->power lost 0.73 EPM against 0.17 for power->power movers
 * who started at essentially the same level (+2.20 vs +2.10). On a per-
 * possession basis, stepping up costs about half a point of EPM.
 *
 * It does not survive as a predictor of next-season VALUE. Regressing next-year
 * eWins on prior EPM gives R^2 = 0.2269; adding step-up and step-down
 * indicators gives 0.2304. Knowing the conference move is worth 0.35% of
 * explanatory power — and the mid->power coefficient comes out at +0.045, the
 * WRONG SIGN for a discount. Two things cancel the rate loss: power programs
 * play more games, so the same player banks more possessions, and the mid-major
 * players who get power offers are positively selected relative to their EPM.
 *
 * A discount here would be a knob that does not earn its place and points the
 * wrong way. The interesting finding is kept where it belongs — in the comment,
 * not in the score.
 */
import fs from "node:fs";
import path from "node:path";
// Run under tsx (see the header): productionFor() is the one place the
// raw_row offsets for games, minutes and PIR are read, and the returner rule
// needs them for a season other than the last one.
import { computeCohortStats, productionFor } from "./lib/bta-prtg.mts";

const DATA = path.resolve("public/data");
const PORTAL = path.join(DATA, "portal.json");
const RANKS_DIR = path.join(DATA, "player-ranks");

/**
 * A player's overall EPM board position for a season, or null.
 *
 * THE SAME NUMBER THE TOP-100 SEAL DRAWS on a player page — read from the
 * same per-player file rather than recomputed here, so the portal cannot
 * disagree with the mark on the player's own page about whether he is in the
 * hundred. A player with no file (a JUCO arrival, a D-II transfer, a
 * freshman) simply has no board position, which is not the same as being
 * outside the hundred but ranks the same way here.
 */
function boardRank(bartId, year) {
  if (!bartId || !year) return null;
  const fp = path.join(RANKS_DIR, `${bartId}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(fp, "utf8"));
    const season = (j.seasonRanks ?? []).find((r) => r.year === year);
    const rank = season?.rankOverall;
    return typeof rank === "number" && rank > 0 ? rank : null;
  } catch {
    return null;
  }
}

/** The board is a hundred deep, same cutoff as the seal. */
const TOP_100 = 100;

// Minutes that count as a full-time role. A 28+ MPG player carries full weight.
const FULL_MPG = 28;
const ROLE_EXP = 0.7;

// Same production baseline the portal table filters on, so a player can't be
// starred without also being visible.
const MIN_GP = 10, MIN_MPG = 12, MIN_PPG = 4;


/**
 * Rating points per win. The portal Rating is the blended value on a readable
 * scale: 0 is an average player, and at 33 the best transfer in this cycle
 * lands at 97 with nothing clipping the top. It moved from 30 when the PIR term
 * went per-40 and the value spread widened; it tracks that spread and nothing
 * else.
 *
 * DELIBERATELY NOT the class score's 12 points per win, and the difference is
 * not an oversight. A class score is a SUM over a whole roster's worth of moves
 * and has to stay legible when eight players are added together; a player
 * rating is a single number and can spend the whole 0-100 range on one man. One
 * constant cannot do both without either squashing players into single digits
 * or sending classes into the hundreds.
 */
const RATING_SCALE = 33;

/**
 * STAR TIERS, re-cut on the Rating.
 *
 * They used to hang off PVS, which stopped being the number this file ranks on
 * once eWins, the freshman bump and tiered PIR went in. The result was visible
 * on the page: Tounde Yessoufou was the #1 transfer by Rating and wore four
 * stars, because PVS could not see either of the two terms that put him there.
 * A tier that disagrees with the column it sits next to is worse than no tier.
 *
 * Re-cut against the Rating distribution to preserve the share split this file
 * has always documented as the intent — roughly 2 / 12 / 28 / 32 / 27 percent —
 * so the tiers mean the same thing they did before even though what feeds them
 * changed. Still FIXED cutoffs rather than percentiles, for the same reason as
 * ever: a player's tier must not drift because someone else entered the portal.
 */
function starsForRating(r) {
  if (r >= 57) return 5;
  if (r >= 31) return 4;
  if (r >= 7) return 3;
  if (r >= -10) return 2;
  return 1;
}

/**
 * Possessions per minute of court time, the median over the 552 portal
 * player-seasons that have both a fitted possession count and 200+ minutes.
 * The distribution is tight — p5 1.539, p95 1.872 — which is what makes it
 * usable as a repair below.
 */
const POSS_PER_MIN = 1.70;
/** College points of margin per marginal win — same constant as the EPM export. */
const PTS_PER_WIN = 30;
/**
 * Below this share of the possessions a player's own minutes imply, the fitted
 * possession count is not a small sample, it is wrong. Two of 567 portal
 * entries trip it: CJ Brown is recorded at 14.3 possessions against 906 minutes
 * over 34 games, and Isaiah Johnson at 70.1 against ~980. eWins is EPM times
 * possessions, so left alone those two silently score 0.00 wins for a full
 * starting season, and a school's class total quietly loses a starter.
 */
const POSS_SANITY = 0.25;

// ---- EPM + eWins, real fit first then box estimate ----
// eWins exists ONLY in the play-by-play fit — box-epm carries none — so a
// box-only player gets an EPM and a null eWins rather than a fabricated zero.
// That costs almost nothing here: of 569 portal entries with an EPM, 567 come
// from the real fit.
const epmCache = new Map();
function epmForYear(year) {
  if (epmCache.has(year)) return epmCache.get(year);
  const out = new Map();
  for (const [file, fillOnly] of [[`epm-${year}.json`, false], [`box-epm-${year}.json`, true]]) {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const [id, v] of Object.entries(j.players ?? {})) {
      if (typeof v?.epm !== "number" || !Number.isFinite(v.epm)) continue;
      const k = Number(id);
      if (fillOnly && out.has(k)) continue;
      out.set(k, {
        epm: v.epm,
        ewins: typeof v.ewins === "number" && Number.isFinite(v.ewins) ? v.ewins : null,
        poss: typeof v.poss === "number" && Number.isFinite(v.poss) ? v.poss : null,
        on_off: typeof v.on_off === "number" && Number.isFinite(v.on_off) ? v.on_off : null,
      });
    }
  }
  epmCache.set(year, out);
  return out;
}

/* ---------------------------------------------------------------------------
 * PIR, TIERED BY CONFERENCE.
 *
 * PIR is the box-score composite — points + rebounds + assists + steals +
 * blocks, minus missed shots — and unlike EPM it carries NO opponent
 * adjustment at all. A 20-PIR season in the Sun Belt and a 20-PIR season in the
 * SEC are the same number against wildly different defenses, which is exactly
 * the case for tiering it and exactly why EPM is NOT tiered anywhere in this
 * file: the adjustment is already inside EPM, and applying it twice would
 * double-count level of competition.
 *
 * THE TIERS ARE SPECIFIED, NOT FITTED — they are Colin's, applied as
 * multipliers (POWER ×1.08 down to Tier 5 ×0.68). What was measured is whether
 * they help, and they do, clearly:
 *
 *   corr(raw PIR,    next-season eWins) = 0.148
 *   corr(tiered PIR, next-season eWins) = 0.270
 *
 * Tiering roughly doubles the signal, which is what you would expect if raw PIR
 * was mostly rewarding low-major volume.
 *
 * AND IT EARNS ITS PLACE IN THE BLEND by the same standard that got the
 * step-up discount rejected. Over 1,326 transfers with a fit in both seasons,
 * predicting next-year eWins:
 *
 *   eWins alone                 R² = 0.2149
 *   eWins + PIR raw             R² = 0.2238   (+0.009)
 *   eWins + PIR TIERED          R² = 0.2468   (+0.032)
 *
 * +0.032 R² is ten times what conference-move indicators bought (+0.0035), and
 * that one was refused. This one is in.
 *
 * TWO THINGS THE BLEND HAS TO GET RIGHT, or PIR quietly takes the whole score
 * over:
 *
 *  1. CENTERING. eWins is denominated over an AVERAGE player, so an average
 *     player scores 0. PIR is not, so adding it uncentered would hand every
 *     transfer a large positive number and turn the class table into a count of
 *     bodies. The term is (adjusted PIR/40 − PIR_BASELINE), which is 0 for an
 *     average player and negative below, exactly like eWins.
 *
 *  2. PER FORTY MINUTES, NOT PER GAME — and this one was got wrong first time.
 *     Raw PIR correlates 0.821 with minutes played: it is mostly a minutes
 *     proxy. eWins is already EPM times possessions, so blending raw PIR
 *     charged playing time TWICE, in opposite directions for the same player.
 *     Measured, the per-game term paid +0.313 wins to the 30-40 mpg bucket and
 *     took 0.402 off the 12-18 bucket, almost independently of quality.
 *
 *     Najai Hines is the case: EPM +1.53, a POSITIVE on/off, a freshman — and a
 *     Rating of -1, because 18 minutes a night meant a raw PIR of 4.6 against a
 *     15.2 baseline and a 0.61-win charge that erased everything else. Per 40 he
 *     is 10.9, still below average and still charged, but 0.23 rather than 0.61.
 *     The per-40 term is flat across minutes buckets by construction: -0.044 to
 *     +0.033 against the per-game version's -0.402 to +0.313.
 *
 *     IT COSTS PREDICTION AND IS WORTH IT. Raw PIR takes the blend to R² 0.2468
 *     and per-40 to 0.2342, because minutes genuinely do predict — a coach
 *     playing you 33 a night knows something. But that is a fact about minutes,
 *     and this file already has a minutes term. Paying for it twice made the
 *     Rating a worse description of a player, which is what it is for.
 *
 *  3. SCALE. The weight is read off the regression, not chosen: fitting
 *     next-year eWins on (eWins, tiered PIR/40) puts one point of adjusted
 *     PIR/40 at 0.0201 wins.
 * ------------------------------------------------------------------------- */
const PORTAL_CONF_TIER = {
  // Power
  SEC: 0.08, B10: 0.08, B12: 0.08, ACC: 0.08, BE: 0.08,
  // Tier 1
  MWC: -0.05, WCC: -0.05, A10: -0.05,
  // Tier 2
  MVC: -0.13, Amer: -0.13, Ivy: -0.13, WAC: -0.13,
  // Tier 3
  MAC: -0.18, BW: -0.18, CUSA: -0.18, BSky: -0.18,
  CAA: -0.18, Slnd: -0.18, Horz: -0.18, BSth: -0.18,
  // Tier 4
  SB: -0.25, Sum: -0.25, SC: -0.25, MAAC: -0.25, ASun: -0.25,
};
/** Everything not named above — AE, MEAC, NEC, OVC, Pat, SWAC and friends. */
const TIER_5 = -0.32;
const confTierAdj = (conf) => PORTAL_CONF_TIER[conf] ?? TIER_5;

/**
 * Mean adjusted PIR across the 579 portal entries that clear the production
 * floor. Fixed rather than recomputed per run, for the reason the star cutoffs
 * are fixed: a centering constant that moves with the cohort would make one
 * school's score depend on who else happened to enter the portal.
 */
const PIR_BASELINE = 22.33;
/** Wins per point of adjusted PIR-per-40, from the regression documented above. */
const PIR_WEIGHT = 0.0201;

/* ---------------------------------------------------------------------------
 * THE NEGATIVE ON/OFF PENALTY.
 *
 * On/off is team net rating per 100 possessions with the player on the floor
 * minus off it, luck-adjusted. A negative one says the plainest thing in the
 * file: his team was worse when he played.
 *
 * WHAT THE MEASUREMENT SAYS, recorded because it does NOT support this term and
 * that should be on the record rather than buried. Over 1,323 transfers with an
 * on/off in the prior season, predicting next-year eWins:
 *
 *   Rating value alone                 R² = 0.2471
 *   + a negative-on/off term           R² = 0.2476   (+0.0005)
 *
 * That is a seventh of what the conference step-up indicators bought, and those
 * were refused. Worse, the fitted coefficient comes out the WRONG WAY: holding
 * value equal, a more negative on/off predicts a slightly BETTER next season.
 *
 * The raw split looks like it argues the opposite — players with a negative
 * on/off average 0.12 eWins the following year against 0.32 for the rest — but
 * that gap is entirely who they are, not their on/off: the same group averages
 * -0.26 in Rating value against +0.29. The Rating already knows they are worse.
 * This is the sophomore-leap confound again, running the other way.
 *
 * WHY IT IS IN ANYWAY. The class total is not purely a projection — it is a
 * statement about what a school got, and eWins was chosen over PVS on exactly
 * that descriptive ground. On/off is the only raw TEAM-level fact in the file:
 * EPM is a regularized individual estimate that deliberately strips away
 * teammates, so a player can post a strong EPM on a team that was measurably
 * worse whenever he played, and nothing else here would notice. Preston Edmead
 * is the case — 16.1 ppg, EPM +2.12, a 25.7 PIR, ranked 12th of 556, and
 * Hofstra were 6.6 points per 100 worse with him on the floor.
 *
 * So it is deliberately a judgement, not a fitted term, and it is sized to
 * matter without deciding anything on its own: a typical negative (-5) costs 3
 * rating points, and the floor caps the damage at 15. If it should come out,
 * ONOFF_PENALTY is the only line to change.
 *
 * ASYMMETRIC BY DESIGN: only negatives are charged. A positive on/off is the
 * noisiest praise in the file — on a rotation that never splits up it is a
 * statement about the lineup, not the player — so it earns nothing.
 * ------------------------------------------------------------------------- */
const ONOFF_PENALTY = 0.02;
/**
 * Below this the number is small-sample noise rather than evidence. Only two
 * portal entries reach it (the worst is -30.6), and a 0.6-win charge off a
 * thin possession sample would be the tail wagging the rating.
 */
const ONOFF_FLOOR = -25;

/* ---------------------------------------------------------------------------
 * THE MID-MAJOR PENALTY. Portal-only, and blunt on purpose.
 *
 * Ten percent off the Rating of anyone whose last season was outside the ACC,
 * Big Ten, Big 12, SEC or Big East. It is a second conference adjustment on top
 * of the one already inside the PIR term, and the two do different jobs: the
 * PIR tier grades a box-score line against the defenses that allowed it, and
 * touches roughly 40% of the Rating's magnitude; this one discounts the whole
 * number, EPM and eWins included, on the view that a mid-major season is a
 * weaker read on a player full stop.
 *
 * APPLIED AS "10% WORSE", NOT AS x0.9, and the difference is the whole
 * implementation. Multiplying a rating by 0.9 makes a positive one smaller and
 * a NEGATIVE one smaller too — a -50 would improve to -45, so the penalty would
 * quietly reward the worst mid-major players in the file, which is the opposite
 * of the intent. Subtracting a tenth of the ABSOLUTE value moves everyone the
 * same direction: 60 becomes 54, -50 becomes -55.
 *
 * Graded on the conference the player actually PLAYED in, not the one he is
 * moving to — the season being discounted is the one already on the books.
 */
const MID_MAJOR_PENALTY = 0.10;
const POWER_CONFS = new Set(["ACC", "B10", "B12", "SEC", "BE"]);

/* ---------------------------------------------------------------------------
 * SCHOOL NAMES, and the three bugs one bad name caused.
 *
 * On3 sends schools in registrar form for a large minority of rows — "Gonzaga
 * University", "Santa Clara University", "Saint Joseph's University" — where
 * the rest of the site uses Bart's short names. 126 of 340 distinct portal
 * school names did not match a team page. That broke three things at once:
 *
 *  1. LINKS. The transfer-class panel slugs the name it is given, so Gonzaga's
 *     card pointed at /teams/gonzaga-university, which is a 404.
 *  2. CLASSES. Buckets are keyed by school name, so a school could be split
 *     across two spellings and its card would read "Gonzaga University".
 *  3. VISIBILITY, the one that actually hid players. On3's own division lookup
 *     fails on the same names, so it reported division 2 for both ends of
 *     Massamba Diop's Arizona State -> Gonzaga move. The portal table filters
 *     to D-I, so 51 players who cleared every production floor were invisible —
 *     19 of them unambiguously D-I on at least one side. Searching for "Diop"
 *     or "Murauskas" returned nothing, which reads as a broken search box and
 *     is really a bad division flag three layers upstream.
 *
 * Fixed by resolving every school against OUR OWN archive of D-I team names
 * and deriving D-I status from whether it resolved, rather than trusting the
 * feed's division field. Reads only committed data, so it is freeze-safe.
 * ------------------------------------------------------------------------- */
const TEAM_ALIASES = {
  /**
   * The two ambiguous ones are resolved the same way TeamLogo resolves them,
   * from evidence rather than preference: every portal row whose ORIGIN is the
   * bare string was checked against what Bart calls the team that player
   * actually played for. "Miami" is Miami FL 4 times out of 4 and "USF" is
   * South Florida 9 of 9, with no counterexample either way.
   */
  "miami": "Miami FL", "usf": "South Florida",
  "nc state": "N.C. State", "ole miss": "Mississippi",
  "loyola maryland": "Loyola MD", "ut martin": "Tennessee Martin",
  "california baptist university": "Cal Baptist",
  // "X University of Y" survives the generic strip as "x y" — "queens charlotte"
  // — which matches nothing, so the place-name form needs saying outright.
  "queens university of charlotte": "Queens",
  "pennsylvania": "Penn", "loyola chi": "Loyola Chicago",
  "middle tennessee state": "Middle Tennessee", "arkansas little rock": "Little Rock",
  "wisconsin milwaukee": "Milwaukee", "central connecticut state": "Central Connecticut",
  "university of maryland baltimore county": "UMBC",
  "new jersey institute of technology": "NJIT",
  "university of california santa barbara": "UC Santa Barbara",
  "university of california san diego": "UC San Diego",
  "university of california irvine": "UC Irvine",
  "university of california riverside": "UC Riverside",
  "california state university northridge": "Cal St. Northridge",
  "california state university bakersfield": "Cal St. Bakersfield",
  "california state university long beach": "Long Beach St.",
  "california state university fullerton": "Cal St. Fullerton",
  "the university of texas at arlington": "UT Arlington",
  "the university of texas rio grande valley": "UT Rio Grande Valley",
  "university of massachusetts lowell": "UMass Lowell",
  "university of north carolina wilmington": "UNC Wilmington",
  "university of north carolina asheville": "UNC Asheville",
  "saint mary s college of california": "Saint Mary's",
  "college of charleston": "Charleston", "long island university": "LIU",
};
const normSchool = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

/** Every D-I team name we publish, across the seasons we hold. */
const canonical = new Map();   // normalized -> canonical name
for (const y of [2026, 2025, 2024, 2023]) {
  const fp = path.join(DATA, "teams-by-year", `${y}.json`);
  if (!fs.existsSync(fp)) continue;
  for (const t of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    if (t?.name) canonical.set(normSchool(t.name), t.name);
  }
}
/** Resolve a feed school name to our canonical team name, or null if not D-I. */
function resolveSchool(name) {
  if (!name) return null;
  const k = normSchool(name);
  if (canonical.has(k)) return canonical.get(k);
  const alias = TEAM_ALIASES[k];
  if (alias && canonical.has(normSchool(alias))) return canonical.get(normSchool(alias));
  // Registrar wording, then the State/St. swap the archive uses.
  const stripped = k.replace(/\b(university|college|the|of)\b/g, "").trim().replace(/\s+/g, " ");
  if (canonical.has(stripped)) return canonical.get(stripped);
  for (const v of [k, stripped]) {
    const st = v.replace(/\bstate\b/g, "st").trim().replace(/\s+/g, " ");
    if (canonical.has(st)) return canonical.get(st);
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * THE SOPHOMORE LEAP. Measured, band-conditional, freshmen only.
 *
 * An earlier pass concluded there was no class effect at all. That was wrong,
 * and wrong for a specific reason worth recording: it was measured on transfers
 * alone, where the Fr->So cell in the band that matters holds 20 players. Over
 * the full 17,455 consecutive player-seasons the effect is clear.
 *
 * The number below is the class effect NET OF MEAN REVERSION — a class's mean
 * EPM change minus the mean change of every other player who started in the
 * same band. That subtraction is the whole point: everyone below average gains
 * about +0.85 EPM the following season whatever their class, and crediting a
 * freshman for that would be crediting him for regression to the mean.
 *
 *   band          Fr->So bump    n     95% CI          t
 *   below +0.5    ~0.00 (unused) 2796  —               —
 *   +0.5 to +2    +0.25          453   [0.14, 0.39]   4.2
 *   above +2      +0.85           67   [0.59, 1.20]   5.7
 *
 * So->Jr and Jr->Sr come out between -0.01 and +0.08 in every band, so only
 * freshmen get anything. And the bump only exists for freshmen who were ALREADY
 * ABOVE AVERAGE: a below-average freshman's apparent improvement is entirely
 * mean reversion, and paying him twice for it would inflate the noisiest rows
 * in the file.
 *
 * The top band is 67 players. It is a real effect at t=5.7, but it is the
 * thinnest cell here, so it is applied at the measured value and no further.
 * ------------------------------------------------------------------------- */
/**
 * The bump as a CONTINUOUS function of prior EPM, not a step.
 *
 * It was two bands — +0.25 from 0.5 to 2.0 and +0.85 above — and that was a
 * mistake in the application, not the measurement: bands are how the effect was
 * MEASURED, and freezing them into the score created a cliff at exactly EPM 2.0
 * where a hair of production tripled the reward. Nik Khamenia at 1.92 took
 * +0.25 while Preston Edmead at 2.12 took +0.85, eleven rating points apart on
 * indistinguishable seasons. No real developmental effect has an edge like that.
 *
 * The two band means are the anchors: the Fr group in [0.5, 2) averages EPM
 * 1.07 and a bump of 0.26; the group above +2 averages 2.56 and 0.89. A line
 * through both crosses zero at EPM 0.46 — within noise of the 0.5 floor where
 * the effect independently measured nothing, which is the check that says the
 * relationship really is linear rather than two plateaus.
 *
 * Finer bins agree that it climbs rather than steps (n in brackets):
 *
 *   EPM band     [0,.5) [.5,1)  [1,1.5) [1.5,2)  [2,2.5) [2.5,3.5)
 *   measured     +0.11  +0.16   +0.42   +0.24    +0.68   +1.01
 *   this model    0.00   0.10    0.32    0.53     0.75    0.89
 *                 (414)  (228)   (142)    (83)     (38)     (28)
 *
 * The [1.5,2) cell is the one that disagrees, on 83 players; every other bin
 * tracks. Clamped at both ends: nothing below EPM 0.5, nothing above 0.89, so
 * the thinnest cell in the data cannot extrapolate into a runaway bump.
 */
const SOPH_LEAP_FLOOR = 0.5;    // EPM below which the effect measures nothing
const SOPH_LEAP_SLOPE = 0.432;  // bump per point of EPM above the floor
const SOPH_LEAP_MAX = 0.89;     // the measured top-band value; never exceeded
const FRESHMAN = new Set(["Freshman", "RedShirt Freshman", "Fr"]);
function sophLeapFor(playedClass, eligibility, epm) {
  const isFr = FRESHMAN.has(playedClass ?? "") || FRESHMAN.has(eligibility ?? "");
  if (!isFr || epm == null) return 0;
  const raw = SOPH_LEAP_SLOPE * (epm - SOPH_LEAP_FLOOR);
  return Math.round(Math.max(0, Math.min(SOPH_LEAP_MAX, raw)) * 1000) / 1000;
}

/** The class a player actually played last season — more reliable than the
 *  feed's eligibility string, which disagrees with it on 82 of 638 entries. */
const classPlayed = new Map();
// Every season on disk, not just the last three: the returner rule below
// scores players on whichever season they last spent at the school they are
// going back to, and the sophomore bump has to be right for that year too.
const CORPUS_YEARS = fs.existsSync(path.join(DATA, "players-by-year"))
  ? fs.readdirSync(path.join(DATA, "players-by-year"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => Number(f.replace(".json", "")))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => b - a)
  : [];
for (const y of CORPUS_YEARS) {
  const fp = path.join(DATA, "players-by-year", `${y}.json`);
  if (!fs.existsSync(fp)) continue;
  for (const p of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    if (p?.bart_player_id != null && p.class) classPlayed.set(`${p.bart_player_id}|${y}`, p.class);
  }
}

/**
 * The Rating for ONE SEASON of one player, from scratch.
 *
 * The main loop below computes the same chain inline for a player's last
 * season. This exists for the returner rule, which has to ask the same
 * question about an EARLIER season — and rather than trust two copies of a
 * six-step formula to stay in step, every entry is run through this function
 * as well and any disagreement stops the build. See the check after the loop.
 */
function rateSeason({ bartId, year, gp, mpg, ppg, pir, conf, eligibility }) {
  const hit = year != null && bartId != null ? epmForYear(year).get(bartId) ?? null : null;
  const epm = hit?.epm ?? null;
  const minutes = (gp ?? 0) * (mpg ?? 0);
  let ewins = hit?.ewins ?? null;
  if (epm !== null && minutes >= 200 && hit?.poss != null && hit.poss < minutes * POSS_PER_MIN * POSS_SANITY) {
    ewins = (epm / 100) * (minutes * POSS_PER_MIN) / PTS_PER_WIN;
  }
  ewins = ewins === null ? null : Math.round(ewins * 1000) / 1000;

  const played = year != null ? classPlayed.get(`${bartId}|${year}`) ?? null : null;
  const bump = sophLeapFor(played, eligibility, epm) || 0;
  const possUsed = hit?.poss != null && !(minutes >= 200 && hit.poss < minutes * POSS_PER_MIN * POSS_SANITY)
    ? hit.poss
    : (minutes >= 200 ? minutes * POSS_PER_MIN : null);
  const ewinsProj = ewins === null ? null
    : Math.round((ewins + (bump / 100) * (possUsed ?? 0) / PTS_PER_WIN) * 1000) / 1000;

  let pirAdj = null, pirWins = 0;
  if (typeof pir === "number" && Number.isFinite(pir) && (mpg ?? 0) >= 5) {
    const adj = (pir * 40) / mpg * (1 + confTierAdj(conf));
    pirAdj = Math.round(adj * 100) / 100;
    pirWins = Math.round(PIR_WEIGHT * (adj - PIR_BASELINE) * 1000) / 1000;
  }

  const onOff = hit?.on_off ?? null;
  const onoffPen = onOff === null || onOff >= 0
    ? 0
    : Math.round(ONOFF_PENALTY * Math.max(ONOFF_FLOOR, onOff) * 1000) / 1000;

  const preMM = ewinsProj === null ? null : ewinsProj + pirWins + onoffPen;
  const mmPen = preMM === null || POWER_CONFS.has(conf ?? "")
    ? 0
    : Math.round(-MID_MAJOR_PENALTY * Math.abs(preMM) * 1000) / 1000;
  const value = preMM === null ? null : Math.round((preMM + mmPen) * 1000) / 1000;

  const eligible = epm !== null && (gp ?? 0) >= MIN_GP && (mpg ?? 0) >= MIN_MPG && (ppg ?? 0) >= MIN_PPG;
  const rating = eligible && typeof value === "number" ? Math.round(value * RATING_SCALE) : null;
  // PVS rides along because the class gate reads it: a player with no PVS is
  // treated as not having cleared the production baseline at all.
  const pvs = eligible && typeof value === "number" && epm !== null
    ? Math.round(epm * Math.pow(Math.min(1, (mpg ?? 0) / FULL_MPG), ROLE_EXP) * 1000) / 1000
    : null;
  return { epm, ewins, dev_bump: bump, ewins_proj: ewinsProj, pir_adj: pirAdj, pir_wins: pirWins, on_off: onOff, onoff_pen: onoffPen, mm_penalty: mmPen, value, rating, pvs };
}

const portal = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
const entries = portal.entries ?? [];

let joined = 0, scored = 0, withEwins = 0, repaired = 0, renamed = 0, unhidden = 0, bumped = 0, pirScored = 0, penalised = 0, discounted = 0;
const repairs = [];
for (const e of entries) {
  const hit =
    e.last_year != null && e.bart_player_id != null
      ? epmForYear(e.last_year).get(e.bart_player_id) ?? null
      : null;
  const epm = hit?.epm ?? null;
  e.epm = epm;

  // eWins, with the possession repair described at POSS_SANITY.
  let ewins = hit?.ewins ?? null;
  const minutes = (e.gp ?? 0) * (e.mpg ?? 0);
  if (epm !== null && minutes >= 200 && hit?.poss != null && hit.poss < minutes * POSS_PER_MIN * POSS_SANITY) {
    const estPoss = minutes * POSS_PER_MIN;
    ewins = (epm / 100) * estPoss / PTS_PER_WIN;
    repaired++;
    repairs.push(`${e.name} (${e.gp} gp, ${(e.mpg ?? 0).toFixed(1)} mpg): fitted poss ${hit.poss} → est ${Math.round(estPoss)}, eWins ${ewins.toFixed(2)}`);
  }
  e.ewins = ewins === null ? null : Math.round(ewins * 1000) / 1000;
  if (e.ewins !== null) withEwins++;

  // Canonical school names + D-I status from our own archive, not the feed's.
  const fromCanon = resolveSchool(e.team_from), toCanon = resolveSchool(e.team_to);
  if (fromCanon && fromCanon !== e.team_from) { e.team_from = fromCanon; renamed++; }
  if (toCanon && toCanon !== e.team_to) { e.team_to = toCanon; renamed++; }
  // Kept as booleans beside the feed's division fields rather than overwriting
  // them, so the two sources stay distinguishable if the feed ever improves.
  e.d1_from = fromCanon !== null;
  e.d1_to = toCanon !== null;
  if ((e.d1_from || e.d1_to) && !(e.division_from === 1 || e.division_to === 1)) unhidden++;

  // The sophomore leap, applied to EPM and carried through to a projected eWins
  // on the same possessions. Both are published: `ewins` is what he did,
  // `ewins_proj` is what the class total is built from.
  const played = e.last_year != null ? classPlayed.get(`${e.bart_player_id}|${e.last_year}`) ?? null : null;
  const bump = sophLeapFor(played, e.eligibility, epm);
  e.dev_bump = bump || 0;
  if (bump > 0) bumped++;
  const possUsed = hit?.poss != null && !(minutes >= 200 && hit.poss < minutes * POSS_PER_MIN * POSS_SANITY)
    ? hit.poss
    : (minutes >= 200 ? minutes * POSS_PER_MIN : null);
  e.ewins_proj = e.ewins === null ? null
    : Math.round((e.ewins + (bump / 100) * (possUsed ?? 0) / PTS_PER_WIN) * 1000) / 1000;

  // Tiered PIR, converted to wins and centred so an average player adds 0.
  // Graded against the conference he actually PLAYED in — that is where the
  // box-score line was earned — not the one he is moving to.
  const conf = e.conf_from ?? e.last_conf ?? null;
  if (typeof e.pir === "number" && Number.isFinite(e.pir) && (e.mpg ?? 0) >= 5) {
    // Per 40 minutes, so the term grades production RATE and leaves minutes to
    // eWins, which already carries them.
    const adj = (e.pir * 40) / e.mpg * (1 + confTierAdj(conf));
    e.pir_adj = Math.round(adj * 100) / 100;
    e.pir_wins = Math.round(PIR_WEIGHT * (adj - PIR_BASELINE) * 1000) / 1000;
    pirScored++;
  } else {
    e.pir_adj = null;
    e.pir_wins = 0;   // no PIR is not a penalty, it is no contribution
  }
  // Negative on/off: charged, positives ignored. See ONOFF_PENALTY.
  const onOff = hit?.on_off ?? null;
  e.on_off = onOff;
  e.onoff_pen = onOff === null || onOff >= 0
    ? 0
    : Math.round(ONOFF_PENALTY * Math.max(ONOFF_FLOOR, onOff) * 1000) / 1000;
  if (e.onoff_pen < 0) penalised++;

  // The portal value a class total is built from: measured wins, plus the
  // freshman development bump, plus the tiered-PIR term, minus the on/off
  // penalty.
  const preMM = e.ewins_proj === null ? null
    : e.ewins_proj + e.pir_wins + e.onoff_pen;
  // Mid-major discount, applied last so it scales the finished number.
  e.mm_penalty = preMM === null || POWER_CONFS.has(conf ?? "")
    ? 0
    : Math.round(-MID_MAJOR_PENALTY * Math.abs(preMM) * 1000) / 1000;
  if (e.mm_penalty < 0) discounted++;
  e.value = preMM === null ? null : Math.round((preMM + e.mm_penalty) * 1000) / 1000;

  const eligible =
    epm !== null && (e.gp ?? 0) >= MIN_GP && (e.mpg ?? 0) >= MIN_MPG && (e.ppg ?? 0) >= MIN_PPG;
  if (epm !== null) joined++;
  if (eligible && typeof e.value === "number") {
    // PVS is still computed because the star cutoffs used to hang off it and
    // the number is worth keeping visible for comparison, but it no longer
    // decides anything.
    const role = Math.pow(Math.min(1, (e.mpg ?? 0) / FULL_MPG), ROLE_EXP);
    e.pvs = Math.round(epm * role * 1000) / 1000;
    e.rating = Math.round(e.value * RATING_SCALE);
    e.stars = starsForRating(e.rating);
    scored++;
  } else {
    e.pvs = null;
    e.rating = null;
    e.stars = 0;
  }
}

/**
 * PROOF THE TWO COPIES AGREE.
 *
 * rateSeason() restates the chain the loop above just ran inline. Run it
 * over every entry's own last season and the answers must be identical —
 * if they ever are not, the returner rule below is quietly scoring players
 * on a formula the table does not use, which is the kind of divergence
 * nobody notices until a number looks wrong months later.
 */
{
  const drift = [];
  for (const e of entries) {
    const check = rateSeason({
      bartId: e.bart_player_id, year: e.last_year,
      gp: e.gp, mpg: e.mpg, ppg: e.ppg, pir: e.pir,
      conf: e.conf_from ?? e.last_conf ?? null, eligibility: e.eligibility,
    });
    if ((check.rating ?? null) !== (e.rating ?? null) || (check.value ?? null) !== (e.value ?? null)
      || (check.pvs ?? null) !== (e.pvs ?? null)) {
      drift.push(`${e.name}: loop ${e.rating}/${e.value}/${e.pvs} vs rateSeason ${check.rating}/${check.value}/${check.pvs}`);
    }
  }
  if (drift.length) {
    console.error(`✗ rateSeason disagrees with the main loop on ${drift.length} entr(ies):`);
    for (const d of drift.slice(0, 5)) console.error('   ' + d);
    process.exit(1);
  }
}

/**
 * GOING BACK TO A SCHOOL HE ALREADY PLAYED FOR.
 *
 * A player returning to a former school is rated on his best case: the
 * Rating from his last season THERE, if that beats the one he just earned
 * somewhere else. Never the reverse — a bad year at the old school does not
 * pull down what he did last season.
 *
 * The argument is that the transfer is a return to a known fit rather than
 * an arrival: the staff, the system and the role are the ones he produced in
 * before, and the year in between is the outlier the move is correcting.
 * Denzel Aberdeen is the case that prompted it — Florida to Kentucky and
 * back — though for him the old season is the weaker one (19 against 57), so
 * the rule leaves him alone. It only ever moves a Rating up.
 *
 * The old season goes through rateSeason(), the same chain as everything
 * else, with that year's EPM, that year's conference and that year's class.
 */
let returners = 0;
const returnerNotes = [];
{
  // One corpus, all years — computeCohortStats needs the full field to
  // z-score against, and productionFor reads a season out of it.
  const bySeason = new Map();
  for (const y of CORPUS_YEARS) {
    const fp = path.join(DATA, "players-by-year", `${y}.json`);
    for (const p of JSON.parse(fs.readFileSync(fp, "utf8"))) {
      const pid = p?.bart_player_id;
      if (typeof pid !== "number") continue;
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      if (!bySeason.has(pid)) bySeason.set(pid, []);
      bySeason.get(pid).push({
        year: p.year, team_name: team?.name ?? "—", team_conference: team?.conference ?? null,
        class: p.class, raw_row: st?.raw_row ?? null, games: st?.games ?? null,
        notes: st?.notes ?? null, projection: st?.projection ?? null,
      });
    }
  }
  for (const seasons of bySeason.values()) seasons.sort((a, b) => b.year - a.year);
  const cohortStats = computeCohortStats(bySeason);

  for (const e of entries) {
    if (!e.team_to || e.bart_player_id == null || e.last_year == null) continue;
    const seasons = bySeason.get(e.bart_player_id) ?? [];
    // The most recent season at the destination that is not the one he is
    // leaving. Name comparison goes through the same canonicaliser the
    // entries themselves were cleaned with.
    const target = resolveSchool(e.team_to) ?? e.team_to;
    const prior = seasons.find(
      (sn) => sn.year < e.last_year && (resolveSchool(sn.team_name) ?? sn.team_name) === target,
    );
    if (!prior) continue;

    // productionFor reads the newest season of whatever corpus it is given,
    // so hand it a corpus of exactly the season in question.
    const prod = productionFor(e.bart_player_id, new Map([[e.bart_player_id, [prior]]]), cohortStats);
    if (!prod) continue;
    const then = rateSeason({
      bartId: e.bart_player_id, year: prior.year,
      gp: prod.gp, mpg: prod.mpg, ppg: prod.ppg, pir: prod.pir,
      conf: prior.team_conference ?? null, eligibility: e.eligibility,
    });
    // AN UNRATED LAST SEASON IS NOT A HIGHER ONE. A player who barely played
    // where he was — Dominick Nelson at 8 minutes and 3.7 points for Iowa
    // St. — has no Rating at all, and the whole point of the rule is that
    // the season at the school he is returning to is the better evidence.
    // Treating null as "nothing to beat" is what lets him carry his Utah
    // Valley year back with him.
    if (then.rating === null) continue;
    if (e.rating !== null && then.rating <= e.rating) continue;

    returnerNotes.push(`${e.name} → ${target}: ${e.rating} (${e.last_year}) → ${then.rating} (${prior.year})`);
    returners++;
    // What the row now says, and where it came from. The last-season figures
    // stay on the entry under their own keys so nothing is lost.
    e.rating_last_season = e.rating;   // null where he did not clear the baseline
    e.rating_year = prior.year;
    e.rating_basis = "return";
    e.rating = then.rating;
    e.value = then.value;
    // PVS moves with the rest of it, or the class ledger would keep reading
    // the season we just decided not to judge him on — and a returner whose
    // last year was thin would score a Rating on the page while counting for
    // nothing towards the class he is joining.
    e.pvs = then.pvs;
    e.stars = starsForRating(then.rating);
  }
}
if (returners > 0) {
  console.log(`  ${returners} returner(s) rated on their last season at the school they are going back to:`);
  for (const n of returnerNotes.slice(0, 8)) console.log("    " + n);
}

/**
 * THE BOARD OVERRULES THE RATING, in both directions.
 *
 * Five stars means top-100 player, full stop: every one of the hundred wears
 * five, and nobody outside it does. The Rating still decides one through
 * four, and still orders the top hundred among themselves on the page — but
 * a tier that says "elite" about somebody the site's own board does not rank
 * is a tier disagreeing with the rest of the site, which is the failure this
 * whole file exists to avoid.
 *
 * It moves in both directions on purpose. Four of the twenty-one top-100
 * transfers were wearing four stars on a Rating cut that could not see the
 * board; five players outside the hundred were wearing five.
 */
let promoted = 0, capped = 0, boarded = 0;
for (const e of entries) {
  const rank = boardRank(e.bart_player_id, e.last_year);
  if (rank !== null && rank <= TOP_100) {
    e.t100 = rank;
    boarded++;
    if (e.stars !== 5) { e.stars = 5; promoted++; }
  } else {
    delete e.t100;
    if (e.stars === 5) { e.stars = 4; capped++; }
  }
}
console.log(`  ${boarded} top-100 player(s) — ${promoted} promoted to five stars, ${capped} outside the hundred capped at four`);

// ---- transfer classes ----
const perSchool = new Map();
function bucket(name, conf) {
  let b = perSchool.get(name);
  if (!b) { b = { school: name, conference: conf ?? null, in_players: [], out_players: [] }; perSchool.set(name, b); }
  return b;
}
for (const e of entries) {
  if (!e.team_from || !e.team_to) continue;
  /**
   * WHO COUNTS. A class total should be a statement about players who will
   * change a rotation, so the same three-part production baseline the table
   * filters on (GP>=10, MPG>=12, PPG>=4, via `pvs` being non-null) plus the
   * 2★ floor gates entry. Walk-ons, one-week cameos and end-of-bench moves are
   * out — not scaled down, out.
   *
   * A player with no eWins is also out, and that is the one exclusion worth
   * naming: eWins comes only from the play-by-play fit, so a box-only player
   * cannot contribute to a total denominated in wins. It affects 2 of 569.
   */
  if (typeof e.pvs !== "number" || e.stars < 2) continue;
  if (typeof e.value !== "number") continue;
  const base = {
    cbba_player_id: e.cbba_player_id,
    bart_player_id: e.bart_player_id,
    name: e.name,
    epm: e.epm,
    pvs: e.pvs,
    ewins: e.ewins,
    ewins_proj: e.ewins_proj,
    dev_bump: e.dev_bump,
    pir_adj: e.pir_adj,
    pir_wins: e.pir_wins,
    on_off: e.on_off,
    onoff_pen: e.onoff_pen,
    mm_penalty: e.mm_penalty,
    rating: e.rating,
    value: e.value,
    stars: e.stars,
    // Board position, so a class can be credited or charged for it below.
    t100: e.t100 ?? null,
  };
  bucket(e.team_from, e.conf_from).out_players.push({ ...base, counter_team: e.team_to, counter_conf: e.conf_to });
  bucket(e.team_to, e.conf_to).in_players.push({ ...base, counter_team: e.team_from, counter_conf: e.conf_from });
}

/**
 * How much of a departing player's Rating is charged against his old school.
 *
 * FULL WEIGHT. It ran at 0.5 for a while on a replacement-level argument — the
 * minutes a departure leaves behind get played by somebody, often one of the
 * arrivals already credited on the other side, so charging the whole loss and
 * crediting the whole gain bills the same forty minutes twice.
 *
 * That argument is sound for a projection and wrong for what this table
 * actually is: a ledger of talent in against talent out. Wake Forest brought in
 * three players worth 18 and lost four worth 35, Juke Harris to Tennessee among
 * them. Half weight called that +1 — a school that lost a 40-rated starter and
 * replaced him with a 7 came out ahead — which is not a defensible reading of
 * that off-season. At full weight it is -17, which is the number a reader would
 * arrive at with the two columns in front of them.
 *
 * The replacement-level effect is real; it just belongs in a projection of next
 * season's record, not in an accounting of who was gained and lost.
 */
const OUT_WEIGHT = 1.0;

/**
 * What a top-100 player is worth to a class, over and above his Rating.
 *
 * A ten-point swing each way — ten on for signing one, ten off for losing
 * one. The Rating already values production, and a top-100 player already
 * rates well, so this is not the same number twice: it is the premium for
 * landing somebody who is genuinely one of the hundred best players in the
 * country rather than a very good starter. Ten is roughly a third of the gap
 * between a four-star Rating and a five-star one, which is the size that
 * moves a class a place or two without deciding the table on its own.
 *
 * Symmetric on purpose. A school that replaces a top-100 departure with a
 * top-100 arrival nets zero from this term, which is the right answer.
 */
const TOP_100_SWING = 10;


const POWER = new Set(["ACC", "B10", "B12", "SEC", "BE"]);
const allRows = [];
for (const b of perSchool.values()) {
  const sum = (a) => a.reduce((s, p) => s + (p.rating ?? 0), 0);
  b.in_players.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0));
  b.out_players.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0));
  const t100In = b.in_players.filter((p) => p.t100).length;
  const t100Out = b.out_players.filter((p) => p.t100).length;
  const net =
    sum(b.in_players)
    - OUT_WEIGHT * sum(b.out_players)
    + TOP_100_SWING * (t100In - t100Out);
  allRows.push({
    school: b.school,
    conference: b.conference,
    net: Math.round(net * 100) / 100,
    /** Top-100 players in and out, so the modal can show the swing. */
    t100_in: t100In,
    t100_out: t100Out,
    /** Wins behind the rating sum, kept for the modal's secondary line. */
    net_wins: Math.round(
      (b.in_players.reduce((s, p) => s + (p.value ?? 0), 0)
        - OUT_WEIGHT * b.out_players.reduce((s, p) => s + (p.value ?? 0), 0)) * 100,
    ) / 100,
    /**
     * THE CLASS SCORE IS THE SUM OF THE PLAYER RATINGS — every arrival's Rating
     * added up, minus half of every departure's. Nothing is rescaled on the way
     * through, which is the whole point: the numbers in the modal add up to the
     * number on the card, and a reader can check the ranking by hand.
     *
     * It therefore runs in the HUNDREDS, not 0-100 — currently -93 to +248 —
     * because a class is seven or eight players and a player can be worth 97 on
     * his own. That is the same shape recruiting-class points have always taken,
     * and it is the direct cost of making the arithmetic visible. If it should
     * read 0-100 again, divide here; the ordering is identical either way.
     */
    score: Math.round(net),
    in_count: b.in_players.length,
    out_count: b.out_players.length,
    in_players: b.in_players,
    out_players: b.out_players,
  });
}
const top_overall = [...allRows].sort((a, b) => b.net - a.net).slice(0, 10);
const worst_power = allRows
  .filter((r) => r.conference && POWER.has(r.conference))
  .sort((a, b) => a.net - b.net)
  .slice(0, 10);
const by_school = {};
for (const r of allRows) by_school[r.school] = r;

portal.transfer_classes = { top_overall, worst_power, by_school };
portal.scoring = {
  // Two metrics doing two jobs, deliberately. `pvs` tiers the PLAYER (how good
  // is he, per minute he plays) and drives the stars. `ewins` totals the CLASS
  // (how much did the school actually gain), because only a wins-denominated
  // quantity can be summed across players.
  metric: "ewins",
  class_formula: `sum(player Rating in) - ${OUT_WEIGHT} * sum(player Rating out), over 2-star-and-up moves`,
  value_formula: `eWins + freshman dev bump + ${PIR_WEIGHT} * (PIR/40 * conf tier - ${PIR_BASELINE}) + ${ONOFF_PENALTY} * min(0, max(${ONOFF_FLOOR}, on/off)), then -${MID_MAJOR_PENALTY} * |value| outside the power conferences`,
  out_weight: OUT_WEIGHT,
  dev_bump: `freshman-only, continuous: min(${SOPH_LEAP_MAX}, ${SOPH_LEAP_SLOPE} * max(0, EPM - ${SOPH_LEAP_FLOOR})), net of mean reversion`,

  rating_formula: `round(value * ${RATING_SCALE})`,
  star_metric: "rating",
  star_cutoffs: [-10, 7, 31, 57],
  rescored_at: new Date().toISOString(),
};
fs.writeFileSync(PORTAL, JSON.stringify(portal));

const tiers = [0, 0, 0, 0, 0, 0];
for (const e of entries) tiers[e.stars ?? 0]++;
console.log(`portal rescored — stars on PVS, classes on eWins`);
console.log(`  ${entries.length.toLocaleString()} entries · ${joined.toLocaleString()} joined an EPM · ${withEwins.toLocaleString()} joined an eWins · ${scored.toLocaleString()} cleared the baseline and were starred`);
if (repaired) console.log(`  ${repaired} possession count(s) repaired:\n${repairs.map((r) => `    ${r}`).join("\n")}`);
console.log(`  ${renamed} school name(s) resolved to the canonical team · ${unhidden} entr(ies) the feed's division field would have hidden`);
console.log(`  ${bumped} sophomore-leap bump(s) · ${pirScored} tiered-PIR terms · ${penalised} negative-on/off penalt(ies) · ${discounted} mid-major discounts`);
console.log(`  tiers  5★ ${tiers[5]}  4★ ${tiers[4]}  3★ ${tiers[3]}  2★ ${tiers[2]}  1★ ${tiers[1]}  unrated ${tiers[0]}`);
console.log(`  ${allRows.length} schools ranked · best ${top_overall[0]?.school} ${top_overall[0]?.net.toFixed(1)} wins (score ${top_overall[0]?.score}) · worst power ${worst_power[0]?.school} ${worst_power[0]?.net.toFixed(1)} (score ${worst_power[0]?.score})`);
