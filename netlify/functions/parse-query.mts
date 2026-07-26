import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "@netlify/functions";

/**
 * parse-query — turns a plain-English Win Calculator question into a filter
 * spec the /calc form can be populated with.
 *
 *   "games where Roy Williams' UNC scored more fast break points and shot
 *    more threes than their opponent"
 *      -> { coach: "Roy Williams", teams: ["UNC"],
 *           conditions: [{stat:"fbpts_diff",op:"gt",value:0},
 *                        {stat:"fg3_att_diff",op:"gt",value:0}] }
 *
 * WHY A FUNCTION: the site is a static export, so there is no server to hide
 * an API key behind. Netlify Functions deploy alongside the static bundle and
 * keep ANTHROPIC_API_KEY server-side — it is never shipped to the browser.
 *
 * WHY THIS ONLY RESOLVES *STATS* AND NOT *NAMES*: the model returns team,
 * coach, opponent and conference names as free text, and the client fuzzy-
 * matches them against the real dropdown options (src/lib/query-parse.ts).
 * That handles user typos ("Roy Willliams") and model drift ("UNC" vs "North
 * Carolina") in one place, and guarantees whatever comes back is actually
 * selectable. Stuffing 812 coach names + 378 teams into every prompt would be
 * expensive and still wouldn't guarantee an exact string.
 *
 * The response is a proposal, not an action: /calc fills the form and waits
 * for the user to press Calculate. A wrong parse that silently returned a
 * number would be worse than no feature at all.
 */

// Mirrors CALC_STAT_OPTIONS in src/lib/game-filters.ts. Kept as a literal
// rather than imported because Netlify Functions bundle separately from the
// Next app and can't resolve the "@/" alias. If a stat is added there and not
// here, the model simply never selects it — a missing capability, not a bug.
const STATS = [
  "pts_diff", "pts_scored", "pts_against",
  "fg_made_diff", "fg3_made_diff", "fg3_att_diff", "fg2_made_diff", "ft_made_diff",
  "reb_diff", "orb_diff", "drb_diff", "tov_diff", "fbpts_diff", "pitp_diff", "scp_diff",
  "fg3_pct", "fg2_pct", "ft_pct", "efg_pct", "ts_pct", "efg_pct_def",
  "poss", "pace", "opp_rank",
  "ff_efg", "ff_ftr", "ff_tov", "ff_orb",
  "ff_efg_def", "ff_ftr_def", "ff_tov_def", "ff_orb_def",
  "ortg", "drtg", "game_score",
  "ast_diff", "stl_diff", "blk_diff", "ft_att_diff", "fouls_diff",
  "ast", "stl", "blk", "fouls",
  "largest_lead", "largest_lead_opp", "h1_margin", "h2_margin",
  "conf_game", "tourney", "postseason",
] as const;

const SCHEMA = {
  type: "object",
  properties: {
    coaches: { type: "array", items: { type: "string" }, description: "Coach names exactly as the user wrote them, corrected for obvious spelling errors. Empty if none mentioned." },
    teams: { type: "array", items: { type: "string" }, description: "The team(s) whose perspective the question is asked from. Empty if none." },
    opponents: { type: "array", items: { type: "string" }, description: "Specific opponents faced. Only when the user names who they PLAYED, not who they are." },
    conferences: { type: "array", items: { type: "string" }, description: "Conference names, e.g. ACC, Big Ten. Empty if none." },
    seasons: { type: "array", items: { type: "integer" }, description: "Season END years (2015-16 season = 2016). Empty means all seasons." },
    venue: { type: "string", enum: ["all", "home", "away", "neutral"] },
    quads: { type: "array", items: { type: "integer", enum: [1, 2, 3, 4] }, description: "NCAA quadrants. Empty means all." },
    conditions: {
      type: "array",
      description: "Statistical conditions, ALL of which must be true.",
      items: {
        type: "object",
        properties: {
          stat: { type: "string", enum: STATS as unknown as string[] },
          op: { type: "string", enum: ["gt", "gte", "lt", "lte", "eq"] },
          value: { type: "number" },
        },
        required: ["stat", "op", "value"],
        additionalProperties: false,
      },
    },
    interpretation: { type: "string", description: "One short sentence restating what you understood, in plain English." },
    ambiguities: { type: "array", items: { type: "string" }, description: "Any place a different reading was plausible, e.g. 'shot more 3s' could mean attempted or made." },
  },
  required: ["coaches", "teams", "opponents", "conferences", "seasons", "venue", "quads", "conditions", "interpretation", "ambiguities"],
  additionalProperties: false,
} as const;

const SYSTEM = `You translate plain-English college basketball questions into filters for a "Win Calculator" — a tool that answers "when X happened, how often did the team win?"

Every row of data is ONE TEAM'S PERSPECTIVE ON ONE GAME. Conditions are evaluated from that team's point of view, so a "diff" stat is always (this team − opponent).

STAT REFERENCE
Margin/scoring: pts_diff, pts_scored, pts_against
Differentials (team − opponent): fg_made_diff (FG made), fg3_made_diff (3PT MADE), fg3_att_diff (3PT ATTEMPTED), fg2_made_diff, ft_made_diff, ft_att_diff, reb_diff, orb_diff, drb_diff, tov_diff (turnovers — FEWER is better, so "won the turnover battle" = tov_diff < 0), ast_diff, stl_diff, blk_diff, fouls_diff, fbpts_diff (fast break points), pitp_diff (points in the paint), scp_diff (second-chance points)
Shooting rates (0-1 decimals, so 45% = 0.45): fg3_pct, fg2_pct, ft_pct, efg_pct, ts_pct, efg_pct_def (opponent's eFG%)
Four factors (0-1): ff_efg, ff_ftr, ff_tov, ff_orb, and the _def versions for what the opponent managed
Efficiency: ortg, drtg (per 100 possessions), game_score, poss, pace
Game shape: largest_lead, largest_lead_opp, h1_margin (first-half margin), h2_margin
Raw counts: ast, stl, blk, fouls
Context flags (use 1 for yes, 0 for no): conf_game, tourney, postseason
Opponent: opp_rank (1 = best team in the country, so "played a top-25 team" = opp_rank <= 25)

RULES
- "more X than their opponent" -> the _diff stat > 0.
- Turnovers, fouls, points allowed and opponent shooting are all BETTER when LOWER. "Protected the ball" / "won the turnover battle" = tov_diff < 0.
- "shot more threes" is ambiguous — prefer fg3_att_diff (attempts) and say so in ambiguities. "MADE more threes" is fg3_made_diff.
- Percentages are decimals: "shot over 40% from three" = fg3_pct > 0.4.
- Seasons are END years. "2015-16" and "the 2016 season" are both 2016. A range like "since 2020" means every season from 2020 onward.
- Return names as the user wrote them (fixing obvious typos). Do NOT try to guess an official name — the caller resolves names against the real list.
- If the user names a school as the subject ("Duke games where..."), that is teams. If they name who was PLAYED ("against Duke"), that is opponents.
- Only include a condition you can point at in the question. Do not invent thresholds.
- Note nothing in ambiguities if the question is unambiguous.`;

const MAX_QUERY_CHARS = 500;

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Deliberately explicit: this is a deploy-config problem, and the client
    // shows the message so it doesn't look like the parser simply failed.
    return Response.json(
      { error: "Search is not configured on this deploy (ANTHROPIC_API_KEY missing)." },
      { status: 503 },
    );
  }

  let query: unknown;
  try {
    ({ query } = await req.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length < 3) {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return Response.json({ error: `Keep it under ${MAX_QUERY_CHARS} characters.` }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      system: SYSTEM,
      // effort "low" keeps this fast and cheap — it's a bounded extraction, not
      // a reasoning problem. Thinking is left at its default rather than
      // disabled: on this model disabling it can leak internal tags into the
      // output, and low effort already does the cost work.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content: query }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "Could not process that question." }, { status: 422 });
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: "Empty response from the parser." }, { status: 502 });
    }

    return Response.json(JSON.parse(text.text), {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Busy right now — try again in a moment." }, { status: 429 });
    }
    console.error("parse-query failed:", message);
    return Response.json({ error: "Could not parse that question." }, { status: 502 });
  }
};

export const config = { path: "/api/parse-query" };
