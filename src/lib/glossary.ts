/**
 * Glossary content.
 *
 * ── IT IS SOURCED, NOT TYPED ──────────────────────────────────────────────
 *
 * Every stat the site can put in a column comes from a live catalogue, and
 * this file reads all of them:
 *
 *   PLAYER_STAT_COLUMNS   the players explorer's summary row        (36)
 *   PACK_STAT_COLUMNS     its extended per-view catalogue          (104)
 *   TEAM_STAT_COLUMNS     the team explorer and conference views   (132)
 *   LINEUP_STATS          lineups and on/off                        (24)
 *   TEAM_GAME_STATS       the team game log explorer
 *   GAME_PICK_OPTIONS     the player game log explorer
 *
 * Retyping them here is how a glossary goes stale: a column gets added to an
 * explorer, nobody remembers this file, and the page quietly describes last
 * year's site. Sourcing means a new column shows up here the moment it ships,
 * with the description its own tooltip already carries.
 *
 * Duplicates are expected and resolved by first-wins in SOURCES order — eFG%
 * is a player column, a team column, a lineup column and a game-log column,
 * and it is one entry.
 *
 * ── TWO KINDS OF OURS, AND THE DIFFERENCE MATTERS ─────────────────────────
 *
 *   "original"  we invented the metric. EPM and its halves, eWins, PORP, the
 *               coach fingerprint and résumé score exist because we built
 *               them; there is no upstream definition to look up.
 *
 *   "computed"  the concept is public, but the number is ours because nobody
 *               publishes it for college basketball. Fast-break points are
 *               estimated by us from the play feed, second-chance points are
 *               reconstructed possession by possession, the lead-state records
 *               are counted out of play-by-play we archive ourselves.
 *
 * NEITHER FLAG IS HAND-MAINTAINED WHERE THE SOURCE ALREADY KNOWS. The pack
 * marks its play-by-play columns `pbp: true` and the team catalogue marks its
 * calculated ones `source: "derived"`; both are read directly. Only the
 * metrics with no such flag — the EPM family, the adjusted ratings, the
 * schedule-strength model, the lead-state counts, the roster-continuity set —
 * are listed by key below, next to the comment in their own file that says so.
 *
 * ── WHAT IS AND IS NOT SPELLED OUT ────────────────────────────────────────
 *
 * PUBLIC STATISTICS (True Shooting, eFG, PPP, PIR, Four Factors, tempo) are
 * standard and their formulas are written out. Nothing is given away by
 * stating arithmetic anyone can look up, and a glossary that withholds it is
 * just annoying.
 *
 * BTA-ORIGINAL METRICS are described by WHAT THEY MEASURE AND HOW THEY BEHAVE,
 * not by their coefficients, constants, penalties or thresholds. A reader
 * should finish an entry knowing what the number means, when to trust it and
 * when not to — without being handed the recipe.
 *
 * Entries are a FLAT list carrying a category, not a nested tree: the page is
 * browsed alphabetically with the category as a filter, so a term only has to
 * appear once and sorts by its own name.
 */
import { PLAYER_STAT_COLUMNS, PLAYER_STAT_GROUP_LABEL, type PlayerStatGroup } from "@/lib/players";
import { PACK_STAT_COLUMNS } from "@/lib/player-stat-pack";
import { TEAM_STAT_COLUMNS, GROUP_LABEL as TEAM_GROUP_LABEL } from "@/lib/team-filters";
import { LINEUP_STATS } from "@/lib/lineup-stats";
import { TEAM_GAME_STATS } from "@/lib/team-game-index";
import { GAME_PICK_OPTIONS } from "@/lib/game-index";

/**
 * "original" — we invented it; there is no upstream definition.
 * "computed" — public concept, but we are the ones producing the number for
 *              college basketball, out of a feed we archive ourselves.
 */
export type Origin = "original" | "computed";

export type GlossaryEntry = {
  term: string;
  /** Short gloss shown under the term. */
  body: string;
  /** Chip used for filtering. */
  category: string;
  /** Formula, only where the statistic is a public standard. */
  formula?: string;
  /** Marks a metric that is ours, and in which of the two senses. */
  origin?: Origin;
  /** Honest limitation — rendered in a quieter voice. */
  caveat?: string;
  /** Extra search terms that are not in the term or body. */
  aka?: string[];
};

/**
 * Ours, by key, where the catalogue carries no flag of its own. Each group
 * cites the file that establishes it rather than asking to be trusted.
 */
const ORIGINAL_KEYS = new Set([
  // players.ts: "BTA EPM — ridge RAPM over play-by-play stints"
  "epm", "off_epm", "def_epm", "box_epm", "onoff_epm", "ewins", "bta_porpag",
]);

const COMPUTED_KEYS = new Set([
  // team-filters.ts: "aNET is the headline: our own schedule-adjusted net rating"
  "a_net", "a_ortg", "a_drtg", "adjt", "prior_net",
  // team-filters.ts: "Schedule strength, our own model"
  "adj_sos", "nc_sos", "conf_sos", "sos_wp",
  // Counted out of the play-by-play archive; no upstream publishes them.
  "wins_no_trail", "wire_wins", "wins_trailing_5", "wins_trailing_10",
  "wins_trailing_15", "wins_trailing_20", "losses_no_lead", "wire_losses",
  "losses_leading_5", "losses_leading_10", "losses_leading_15",
  "losses_leading_20", "pbp_games",
  // Roster continuity, assembled from two seasons of our own minutes.
  "cont_pct", "ret_min_pct", "rrot_pct", "ret_prior_min", "prior_team_min",
  "ret_curr_min", "team_min", "in_transfer_min", "proven_min_pct",
  // "reconstructed from play-by-play, so blank unless every game has PBP"
  "scp_diff", "scp_diff_pg",
]);

/** Longer copy for the metrics we build ourselves — overrides the tooltip text. */
const OVERRIDES: Record<string, Omit<GlossaryEntry, "category">> = {
  EPM: {
    term: "EPM — Estimated Plus-Minus",
    origin: "original",
    aka: ["plus minus", "impact", "all-in-one", "rapm"],
    body:
      "Our headline all-in-one rating: how many points per 100 possessions a player is worth "
      + "compared with an average Division I player, offense and defense combined. Zero is average; "
      + "the best players in the country land somewhere around +8. It is built from play-by-play — "
      + "every stretch of game time where the same ten players are on the floor becomes an "
      + "observation, and a regression solves for how much each individual is worth once teammates "
      + "and opponents are accounted for. That regression starts from a box-score estimate of the "
      + "player and adjusts it toward what the scoreboard actually did while he played. "
      + "That box-score estimate is read in the context of the schedule behind it: the same line "
      + "counts for more against the defenses a player actually had to face, and less against a soft "
      + "slate. Three-point and free-throw variance is removed first, because nobody on the floor "
      + "controls whether an open look drops. Non-conference games count for more, since they are "
      + "the only games that connect one conference to another.",
    caveat:
      "Five starters who share every possession are difficult to tell apart — the data cannot see "
      + "who caused what when they are never separated. Expect a good team's rotation to cluster.",
  },
  "Off EPM": {
    term: "Off EPM",
    origin: "original",
    body: "The offensive half of EPM: points per 100 possessions added on offense versus an average player.",
  },
  "Def EPM": {
    term: "Def EPM",
    origin: "original",
    body:
      "The defensive half of EPM, per 100 possessions, signed so that positive is always better. "
      + "A +3 defender saves three points per 100 possessions against an average one.",
    caveat: "Defense is the noisier half of any plus-minus metric, here and everywhere else.",
  },
  Box: {
    term: "Box — box-score EPM",
    origin: "original",
    aka: ["box epm", "prior"],
    body:
      "The box-score half of EPM — what a player's counting stats alone say he is worth, before any "
      + "on-court results are considered. It is the starting point the full model adjusts away from, "
      + "and it is available for every season on the site, including those with no play-by-play. "
      + "Where Box and EPM disagree is usually the interesting part of a player.",
  },
  "On/Off": {
    term: "On/Off",
    origin: "original",
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
    origin: "original",
    aka: ["wins added", "value", "war"],
    body:
      "EPM is a rate; eWins is the total. It converts a player's per-possession impact into the "
      + "number of wins he added over what an average player would have produced in the same "
      + "playing time. This is the default sort on the player board, because a rate alone treats a "
      + "24-minute role player and the man who closes games as equals. Minutes are also the one "
      + "input we have that does not come off the floor — they are a coach's judgement about a "
      + "player, formed from practices nobody outside the program sees."
      + " Estimates for the lowest-usage players are eased toward average before the total is "
      + "taken: someone who ends very few possessions leaves less evidence behind him, and a "
      + "thin estimate should not be published at full confidence.",
    caveat:
      "That easing pulls in from BOTH ends — a low-usage player with a negative figure moves up "
      + "too. It is a statement about how much we know, not about how good he is.",
  },
  PORP: {
    term: "PORP — Points Over Replacement",
    origin: "original",
    aka: ["porpag", "replacement"],
    body:
      "Points produced per game above what a freely available replacement-level player would have "
      + "managed on the same number of possessions, credited for the quality of defense actually "
      + "faced. Built game by game, so a big night against the best defense in the country counts "
      + "for more than the same line against the worst. Offense only — it says nothing about the "
      + "other end.",
  },
};

/**
 * One catalogue row, flattened to what a glossary entry needs. Every source
 * below produces these; nothing downstream knows which explorer it came from.
 */
type Sourced = { key: string; label: string; desc: string; category: string; origin?: Origin };

/**
 * The dedupe key. Catalogues disagree about punctuation — the lineup table
 * writes "+/-" with a hyphen and the box-score pack writes "+/−" with a
 * true minus sign — and two spellings of one stat is exactly the kind of
 * duplicate a reader reads as a mistake in the data.
 */
function normalise(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");
}

function originFor(key: string, flagged?: Origin): Origin | undefined {
  if (ORIGINAL_KEYS.has(key)) return "original";
  if (COMPUTED_KEYS.has(key)) return "computed";
  return flagged;
}

/** The players explorer's summary row. */
function playerRows(): Sourced[] {
  const order: PlayerStatGroup[] = ["impact", "advanced", "offense", "shooting", "defense", "volume"];
  return order.flatMap((g) =>
    PLAYER_STAT_COLUMNS.filter((c) => c.group === g).map((c) => ({
      key: c.key, label: c.label, desc: c.desc, category: PLAYER_STAT_GROUP_LABEL[g],
    })),
  );
}

const PACK_CATEGORY: Record<string, string> = {
  info: "Player info", playtime: "Playing time", box: "Box score",
  shooting: "Shooting", context: "Scoring context", advoff: "Playmaking & rebounding",
  advdef: "Defensive rates", fouls: "Fouls", doubles: "Milestones", leaders: "Game leaders",
};

/** The extended per-view catalogue. `pbp` means we built it from the play feed. */
function packRows(): Sourced[] {
  return PACK_STAT_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    desc: c.desc,
    category: PACK_CATEGORY[c.group] ?? "Advanced",
    origin: c.pbp ? ("computed" as Origin) : undefined,
  }));
}

/**
 * The team explorer.
 *
 * `source: "derived"` is NOT read as provenance. It means "subtracted in this
 * file rather than stored", and eFG% − Opp eFG% is arithmetic anyone can do
 * with two public numbers. Claiming it as ours would cheapen the badge on the
 * things that genuinely are. The team columns that ARE ours are named by key
 * in COMPUTED_KEYS, each next to the comment that establishes it.
 */
function teamRows(): Sourced[] {
  return TEAM_STAT_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    desc: c.desc,
    category: `Team — ${TEAM_GROUP_LABEL[c.group]}`,
  }));
}

/** Lineups and on/off share one catalogue, and it uses `title` for its gloss. */
function lineupRows(): Sourced[] {
  return LINEUP_STATS.map((c) => ({
    key: `lineup_${c.key}`, label: c.label, desc: c.title, category: "Lineups & on/off",
  }));
}

/** Both game log explorers. Mostly box stats, so most rows dedupe away. */
function gameLogRows(): Sourced[] {
  return [
    ...TEAM_GAME_STATS.map((c) => ({
      key: `tgame_${c.key}`, label: c.label, desc: c.title ?? "", category: "Game log",
    })),
    ...GAME_PICK_OPTIONS.map((c) => ({
      key: `game_${c.key}`, label: c.label, desc: c.desc ?? "", category: "Game log",
    })),
  ].filter((r) => r.desc.trim().length > 0);
}

/**
 * ORDER IS PRECEDENCE. A term defined in more than one catalogue keeps the
 * first description, which is why the player and team explorers — the two with
 * the most carefully written tooltips — come before the game logs.
 */
const SOURCES = [playerRows, packRows, teamRows, lineupRows, gameLogRows];

function sourcedEntries(): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const source of SOURCES) {
    for (const r of source()) {
      const dedupe = normalise(r.label);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const o = OVERRIDES[r.label];
      if (o) {
        out.push({ ...o, category: r.category });
        continue;
      }
      out.push({
        term: r.label,
        body: r.desc,
        category: r.category,
        ...(originFor(r.key, r.origin) ? { origin: originFor(r.key, r.origin) } : {}),
      });
    }
  }
  return out;
}

const MANUAL: GlossaryEntry[] = [
  // ── Reading the numbers ───────────────────────────────────────────
  {
    term: "Possession",
    category: "Reading the numbers",
    body:
      "One trip down the floor. It ends with a shot that is not offensively rebounded, a turnover, "
      + "or a trip to the line. Rate stats are quoted per 100 possessions so that a fast team and a "
      + "slow one can be compared directly — a team playing at 75 possessions a game will score more "
      + "points than one at 62 without being any better at basketball.",
  },
  {
    term: "Per 100 possessions",
    category: "Reading the numbers",
    body:
      "The standard denominator for efficiency. Points per 100 removes pace, which raw points per "
      + "game does not.",
  },
  {
    term: "Percentile",
    category: "Reading the numbers",
    body:
      "Where a player or team sits against everyone else who qualifies that season. 99 means top 1%. "
      + "Percentiles are always within-season, so a 90th-percentile shooter in 2015 and one in 2026 "
      + "are equally rare in their own eras.",
  },
  {
    term: "Replacement level",
    category: "Reading the numbers",
    body:
      "The production a team could get for nothing — the level of a readily available bench player "
      + "or waiver-wire equivalent. Metrics measured against replacement (rather than against "
      + "average) credit a player for simply being better than the alternative.",
  },
  {
    term: "Estimated (≈)",
    category: "Reading the numbers",
    aka: ["approximate", "tilde"],
    body:
      "A value marked with ≈ comes from the box-score model rather than from play-by-play. Seasons "
      + "before lineup tracking existed can only be estimated this way.",
    caveat:
      "Estimated values are placed on the same scale as measured ones so the two can be sorted "
      + "together, but an estimate is not a measurement and carries wider error.",
  },
  {
    term: "Rate versus value",
    category: "Reading the numbers",
    body:
      "A rate (EPM, PPP, TS%) asks how good a player is when he plays. A value stat (eWins, PORP) "
      + "asks how much he actually delivered. They answer different questions and will disagree — a "
      + "high-rate reserve can trail a lower-rate starter on value, and that is the two statistics "
      + "working correctly, not a contradiction.",
  },

  // ── Team ratings ──────────────────────────────────────────────────
  {
    term: "Adjusted Offensive Rating",
    category: "Team ratings",
    aka: ["adjo", "ortg", "offensive efficiency"],
    body:
      "Points scored per 100 possessions, adjusted for the strength of the defenses faced. The "
      + "adjustment is what makes a mid-major's number comparable to a high-major's.",
  },
  {
    term: "Adjusted Defensive Rating",
    category: "Team ratings",
    aka: ["adjd", "drtg", "defensive efficiency"],
    body: "Points allowed per 100 possessions, adjusted for the offenses faced. Lower is better.",
  },
  {
    term: "Adjusted Net Rating",
    category: "Team ratings",
    aka: ["net", "adjem", "efficiency margin"],
    body:
      "Adjusted offense minus adjusted defense — the single number for how good a team is. Roughly, "
      + "the margin per 100 possessions you would expect against an average opponent on a neutral "
      + "floor.",
  },
  {
    term: "Tempo",
    category: "Team ratings",
    aka: ["pace", "possessions per game"],
    body:
      "Possessions per 40 minutes. A description of style, not quality: the fastest and slowest "
      + "teams in the country both win games.",
  },
  {
    term: "Strength of schedule",
    category: "Team ratings",
    aka: ["sos"],
    body: "The average quality of the opponents a team actually played.",
  },

  // ── Four Factors ──────────────────────────────────────────────────
  {
    term: "Four Factors",
    category: "Four Factors",
    body:
      "Dean Oliver's decomposition of what decides a basketball game, in descending order of "
      + "importance: shooting, turnovers, rebounding, free throws. Every team has an offensive and a "
      + "defensive version of each.",
  },
  {
    term: "Effective Field Goal %",
    category: "Four Factors",
    aka: ["efg"],
    body: "Field goal percentage that counts a three as worth more than a two. The first Four Factor.",
    formula: "(FGM + 0.5 × 3PM) / FGA",
  },
  {
    term: "Turnover Rate",
    category: "Four Factors",
    aka: ["tov%", "to rate"],
    body: "How often a possession ends without a shot going up. The second Four Factor.",
    formula: "TOV / (FGA + 0.44 × FTA + TOV)",
  },
  {
    term: "Offensive Rebound Rate",
    category: "Four Factors",
    aka: ["oreb%", "orb%"],
    body: "The share of a team's own missed shots it recovers. The third Four Factor.",
    formula: "OREB / (OREB + opponent DREB)",
  },
  {
    term: "Free Throw Rate",
    category: "Four Factors",
    aka: ["ft rate", "fta rate"],
    body: "How often a team gets to the line relative to how often it shoots. The fourth Four Factor.",
    formula: "FTA / FGA",
  },

  // ── Coaches ───────────────────────────────────────────────────────
  {
    term: "Coach fingerprint",
    category: "Coaches",
    origin: "original",
    aka: ["style", "tendencies"],
    body:
      "A profile of how a coach's teams actually play, measured across nine dimensions of style — "
      + "tempo, three-point rate, free-throw rate, offensive rebounding, turnovers, ball movement, "
      + "and three defensive counterparts. Each is expressed as a percentile against every other "
      + "coach in the database, so it reads as a shape rather than a score. Style is not quality: a "
      + "coach can be extreme on every dimension and mediocre, or bland and excellent.",
    caveat:
      "Only coaches with several seasons on record qualify for the percentile ranks. One good year "
      + "is not a tendency.",
  },
  {
    term: "Résumé score",
    category: "Coaches",
    origin: "original",
    body:
      "A career summary blending tournament results, regular-season winning and the quality of the "
      + "teams a coach did it with. It is a record of what has happened, not a projection of what "
      + "will.",
  },
  {
    term: "NCAA record",
    category: "Coaches",
    body:
      "Career wins and losses in the NCAA tournament, with Sweet 16s, Final Fours and titles noted "
      + "separately.",
  },

  // ── Coverage ──────────────────────────────────────────────────────
  {
    term: "Why EPM starts in 2024",
    category: "Coverage",
    aka: ["coverage", "seasons", "history"],
    body:
      "Measuring a player against his teammates requires knowing who was on the floor. Play-by-play "
      + "with lineup information begins in the 2023-24 season. Earlier seasons have play-by-play but "
      + "no lineups, so a true plus-minus fit is impossible for them — those seasons show the "
      + "box-score estimate, marked ≈.",
  },
  {
    term: "The 2020-21 season",
    category: "Coverage",
    aka: ["covid", "missing season"],
    body:
      "Shown, but flagged. COVID-shortened schedules, cancelled games and irregular opponents make "
      + "it incomparable with the seasons around it, so it carries a marker wherever seasons can be "
      + "pooled — it is fine on its own terms and misleading in an average. Coverage is partial: "
      + "team pages, the team explorer and the Team Game Log Explorer hold it in full, while the "
      + "per-player game log and anything built from play-by-play (shot charts, lineups, on/off) "
      + "do not, because that season's archive has no per-player box or play-by-play.",
  },
  {
    term: "Minutes floor",
    category: "Coverage",
    aka: ["qualified", "cutoff"],
    body:
      "Impact metrics are hidden below a minutes threshold rather than shown as a small number. "
      + "Beneath it the model is mostly repeating its own starting assumption, and publishing that "
      + "invites it to be read as a measurement.",
  },
];

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [...sourcedEntries(), ...MANUAL];

/**
 * Category chips, in a deliberate reading order rather than alphabetical.
 *
 * ANY CATEGORY PRESENT GETS A CHIP. The list below is the order, not the
 * membership — a category that appears in the entries but not here is appended
 * rather than dropped, because the alternative is what happened when the
 * catalogues were first wired in: 236 entries reachable only by search,
 * because their chip did not exist and nothing said so.
 */
export const GLOSSARY_CATEGORIES: string[] = (() => {
  const preferred = [
    // The player, as the explorer presents him
    "Impact", "Advanced", "Shooting", "Offense", "Defense", "Volume",
    // The extended catalogue behind the views
    "Player info", "Playing time", "Box score", "Scoring context",
    "Playmaking & rebounding", "Defensive rates", "Fouls",
    "Milestones", "Game leaders",
    // The team
    "Team ratings", "Team — Overall", "Team — Record & Outcomes",
    "Team — Roster & Experience", "Team — Scoring", "Team — Defense",
    "Team — Differentials", "Four Factors",
    // Everything else the site can show you
    "Lineups & on/off", "Game log", "Coaches",
    // How to read any of it
    "Reading the numbers", "Coverage",
  ];
  const present = new Set(GLOSSARY_ENTRIES.map((e) => e.category));
  const ordered = preferred.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !preferred.includes(c)).sort();
  return [...ordered, ...extra];
})();

/**
 * First letter used for the A-Z index. Non-letters bucket under "#".
 *
 * THE FIRST CHARACTER, not the first letter anywhere in the term. Searching
 * for a letter put "20/10 A" under A and "2ND CH" under N, which is not where
 * anyone looks for either: a reader scanning an index runs down the first
 * character on the line. Everything that opens with a digit or a symbol
 * belongs in one bucket at the top.
 */
export function indexLetter(term: string): string {
  const first = term.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}
