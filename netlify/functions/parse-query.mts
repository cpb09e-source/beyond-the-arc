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
  "ortg", "drtg",
  "ast_diff", "stl_diff", "blk_diff", "ft_att_diff", "fouls_diff",
  "ast", "stl", "blk", "fouls",
  "largest_lead", "largest_lead_opp", "h1_margin", "h2_margin",
  "conf_game", "tourney",
] as const;

// Mirrors src/lib/seasons.ts. Same bundling constraint as STATS above — the
// function can't resolve "@/". The client re-filters against its own list, so
// drift here costs a bad suggestion, never a bad result.
const SEASON_FLOOR = 2014;
const SEASON_CEIL = 2026;
const EXCLUDED_SEASONS = [2021];

const SCHEMA = {
  type: "object",
  properties: {
    // WHY THIS IS "analysis" AND NOT "interpretation": structured-output keys
    // come back ALPHABETIZED, not in schema order. Under the old name the model
    // wrote `conditions` (3rd) before `interpretation` (7th) — committing to
    // filters before reasoning about the question, and dropping the condition
    // outright on 3 of 5 runs. "analysis" sorts ahead of "conditions", so the
    // reasoning now lands first. Renaming it back reintroduces the bug.
    // A dedicated scratchpad field fixed it too, but cost extra tokens on every
    // call; renaming an existing field reorders the generation for free.
    analysis: { type: "string", description: "Write this FIRST. One short sentence restating what you understood, naming each stat you are about to use. Shown to the user." },
    coaches: { type: "array", items: { type: "string" }, description: "Coach names exactly as the user wrote them, corrected for obvious spelling errors. Empty if none mentioned." },
    teams: { type: "array", items: { type: "string" }, description: "The team(s) whose perspective the question is asked from. Empty if none." },
    opponents: { type: "array", items: { type: "string" }, description: "Specific opponents faced. Only when the user names who they PLAYED, not who they are." },
    conferences: { type: "array", items: { type: "string" }, description: "Conference names, e.g. ACC, Big Ten. Empty if none." },
    // No minimum/maximum here — structured outputs reject numeric bounds on
    // integer. The range lives in the description, and the client drops any
    // season outside its own window anyway (resolveQuery -> validSeasons).
    seasons: { type: "array", items: { type: "integer" }, description: `Season END years (2015-16 season = 2016), between ${SEASON_FLOOR} and ${SEASON_CEIL}. An open-ended range such as "since 2022" runs through ${SEASON_CEIL}. Never include ${EXCLUDED_SEASONS.join(", ")} (absent from the data). Empty means all seasons.` },
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
    notes: { type: "array", items: { type: "string" }, description: "Any place a different reading was plausible, e.g. 'shot more 3s' could mean attempted or made." },
  },
  required: ["analysis", "coaches", "teams", "opponents", "conferences", "seasons", "venue", "quads", "conditions", "notes"],
  additionalProperties: false,
} as const;

const SYSTEM = `You translate plain-English college basketball questions into filters for a "Win Calculator" — a tool that answers "when X happened, how often did the team win?"

Every row of data is ONE TEAM'S PERSPECTIVE ON ONE GAME. Conditions are evaluated from that team's point of view, so a "diff" stat is always (this team − opponent).

Conditions are ALWAYS evaluated per individual game — never against a season total or a season average. "Teams that shot over 40% from three" means games in which that team shot over 40%, so it is still fg3_pct > 0.4. There is no way to express a season-level condition, so never drop a condition because it sounded like a season stat.

STAT REFERENCE
Margin/scoring: pts_diff, pts_scored, pts_against
Differentials (team − opponent): fg_made_diff (FG made), fg3_made_diff (3PT MADE), fg3_att_diff (3PT ATTEMPTED), fg2_made_diff, ft_made_diff, ft_att_diff, reb_diff, orb_diff, drb_diff, tov_diff (turnovers — FEWER is better, so "won the turnover battle" = tov_diff < 0), ast_diff, stl_diff, blk_diff, fouls_diff, fbpts_diff (fast break points), pitp_diff (points in the paint), scp_diff (second-chance points)
Shooting rates (0-1 decimals, so 45% = 0.45): fg3_pct, fg2_pct, ft_pct, efg_pct, ts_pct, efg_pct_def (opponent's eFG%)
Rate stats (0-1): ff_efg, ff_ftr, ff_tov, ff_orb, and the _def versions for what the opponent managed
Efficiency: ortg, drtg (per 100 possessions), poss, pace
Game shape: largest_lead, largest_lead_opp, h1_margin (first-half margin), h2_margin
Raw counts: ast, stl, blk, fouls
Context flags (use 1 for yes, 0 for no): conf_game (conference matchup), tourney (NCAA tournament / March Madness ONLY -- not conference tournaments)
Opponent: opp_rank (1 = best team in the country, so "played a top-25 team" = opp_rank <= 25)

RULES
- "more X than their opponent" -> the _diff stat > 0.
- Turnovers, fouls, points allowed and opponent shooting are all BETTER when LOWER. "Protected the ball" / "won the turnover battle" = tov_diff < 0.
- "shot more threes" is ambiguous — prefer fg3_att_diff (attempts) and say so in notes. "MADE more threes" is fg3_made_diff.
- Percentages are decimals: "shot over 40% from three" = fg3_pct > 0.4.
- Seasons are END years. "2015-16" and "the 2016 season" are both 2016. Data covers ${SEASON_FLOOR}-${SEASON_CEIL}; ${SEASON_CEIL} is the most recent season. An open-ended range like "since 2020" means every season from 2020 through ${SEASON_CEIL} inclusive — do not stop early. ${EXCLUDED_SEASONS.join(", ")} is missing from the data, so never emit it, and silently skip it inside a range.
- Return names as the user wrote them (fixing obvious typos). Do NOT try to guess an official name — the caller resolves names against the real list.
- If the user names a school as the subject ("Duke games where..."), that is teams. If they name who was PLAYED ("against Duke"), that is opponents.
- The subject can be a group rather than one school — "ACC teams", "Big Ten teams", "any team". Put the conference in conferences, leave teams empty, and still emit every per-game condition exactly as you would for a single school.
- "<group> teams that <did something>" is NOT a request to list teams or to rank them by a season average. It is the same per-game filter as "<school> games where they <did something>". Rewrite it that way in your head first: "ACC teams that shot over 40% from three" is "ACC games where the team shot over 40% from three" -> conferences ["ACC"], fg3_pct > 0.4. Never return an empty conditions array for a question that describes something happening on the court.
- Only include a condition you can point at in the question. Do not invent thresholds.
- Leave notes empty if the question is unambiguous.`;

const MAX_QUERY_CHARS = 500;
/**
 * Netlify allows a synchronous function 60s (not the 10s often assumed, and not
 * configurable either way). Typical parses land in 4-9s; vague questions with no
 * named team deliberate much longer. 30s keeps those alive while still failing
 * well short of the platform cutoff, which would kill the request with no body.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * True when a parse contradicts itself: no conditions, but the analysis names a
 * stat key it was supposedly about to filter on. The `analysis` field is
 * instructed to name each stat, so a key appearing there and nowhere in
 * `conditions` is a dropped filter rather than a question with no condition.
 */
function needsRepair(parsed: Record<string, unknown>): boolean {
  const conditions = parsed.conditions;
  if (Array.isArray(conditions) && conditions.length > 0) return false;
  const analysis = typeof parsed.analysis === "string" ? parsed.analysis : "";
  return STATS.some((s) => analysis.includes(s));
}

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

  // Retries were 0 back when the failure mode was a slow non-streaming
  // generation, where a second attempt only spent the budget twice. Streaming
  // removed that failure mode; what's left is transient socket resets
  // (ECONNRESET mid-stream), which is precisely what retries exist for.
  const client = new Anthropic({ apiKey, timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 2 });

  // STREAMED, and it has to be. A non-streaming request sends no response
  // headers until the whole message is generated, so time-to-first-byte is the
  // full generation time and the runtime's header timeout kills anything slow.
  // Measured: parses needing more than ~11s died as APIConnectionTimeoutError
  // no matter what `timeout` was set to — 8.5s, 30s and 45s all failed at the
  // same ~11s mark, because the limit was never ours. Streaming sends headers
  // immediately and keeps the socket busy, so the only ceiling left is the one
  // configured above. finalMessage() hands back a normal assembled Message.
  const ask = async (messages: Anthropic.MessageParam[]) => {
    const response = await client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 2048,
      system: SYSTEM,
      // effort "low" keeps this cheap — it's a bounded extraction, not a
      // reasoning problem. Thinking stays at its adaptive default: disabling it
      // was measured at roughly half the latency with clean output, but the
      // nuanced reads are the ones worth having (converting "under 1.0 points
      // per possession" to drtg < 100, flagging that "shot more 3s" could mean
      // attempts or makes), and streaming already bought back the time.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages,
    }).finalMessage();

    if (response.stop_reason === "refusal") return { refused: true as const };
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { empty: true as const };
    return { parsed: JSON.parse(text.text) as Record<string, unknown> };
  };

  try {
    let out = await ask([{ role: "user", content: query }]);
    if ("refused" in out) {
      return Response.json({ error: "Could not process that question." }, { status: 422 });
    }
    if ("empty" in out) {
      return Response.json({ error: "Empty response from the parser." }, { status: 502 });
    }

    // REPAIR PASS. The dominant failure mode isn't misunderstanding — it's the
    // model working out the answer, writing it into `analysis`, and then
    // emitting an empty `conditions`. Measured 2 of 4 identical runs of "bill
    // self record on the road where he scores more fastbreak points": every one
    // named fbpts_diff in the analysis, half shipped no condition.
    //
    // That contradiction is detectable, so repair it rather than hand back a
    // parse that quietly answers a much broader question. Only fires on the
    // broken half, and re-asks with the model's own analysis quoted back, which
    // beats blind resampling because the reasoning is already correct.
    if (needsRepair(out.parsed)) {
      const first = out.parsed;
      const repaired = await ask([
        { role: "user", content: query },
        { role: "assistant", content: JSON.stringify(first) },
        {
          role: "user",
          content:
            `That response described the filter as "${String(first.analysis ?? "")}" but returned an empty "conditions" array, ` +
            `so it would match every game instead. Return the same JSON with "conditions" filled in to match your own analysis.`,
        },
      ]);
      // Keep the repair only if it actually produced conditions — a second
      // empty answer means the question genuinely has none, and the client
      // warns about that case anyway.
      if ("parsed" in repaired && Array.isArray(repaired.parsed.conditions) && repaired.parsed.conditions.length) {
        out = repaired;
      }
    }

    return Response.json(out.parsed, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Busy right now — try again in a moment." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      // Actionable on purpose: naming the team is what actually makes this
      // query fast, and the manual filters below are always available.
      return Response.json(
        { error: "That question took too long to work out. Naming a specific team usually helps — or set the filters below by hand." },
        { status: 504 },
      );
    }
    console.error("parse-query failed:", message);
    return Response.json({ error: "Could not parse that question." }, { status: 502 });
  }
};

export const config = { path: "/api/parse-query" };
