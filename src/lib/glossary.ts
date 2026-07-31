/**
 * Glossary content.
 *
 * Two kinds of entry live here, and the distinction is deliberate.
 *
 * PUBLIC STATISTICS (True Shooting, eFG, PPP, PIR, Four Factors, tempo) are
 * standard and their formulas are written out. Nothing is given away by stating
 * arithmetic anyone can look up, and a glossary that withholds it is just
 * annoying.
 *
 * BTA-ORIGINAL METRICS (EPM and its halves, eWins, PORP, the coach fingerprint)
 * are described by WHAT THEY MEASURE AND HOW THEY BEHAVE, not by their
 * coefficients, constants, penalties or thresholds. A reader should finish an
 * entry knowing what the number means, when to trust it and when not to —
 * without being handed the recipe.
 *
 * Player stat rows are sourced from PLAYER_STAT_COLUMNS rather than retyped, so
 * a column added to the explorer cannot silently go missing here. Entries that
 * need more than a tooltip's worth of explanation override it below.
 */
import { PLAYER_STAT_COLUMNS, PLAYER_STAT_GROUP_LABEL, type PlayerStatGroup } from "@/lib/players";

export type GlossaryEntry = {
  term: string;
  /** Short gloss shown under the term. */
  body: string;
  /** Formula, only where the statistic is a public standard. */
  formula?: string;
  /** "BTA original" badge. */
  original?: boolean;
  /** Honest limitation — rendered in a quieter voice. */
  caveat?: string;
};

export type GlossarySection = {
  id: string;
  title: string;
  blurb?: string;
  entries: GlossaryEntry[];
};

/** Longer copy for the metrics we build ourselves — overrides the tooltip text. */
const OVERRIDES: Record<string, GlossaryEntry> = {
  EPM: {
    term: "EPM — Estimated Plus-Minus",
    original: true,
    body:
      "Our headline all-in-one rating: how many points per 100 possessions a player is worth "
      + "compared with an average Division I player, offence and defence combined. Zero is average; "
      + "the best players in the country land somewhere around +8. It is built from play-by-play — "
      + "every stretch of game time where the same ten players are on the floor becomes an "
      + "observation, and a regression solves for how much each individual is worth once teammates "
      + "and opponents are accounted for. That regression starts from a box-score estimate of the "
      + "player and adjusts it toward what the scoreboard actually did while he played. "
      + "Three-point and free-throw variance is removed first, because nobody on the floor controls "
      + "whether an open look drops. Non-conference games count for more, since they are the only "
      + "games that connect one conference to another.",
    caveat:
      "Five starters who share every possession are difficult to tell apart — the data cannot see "
      + "who caused what when they are never separated. Expect a good team's rotation to cluster.",
  },
  "Off EPM": {
    term: "Off EPM",
    original: true,
    body: "The offensive half of EPM: points per 100 possessions added on offence versus an average player.",
  },
  "Def EPM": {
    term: "Def EPM",
    original: true,
    body:
      "The defensive half of EPM, per 100 possessions, signed so that positive is always better. "
      + "A +3 defender saves three points per 100 possessions against an average one.",
    caveat: "Defence is the noisier half of any plus-minus metric, here and everywhere else.",
  },
  Box: {
    term: "Box",
    original: true,
    body:
      "The box-score half of EPM — what a player's counting stats alone say he is worth, before any "
      + "on-court results are considered. It is the starting point the full model adjusts away from, "
      + "and it is available for every season on the site, including those with no play-by-play. "
      + "Where Box and EPM disagree is usually the interesting part of a player.",
  },
  "On/Off": {
    term: "On/Off",
    original: true,
    body:
      "The rawest view: his team's net rating per 100 possessions with him on the floor, minus the "
      + "same figure with him off it. Shooting variance is stripped out, but nothing else is — no "
      + "adjustment for who he played with or against.",
    caveat:
      "The weakest number on the page and we would rather say so. It barely repeats from one season "
      + "to the next, and it is only shown at all above a possession floor.",
  },
  eWins: {
    term: "eWins — Estimated Wins Added",
    original: true,
    body:
      "EPM is a rate; eWins is the total. It converts a player's per-possession impact into the "
      + "number of wins he added over what an average player would have produced in the same "
      + "playing time. This is the default sort on the player board, because a rate alone treats a "
      + "24-minute role player and the man who closes games as equals. Minutes are also the one "
      + "input we have that does not come off the floor — they are a coach's judgement about a "
      + "player, formed from practices nobody outside the program sees.",
  },
  PORP: {
    term: "PORP — Points Over Replacement",
    original: true,
    body:
      "Points produced per game above what a freely available replacement-level player would have "
      + "managed on the same number of possessions, credited for the quality of defence actually "
      + "faced. Built game by game, so a big night against the best defence in the country counts "
      + "for more than the same line against the worst. Offence only — it says nothing about the "
      + "other end.",
  },
};

/** Player statistics, grouped, sourced from the live column definitions. */
function playerSections(): GlossarySection[] {
  const order: PlayerStatGroup[] = ["impact", "advanced", "offense", "shooting", "defense", "volume"];
  return order.map((g) => ({
    id: `stat-${g}`,
    title: PLAYER_STAT_GROUP_LABEL[g],
    entries: PLAYER_STAT_COLUMNS.filter((c) => c.group === g).map((c) => {
      const o = OVERRIDES[c.label];
      if (o) return o;
      return { term: c.label, body: c.desc };
    }),
  }));
}

export const GLOSSARY: GlossarySection[] = [
  {
    id: "reading",
    title: "How to read the numbers",
    blurb: "Three conventions that apply almost everywhere on the site.",
    entries: [
      {
        term: "Possession",
        body:
          "One trip down the floor. It ends with a shot that is not offensively rebounded, a "
          + "turnover, or a trip to the line. Rate stats are quoted per 100 possessions so that a "
          + "fast team and a slow one can be compared directly — a team playing at 75 possessions a "
          + "game will score more points than one at 62 without being any better at basketball.",
      },
      {
        term: "Per 100 possessions",
        body:
          "The standard denominator for efficiency. Points per 100 removes pace, which raw points "
          + "per game does not.",
      },
      {
        term: "Percentile",
        body:
          "Where a player or team sits against everyone else who qualifies that season. 99 means "
          + "top 1%. Percentiles are always within-season, so a 90th-percentile shooter in 2015 and "
          + "one in 2026 are equally rare in their own eras.",
      },
      {
        term: "Replacement level",
        body:
          "The production a team could get for nothing — the level of a readily available bench "
          + "player or waiver-wire equivalent. Metrics measured against replacement (rather than "
          + "against average) credit a player for simply being better than the alternative.",
      },
      {
        term: "Estimated (≈)",
        body:
          "A value marked with ≈ comes from the box-score model rather than from play-by-play. "
          + "Seasons before lineup tracking existed can only be estimated this way.",
        caveat:
          "Estimated values are placed on the same scale as measured ones so the two can be sorted "
          + "together, but an estimate is not a measurement and carries wider error.",
      },
    ],
  },
  ...playerSections(),
  {
    id: "team",
    title: "Team ratings",
    entries: [
      {
        term: "Adjusted Offensive Rating (AdjO)",
        body:
          "Points scored per 100 possessions, adjusted for the strength of the defences faced. The "
          + "adjustment is what makes a mid-major's number comparable to a high-major's.",
      },
      {
        term: "Adjusted Defensive Rating (AdjD)",
        body: "Points allowed per 100 possessions, adjusted for the offences faced. Lower is better.",
      },
      {
        term: "Adjusted Net Rating",
        body:
          "AdjO minus AdjD — the single number for how good a team is. Roughly, the margin per 100 "
          + "possessions you would expect against an average opponent on a neutral floor.",
      },
      {
        term: "Tempo / Pace",
        body:
          "Possessions per 40 minutes. A description of style, not quality: the fastest and slowest "
          + "teams in the country both win games.",
      },
      {
        term: "Strength of schedule",
        body: "The average quality of the opponents a team actually played.",
      },
    ],
  },
  {
    id: "four-factors",
    title: "The Four Factors",
    blurb:
      "Dean Oliver's decomposition of what decides a basketball game, in descending order of "
      + "importance. Every team has an offensive and a defensive version of each.",
    entries: [
      { term: "Shooting (eFG%)", body: "How well you shoot, counting a three as worth more than a two.", formula: "(FGM + 0.5 × 3PM) / FGA" },
      { term: "Turnovers (TOV%)", body: "How often a possession ends without a shot going up.", formula: "TOV / (FGA + 0.44 × FTA + TOV)" },
      { term: "Rebounding (OREB%)", body: "The share of your own missed shots you recover.", formula: "OREB / (OREB + opponent DREB)" },
      { term: "Free throws (FT rate)", body: "How often you get to the line relative to how often you shoot.", formula: "FTA / FGA" },
    ],
  },
  {
    id: "coaches",
    title: "Coaches",
    entries: [
      {
        term: "Coach fingerprint",
        original: true,
        body:
          "A profile of how a coach's teams actually play, measured across nine dimensions of style "
          + "— tempo, three-point rate, free-throw rate, offensive rebounding, turnovers, ball "
          + "movement, and three defensive counterparts. Each is expressed as a percentile against "
          + "every other coach in the database, so it reads as a shape rather than a score. Style is "
          + "not quality: a coach can be extreme on every dimension and mediocre, or bland and "
          + "excellent.",
        caveat:
          "Only coaches with several seasons on record qualify for the percentile ranks. One good "
          + "year is not a tendency.",
      },
      {
        term: "Résumé score",
        original: true,
        body:
          "A career summary blending tournament results, regular-season winning and the quality of "
          + "the teams a coach did it with. It is a record of what has happened, not a projection "
          + "of what will.",
      },
      {
        term: "NCAA record",
        body: "Career wins and losses in the NCAA tournament, with Sweet 16s, Final Fours and titles noted separately.",
      },
    ],
  },
  {
    id: "coverage",
    title: "Coverage and caveats",
    blurb: "What the data can and cannot support. Worth reading before drawing a conclusion.",
    entries: [
      {
        term: "Why EPM starts in 2024",
        body:
          "Measuring a player against his teammates requires knowing who was on the floor. "
          + "Play-by-play with lineup information begins in the 2023-24 season. Earlier seasons have "
          + "play-by-play but no lineups, so a true plus-minus fit is impossible for them — those "
          + "seasons show the box-score estimate, marked ≈.",
      },
      {
        term: "The 2020-21 season",
        body:
          "Excluded site-wide. COVID-shortened schedules, cancelled games and irregular opponents "
          + "make it incomparable with the seasons around it.",
      },
      {
        term: "Minutes floors",
        body:
          "Impact metrics are hidden below a minutes threshold rather than shown as a small number. "
          + "Beneath it the model is mostly repeating its own starting assumption, and publishing "
          + "that invites it to be read as a measurement.",
      },
      {
        term: "Rate versus value",
        body:
          "A rate (EPM, PPP, TS%) asks how good a player is when he plays. A value stat (eWins, "
          + "PORP) asks how much he actually delivered. They answer different questions and will "
          + "disagree — a high-rate reserve can trail a lower-rate starter on value, and that is "
          + "the two statistics working correctly, not a contradiction.",
      },
    ],
  },
];
