import type { Scope, Scoped } from "./scoped-query";
import { matchesQuery, normalizeText } from "./text";

/**
 * The filter box's grammar: plain words, exact names and conditions, in any order.
 *
 *   duke                    words, matched loosely, as the box always did
 *   conf: SEC               an exact name (./scoped-query.ts)
 *   net>20 tempo<68         a stat against a number
 *   conf: Big Ten net>20    all of it at once, every clause required
 *
 * STILL WORDS IN THE BOX. Nothing here becomes a chip or a hidden state. What
 * narrows the table is what the reader can read, edit, keep in a favorite and
 * clear with Esc, the contract the exact names already had.
 *
 * A NAME RUNS TO THE NEXT CLAUSE. Names have spaces and conditions have an
 * operator, so "conf: Big Ten net>20" is the Big Ten, then a condition.
 *
 * IN THE TABLE'S UNITS, AS PRINTED. A percentage is typed as the table shows it
 * (efg>55, not .55), and each value is compared as printed, so "net>20" never
 * keeps a row that reads +20.0.
 *
 * HALF-TYPED IS NOT YET A FILTER. "net>" and "conf:" narrow nothing until they
 * have a value, so the table does not blink empty between keystrokes.
 */

export type Op = ">" | ">=" | "<" | "<=" | "=";
export type Condition = { name: string; op: Op; value: number };

type ScopeClause = { kind: "scope"; scope: Scope; value: string; start: number; valueStart: number; end: number };
type StatClause = { kind: "stat"; name: string; op: Op; value: number | null; start: number; end: number };
type WordsClause = { kind: "words"; start: number; end: number };
export type Clause = ScopeClause | StatClause | WordsClause;

export type ParsedFilter = {
  clauses: Clause[];
  /** Names with a value. */
  scopes: Scoped[];
  /** Conditions with a number. */
  conditions: Condition[];
  /** Everything else, for the loose match. */
  words: string;
};

const OPS: Record<string, Op> = { ">": ">", ">=": ">=", "≥": ">=", "<": "<", "<=": "<=", "≤": "<=", "=": "=" };

// A clause starts a word: at the start, or after a space or a comma. A stat's
// name needs a letter, so "7>6" stays words.
const CLAUSE =
  /(?<![^\s,])(?:(teams|team|player|conf|opponents)\s*:|([a-z0-9_]*[a-z][a-z0-9_]*%?)\s*(>=|<=|≥|≤|>|<|=)\s*(?:([-−+]?(?:\d+(?:\.\d*)?|\.\d+))%?)?)/gi;

export function parseFilter(query: string): ParsedFilter {
  const clauses: Clause[] = [];
  let at = 0;
  let open: ScopeClause | null = null;
  // The text before a clause finishes the name that was open, or is words.
  const gap = (end: number) => {
    if (open) {
      open.value = query.slice(open.valueStart, end).trim();
      open.end = end;
      open = null;
    } else if (query.slice(at, end).trim()) {
      clauses.push({ kind: "words", start: at, end });
    }
  };
  for (const m of query.matchAll(CLAUSE)) {
    const start = m.index;
    gap(start);
    const end = start + m[0].length;
    if (m[1]) {
      open = { kind: "scope", scope: m[1].toLowerCase() as Scope, value: "", start, valueStart: end, end };
      clauses.push(open);
    } else {
      const raw = m[4];
      const value = raw == null ? null : Number(raw.replace("−", "-"));
      clauses.push({ kind: "stat", name: m[2]!, op: OPS[m[3]!]!, value: value != null && Number.isFinite(value) ? value : null, start, end });
    }
    at = end;
  }
  gap(query.length);

  const scopes: Scoped[] = [];
  const conditions: Condition[] = [];
  const words: string[] = [];
  for (const c of clauses) {
    if (c.kind === "scope" && c.value) scopes.push({ scope: c.scope, value: c.value });
    else if (c.kind === "stat" && c.value != null) conditions.push({ name: c.name, op: c.op, value: c.value });
    else if (c.kind === "words") words.push(query.slice(c.start, c.end));
  }
  return { clauses, scopes, conditions, words: words.join(" ") };
}

// ── Stats ─────────────────────────────────────────────────────────────────

export type FilterStat<R> = {
  /** What the box offers, and what most people type: "net", "tempo", "3p". */
  name: string;
  /** Other spellings that find it: the site's key, "pace" for tempo. */
  aliases?: string[];
  label: string;
  desc?: string;
  /** Stored as a share, printed and typed as a percentage. */
  pct?: boolean;
  /** Decimal places the table prints, which is what a comparison reads. */
  digits: number;
  get: (r: R) => number | null;
};

export type StatIndex<R> = { all: FilterStat<R>[]; find: (typed: string) => FilterStat<R> | null };

/** "TS%", "ts_pct" and "ts%" fold alike; "tov" and "tov%" do not, because a game log has both. */
const fold = (s: string): string => s.toLowerCase().replace(/[\s_]+/g, "").replace(/pct$/, "%");

export function statIndex<R>(stats: FilterStat<R>[]): StatIndex<R> {
  const by = new Map<string, FilterStat<R>>();
  // Names first, so no stat's alias can take another stat's name.
  for (const s of stats) by.set(fold(s.name), s);
  for (const s of stats) for (const a of s.aliases ?? []) if (!by.has(fold(a))) by.set(fold(a), s);
  return {
    all: stats,
    find: (typed) => {
      const k = fold(typed);
      // "3p" finds 3P% and "efg%" finds efg, wherever that is the only reading.
      return by.get(k) ?? (k.endsWith("%") ? by.get(k.slice(0, -1)) : by.get(`${k}%`)) ?? null;
    },
  };
}

type Fmt = "int" | "num1" | "num2" | "pct1";
const DIGITS: Record<Fmt, number> = { int: 0, num1: 1, num2: 2, pct1: 1 };

/**
 * A site catalog's stats (TEAM_GAME_STATS, GAME_STATS, PLAYER_STAT_COLUMNS) as
 * filter stats, named by their header: "3P%" is typed 3p, "OPP" is opp. A
 * header that is not typeable ("eFG% D", "REB±") falls back to the site's key.
 */
export function catalogStats<S extends { key: string; label: string }, R>(
  list: readonly S[],
  how: { get: (s: S) => (r: R) => number | null; fmt: (s: S) => Fmt; desc?: (s: S) => string; aliases?: Record<string, string[]> },
): FilterStat<R>[] {
  const typed = list.map((s) => {
    const l = s.label.toLowerCase().replace(/\s+/g, "");
    return /^[a-z0-9]*[a-z][a-z0-9]*%?$/.test(l) ? l : s.key.toLowerCase();
  });
  const used = new Set(typed);
  return list.map((s, i) => {
    let name = typed[i]!;
    const bare = name.slice(0, -1);
    if (name.endsWith("%") && !used.has(bare)) {
      used.add(bare);
      name = bare;
    }
    const fmt = how.fmt(s);
    return {
      name,
      aliases: [s.key, typed[i]!, ...(how.aliases?.[s.key] ?? [])],
      label: s.label,
      desc: how.desc?.(s),
      pct: fmt === "pct1",
      digits: DIGITS[fmt],
      get: how.get(s),
    };
  });
}

/** A stat's value as the table prints it, or null for a blank. */
function printed<R>(s: FilterStat<R>): (r: R) => number | null {
  const scale = s.pct ? 100 : 1;
  const f = 10 ** s.digits;
  return (r) => {
    const v = s.get(r);
    return v == null || !Number.isFinite(v) ? null : Math.round(v * scale * f) / f;
  };
}

const EPS = 1e-9;
const COMPARE: Record<Op, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b + EPS,
  ">=": (a, b) => a > b - EPS,
  "<": (a, b) => a < b - EPS,
  "<=": (a, b) => a < b + EPS,
  "=": (a, b) => Math.abs(a - b) < EPS,
};

/**
 * One test for every condition, or null when there are none. A blank fails
 * every comparison, as the site's filters decide: "3p>40" is not a team that
 * never shot a three. A stat the table does not have keeps no row, and
 * filterProblem says why.
 */
export function conditionTest<R>(index: StatIndex<R>, conditions: Condition[]): ((r: R) => boolean) | null {
  if (conditions.length === 0) return null;
  const checks: Array<(r: R) => boolean> = [];
  for (const c of conditions) {
    const s = index.find(c.name);
    if (!s) return () => false;
    const shown = printed(s);
    const cmp = COMPARE[c.op];
    checks.push((r) => {
      const v = shown(r);
      return v != null && cmp(v, c.value);
    });
  }
  return (r) => {
    for (const check of checks) if (!check(r)) return false;
    return true;
  };
}

/** Why a filter keeps nothing when the reason is the filter itself. */
export function filterProblem<R>(parsed: ParsedFilter, index: StatIndex<R>, scopes: readonly Scope[]): string | null {
  const scope = parsed.scopes.find((s) => !scopes.includes(s.scope));
  if (scope) return `This table has no “${scope.scope}:” filter.`;
  const stat = parsed.conditions.find((c) => !index.find(c.name));
  if (stat) return `No stat here is called “${stat.name}”.`;
  return null;
}

// ── Completion ────────────────────────────────────────────────────────────

/** What the box can offer while typing, for one table and season. Built once per season. */
export type FilterHelp = {
  /** "teams", "player games": what a count counts. */
  noun: string;
  stats: ReadonlyArray<FilterStat<never>>;
  find: (typed: string) => FilterStat<never> | null;
  scopes: readonly Scope[];
  names: (scope: Scope) => ReadonlyArray<readonly [name: string, folded: string]>;
  /** A stat's printed values across the season, ascending, blanks left out. */
  values: (name: string) => Float64Array;
};

export function filterHelp<R>({
  noun,
  index,
  rows,
  scopes,
  names,
}: {
  noun: string;
  index: StatIndex<R>;
  rows: readonly R[];
  scopes: readonly Scope[];
  names: Partial<Record<Scope, () => Iterable<string>>>;
}): FilterHelp {
  const valueCache = new Map<string, Float64Array>();
  const nameCache = new Map<Scope, ReadonlyArray<readonly [string, string]>>();
  return {
    noun,
    stats: index.all as FilterStat<never>[],
    find: (typed) => index.find(typed) as FilterStat<never> | null,
    scopes,
    names: (scope) => {
      let list = nameCache.get(scope);
      if (!list) {
        list = [...new Set(names[scope]?.() ?? [])].filter(Boolean).map((n) => [n, normalizeText(n)] as const);
        nameCache.set(scope, list);
      }
      return list;
    },
    values: (name) => {
      const s = index.find(name);
      if (!s) return new Float64Array(0);
      let v = valueCache.get(s.name);
      if (!v) {
        const shown = printed(s);
        const out: number[] = [];
        for (const r of rows) {
          const x = shown(r);
          if (x != null) out.push(x);
        }
        v = Float64Array.from(out).sort();
        valueCache.set(s.name, v);
      }
      return v;
    },
  };
}

/** A season's names in alphabetical order, each once. */
export const sortedNames = (names: Iterable<string>): string[] => [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b));

export type Suggestion = {
  key: string;
  /** How it will read in the box. */
  text: string;
  mono: boolean;
  label?: string;
  meta?: string;
  title?: string;
  /** The box once it is chosen, and where the caret lands. */
  value: string;
  caret: number;
};

export type Completion = { title?: string; detail?: string; items: Suggestion[]; note?: string };

const SCOPE_TEXT: Record<Scope, string> = {
  team: "One team, by its exact name",
  teams: "Several teams, with commas between",
  conf: "A conference",
  opponents: "Played against a team",
  player: "One player, by exact name",
};

const MINUS = "−";
const shownNumber = (x: number, digits: number): string => `${x < 0 ? MINUS : ""}${Math.abs(x).toFixed(digits)}`;
/** A number as it is typed: no trailing zeros, a plain hyphen. */
const typedNumber = (x: number, digits: number): string => String(Number(x.toFixed(digits)));

/** A catalog description's opening phrase, when it is short enough to sit on one line. */
function blurb(s: FilterStat<never>): string {
  const first = s.desc?.split(/ — |\. |, per |\(/)[0]?.trim().replace(/\.$/, "");
  return first && first.length <= 40 ? first : s.label;
}

function splice(query: string, start: number, end: number, text: string, space: boolean): { value: string; caret: number } {
  const rest = query.slice(end);
  const insert = space && !/^[\s,]/.test(rest) ? `${text} ` : text;
  return { value: query.slice(0, start) + insert + rest, caret: start + insert.length };
}

function countWhere(v: Float64Array, op: Op, t: number): number {
  let lo = 0;
  let hi = v.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v[mid]! < t - EPS) lo = mid + 1;
    else hi = mid;
  }
  const below = lo;
  hi = v.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v[mid]! <= t + EPS) lo = mid + 1;
    else hi = mid;
  }
  const upTo = lo;
  if (op === ">") return v.length - upTo;
  if (op === ">=") return v.length - below;
  if (op === "<") return below;
  if (op === "<=") return upTo;
  return upTo - below;
}

/** Stats a partial name could mean: the one it already names, then their own names, then aliases. */
function statsStarting(help: FilterHelp, typed: string, limit: number): FilterStat<never>[] {
  const k = fold(typed);
  const exact = help.find(typed);
  const byName = help.stats.filter((s) => fold(s.name).startsWith(k)).sort((a, b) => Number(b === exact) - Number(a === exact));
  const byAlias = help.stats.filter((s) => !byName.includes(s) && (s.aliases ?? []).some((a) => fold(a).startsWith(k)));
  return [...byName, ...byAlias].slice(0, limit);
}

/**
 * What to offer with the caret at `caret`: the stats and names a half-typed
 * word could be, the names a "conf:" can take, and, once a stat has its
 * operator, the numbers that cut the season at its tenth, quarter and half.
 */
export function completeFilter(query: string, caret: number, help: FilterHelp): Completion | null {
  const { clauses } = parseFilter(query);
  let here: Clause | undefined;
  for (const c of clauses) if (c.start <= caret && caret <= c.end) here = c;

  if (here?.kind === "scope") return completeName(query, caret, here, help);
  if (here?.kind === "stat") return completeStat(query, caret, here, help);

  // A word being typed, at its end.
  if (/\S/.test(query[caret] ?? " ")) return null;
  const start = query.slice(0, caret).search(/\S+$/);
  if (start < 0) return null;
  const token = query.slice(start, caret);
  if (token.length < 2 || /[:<>=≥≤,]/.test(token)) return null;
  const items: Suggestion[] = [];
  for (const scope of help.scopes) {
    if (!scope.startsWith(token.toLowerCase())) continue;
    items.push({ key: `scope:${scope}`, text: `${scope}:`, mono: true, label: SCOPE_TEXT[scope], ...splice(query, start, caret, `${scope}:`, true) });
  }
  for (const s of statsStarting(help, token, 8)) {
    items.push({ key: `stat:${s.name}`, text: s.name, mono: true, label: blurb(s), title: s.desc, ...splice(query, start, caret, s.name, false) });
  }
  if (items.length === 0) return null;
  return { items, note: items.some((it) => it.key.startsWith("stat:")) ? "Then > or < and a number, as the table prints it" : undefined };
}

function completeName(query: string, caret: number, c: ScopeClause, help: FilterHelp): Completion | null {
  if (caret < c.valueStart) return null;
  if (!help.scopes.includes(c.scope)) return { items: [], note: `This table has no “${c.scope}:” filter.` };
  // Several teams: only the one after the last comma is being typed.
  const typedPart = query.slice(c.valueStart, caret);
  const comma = c.scope === "teams" ? typedPart.lastIndexOf(",") : -1;
  const lead = typedPart.slice(comma + 1).search(/\S|$/);
  const start = c.valueStart + comma + 1 + lead;
  const partial = query.slice(start, caret);
  const q = normalizeText(partial);
  const list = help.names(c.scope);
  const exact: string[] = [];
  const prefix: string[] = [];
  const within: string[] = [];
  for (const [name, folded] of list) {
    if (!q) prefix.push(name);
    else if (folded === q) exact.push(name);
    else if (folded.startsWith(q)) prefix.push(name);
    else if (within.length < 40 && matchesQuery(partial, name)) within.push(name);
    if (prefix.length >= 40) break;
  }
  const names = [...exact, ...prefix, ...within].slice(0, 40);
  // Typed in full, and nothing longer begins with it: nothing left to offer.
  if (names.length === 0 || (exact.length === 1 && names.length === 1)) return null;
  const end = c.scope === "teams" ? caret + query.slice(caret, c.end).search(/,|$/) : c.end;
  return {
    items: names.map((name) => ({ key: `name:${name}`, text: name, mono: false, ...splice(query, start, end, name, true) })),
  };
}

function completeStat(query: string, caret: number, c: StatClause, help: FilterHelp): Completion | null {
  if (caret < c.start + c.name.length) return null;
  const s = help.find(c.name);
  if (!s) {
    const k = fold(c.name);
    const near = help.stats.filter((x) => fold(x.name).startsWith(k.slice(0, 2)) || k.includes(fold(x.name))).slice(0, 6);
    return {
      note: `No stat here is called “${c.name}”.`,
      items: near.map((x) => {
        const { value } = splice(query, c.start, c.start + c.name.length, x.name, false);
        return { key: `fix:${x.name}`, text: x.name, mono: true, label: blurb(x), title: x.desc, value, caret: caret + x.name.length - c.name.length };
      }),
    };
  }
  if (c.value != null) return null;

  const v = help.values(s.name);
  const title = s.label;
  const detail = s.desc && s.desc !== s.label ? s.desc : undefined;
  if (v.length === 0) return { title, detail, items: [], note: "No values this season." };
  const n = v.length;
  const at = (q: number) => v[Math.round((n - 1) * q)]!;
  const cuts: Array<[number, string]> =
    c.op === "=" ? [[0.5, "Median"]] : c.op.startsWith(">") ? [[0.9, "Highest 10%"], [0.75, "Highest 25%"], [0.5, "Highest half"]] : [[0.1, "Lowest 10%"], [0.25, "Lowest 25%"], [0.5, "Lowest half"]];
  const seen = new Set<number>();
  const items: Suggestion[] = [];
  for (const [q, label] of cuts) {
    const t = at(q);
    if (seen.has(t)) continue;
    seen.add(t);
    const num = typedNumber(t, s.digits);
    const text = `${s.name}${c.op}${num}`;
    items.push({ key: `cut:${q}`, text, mono: true, label, meta: `${countWhere(v, c.op, t).toLocaleString()} ${help.noun}`, ...splice(query, c.start, c.end, text, true) });
  }
  return { title, detail, items, note: `From ${shownNumber(v[0]!, s.digits)} to ${shownNumber(v[n - 1]!, s.digits)} across ${n.toLocaleString()} ${help.noun}` };
}
