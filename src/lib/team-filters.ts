/**
 * Shared filter spec for the team explorer. Used by both the URL-state
 * client component and the server-side Supabase query builder.
 *
 * Stats come from two sources, joined on team_id:
 *   - team_trank_stats  (Bart Torvik T-Rank)
 *   - team_season_stats   (CBBD box-score season aggregates, built offline by
 *                          scripts/build-team-season-stats.mjs)
 */

import { EXPLORER_SEASONS, clampSeason } from "@/lib/seasons";

export type StatSource = "trank" | "cbbd" | "derived";

export type StatGroup = "overall" | "record" | "roster" | "scoring" | "defense" | "diffs";

export type TeamStatColumn = {
  key: string;             // URL-safe key, used everywhere
  source: StatSource;      // "derived" = computed in JS, not a DB column
  dbColumn: string;        // DB column on that table; empty for derived
  label: string;
  desc: string;
  /**
   * "int" is for COUNTS — wins, games, comeback tallies. Without it they fell
   * to num1 and the table read "32.0 wins", which is a decimal on a quantity
   * that cannot have one.
   */
  format?: "pct1" | "pct0" | "num1" | "num2" | "num3" | "int" | "rank";
  group: StatGroup;
  hideInFilter?: boolean;  // true = available as a sort/data key but hidden from the filter UI
};

// Columns are grouped into basketball-meaningful sections (Overall / Scoring /
// Defense / Differentials / Misc) for the searchable filter dropdown.
// `hideInFilter: true` keeps a column wired internally (sort key, # column)
// without exposing it in the user-facing filter UI.
export const TEAM_STAT_COLUMNS: TeamStatColumn[] = [
  // ── Overall ──────────────────────────────────────────────
  { key: "rank",       source: "trank",   dbColumn: "rank",    label: "Rank",     desc: "Bart's overall ranking (we surface BTA RTG score elsewhere; this is the per-season rank position)", format: "rank", group: "overall", hideInFilter: true },
  // Our own schedule-adjusted ratings (scripts/build-adjusted-ratings.mjs).
  // These are the D&T-style headline set and replace BTA RTG as the default.
  { key: "a_net",      source: "cbbd", dbColumn: "a_net",   label: "aNET",   desc: "Schedule-adjusted net rating — points per 100 possessions vs an average D-I opponent on a neutral floor", format: "num1", group: "overall" },
  { key: "a_ortg",     source: "cbbd", dbColumn: "a_ortg",  label: "aORTG",  desc: "Schedule-adjusted offensive rating — points scored per 100 possessions", format: "num1", group: "overall" },
  { key: "a_drtg",     source: "cbbd", dbColumn: "a_drtg",  label: "aDRTG",  desc: "Schedule-adjusted defensive rating — points allowed per 100 possessions (lower is better)", format: "num1", group: "overall" },
  { key: "adjt",       source: "cbbd", dbColumn: "adjt",   label: "Adj Tempo", desc: "Adjusted tempo — possessions per 40 minutes against an average opponent",                                                                                                                                                                                                   format: "num1", group: "overall" },
  // Raw pace, beside the adjusted tempo it is the unadjusted version of.
  { key: "cbb_pace",   source: "cbbd", dbColumn: "pace",   label: "Pace",      desc: "Possessions per game", format: "num1", group: "overall" },

  // ── Record & Outcomes ─────────────────────────────────────────────────────
  // Wins, losses and the schedule a team got them against. All computed by us
  // now — see the note in TeamRow about which of these used to be Bart's.
  { key: "adj_sos",    source: "cbbd", dbColumn: "sos",     label: "SOS",    desc: "Strength of schedule — average opponent adjusted net rating", format: "num1", group: "record" },
  { key: "wins",       source: "cbbd", dbColumn: "wins",   label: "Wins",      desc: "Season wins, counted from our own game logs (non-D1 games included, as the NCAA reports them)",                                                                                                                                                                                                                     format: "int", group: "record" },
  { key: "losses",     source: "cbbd", dbColumn: "losses", label: "Losses",    desc: "Season losses, counted from our own game logs",                                                                                                                                                                                                                   format: "int", group: "record" },
  { key: "wab",        source: "cbbd", dbColumn: "wab",    label: "WAB",       desc: "Wins above bubble — actual wins minus what the 45th-ranked team would be expected to win against this schedule",                                                                                                                                                                                                               format: "num1", group: "record" },
  { key: "nc_sos",     source: "cbbd", dbColumn: "nc_sos",   label: "NC SOS",     desc: "Non-conference schedule strength — average opponent adjusted net rating in non-conference games", format: "num1", group: "record" },
  { key: "conf_sos",   source: "cbbd", dbColumn: "conf_sos", label: "Conf SOS",   desc: "Conference schedule strength — average opponent adjusted net rating in conference games", format: "num1", group: "record" },
  { key: "sos_wp",     source: "cbbd", dbColumn: "sos_wp",   label: "SOS Win%",   desc: "Expected win % of a bubble-quality (45th-ranked) team against this schedule — higher means an easier slate", format: "pct1", group: "record" },

  // ── Schedule strength, our own model ──────────────────────────────────────
  // These replace Bart's sos / ncsos / consos, which were dropped rather than
  // kept alongside. His SoS is a win-probability figure and `adj_sos` below is
  // a net rating, and the two shipped as "SoS" and "SOS" — labels differing
  // only in capitalisation, in different units, in one searchable picker.
  //
  // `sos_wp` keeps the win-percentage FRAMING people know from T-Rank, on our
  // own numbers and against a baseline we state: the 45th-ranked team, the same
  // one WAB uses. It reads HIGH for a soft schedule, the opposite direction to
  // adj_sos, which is why the label says so.


  // Lead-state records, from build-team-outcomes.mjs. These are the only stats
  // here whose denominator is not the full season — the play-by-play archive is
  // incomplete, badly so before 2024, so `pbp_games` ships alongside as the
  // count they are actually measured over.
  { key: "win_pct", source: "cbbd", dbColumn: "win_pct", label: "Win %", desc: "Wins / games played", format: "pct1", group: "record" },
  { key: "wins_no_trail", source: "cbbd", dbColumn: "wins_no_trail", label: "Wins w/o Trailing", desc: "Wins in games the team never trailed (ties allowed)", format: "int", group: "record" },
  { key: "wire_wins", source: "cbbd", dbColumn: "wire_wins", label: "Wire-to-Wire Wins", desc: "Wins in which the team led the whole way — never behind and never tied again after first going ahead", format: "int", group: "record" },
  { key: "wins_trailing_5", source: "cbbd", dbColumn: "wins_trailing_5", label: "Wins Trailing 5+", desc: "Wins in games the team trailed by 5 or more at some point", format: "int", group: "record" },
  { key: "wins_trailing_10", source: "cbbd", dbColumn: "wins_trailing_10", label: "Wins Trailing 10+", desc: "Wins in games the team trailed by 10 or more at some point", format: "int", group: "record" },
  { key: "wins_trailing_15", source: "cbbd", dbColumn: "wins_trailing_15", label: "Wins Trailing 15+", desc: "Wins in games the team trailed by 15 or more at some point", format: "int", group: "record" },
  { key: "wins_trailing_20", source: "cbbd", dbColumn: "wins_trailing_20", label: "Wins Trailing 20+", desc: "Wins in games the team trailed by 20 or more at some point", format: "int", group: "record" },
  { key: "losses_no_lead", source: "cbbd", dbColumn: "losses_no_lead", label: "Losses w/o Leading", desc: "Losses in games the team never led", format: "int", group: "record" },
  { key: "wire_losses", source: "cbbd", dbColumn: "wire_losses", label: "Wire-to-Wire Losses", desc: "Losses in which the opponent led the whole way", format: "int", group: "record" },
  { key: "losses_leading_5", source: "cbbd", dbColumn: "losses_leading_5", label: "Losses Leading 5+", desc: "Losses in games the team led by 5 or more at some point", format: "int", group: "record" },
  { key: "losses_leading_10", source: "cbbd", dbColumn: "losses_leading_10", label: "Losses Leading 10+", desc: "Losses in games the team led by 10 or more at some point", format: "int", group: "record" },
  { key: "losses_leading_15", source: "cbbd", dbColumn: "losses_leading_15", label: "Losses Leading 15+", desc: "Losses in games the team led by 15 or more at some point", format: "int", group: "record" },
  { key: "losses_leading_20", source: "cbbd", dbColumn: "losses_leading_20", label: "Losses Leading 20+", desc: "Losses in games the team led by 20 or more at some point", format: "int", group: "record" },
  { key: "pbp_games", source: "cbbd", dbColumn: "pbp_games", label: "PBP Games", desc: "Games with play-by-play, the denominator every lead-state count above is measured over", format: "int", group: "record" },

  // ── Roster & Experience ───────────────────────────────────────────────────
  // build-team-roster-splits.mjs. Everything is weighted by minutes played, so
  // it describes the rotation rather than the listed roster — a redshirting
  // seven-footer moves a straight roster average and moves nothing here.
  { key: "eff_height", source: "cbbd", dbColumn: "eff_height", label: "Eff Height", desc: "Effective height in inches — average player height weighted by minutes played, so it describes the rotation rather than the listed roster", format: "num1", group: "roster" },
  { key: "fr_min_pct", source: "cbbd", dbColumn: "fr_min_pct", label: "Fr Min %", desc: "Share of team minutes played by freshmen", format: "pct1", group: "roster" },
  { key: "so_min_pct", source: "cbbd", dbColumn: "so_min_pct", label: "So Min %", desc: "Share of team minutes played by sophomores", format: "pct1", group: "roster" },
  { key: "jr_min_pct", source: "cbbd", dbColumn: "jr_min_pct", label: "Jr Min %", desc: "Share of team minutes played by juniors", format: "pct1", group: "roster" },
  { key: "sr_min_pct", source: "cbbd", dbColumn: "sr_min_pct", label: "Sr Min %", desc: "Share of team minutes played by seniors", format: "pct1", group: "roster" },
  { key: "fr_pts_pct", source: "cbbd", dbColumn: "fr_pts_pct", label: "Fr Pts %", desc: "Share of team points scored by freshmen", format: "pct1", group: "roster" },
  { key: "so_pts_pct", source: "cbbd", dbColumn: "so_pts_pct", label: "So Pts %", desc: "Share of team points scored by sophomores", format: "pct1", group: "roster" },
  { key: "jr_pts_pct", source: "cbbd", dbColumn: "jr_pts_pct", label: "Jr Pts %", desc: "Share of team points scored by juniors", format: "pct1", group: "roster" },
  { key: "sr_pts_pct", source: "cbbd", dbColumn: "sr_pts_pct", label: "Sr Pts %", desc: "Share of team points scored by seniors", format: "pct1", group: "roster" },


  // Roster continuity, season over season. A returner is the same player on the
  // same team in consecutive seasons — a transfer arriving with minutes
  // elsewhere is not continuity for his new school. Null in 2014, the first
  // season on file, because "no prior data" is not "lost everyone".
  { key: "cont_pct", source: "cbbd", dbColumn: "cont_pct", label: "Continuity %", desc: "Minutes continuity — for each player the smaller of last season's and this season's minute share, summed. Near 100% when the same players hold the same rotation roles.", format: "pct1", group: "roster" },
  { key: "ret_min_pct", source: "cbbd", dbColumn: "ret_min_pct", label: "Returning Min %", desc: "Last season's minutes belonging to players who came back, over the team's total minutes last season", format: "pct1", group: "roster" },
  { key: "rrot_pct", source: "cbbd", dbColumn: "rrot_pct", label: "Returner Rotation %", desc: "Share of THIS season's minutes played by returners", format: "pct1", group: "roster" },
  { key: "ret_prior_min", source: "cbbd", dbColumn: "ret_prior_min", label: "Ret Prior Min", desc: "Sum of last season's minutes for players still on this season's roster", format: "int", group: "roster" },
  { key: "prior_team_min", source: "cbbd", dbColumn: "prior_team_min", label: "Prior Team Min", desc: "Total minutes the team played last season — the denominator for Returning Min %", format: "int", group: "roster" },
  { key: "ret_curr_min", source: "cbbd", dbColumn: "ret_curr_min", label: "Ret Curr Min", desc: "Current-season minutes played by returners", format: "int", group: "roster" },
  { key: "curr_team_min", source: "cbbd", dbColumn: "curr_team_min", label: "Team Min", desc: "Total minutes the team has played this season", format: "int", group: "roster" },

  { key: "prev_a_net", source: "cbbd", dbColumn: "prev_a_net", label: "Prior NET", desc: "Last season’s schedule-adjusted net rating — the rating this roster is changing from", format: "num1", group: "overall" },


  // Preseason only: what the portal brought in, and the two figures together.
  // Null on every played season, the mirror image of the continuity columns
  // that are null on the upcoming one.
  { key: "in_transfer_min", source: "cbbd", dbColumn: "in_transfer_min", label: "Transfer Min In", desc: "Minutes the incoming transfers played elsewhere last season — proven production added through the portal", format: "int", group: "roster" },
  { key: "proven_min_pct", source: "cbbd", dbColumn: "proven_min_pct", label: "Proven Min %", desc: "Returning plus incoming transfer minutes over last season's team total. Can exceed 100% when a team replaces its rotation with more proven production than it fielded.", format: "pct1", group: "roster" },

  // ── Scoring (offense) ────────────────────────────────────
  { key: "cbb_ts",       source: "cbbd", dbColumn: "ts_pct",     label: "TS%",        desc: "True shooting %",                  format: "pct1", group: "scoring" },
  { key: "cbb_efg",      source: "cbbd", dbColumn: "efg_pct",    label: "eFG%",       desc: "Effective FG%",                    format: "pct1", group: "scoring" },
  { key: "cbb_fg3",      source: "cbbd", dbColumn: "fg3_pct",    label: "3P%",        desc: "3-point %",                        format: "pct1", group: "scoring" },
  { key: "cbb_ft",       source: "cbbd", dbColumn: "ft_pct",     label: "FT%",        desc: "Free-throw %",                     format: "pct1", group: "scoring" },
  { key: "cbb_fg3rate",  source: "cbbd", dbColumn: "fg3a_rate",  label: "3PAR",       desc: "3PA / FGA (3-point reliance)",      format: "pct1", group: "scoring" },
  { key: "cbb_ftarate",  source: "cbbd", dbColumn: "fta_rate",   label: "FTAR",       desc: "Free-throws attempted / FGA",      format: "pct1", group: "scoring" },
  { key: "cbb_orb",      source: "cbbd", dbColumn: "orb_pct",    label: "OREB%",      desc: "Offensive rebound %",              format: "pct1", group: "scoring" },
  { key: "cbb_tov",      source: "cbbd", dbColumn: "tov_pct",    label: "TOV%",       desc: "Turnover %",                       format: "pct1", group: "scoring" },
  { key: "cbb_ast",      source: "cbbd", dbColumn: "ast_pct",    label: "AST%",       desc: "% of made FGs assisted",            format: "pct1", group: "scoring" },
  { key: "cbb_fbpts",    source: "cbbd", dbColumn: "fbpts_pct",  label: "FB Pts %",   desc: "Fast-break points / total pts",     format: "pct1", group: "scoring" },
  { key: "cbb_pitp",     source: "cbbd", dbColumn: "pitp_pct",   label: "Paint Pts %", desc: "Paint points / total pts",          format: "pct1", group: "scoring" },
  { key: "cbb_ortg",     source: "cbbd", dbColumn: "ortg",       label: "ORtg (raw)",  desc: "Raw offensive rating (points per 100 possessions)",         format: "num1", group: "scoring" },

  // ── Defense (allowed) ────────────────────────────────────
  { key: "cbb_efg_def", source: "cbbd", dbColumn: "efg_pct_def", label: "Opp eFG%",   desc: "Opponent eFG%",                 format: "pct1", group: "defense" },
  { key: "cbb_tov_def", source: "cbbd", dbColumn: "tov_pct_def", label: "Opp TOV%",   desc: "Opponent TOV% (forced)",        format: "pct1", group: "defense" },
  { key: "cbb_orb_def", source: "cbbd", dbColumn: "orb_pct_def", label: "Opp OREB%",  desc: "Opponent OREB% (allowed)",      format: "pct1", group: "defense" },
  { key: "cbb_fg3_def", source: "cbbd", dbColumn: "fg3_pct_def", label: "Opp 3P%",    desc: "Opponent 3-point %",            format: "pct1", group: "defense" },
  { key: "cbb_drtg",    source: "cbbd", dbColumn: "drtg",        label: "DRtg (raw)", desc: "Raw defensive rating (points allowed per 100 possessions)",      format: "num1", group: "defense" },

  // ── Differentials (you vs opponent) ──────────────────────
  // Percentage-point diffs
  { key: "efg_diff",   source: "derived", dbColumn: "", label: "eFG% Diff",    desc: "eFG% − Opp eFG% (shooting margin)",                       format: "pct1", group: "diffs" },
  { key: "tov_diff",   source: "derived", dbColumn: "", label: "TOV% Diff",    desc: "Opp TOV% − your TOV% (+ = forcing more)",                  format: "pct1", group: "diffs" },
  { key: "orb_diff",   source: "derived", dbColumn: "", label: "OREB% Diff",   desc: "OREB% − Opp OREB% (offensive-board battle)",               format: "pct1", group: "diffs" },
  { key: "fg3_diff",   source: "derived", dbColumn: "", label: "3P% Diff",     desc: "3P% − Opp 3P% (computed from raw 3PT counts)",             format: "pct1", group: "diffs" },
  // NOTE: there is no free-throw ATTEMPT-RATE margin here, and that is not an
  // oversight. It would be FTAR − Opp FTAR, and the opponent half has never
  // existed: the season stats carry efg/tov/orb/fg3 allowed and no
  // free-throw-rate-allowed field. The stat shipped anyway for a while and was
  // null on all 4,273 team-seasons. FTM Diff below is a count of makes, not a
  // rate, so it does not replace it — restoring the drawing edge means adding
  // opponent free-throw rate to the season-stats build first.
  // Count diffs (CBB ready-made; populated after migration 003 + sync)
  { key: "fg3m_diff_ct", source: "cbbd", dbColumn: "fg3_made_diff",  label: "3PM Diff",     desc: "3-pointers made − allowed (season total)",   format: "num1", group: "diffs" },
  { key: "fg3a_diff_ct", source: "cbbd", dbColumn: "fg3_att_diff",   label: "3PA Diff",     desc: "3-point attempts − allowed",                 format: "num1", group: "diffs" },
  { key: "fg2m_diff_ct", source: "cbbd", dbColumn: "fg2_made_diff",  label: "2PM Diff",     desc: "2-pointers made − allowed",                  format: "num1", group: "diffs" },
  { key: "fgm_diff_ct",  source: "cbbd", dbColumn: "fg_made_diff",   label: "FGM Diff",     desc: "Field goals made − allowed",                 format: "num1", group: "diffs" },
  { key: "ftm_diff_ct",  source: "cbbd", dbColumn: "ft_made_diff",   label: "FTM Diff",     desc: "Free throws made − allowed",                 format: "num1", group: "diffs" },
  { key: "orb_diff_ct",  source: "cbbd", dbColumn: "orb_diff_ct",    label: "OREB Diff",    desc: "Offensive rebounds − opp OREB",              format: "num1", group: "diffs" },
  { key: "drb_diff_ct",  source: "cbbd", dbColumn: "drb_diff",       label: "DREB Diff",    desc: "Defensive rebounds − opp DREB",              format: "num1", group: "diffs" },
  { key: "reb_diff_ct",  source: "cbbd", dbColumn: "reb_diff",       label: "REB Diff",     desc: "Total rebounds − opp REB",                   format: "num1", group: "diffs" },
  { key: "tov_diff_ct",  source: "cbbd", dbColumn: "tov_diff_ct",    label: "TOV Diff",     desc: "Turnovers − opp TOV (negative = good)",      format: "num1", group: "diffs" },
  // PER-GAME first: these are the ones with broad coverage. CBBD reports an
  // untracked point split as 0 rather than null on 30-57% of pre-2024 games, so
  // a SEASON TOTAL can only be honestly reported for ~1,200 of 4,631
  // team-seasons. The per-game average over the games that were tracked is
  // valid at partial coverage and reaches ~3,800 — and it is the fairer
  // comparison regardless, since a season total quietly rewards whoever played
  // more games.
  // BTA's Four Factors, uniformly per game. REB/3PM/TOV have full coverage as
  // season totals, but the fourth (fast break) does not, and mixing "+416 REB"
  // with "+1.82 FBP" in one group reads as an error.
  { key: "reb_diff_pg",    source: "cbbd", dbColumn: "reb_diff_pg",    label: "REB Diff/G",       desc: "Rebounds − opponent rebounds, per game",       format: "num2", group: "diffs" },
  { key: "fg3m_diff_pg",   source: "cbbd", dbColumn: "fg3m_diff_pg",   label: "3PM Diff/G",       desc: "3-pointers made − allowed, per game",          format: "num2", group: "diffs" },
  { key: "fbpts_diff_pg",  source: "cbbd", dbColumn: "fbpts_diff_pg",  label: "FBP Diff/G",       desc: "Fast-break points − allowed, per game",        format: "num2", group: "diffs" },
  { key: "tov_diff_pg",    source: "cbbd", dbColumn: "tov_diff_pg",    label: "TOV Diff/G",       desc: "Turnovers − opponent turnovers, per game (negative = good)", format: "num2", group: "diffs" },
  { key: "pitp_diff_pg",   source: "cbbd", dbColumn: "pitp_diff_pg",   label: "Paint Pts Diff/G", desc: "Points in the paint − allowed, per game",      format: "num2", group: "diffs" },
  { key: "potov_diff_pg",  source: "cbbd", dbColumn: "potov_diff_pg",  label: "Pts off TO Diff/G", desc: "Points off turnovers − allowed, per game",    format: "num2", group: "diffs" },
  { key: "scp_diff_pg",    source: "cbbd", dbColumn: "scp_diff_pg",    label: "2nd-Chance Diff/G", desc: "Second-chance points − allowed, per game",    format: "num2", group: "diffs" },
  // Season totals. Kept because they're the natural reading for a recent season,
  // but they go blank on most pre-2023 seasons — by design, not by accident.
  { key: "fbpts_diff",   source: "cbbd", dbColumn: "fbpts_diff",     label: "FBP Diff",     desc: "Fast-break points − allowed (season total; blank when the split wasn't tracked for enough games)",                format: "num1", group: "diffs" },
  { key: "pitp_diff",    source: "cbbd", dbColumn: "pitp_diff",      label: "Paint Pts Diff", desc: "Points in the paint − allowed (season total)",            format: "num1", group: "diffs" },
  { key: "pts_diff",     source: "cbbd", dbColumn: "pts_diff",       label: "Pts Diff",     desc: "Total points scored − allowed (season)",     format: "num1", group: "diffs" },
  { key: "scp_diff",     source: "cbbd", dbColumn: "scp_diff",       label: "2nd-Chance Diff", desc: "Second-chance points − allowed (season total; reconstructed from play-by-play, so blank unless every game has PBP)",          format: "num1", group: "diffs" },

  // ── Glossary set (CBB Analytics-defined), from build-team-season-stats.mjs ──
  // Every stat here has a written definition we can point at, which is why the
  // class-year, roster-continuity, effective-height and wire-to-wire families
  // are absent: they appear in their product but not their glossary, so the
  // denominators are unknowable and a number shipped under those names would
  // disagree with theirs for reasons neither side could explain.
  { key: "cbb_fg", source: "cbbd", dbColumn: "fg_pct", label: "FG%", desc: "Field-goal %", format: "pct1", group: "scoring" },
  { key: "cbb_fg2", source: "cbbd", dbColumn: "fg2_pct", label: "2P%", desc: "2-point %", format: "pct1", group: "scoring" },
  { key: "cbb_fga_pg", source: "cbbd", dbColumn: "fga_pg", label: "FGA/G", desc: "Field-goal attempts per game", format: "num1", group: "scoring" },
  { key: "cbb_fg2a_pg", source: "cbbd", dbColumn: "fg2a_pg", label: "2PA/G", desc: "2-point attempts per game", format: "num1", group: "scoring" },
  { key: "cbb_fg3a_pg", source: "cbbd", dbColumn: "fg3a_pg", label: "3PA/G", desc: "3-point attempts per game", format: "num1", group: "scoring" },
  { key: "cbb_fta_pg", source: "cbbd", dbColumn: "fta_pg", label: "FTA/G", desc: "Free-throw attempts per game", format: "num1", group: "scoring" },
  { key: "cbb_pts_pg", source: "cbbd", dbColumn: "pts_pg", label: "PTS/G", desc: "Points per game", format: "num1", group: "scoring" },
  { key: "cbb_ast_pg", source: "cbbd", dbColumn: "ast_pg", label: "AST/G", desc: "Assists per game", format: "num1", group: "scoring" },
  { key: "cbb_orb_pg", source: "cbbd", dbColumn: "orb_pg", label: "OREB/G", desc: "Offensive rebounds per game", format: "num1", group: "scoring" },
  { key: "cbb_reb_pg", source: "cbbd", dbColumn: "reb_pg", label: "REB/G", desc: "Total rebounds per game", format: "num1", group: "scoring" },
  { key: "cbb_tov_pg", source: "cbbd", dbColumn: "tov_pg", label: "TO/G", desc: "Turnovers per game", format: "num1", group: "scoring" },
  { key: "cbb_pfd_pg", source: "cbbd", dbColumn: "pfd_pg", label: "PFD/G", desc: "Personal fouls drawn per game — the opponent's foul count", format: "num1", group: "scoring" },
  { key: "cbb_fbpts_pg", source: "cbbd", dbColumn: "fbpts_pg", label: "FB Pts/G", desc: "Fast-break points per game", format: "num1", group: "scoring" },
  { key: "cbb_pitp_pg", source: "cbbd", dbColumn: "pitp_pg", label: "Paint Pts/G", desc: "Points in the paint per game", format: "num1", group: "scoring" },
  { key: "cbb_potov_pg", source: "cbbd", dbColumn: "potov_pg", label: "Pts off TO/G", desc: "Points off turnovers per game", format: "num1", group: "scoring" },
  { key: "cbb_scp_pg", source: "cbbd", dbColumn: "scp_pg", label: "2nd Pts/G", desc: "Second-chance points per game", format: "num1", group: "scoring" },
  { key: "cbb_scp_pct", source: "cbbd", dbColumn: "scp_pct", label: "2nd Pts %", desc: "Second-chance points / total points", format: "pct1", group: "scoring" },
  { key: "cbb_bench_pg", source: "cbbd", dbColumn: "bench_pts_pg", label: "Bench Pts/G", desc: "Points from players who did not start, per game", format: "num1", group: "scoring" },
  { key: "cbb_bench_pct", source: "cbbd", dbColumn: "bench_pts_pct", label: "Bench Pts %", desc: "Bench points / total points", format: "pct1", group: "scoring" },
  { key: "cbb_ast_to", source: "cbbd", dbColumn: "ast_to", label: "AST/TO", desc: "Assists per turnover", format: "num2", group: "scoring" },
  { key: "cbb_ppp", source: "cbbd", dbColumn: "ppp", label: "PPP", desc: "Points per offensive possession", format: "num3", group: "scoring" },
  { key: "cbb_drb_pg", source: "cbbd", dbColumn: "drb_pg", label: "DREB/G", desc: "Defensive rebounds per game", format: "num1", group: "defense" },
  { key: "cbb_stl_pg", source: "cbbd", dbColumn: "stl_pg", label: "STL/G", desc: "Steals per game", format: "num1", group: "defense" },
  { key: "cbb_blk_pg", source: "cbbd", dbColumn: "blk_pg", label: "BLK/G", desc: "Blocks per game", format: "num1", group: "defense" },
  { key: "cbb_pf_pg", source: "cbbd", dbColumn: "pf_pg", label: "PF/G", desc: "Personal fouls committed per game", format: "num1", group: "defense" },
  { key: "cbb_drb_pct", source: "cbbd", dbColumn: "drb_pct", label: "DREB%", desc: "Defensive rebound % — share of available defensive boards secured", format: "pct1", group: "defense" },
  { key: "cbb_stl_pct", source: "cbbd", dbColumn: "stl_pct", label: "STL%", desc: "Share of opponent possessions ending in a steal", format: "pct1", group: "defense" },
  { key: "cbb_blk_pct", source: "cbbd", dbColumn: "blk_pct", label: "BLK%", desc: "Share of opponent 2-point attempts blocked", format: "pct1", group: "defense" },
  { key: "cbb_hakeem", source: "cbbd", dbColumn: "hakeem_pct", label: "Hakeem%", desc: "Combined defensive-event rate — STL% + BLK%", format: "pct1", group: "defense" },
  { key: "cbb_stl_pf", source: "cbbd", dbColumn: "stl_pf", label: "STL/PF", desc: "Steals per personal foul", format: "num2", group: "defense" },
  { key: "cbb_blk_pf", source: "cbbd", dbColumn: "blk_pf", label: "BLK/PF", desc: "Blocks per personal foul", format: "num2", group: "defense" },
  { key: "cbb_pf_eff", source: "cbbd", dbColumn: "pf_eff", label: "PF Eff", desc: "Defensive events per foul — (STL + BLK) / PF", format: "num2", group: "defense" },

  // ── Shot frequency (build-shot-distribution.mjs, via team-season-stats) ────
  // The glossary's "Shot Frequency": zone attempts / total attempts, own and
  // allowed. Three zones because that is what the play-by-play range flag
  // distinguishes; corner-vs-above-the-break needs shot coordinates.
  //
  // 2014-2026 EXCEPT 2021 — the COVID season the whole site excludes.
  { key: "cbb_rim_rate", source: "cbbd", dbColumn: "rim_rate", label: "Rim Freq", desc: "Share of field-goal attempts taken at the rim", format: "pct1", group: "scoring" },
  { key: "cbb_mid_rate", source: "cbbd", dbColumn: "mid_rate", label: "Mid Freq", desc: "Share of field-goal attempts taken from mid-range", format: "pct1", group: "scoring" },
  { key: "cbb_three_rate", source: "cbbd", dbColumn: "three_rate", label: "3PT Freq", desc: "Share of field-goal attempts taken from three", format: "pct1", group: "scoring" },
  { key: "cbb_rim_rate_def", source: "cbbd", dbColumn: "rim_rate_def", label: "Opp Rim Freq", desc: "Share of opponent attempts allowed at the rim", format: "pct1", group: "defense" },
  { key: "cbb_mid_rate_def", source: "cbbd", dbColumn: "mid_rate_def", label: "Opp Mid Freq", desc: "Share of opponent attempts allowed from mid-range", format: "pct1", group: "defense" },
  { key: "cbb_three_rate_def", source: "cbbd", dbColumn: "three_rate_def", label: "Opp 3PT Freq", desc: "Share of opponent attempts allowed from three", format: "pct1", group: "defense" },

  // ── Zone accuracy (build-team-shot-zones.mts, via team-season-stats) ──────
  // The glossary's Rim / Mid / Corner-3 / Above-the-break FG%. These need shot
  // COORDINATES rather than the play-by-play range flag, so coverage starts at
  // 2022 where the coordinate archive does — null before that by construction.
  { key: "cbb_rim_fg", source: "cbbd", dbColumn: "rim_fg_pct", label: "Rim FG%", desc: "Field-goal % at the rim (2022+)", format: "pct1", group: "scoring" },
  { key: "cbb_mid_fg", source: "cbbd", dbColumn: "mid_fg_pct", label: "Mid FG%", desc: "Field-goal % from mid-range (2022+)", format: "pct1", group: "scoring" },
  { key: "cbb_corner3_fg", source: "cbbd", dbColumn: "corner3_fg_pct", label: "Corner 3 FG%", desc: "3-point % from the corners (2022+)", format: "pct1", group: "scoring" },
  { key: "cbb_atb3_fg", source: "cbbd", dbColumn: "atb3_fg_pct", label: "ATB 3 FG%", desc: "3-point % above the break (2022+)", format: "pct1", group: "scoring" },
  { key: "cbb_corner3_share", source: "cbbd", dbColumn: "corner3_share", label: "Corner 3 Freq", desc: "Share of a team's threes taken from the corner (2022+)", format: "pct1", group: "scoring" },
  { key: "cbb_unast_pg", source: "cbbd", dbColumn: "unast_pg", label: "Unast FG/G", desc: "Unassisted field goals per game", format: "num1", group: "scoring" },
  { key: "cbb_unast_share", source: "cbbd", dbColumn: "unast_share", label: "Unast FG%", desc: "Share of made field goals that were unassisted", format: "pct1", group: "scoring" },

];

export const GROUP_LABEL: Record<StatGroup, string> = {
  overall: "Overall",
  record: "Record & Outcomes",
  roster: "Roster & Experience",
  scoring: "Scoring",
  defense: "Defense",
  diffs: "Differentials",
};

// Filtered down to columns that appear in user-facing filter / sort dropdowns.
export const FILTER_COLUMNS = TEAM_STAT_COLUMNS.filter((c) => !c.hideInFilter);

export type TeamStatKey = (typeof TEAM_STAT_COLUMNS)[number]["key"];
export type Comparator = "gt" | "gte" | "lt" | "lte";

export type StatFilter = { stat: TeamStatKey; op: Comparator; value: number };

/**
 * How many stat filters a URL can carry.
 *
 * THE NUMBER IS ARBITRARY; only the agreement matters. Filters serialise as
 * `f0`..`fN` and parseSpec loops this same constant, so both sides move
 * together and raising it costs nothing — one past the ceiling would be
 * written to the URL and silently dropped on the way back in, which is the
 * only reason a ceiling exists at all.
 *
 * It is NOT a plan lever. Gating the count would be trivially undone by
 * editing the URL, like everything else decided in the browser.
 *
 * The builder UI reads this to stop offering "Add a Filter" at the ceiling,
 * which is the only way a reader ever finds out the limit exists.
 */
export const MAX_FILTERS = 25;

export type TeamFilterSpec = {
  years: number[];              // multi-select; any combination of seasons
  conf: string[];               // empty = all conferences
  teams: string[];              // empty = all teams
  filters: StatFilter[];
  /**
   * Stats pinned as leading columns, in the order the reader picked them. They
   * render to the LEFT of NET, ahead of the default column set. Independent of
   * `filters`: a stat can be pinned without being bounded (the reader just wants
   * to see it) or bounded without being pinned.
   */
  cols: TeamStatKey[];
  /**
   * Named column set from src/lib/team-views.ts. Empty means the default view.
   *
   * Deliberately NOT validated here: parseSpec keeps whatever string the URL
   * carried and viewByKey falls back to the default for anything it does not
   * recognise. Validating it in the spec would mean importing the view registry
   * into this module, which the server-side query builder also loads.
   */
  view: string;
  sortBy: TeamStatKey;
  sortDir: "asc" | "desc";
  limit: number;                // -1 = show all
};

// Season window (floor, ceiling, and the excluded COVID year) is defined once
// in src/lib/seasons.ts. Re-exported here as ALL_YEARS because a lot of call
// sites already import that name.
export const ALL_YEARS = EXPLORER_SEASONS;

export const DEFAULT_SPEC: TeamFilterSpec = {
  years: [2026],                // current season only by default
  conf: [],
  teams: [],
  filters: [],
  cols: [],
  view: "",
  // aNET is the headline: our own schedule-adjusted net rating, full coverage
  // on all 4,631 team-seasons, and auditable from the game logs.
  sortBy: "a_net",
  sortDir: "desc",
  // 100 by default, matching /players. 50 cut the table off inside the top
  // quarter of D-I, so the first thing most visitors did was change it.
  limit: 100,
};

export const LIMIT_OPTIONS = [50, 100, 250, 500, -1] as const;
export function limitLabel(n: number): string {
  // The picker sits under a "Show" label, so "All" reads as "Show: All" and
  // fits the narrow select where "Show all" clipped to "Show".
  return n === -1 ? "All" : String(n);
}

const COLUMN_BY_KEY = new Map(TEAM_STAT_COLUMNS.map((c) => [c.key, c]));
/** Lookup a stat column by key — the grid-short label/format for the filter UI. */
export function teamStatColumn(key: string): TeamStatColumn | undefined {
  return COLUMN_BY_KEY.get(key);
}
function isStatKey(s: string | undefined): s is TeamStatKey {
  return !!s && COLUMN_BY_KEY.has(s);
}
function isComparator(s: string): s is Comparator {
  return s === "gt" || s === "gte" || s === "lt" || s === "lte";
}
function clampYear(y: number): number {
  return clampSeason(y, DEFAULT_SPEC.years[0]!);
}

// ---------- URL <-> spec ----------
export function specToParams(spec: TeamFilterSpec): URLSearchParams {
  const p = new URLSearchParams();
  // Years: comma-separated. Omit when default (just current season).
  if (
    spec.years.length !== DEFAULT_SPEC.years.length ||
    spec.years.some((y, i) => y !== DEFAULT_SPEC.years[i])
  ) {
    p.set("ys", spec.years.join(","));
  }
  if (spec.conf.length) p.set("conf", spec.conf.join(","));
  if (spec.teams.length) p.set("team", spec.teams.join(","));
  spec.filters
    .slice(0, MAX_FILTERS)
    .forEach((f, i) => p.set(`f${i}`, `${f.stat}.${f.op}.${f.value}`));
  if (spec.cols.length) p.set("cols", spec.cols.join(","));
  if (spec.view) p.set("view", spec.view);
  if (spec.sortBy !== DEFAULT_SPEC.sortBy) p.set("sort", spec.sortBy);
  if (spec.sortDir !== DEFAULT_SPEC.sortDir) p.set("order", spec.sortDir);
  if (spec.limit !== DEFAULT_SPEC.limit) p.set("limit", String(spec.limit));
  return p;
}

export function parseSpec(searchParams: Record<string, string | string[] | undefined>): TeamFilterSpec {
  const get = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: StatFilter[] = [];
  for (let i = 0; i < MAX_FILTERS; i++) {
    const raw = get(`f${i}`);
    if (!raw) continue;
    const dot = raw.indexOf(".");
    const dot2 = raw.indexOf(".", dot + 1);
    if (dot < 0 || dot2 < 0) continue;
    const stat = raw.slice(0, dot);
    const op = raw.slice(dot + 1, dot2);
    const valueStr = raw.slice(dot2 + 1);
    if (!isStatKey(stat) || !isComparator(op)) continue;
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    filters.push({ stat, op, value });
  }
  // Length-capped rather than checked against the registry — see the note on
  // TeamFilterSpec.view. A junk value costs one failed Map lookup.
  const rawView = get("view") ?? "";
  const view = /^[a-z0-9-]{0,32}$/.test(rawView) ? rawView : "";
  const sortBy = get("sort");
  const sortDir = get("order");
  const limitRaw = get("limit");
  const limit = limitRaw === "-1" || limitRaw === "all" ? -1 : Number(limitRaw);

  // Years: prefer the new ?ys=2020,2022 multi-select; fall back to legacy
  // ?yf= / ?yt= range, then to ?year= single. Empty = default (current season).
  let years: number[] = [];
  const ys = get("ys");
  if (ys) {
    years = ys
      .split(",")
      .map((s) => clampYear(Number(s.trim())))
      .filter((n, i, a) => a.indexOf(n) === i);
  } else if (get("yf") !== undefined || get("yt") !== undefined) {
    let yf = clampYear(Number(get("yf") ?? get("yt")));
    let yt = clampYear(Number(get("yt") ?? get("yf")));
    if (yf > yt) [yf, yt] = [yt, yf];
    years = [];
    for (let y = yt; y >= yf; y--) years.push(y);
  } else if (get("year") !== undefined) {
    years = [clampYear(Number(get("year")))];
  } else {
    years = [...DEFAULT_SPEC.years];
  }
  if (years.length === 0) years = [...DEFAULT_SPEC.years];
  years.sort((a, b) => b - a);     // canonical newest-first

  // Comma-separated for both. Legacy single-value ?conf=ACC URLs split to a
  // one-element array (no migration needed for old bookmarks).
  const confRaw = get("conf");
  const conf = confRaw ? confRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const teamRaw = get("team");
  const teams = teamRaw ? teamRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  // Pinned columns. Unknown keys are dropped rather than trusted — this comes
  // straight off the query string. Deduped so a hand-edited URL can't render
  // the same column twice.
  const colsRaw = get("cols");
  const cols: TeamStatKey[] = colsRaw
    ? colsRaw.split(",").map((s) => s.trim()).filter(isStatKey).filter((k, i, a) => a.indexOf(k) === i)
    : [];

  return {
    years,
    conf,
    teams,
    filters,
    cols,
    view,
    sortBy: isStatKey(sortBy) ? sortBy : DEFAULT_SPEC.sortBy,
    sortDir: sortDir === "asc" || sortDir === "desc" ? sortDir : DEFAULT_SPEC.sortDir,
    limit: limit === -1 ? -1 : (Number.isFinite(limit) && limit > 0 && limit <= 5000 ? limit : DEFAULT_SPEC.limit),
  };
}

// ---------- query ----------
// PostgREST can't join sibling tables directly — pivot from `teams` and pull
// both stat tables through it via the FK each one has to teams(id).
function foreignTable(col: TeamStatColumn): string {
  return col.source === "trank" ? "team_trank_stats" : "team_season_stats";
}

export type TeamRow = {
  // identity
  team_id: number;
  team_name: string;
  team_conference: string | null;
  team_year: number;
  // Bart Torvik. Only `rank`, `record` and the adjoe/adjde pair are still his:
  // wins, losses, adjt and wab are fitted or counted by us now and simply keep
  // the same field names, and his sos / ncsos / consos are gone entirely — see
  // the schedule-strength block in TEAM_STAT_COLUMNS for why.
  rank: number | null;
  record: string | null;
  adjoe: number | null;
  adjde: number | null;
  // ours (build-adjusted-ratings.mjs)
  wins: number | null;
  losses: number | null;
  adjt: number | null;
  wab: number | null;
  // cbb (nullable until sync runs)
  cbb_efg: number | null;
  cbb_ts: number | null;
  cbb_tov: number | null;
  cbb_orb: number | null;
  cbb_ftarate: number | null;
  cbb_fg3: number | null;
  cbb_ft: number | null;
  cbb_fg3rate: number | null;
  cbb_ast: number | null;
  cbb_efg_def: number | null;
  cbb_tov_def: number | null;
  cbb_orb_def: number | null;
  cbb_fg3_def: number | null;
  cbb_ortg: number | null;
  cbb_drtg: number | null;
  cbb_ortg_adj: number | null;
  cbb_drtg_adj: number | null;
  cbb_net_adj: number | null;
  cbb_pace: number | null;
  cbb_fbpts: number | null;
  cbb_pitp: number | null;
  // Raw counts
  fg3_made: number | null;
  fg3_attempts: number | null;
  // Season count diffs
  fg3m_diff_ct: number | null;
  fg3a_diff_ct: number | null;
  fg2m_diff_ct: number | null;
  fgm_diff_ct: number | null;
  ftm_diff_ct: number | null;
  orb_diff_ct: number | null;
  drb_diff_ct: number | null;
  reb_diff_ct: number | null;
  tov_diff_ct: number | null;
  fbpts_diff: number | null;
  pitp_diff: number | null;
  /**
   * Per-tracked-game split differentials. Prefer these over the season totals
   * above: CBBD reports an untracked split as 0 rather than null on a third of
   * pre-2024 games, so the totals are only honest on ~1,200 of 4,631
   * team-seasons while these reach ~3,800.
   */
  fbpts_diff_pg: number | null;
  pitp_diff_pg: number | null;
  potov_diff_pg: number | null;
  scp_diff_pg: number | null;
  /** BTA's Four Factors, per game — the values the explorer's chips rank on. */
  reb_diff_pg: number | null;
  fg3m_diff_pg: number | null;
  tov_diff_pg: number | null;
  /**
   * Our own schedule-adjusted ratings. Distinct from `bta_*`, which average two
   * providers' adjusted numbers, and from `sos`, which is Bart's own strength of
   * schedule on a different scale — hence `adj_sos` rather than reusing the name.
   */
  a_net: number | null;
  a_ortg: number | null;
  a_drtg: number | null;
  adj_sos: number | null;
  pts_diff: number | null;
  scp_diff: number | null;
  potov_diff: number | null;
  // derived
  bta_ortg: number | null;
  bta_drtg: number | null;
  bta_net: number | null;        // bta_ortg − bta_drtg
  bta_rtg: number | null;        // weighted z-score composite ×10
  efg_diff: number | null;
  tov_diff: number | null;
  orb_diff: number | null;
  fg3_diff: number | null;
  cbb_fg: number | null;
  cbb_fg2: number | null;
  cbb_fga_pg: number | null;
  cbb_fg2a_pg: number | null;
  cbb_fg3a_pg: number | null;
  cbb_fta_pg: number | null;
  cbb_pts_pg: number | null;
  cbb_ast_pg: number | null;
  cbb_orb_pg: number | null;
  cbb_reb_pg: number | null;
  cbb_tov_pg: number | null;
  cbb_pfd_pg: number | null;
  cbb_fbpts_pg: number | null;
  cbb_pitp_pg: number | null;
  cbb_potov_pg: number | null;
  cbb_scp_pg: number | null;
  cbb_scp_pct: number | null;
  cbb_bench_pg: number | null;
  cbb_bench_pct: number | null;
  cbb_ast_to: number | null;
  cbb_ppp: number | null;
  cbb_drb_pg: number | null;
  cbb_stl_pg: number | null;
  cbb_blk_pg: number | null;
  cbb_pf_pg: number | null;
  cbb_drb_pct: number | null;
  cbb_stl_pct: number | null;
  cbb_blk_pct: number | null;
  cbb_hakeem: number | null;
  cbb_stl_pf: number | null;
  cbb_blk_pf: number | null;
  cbb_pf_eff: number | null;
  cbb_rim_rate: number | null;
  cbb_mid_rate: number | null;
  cbb_three_rate: number | null;
  cbb_rim_rate_def: number | null;
  cbb_mid_rate_def: number | null;
  cbb_three_rate_def: number | null;
  cbb_rim_fg: number | null;
  cbb_mid_fg: number | null;
  cbb_corner3_fg: number | null;
  cbb_atb3_fg: number | null;
  cbb_corner3_share: number | null;
  cbb_unast_pg: number | null;
  cbb_unast_share: number | null;
  nc_sos: number | null;
  conf_sos: number | null;
  sos_wp: number | null;
  win_pct: number | null;
  wins_no_trail: number | null;
  wire_wins: number | null;
  wins_trailing_5: number | null;
  wins_trailing_10: number | null;
  wins_trailing_15: number | null;
  wins_trailing_20: number | null;
  losses_no_lead: number | null;
  wire_losses: number | null;
  losses_leading_5: number | null;
  losses_leading_10: number | null;
  losses_leading_15: number | null;
  losses_leading_20: number | null;
  pbp_games: number | null;
  eff_height: number | null;
  fr_min_pct: number | null;
  so_min_pct: number | null;
  jr_min_pct: number | null;
  sr_min_pct: number | null;
  fr_pts_pct: number | null;
  so_pts_pct: number | null;
  jr_pts_pct: number | null;
  sr_pts_pct: number | null;
  cont_pct: number | null;
  ret_min_pct: number | null;
  rrot_pct: number | null;
  ret_prior_min: number | null;
  prior_team_min: number | null;
  ret_curr_min: number | null;
  curr_team_min: number | null;
  prev_a_net: number | null;
  in_transfer_min: number | null;
  proven_min_pct: number | null;
  // Per-season percentile rank (0–100) for each visible stat. Computed within
  // the team's own season cohort, not the full multi-year selection.
  pct: Record<string, number | null>;
};

// ---------- pure JS processing (no Supabase) ----------
// Used by client-side ExplorerClient to filter/sort/derive over the static
// teams-all.json blob. Same end shape as fetchTeams.
export type RawTeamSeason = {
  id: number;
  name: string;
  conference: string | null;
  year: number;
  team_trank_stats: {
    rank: number | null; record: string | null;
    wins: number | null; losses: number | null;
    adjoe: number | null; adjde: number | null;
    adjt: number | null;
    wab: number | null; sos: number | null;
    ncsos: number | null; consos: number | null;
  } | Array<unknown>;
  team_season_stats: {
    efg_pct: number | null; ts_pct: number | null;
    tov_pct: number | null; orb_pct: number | null;
    fta_rate: number | null; fg3_pct: number | null;
    fg3a_rate: number | null; ast_pct: number | null;
    efg_pct_def: number | null; tov_pct_def: number | null;
    orb_pct_def: number | null; fg3_pct_def: number | null;
    ortg: number | null; drtg: number | null;
    net_rtg: number | null; ortg_adj: number | null;
    drtg_adj: number | null; net_rtg_adj: number | null;
    pace: number | null;
    fbpts_pct: number | null; pitp_pct: number | null;
    // count-diff fields (migration 003 + 006). Loosely typed because the
    // export reads them via index access and the rest of this file casts.
    fg3_made_diff?: number | null; orb_diff_ct?: number | null;
    reb_diff?: number | null; fbpts_diff?: number | null;
    potov_diff?: number | null;
  } | null | Array<unknown>;
};

/**
 * Shape one year-cohort into fully-decorated TeamRows: derived columns, BTA
 * RTG, percentile chips. Everything here depends ONLY on (rawAll, years) —
 * never on the conference, team, stat, sort or limit parts of the spec — which
 * is what makes the result cacheable across a filter drag.
 */
function buildCohortRows(rawAll: RawTeamSeason[], years: number[]): TeamRow[] {
  // Year is the only pre-filter applied before BTA RTG is computed — we want
  // every team-season to keep the SAME BTA RTG regardless of which conference
  // or stat filters are active. So z-score within the full year cohort, then
  // apply conf + stat filters as display-only filters below.
  const yearSet = new Set(years);
  const cohort = rawAll.filter((r) => yearSet.has(r.year));

  // Shape rows + average-based derived columns
  const allRows: TeamRow[] = cohort.map((r) => {
    const trank = (Array.isArray(r.team_trank_stats) ? null : r.team_trank_stats) as Record<string, number | string | null> | null;
    const cbb = (Array.isArray(r.team_season_stats) || !r.team_season_stats ? null : r.team_season_stats) as Record<string, number | null> | null;
    const adjoe = (trank?.adjoe as number | null) ?? null;
    const adjde = (trank?.adjde as number | null) ?? null;
    const cbbOAdj = cbb?.ortg_adj ?? null;
    const cbbDAdj = cbb?.drtg_adj ?? null;
    const bta_ortg = avgIfPresent([adjoe, cbbOAdj]);
    const bta_drtg = avgIfPresent([adjde, cbbDAdj]);
    // Opponent 3P% is now computed at build time from summed season counts
    // (scripts/build-team-season-stats.mjs), so there is nothing to derive here.
    // The old source didn't pre-compute it, which is why raw fg3_made_def /
    // fg3_attempts_def counts used to be carried on every row just to divide
    // them client-side.
    const fg3_pct_def = cbb?.fg3_pct_def ?? null;
    return {
      team_id: r.id,
      team_name: r.name,
      team_conference: r.conference ?? null,
      team_year: r.year,
      rank: (trank?.rank as number | null) ?? null,
      /**
       * Built from OUR wins and losses, not Bart's string.
       *
       * It has to be, now that the Wins and Losses columns are ours: leaving
       * the string as Bart's would let a row read "34-1" beside a `wins >= 35`
       * filter it satisfied. Our counts are also the more accurate of the two —
       * Bart excludes non-D1 games from the record for 2014-2016 and includes
       * them from 2017, so his 2014 Wichita State reads 34-1 against a real
       * 35-1. Falls back to his string only when we have no counts at all,
       * which is every season before the CBBD archive starts.
       */
      record: (() => {
        const w = cbb?.wins, l = cbb?.losses;
        return typeof w === "number" && typeof l === "number"
          ? `${w}-${l}`
          : ((trank?.record as string | null) ?? null);
      })(),
      wins: cbb?.wins ?? null,
      losses: cbb?.losses ?? null,
      adjoe, adjde,
      adjt: cbb?.adjt ?? null,
      wab: cbb?.wab ?? null,
      cbb_efg: cbb?.efg_pct ?? null,
      cbb_ts: cbb?.ts_pct ?? null,
      cbb_tov: cbb?.tov_pct ?? null,
      cbb_orb: cbb?.orb_pct ?? null,
      cbb_ftarate: cbb?.fta_rate ?? null,
      cbb_fg3: cbb?.fg3_pct ?? null,
      cbb_ft: cbb?.ft_pct ?? null,
      cbb_fg3rate: cbb?.fg3a_rate ?? null,
      cbb_ast: cbb?.ast_pct ?? null,
      cbb_fg: cbb?.fg_pct ?? null,
      cbb_fg2: cbb?.fg2_pct ?? null,
      cbb_fga_pg: cbb?.fga_pg ?? null,
      cbb_fg2a_pg: cbb?.fg2a_pg ?? null,
      cbb_fg3a_pg: cbb?.fg3a_pg ?? null,
      cbb_fta_pg: cbb?.fta_pg ?? null,
      cbb_pts_pg: cbb?.pts_pg ?? null,
      cbb_ast_pg: cbb?.ast_pg ?? null,
      cbb_orb_pg: cbb?.orb_pg ?? null,
      cbb_reb_pg: cbb?.reb_pg ?? null,
      cbb_tov_pg: cbb?.tov_pg ?? null,
      cbb_pfd_pg: cbb?.pfd_pg ?? null,
      cbb_fbpts_pg: cbb?.fbpts_pg ?? null,
      cbb_pitp_pg: cbb?.pitp_pg ?? null,
      cbb_potov_pg: cbb?.potov_pg ?? null,
      cbb_scp_pg: cbb?.scp_pg ?? null,
      cbb_scp_pct: cbb?.scp_pct ?? null,
      cbb_bench_pg: cbb?.bench_pts_pg ?? null,
      cbb_bench_pct: cbb?.bench_pts_pct ?? null,
      cbb_ast_to: cbb?.ast_to ?? null,
      cbb_ppp: cbb?.ppp ?? null,
      cbb_drb_pg: cbb?.drb_pg ?? null,
      cbb_stl_pg: cbb?.stl_pg ?? null,
      cbb_blk_pg: cbb?.blk_pg ?? null,
      cbb_pf_pg: cbb?.pf_pg ?? null,
      cbb_drb_pct: cbb?.drb_pct ?? null,
      cbb_stl_pct: cbb?.stl_pct ?? null,
      cbb_blk_pct: cbb?.blk_pct ?? null,
      cbb_hakeem: cbb?.hakeem_pct ?? null,
      cbb_stl_pf: cbb?.stl_pf ?? null,
      cbb_blk_pf: cbb?.blk_pf ?? null,
      cbb_pf_eff: cbb?.pf_eff ?? null,
      cbb_rim_rate: cbb?.rim_rate ?? null,
      cbb_mid_rate: cbb?.mid_rate ?? null,
      cbb_three_rate: cbb?.three_rate ?? null,
      cbb_rim_rate_def: cbb?.rim_rate_def ?? null,
      cbb_mid_rate_def: cbb?.mid_rate_def ?? null,
      cbb_three_rate_def: cbb?.three_rate_def ?? null,
      cbb_rim_fg: cbb?.rim_fg_pct ?? null,
      cbb_mid_fg: cbb?.mid_fg_pct ?? null,
      cbb_corner3_fg: cbb?.corner3_fg_pct ?? null,
      cbb_atb3_fg: cbb?.atb3_fg_pct ?? null,
      cbb_corner3_share: cbb?.corner3_share ?? null,
      cbb_unast_pg: cbb?.unast_pg ?? null,
      cbb_unast_share: cbb?.unast_share ?? null,
      nc_sos: cbb?.nc_sos ?? null,
      conf_sos: cbb?.conf_sos ?? null,
      sos_wp: cbb?.sos_wp ?? null,
      win_pct: cbb?.win_pct ?? null,
      wins_no_trail: cbb?.wins_no_trail ?? null,
      wire_wins: cbb?.wire_wins ?? null,
      wins_trailing_5: cbb?.wins_trailing_5 ?? null,
      wins_trailing_10: cbb?.wins_trailing_10 ?? null,
      wins_trailing_15: cbb?.wins_trailing_15 ?? null,
      wins_trailing_20: cbb?.wins_trailing_20 ?? null,
      losses_no_lead: cbb?.losses_no_lead ?? null,
      wire_losses: cbb?.wire_losses ?? null,
      losses_leading_5: cbb?.losses_leading_5 ?? null,
      losses_leading_10: cbb?.losses_leading_10 ?? null,
      losses_leading_15: cbb?.losses_leading_15 ?? null,
      losses_leading_20: cbb?.losses_leading_20 ?? null,
      pbp_games: cbb?.pbp_games ?? null,
      eff_height: cbb?.eff_height ?? null,
      fr_min_pct: cbb?.fr_min_pct ?? null,
      so_min_pct: cbb?.so_min_pct ?? null,
      jr_min_pct: cbb?.jr_min_pct ?? null,
      sr_min_pct: cbb?.sr_min_pct ?? null,
      fr_pts_pct: cbb?.fr_pts_pct ?? null,
      so_pts_pct: cbb?.so_pts_pct ?? null,
      jr_pts_pct: cbb?.jr_pts_pct ?? null,
      sr_pts_pct: cbb?.sr_pts_pct ?? null,
      cont_pct: cbb?.cont_pct ?? null,
      ret_min_pct: cbb?.ret_min_pct ?? null,
      rrot_pct: cbb?.rrot_pct ?? null,
      ret_prior_min: cbb?.ret_prior_min ?? null,
      prior_team_min: cbb?.prior_team_min ?? null,
      ret_curr_min: cbb?.ret_curr_min ?? null,
      curr_team_min: cbb?.curr_team_min ?? null,
      prev_a_net: cbb?.prev_a_net ?? null,
      in_transfer_min: cbb?.in_transfer_min ?? null,
      proven_min_pct: cbb?.proven_min_pct ?? null,
      cbb_efg_def: cbb?.efg_pct_def ?? null,
      cbb_tov_def: cbb?.tov_pct_def ?? null,
      cbb_orb_def: cbb?.orb_pct_def ?? null,
      cbb_fg3_def: fg3_pct_def,
      cbb_ortg: cbb?.ortg ?? null,
      cbb_drtg: cbb?.drtg ?? null,
      cbb_ortg_adj: cbbOAdj,
      cbb_drtg_adj: cbbDAdj,
      cbb_net_adj: cbb?.net_rtg_adj ?? null,
      cbb_pace: cbb?.pace ?? null,
      cbb_fbpts: cbb?.fbpts_pct ?? null,
      cbb_pitp: cbb?.pitp_pct ?? null,
      fg3_made: cbb?.fg3_made ?? null,
      fg3_attempts: cbb?.fg3_attempts ?? null,
      fg3m_diff_ct: cbb?.fg3_made_diff ?? null,
      fg3a_diff_ct: cbb?.fg3_att_diff ?? null,
      fg2m_diff_ct: cbb?.fg2_made_diff ?? null,
      fgm_diff_ct: cbb?.fg_made_diff ?? null,
      ftm_diff_ct: cbb?.ft_made_diff ?? null,
      orb_diff_ct: cbb?.orb_diff_ct ?? null,
      drb_diff_ct: cbb?.drb_diff ?? null,
      reb_diff_ct: cbb?.reb_diff ?? null,
      tov_diff_ct: cbb?.tov_diff_ct ?? null,
      fbpts_diff: cbb?.fbpts_diff ?? null,
      pitp_diff: cbb?.pitp_diff ?? null,
      pts_diff: cbb?.pts_diff ?? null,
      scp_diff: cbb?.scp_diff ?? null,
      potov_diff: cbb?.potov_diff ?? null,
      fbpts_diff_pg: cbb?.fbpts_diff_pg ?? null,
      a_net: cbb?.a_net ?? null,
      a_ortg: cbb?.a_ortg ?? null,
      a_drtg: cbb?.a_drtg ?? null,
      adj_sos: cbb?.sos ?? null,
      reb_diff_pg: cbb?.reb_diff_pg ?? null,
      fg3m_diff_pg: cbb?.fg3m_diff_pg ?? null,
      tov_diff_pg: cbb?.tov_diff_pg ?? null,
      pitp_diff_pg: cbb?.pitp_diff_pg ?? null,
      potov_diff_pg: cbb?.potov_diff_pg ?? null,
      scp_diff_pg: cbb?.scp_diff_pg ?? null,
      bta_ortg,
      bta_drtg,
      bta_net: (bta_ortg !== null && bta_drtg !== null) ? bta_ortg - bta_drtg : null,
      bta_rtg: null,
      efg_diff: diff(cbb?.efg_pct ?? null, cbb?.efg_pct_def ?? null),
      tov_diff: diff(cbb?.tov_pct_def ?? null, cbb?.tov_pct ?? null),
      orb_diff: diff(cbb?.orb_pct ?? null, cbb?.orb_pct_def ?? null),
      fg3_diff: diff(cbb?.fg3_pct ?? null, fg3_pct_def),
      pct: {},
    };
  });

  // Bucket by year and z-score within EACH year cohort separately, so a team-
  // season's BTA RTG is locked to its own season (Gonzaga 2026 is always 71.3,
  // whether the user is viewing just 2026 or 2014-2026 together).
  {
    const rowsByYear = new Map<number, TeamRow[]>();
    for (const r of allRows) {
      const arr = rowsByYear.get(r.team_year) ?? [];
      arr.push(r);
      rowsByYear.set(r.team_year, arr);
    }
    for (const yearRows of rowsByYear.values()) attachBtaRtg(yearRows);
  }

  // Percentiles are computed across the FULL year cohort (every D-I team in
  // that season), not the filtered view — so a team's percentile chips don't
  // shift when the user narrows by conference, team, or stat filter. Multi-
  // year selections still bucket per-year inside attachPercentiles, so
  // 2024-Duke is measured against 2024 peers, not 2026.
  attachPercentiles(allRows);

  return allRows;
}

/**
 * Cache of shaped cohorts, keyed first on the raw array's identity and then on
 * the year selection.
 *
 * WHY: buildCohortRows reshapes every team-season from raw — ~6,689 of them for
 * an all-years view — and costs ~22ms. processTeams used to redo all of it on
 * every call, including the calls that only wanted a COUNT for the filter
 * drawer's footer, so dragging a slider re-derived the entire league on each
 * tick. Nothing it computes depends on the filters, so it is pure waste.
 *
 * A WeakMap on `rawAll` means the entry disappears with the data it was built
 * from; the inner map is capped because a user sweeping the season picker could
 * otherwise accumulate one cohort per combination they touch.
 */
const MAX_CACHED_COHORTS = 8;
const cohortCache = new WeakMap<RawTeamSeason[], Map<string, TeamRow[]>>();

function cachedCohortRows(rawAll: RawTeamSeason[], years: number[]): TeamRow[] {
  const key = [...years].sort((a, b) => a - b).join(",");
  let byYears = cohortCache.get(rawAll);
  if (!byYears) {
    byYears = new Map();
    cohortCache.set(rawAll, byYears);
  }
  const hit = byYears.get(key);
  if (hit) return hit;
  const rows = buildCohortRows(rawAll, years);
  // Evict oldest-inserted first — Map preserves insertion order.
  if (byYears.size >= MAX_CACHED_COHORTS) {
    const oldest = byYears.keys().next().value;
    if (oldest !== undefined) byYears.delete(oldest);
  }
  byYears.set(key, rows);
  return rows;
}

/** Does one row satisfy one stat filter? */
function passes(r: TeamRow, f: StatFilter): boolean {
  const key = f.stat as keyof TeamRow;
  const v = r[key] as number | null;
  if (v === null) return false;
  if (f.op === "gt") return v > f.value;
  if (f.op === "gte") return v >= f.value;
  if (f.op === "lt") return v < f.value;
  return v <= f.value;
}

export function processTeams(rawAll: RawTeamSeason[], spec: TeamFilterSpec): { rows: TeamRow[]; count: number } {
  const allRows = cachedCohortRows(rawAll, spec.years);

  // Display filters (conf + raw stats + derived stats). All applied AFTER
  // BTA RTG and percentiles so neither shifts when the user narrows the view.
  let displaySet = allRows;
  if (spec.conf.length) {
    const confSet = new Set(spec.conf);
    displaySet = displaySet.filter((r) => r.team_conference !== null && confSet.has(r.team_conference));
  }
  if (spec.teams.length) {
    const teamSet = new Set(spec.teams);
    displaySet = displaySet.filter((r) => teamSet.has(r.team_name));
  }
  for (const f of spec.filters) {
    // `source` describes where the number was FETCHED from, not whether it is
    // filterable. This used to skip `derived` stats outright, which silently
    // dropped every filter on eFG% Diff, TOV% Diff, OREB% Diff, 3P% Diff and
    // FTA% Diff — all five are computed onto TeamRow by cachedCohortRows before
    // this runs, so passes() reads them fine. The filter was accepted by the
    // URL, counted in the chip strip, and did nothing to the table.
    //
    // The only check that belongs here is that the stat is one we know.
    if (!COLUMN_BY_KEY.has(f.stat)) continue;
    displaySet = displaySet.filter((r) => passes(r, f));
  }

  let filtered = displaySet;
  for (const f of spec.filters) {
    const col = COLUMN_BY_KEY.get(f.stat);
    if (!col || col.source !== "derived") continue;
    filtered = filtered.filter((r) => passes(r, f));
  }

  // Array#sort mutates. When no filter narrowed anything, `filtered` is still
  // the cached cohort array itself, and sorting it in place would reorder the
  // cache under every other caller. Copy first in that case.
  if (filtered === allRows) filtered = filtered.slice();

  const sortCol = COLUMN_BY_KEY.get(spec.sortBy);
  if (sortCol) {
    const key = spec.sortBy as keyof TeamRow;
    const dir = spec.sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[key] as number | string | null;
      const bv = b[key] as number | string | null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  const sliced = spec.limit === -1 ? filtered : filtered.slice(0, spec.limit);
  return { rows: sliced, count: filtered.length };
}

// ---------- legacy Supabase fetch (left for any non-SSG consumers) ----------

// Legacy Supabase fetchers removed — all reads now go through static-data.ts
// + processTeams() above. The supabase import is unused at runtime too.

// ---------- helpers used by processTeams (re-added after dead-code cleanup)
function avgIfPresent(vals: Array<number | null | undefined>): number | null {
  const ok = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}
function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  return a - b;
}

// Per-season percentile rank for the 8 stats shown in the explorer table.
// `higherBetter: false` flips the sort so "lower is better" stats (Adj DRtg,
// Opp eFG%) get green chips at low values.
const PERCENTILE_STATS: Array<{ key: keyof TeamRow; higherBetter: boolean }> = [
  { key: "adjt",        higherBetter: true },
  { key: "cbb_ts",      higherBetter: true },
  { key: "cbb_efg",     higherBetter: true },
  { key: "cbb_fg3",     higherBetter: true },
  { key: "cbb_ft",      higherBetter: true },
  { key: "cbb_fg3rate", higherBetter: true },
  { key: "cbb_ftarate", higherBetter: true },
  { key: "cbb_efg_def", higherBetter: false },
  // Four Factors columns in the Team Explorer table — positive diffs are good
  // for everything except turnovers (more TOVs than the opponent = bad).
  { key: "reb_diff_ct",  higherBetter: true },
  { key: "fg3m_diff_ct", higherBetter: true },
  { key: "fbpts_diff",   higherBetter: true },
  { key: "tov_diff_ct",  higherBetter: false },
  // The per-game variants carry the chips, because they are the values with
  // full coverage — a percentile computed over the ~1,500 team-seasons that
  // have a fast-break TOTAL would rank a team against a biased subset of its
  // own era rather than against the era.
  { key: "reb_diff_pg",   higherBetter: true },
  { key: "fg3m_diff_pg",  higherBetter: true },
  { key: "fbpts_diff_pg", higherBetter: true },
  { key: "tov_diff_pg",   higherBetter: false },
  // The schedule-adjusted ratings, which replace BTA RTG as the headline set.
  { key: "a_net",   higherBetter: true },
  { key: "a_ortg",  higherBetter: true },
  { key: "a_drtg",  higherBetter: false },
  { key: "adj_sos", higherBetter: true },
  { key: "prev_a_net", higherBetter: true },
  { key: "in_transfer_min", higherBetter: true },
  { key: "proven_min_pct", higherBetter: true },
  { key: "nc_sos", higherBetter: true },
  { key: "conf_sos", higherBetter: true },
  { key: "sos_wp", higherBetter: false },
  { key: "cbb_pace", higherBetter: true },
  // Everything else the filter drawer can PIN as a column. A pinned column
  // renders the same value + chip treatment as a default one, so any stat that
  // can be pinned needs a percentile or it lands in the table visibly
  // half-dressed. Cost is ~12 more sorts over a cohort that's built once and
  // cached, so it never touches the drag path.
  { key: "cbb_fg3_def", higherBetter: false },
  { key: "cbb_tov_def", higherBetter: true },   // forcing more is good
  { key: "cbb_orb_def", higherBetter: false },  // allowing fewer is good
  { key: "cbb_orb",     higherBetter: true },
  { key: "cbb_tov",     higherBetter: false },
  { key: "cbb_ast",     higherBetter: true },
  { key: "wins",        higherBetter: true },
  { key: "losses",      higherBetter: false },
  { key: "wab",         higherBetter: true },
  { key: "pts_diff",    higherBetter: true },
  { key: "pitp_diff",   higherBetter: true },
  { key: "scp_diff",    higherBetter: true },
  // The glossary set. Same reasoning as the block above: anything pinnable
  // needs a percentile or it lands in the table visibly half-dressed.
  { key: "cbb_fg", higherBetter: true },
  { key: "cbb_fg2", higherBetter: true },
  { key: "cbb_fga_pg", higherBetter: true },
  { key: "cbb_fg2a_pg", higherBetter: true },
  { key: "cbb_fg3a_pg", higherBetter: true },
  { key: "cbb_fta_pg", higherBetter: true },
  { key: "cbb_pts_pg", higherBetter: true },
  { key: "cbb_ast_pg", higherBetter: true },
  { key: "cbb_orb_pg", higherBetter: true },
  { key: "cbb_reb_pg", higherBetter: true },
  { key: "cbb_tov_pg", higherBetter: false },
  { key: "cbb_pfd_pg", higherBetter: true },
  { key: "cbb_fbpts_pg", higherBetter: true },
  { key: "cbb_pitp_pg", higherBetter: true },
  { key: "cbb_potov_pg", higherBetter: true },
  { key: "cbb_scp_pg", higherBetter: true },
  { key: "cbb_scp_pct", higherBetter: true },
  { key: "cbb_bench_pg", higherBetter: true },
  { key: "cbb_bench_pct", higherBetter: true },
  { key: "cbb_ast_to", higherBetter: true },
  { key: "cbb_ppp", higherBetter: true },
  { key: "cbb_drb_pg", higherBetter: true },
  { key: "cbb_stl_pg", higherBetter: true },
  { key: "cbb_blk_pg", higherBetter: true },
  { key: "cbb_pf_pg", higherBetter: false },
  { key: "cbb_drb_pct", higherBetter: true },
  { key: "cbb_stl_pct", higherBetter: true },
  { key: "cbb_blk_pct", higherBetter: true },
  { key: "cbb_hakeem", higherBetter: true },
  { key: "cbb_stl_pf", higherBetter: true },
  { key: "cbb_blk_pf", higherBetter: true },
  { key: "cbb_pf_eff", higherBetter: true },
  // Shot mix direction follows the orthodoxy the league itself has been
  // moving toward for a decade — rim and three good, mid-range bad, and the
  // mirror image on defence. It is a judgement, not a fact, but a percentile
  // chip has to point somewhere and "neutral" is not an option the UI has.
  { key: "cbb_rim_rate", higherBetter: true },
  { key: "cbb_mid_rate", higherBetter: false },
  { key: "cbb_three_rate", higherBetter: true },
  { key: "cbb_rim_rate_def", higherBetter: false },
  { key: "cbb_mid_rate_def", higherBetter: true },
  { key: "cbb_three_rate_def", higherBetter: false },
  { key: "cbb_rim_fg", higherBetter: true },
  { key: "cbb_mid_fg", higherBetter: true },
  { key: "cbb_corner3_fg", higherBetter: true },
  { key: "cbb_atb3_fg", higherBetter: true },
  { key: "cbb_corner3_share", higherBetter: true },
  { key: "win_pct", higherBetter: true },
  { key: "wins_no_trail", higherBetter: true },
  { key: "wire_wins", higherBetter: true },
  { key: "wins_trailing_5", higherBetter: true },
  { key: "wins_trailing_10", higherBetter: true },
  { key: "wins_trailing_15", higherBetter: true },
  { key: "wins_trailing_20", higherBetter: true },
  { key: "losses_no_lead", higherBetter: false },
  { key: "wire_losses", higherBetter: false },
  { key: "losses_leading_5", higherBetter: false },
  { key: "losses_leading_10", higherBetter: false },
  { key: "losses_leading_15", higherBetter: false },
  { key: "losses_leading_20", higherBetter: false },
  { key: "eff_height", higherBetter: true },
  { key: "fr_min_pct", higherBetter: true },
  { key: "so_min_pct", higherBetter: true },
  { key: "jr_min_pct", higherBetter: true },
  { key: "sr_min_pct", higherBetter: true },
  { key: "fr_pts_pct", higherBetter: true },
  { key: "so_pts_pct", higherBetter: true },
  { key: "jr_pts_pct", higherBetter: true },
  { key: "sr_pts_pct", higherBetter: true },
  // NO PERCENTILE ON THE RAW MINUTE COUNTS — ret_prior_min, prior_team_min,
  // ret_curr_min, curr_team_min, pbp_games.
  //
  // A chip is a judgement: green means good. Ranking teams by how many minutes
  // they played is ranking them by how many games they played, so Harvard drew
  // a red 1 on Prior Team Min for the crime of being in the Ivy League. The
  // shares built ON those denominators — Returning Min %, Returner Rotation % —
  // keep their chips, because those genuinely say something.
  //
  // Dropping a key from this list is all it takes: the cell renders its value
  // with no chip when `row.pct` has no entry for it.
  { key: "cont_pct", higherBetter: true },
  { key: "ret_min_pct", higherBetter: true },
  { key: "rrot_pct", higherBetter: true },
  { key: "cbb_unast_pg", higherBetter: true },
  { key: "cbb_unast_share", higherBetter: true },
]

const LOWER_BETTER = new Set(
  PERCENTILE_STATS.filter((s) => !s.higherBetter).map((s) => s.key as string),
);
/**
 * Whether ascending is the "good" direction for a stat — the single source the
 * explorer's pinned columns read for their default sort direction and chip
 * polarity, so a pinned aDRTG behaves like the built-in aDRTG column.
 */
export function isLowerBetter(key: string): boolean {
  return LOWER_BETTER.has(key);
}

function attachPercentiles(rows: TeamRow[]) {
  const byYear = new Map<number, TeamRow[]>();
  for (const r of rows) {
    if (!byYear.has(r.team_year)) byYear.set(r.team_year, []);
    byYear.get(r.team_year)!.push(r);
  }
  for (const cohort of byYear.values()) {
    if (cohort.length === 0) continue;
    for (const { key, higherBetter } of PERCENTILE_STATS) {
      const indexed = cohort
        .map((r, i) => ({ v: r[key] as number | null, i }))
        .filter((x) => typeof x.v === "number" && Number.isFinite(x.v)) as { v: number; i: number }[];
      if (indexed.length < 2) {
        for (const r of cohort) r.pct[key as string] = null;
        continue;
      }
      indexed.sort((a, b) => (higherBetter ? a.v - b.v : b.v - a.v));
      const n = indexed.length;
      const written = new Set<number>();
      for (let rank = 0; rank < n; rank++) {
        const { i } = indexed[rank]!;
        cohort[i]!.pct[key as string] = Math.round((rank / (n - 1)) * 100);
        written.add(i);
      }
      for (let i = 0; i < cohort.length; i++) {
        if (!written.has(i)) cohort[i]!.pct[key as string] = null;
      }
    }
  }
}

function attachBtaRtg(rows: TeamRow[]) {
  const meanStd = (pick: (r: TeamRow) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    return std > 1e-9 ? { mean, std } : null;
  };

  const adjoe = meanStd((r) => r.adjoe);
  const adjde = meanStd((r) => r.adjde);
  const cbbO = meanStd((r) => r.cbb_ortg_adj);
  const cbbD = meanStd((r) => r.cbb_drtg_adj);
  // Was Bart's `sos`, a win-probability figure. Now our own net-rating SOS —
  // same concept, same direction (higher = tougher), and auditable from the
  // game logs rather than read off a scraped CSV.
  const sos = meanStd((r) => r.adj_sos);
  // Small-weight diff tells — ORTG side
  const orbDiff   = meanStd((r) => r.orb_diff_ct);
  const fg3mDiff  = meanStd((r) => r.fg3m_diff_ct);
  // PER-GAME, not the season total. The total is null for most pre-2023
  // team-seasons (CBBD reports untracked splits as 0), so keying the composite
  // off it meant BTA RTG quietly used a different set of inputs depending on
  // the era — a 2016 team scored on 7 components where a 2026 team scored on 9.
  // The per-game variant covers ~3,800 team-seasons instead of ~1,200 and is
  // already scale-free, which is what a z-score wants.
  const fbptsDiff = meanStd((r) => r.fbpts_diff_pg);
  // Small-weight diff tells — DRTG side
  const rebDiff   = meanStd((r) => r.reb_diff_ct);
  const potovDiff = meanStd((r) => r.potov_diff_pg);

  for (const r of rows) {
    let weightedSum = 0;
    let totalWeight = 0;
    const add = (z: number, weight: number) => {
      weightedSum += z * weight;
      totalWeight += weight;
    };
    if (adjoe && typeof r.adjoe === "number") add((r.adjoe - adjoe.mean) / adjoe.std, 1);
    if (cbbO && typeof r.cbb_ortg_adj === "number") add((r.cbb_ortg_adj - cbbO.mean) / cbbO.std, 1);
    if (adjde && typeof r.adjde === "number") add(-((r.adjde - adjde.mean) / adjde.std), 1);
    if (cbbD && typeof r.cbb_drtg_adj === "number") add(-((r.cbb_drtg_adj - cbbD.mean) / cbbD.std), 1);
    if (sos && typeof r.adj_sos === "number") add((r.adj_sos - sos.mean) / sos.std, 0.5);
    // ORTG-side small-weight tells (+z = bigger advantage = better)
    if (orbDiff   && typeof r.orb_diff_ct  === "number") add((r.orb_diff_ct  - orbDiff.mean)   / orbDiff.std,   0.25);
    if (fg3mDiff  && typeof r.fg3m_diff_ct === "number") add((r.fg3m_diff_ct - fg3mDiff.mean)  / fg3mDiff.std,  0.25);
    if (fbptsDiff && typeof r.fbpts_diff_pg === "number") add((r.fbpts_diff_pg - fbptsDiff.mean) / fbptsDiff.std, 0.25);
    // DRTG-side small-weight tells (+z = bigger advantage = better)
    if (rebDiff   && typeof r.reb_diff_ct === "number") add((r.reb_diff_ct - rebDiff.mean)   / rebDiff.std,   0.25);
    if (potovDiff && typeof r.potov_diff_pg === "number") add((r.potov_diff_pg - potovDiff.mean) / potovDiff.std, 0.25);
    r.bta_rtg = totalWeight === 0 ? null : (weightedSum / totalWeight) * 40;
  }
}

void avgIfPresent;
void diff;
void attachPercentiles;
void attachBtaRtg;
