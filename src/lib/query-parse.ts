/**
 * Client half of the natural-language Win Calculator search.
 *
 * The Netlify function (netlify/functions/parse-query.mts) returns entity names
 * as FREE TEXT — "UNC", "Roy Willliams", "the ACC" — and this module resolves
 * them against the actual dropdown options before anything reaches the form.
 *
 * Two-stage on purpose. The model is good at reading intent and terrible at
 * guaranteeing an exact string from a 812-name list it was never shown; fuzzy
 * matching here closes both gaps at once — the user's typos AND the model's
 * near-misses — and makes it impossible to produce a value the UI can't select.
 * The alternative (send every coach and team name in the prompt) costs more per
 * call and still wouldn't guarantee an exact match.
 */

import type { Op } from "@/lib/game-filters";

export type ParsedCondition = { stat: string; op: Op; value: number };

/** Raw shape returned by the function — names are unresolved free text. */
export type ParsedQuery = {
  coaches: string[];
  teams: string[];
  opponents: string[];
  conferences: string[];
  seasons: number[];
  venue: "all" | "home" | "away" | "neutral";
  quads: number[];
  conditions: ParsedCondition[];
  /**
   * The model's restatement of the question, shown to the user as "Understood:".
   * Named `analysis` to match the wire field — see parse-query.mts, where the
   * name is load-bearing: structured-output keys are alphabetised, so this has
   * to sort before `conditions` for the model to reason before it filters.
   */
  analysis: string;
  notes: string[];
};

/** After name resolution — every string here is a real option value. */
export type ResolvedQuery = ParsedQuery & {
  resolved: {
    coaches: string[];
    teams: string[];
    opponents: string[];
    conferences: string[];
  };
  /** Names the model returned that matched nothing — surfaced to the user. */
  unresolved: string[];
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state")
    .replace(/\buniversity\b|\bcollege\b|\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Common shorthand the model is likely to echo back verbatim because that's
 * how people talk. Resolved before fuzzy matching, since edit distance alone
 * would never get "UNC" to "North Carolina".
 */
const SPOKEN_ALIASES: Record<string, string> = {
  unc: "North Carolina",
  "ole miss": "Mississippi",
  uconn: "Connecticut",
  pitt: "Pittsburgh",
  cuse: "Syracuse",
  nova: "Villanova",
  zags: "Gonzaga",
  "st johns": "St. John's",
  "nc state": "N.C. State",
  "usc": "Southern California",
  "miami": "Miami FL",
  "smu": "SMU",
  "ucf": "UCF",
  "vcu": "VCU",
  "byu": "BYU",
  "tcu": "TCU",
  "lsu": "LSU",
  "unlv": "UNLV",
  "utep": "UTEP",
  "uab": "UAB",
};

/** Levenshtein, bounded — we only care about "close enough". */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Resolve one free-text name against a list of real option values.
 * Exact → alias → substring → bounded edit distance. Returns null rather than
 * guessing when nothing is close, so the caller can tell the user what it
 * couldn't place instead of silently filtering on the wrong team.
 */
export function resolveName(raw: string, options: string[]): string | null {
  if (!raw?.trim() || options.length === 0) return null;
  const target = norm(SPOKEN_ALIASES[norm(raw)] ?? raw);
  if (!target) return null;

  let exact: string | null = null;
  // Track the CLOSEST-LENGTH substring match, not the first one found.
  // "unc" is a substring of both "unc asheville" and "unc wilmington"; taking
  // whichever happened to sort first silently answered a question about a
  // different school. Closest length is the least-surprising tiebreak.
  let contains: { value: string; gap: number } | null = null;
  let best: { value: string; dist: number } | null = null;

  for (const opt of options) {
    const n = norm(opt);
    if (n === target) { exact = opt; break; }
    if (n.includes(target) || target.includes(n)) {
      const gap = Math.abs(n.length - target.length);
      if (!contains || gap < contains.gap) contains = { value: opt, gap };
    }
    const dist = editDistance(target, n);
    if (!best || dist < best.dist) best = { value: opt, dist };
  }
  if (exact) return exact;
  // A very short query ("unc", "usc") is a substring of too many school names
  // to guess from — require a real alias or an exact hit rather than pick one.
  if (contains && !(target.length <= 4 && contains.gap > 3)) return contains.value;

  // Allow roughly one error per four characters — enough for a transposed
  // letter or a doubled consonant, not enough to match a different school.
  const tolerance = Math.max(2, Math.floor(target.length / 4));
  return best && best.dist <= tolerance ? best.value : null;
}

function resolveList(raws: string[], options: string[], missing: string[]): string[] {
  const out: string[] = [];
  for (const raw of raws ?? []) {
    const hit = resolveName(raw, options);
    if (hit) { if (!out.includes(hit)) out.push(hit); }
    else missing.push(raw);
  }
  return out;
}

export function resolveQuery(
  parsed: ParsedQuery,
  opts: {
    coaches: string[];
    teams: string[];
    opponents: string[];
    /** Conference option values are codes (ACC/B10); pass display labels too. */
    conferences: Array<{ value: string; label: string }>;
    validStats: Set<string>;
    validSeasons: number[];
  },
): ResolvedQuery {
  const unresolved: string[] = [];

  // Conferences match on the human label ("Big Ten") but we store the code.
  const confLabels = opts.conferences.map((c) => c.label);
  const confByLabel = new Map(opts.conferences.map((c) => [c.label, c.value]));
  const confHits = resolveList(parsed.conferences ?? [], confLabels, unresolved)
    .map((label) => confByLabel.get(label))
    .filter((v): v is string => !!v);

  return {
    ...parsed,
    // Drop any stat the current build doesn't expose, and any season outside
    // the data window — both would otherwise render as a silently empty result.
    conditions: (parsed.conditions ?? []).filter((c) => opts.validStats.has(c.stat)),
    seasons: (parsed.seasons ?? []).filter((y) => opts.validSeasons.includes(y)),
    resolved: {
      coaches: resolveList(parsed.coaches ?? [], opts.coaches, unresolved),
      teams: resolveList(parsed.teams ?? [], opts.teams, unresolved),
      opponents: resolveList(parsed.opponents ?? [], opts.opponents, unresolved),
      conferences: confHits,
    },
    unresolved,
  };
}
