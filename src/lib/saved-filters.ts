/**
 * Saved filters for the team explorer — a name, and the query that produced
 * the table.
 *
 * WHAT GETS SAVED IS THE URL, not a bespoke record of every control. The
 * explorer already serialises its entire state through `specToParams` —
 * seasons, conference, teams, stat filters, pinned columns, view, sort, page
 * size — because that is what makes a table shareable. A saved filter is that
 * same string with a name on it, which means this feature cannot drift out of
 * step with the explorer: anything the URL learns to carry, a saved filter
 * carries for free.
 *
 * STORED IN THE BROWSER, NOT THE ACCOUNT. The site is a static export with no
 * server of its own, so the alternative is a Supabase table with its own
 * policy — worth doing when these need to follow a reader between devices, and
 * more machinery than the feature has earned yet. The trade is stated plainly
 * in the menu rather than left for someone to discover when they open the site
 * on their phone.
 *
 * EVERY READ AND WRITE IS GUARDED. localStorage throws outright in some
 * privacy modes rather than returning null, and a saved-filter list is never
 * worth taking the page down for — a failed read is an empty list, a failed
 * write is reported to the caller so the menu can say so.
 */
import { parseSpec, teamStatColumn, type TeamFilterSpec } from "@/lib/team-filters";
import { viewByKey } from "@/lib/team-views";
import { confDisplay } from "@/lib/conf-display";

export type SavedFilter = {
  id: string;
  name: string;
  /** The explorer's query string, exactly as specToParams writes it. */
  query: string;
  /** Epoch ms, for ordering most-recent-first. */
  savedAt: number;
};

const KEY = "bta-saved-filters-v1";

/**
 * How many can be kept.
 *
 * Not a storage limit — a browsing one. Past a couple of dozen a flat list
 * stops being faster than rebuilding the query, and the menu would need
 * search, folders and a rename flow to stay usable. The cap is announced when
 * it is reached rather than silently dropping the oldest.
 */
export const MAX_SAVED = 24;

/**
 * READ AS AN EXTERNAL STORE, not copied into state on mount.
 *
 * localStorage does not exist while the page is being exported, so the count
 * on the trigger cannot be rendered from it at build time — and reading it
 * into state from an effect is exactly the cascading-render pattern React now
 * flags. useSyncExternalStore is built for this: it renders the server
 * snapshot (empty) during hydration and switches to the real one immediately
 * after, with no mismatch and no extra commit.
 *
 * It also buys cross-tab sync for nothing. Saving a filter in one tab fires a
 * `storage` event in the others, and their lists update where before they
 * would have shown a stale count until reload.
 */
const EMPTY: SavedFilter[] = [];
const listeners = new Set<() => void>();

/** Cached against the raw string so getSnapshot returns a STABLE reference —
 *  a fresh array each call makes React re-render without end. */
let snapRaw: string | null = null;
let snapVal: SavedFilter[] = EMPTY;

function parseList(raw: string): SavedFilter[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    // Validated field by field: this is data a previous version of the site
    // wrote, and a half-shaped entry should be dropped rather than rendered as
    // a row that does nothing when clicked.
    const ok = parsed.filter((e): e is SavedFilter =>
      !!e && typeof e === "object" &&
      typeof (e as SavedFilter).id === "string" &&
      typeof (e as SavedFilter).name === "string" &&
      typeof (e as SavedFilter).query === "string" &&
      typeof (e as SavedFilter).savedAt === "number");
    return ok.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return EMPTY;
  }
}

export function savedSnapshot(): SavedFilter[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Some privacy modes throw on access rather than returning null.
    return EMPTY;
  }
  if (raw === snapRaw) return snapVal;
  snapRaw = raw;
  snapVal = raw ? parseList(raw) : EMPTY;
  return snapVal;
}

/** Always empty: nothing is saved at export time, and this is what hydration
 *  matches against. */
export function savedServerSnapshot(): SavedFilter[] {
  return EMPTY;
}

export function subscribeSaved(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** True when the list was written. False means storage refused it. */
export function writeSaved(list: SavedFilter[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  for (const fn of listeners) fn();
  return true;
}

function newId(): string {
  // crypto.randomUUID is not in every browser this site supports; the fallback
  // only has to be unique within one reader's own list.
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `sf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Add or replace by name.
 *
 * SAVING OVER AN EXISTING NAME UPDATES IT. Two entries called "Fast + tall"
 * pointing at different queries is a list nobody can use, and an explicit
 * rename step to avoid that would be a second dialog on a one-field form.
 */
export function upsertSaved(list: SavedFilter[], name: string, query: string): SavedFilter[] {
  const trimmed = name.trim();
  const at = list.findIndex((e) => e.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedFilter = {
    id: at >= 0 ? list[at]!.id : newId(),
    name: trimmed,
    query,
    savedAt: Date.now(),
  };
  const next = at >= 0 ? list.map((e, i) => (i === at ? entry : e)) : [entry, ...list];
  return next.sort((a, b) => b.savedAt - a.savedAt);
}

export function removeSaved(list: SavedFilter[], id: string): SavedFilter[] {
  return list.filter((e) => e.id !== id);
}

// ---------------------------------------------------------------------------
// describing a saved query
// ---------------------------------------------------------------------------

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

function specOf(query: string): TeamFilterSpec {
  const obj: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query).entries()) obj[k] = v;
  return parseSpec(obj);
}

/**
 * The one-line read-out under each saved name.
 *
 * A NAME ALONE IS NOT ENOUGH. These are saved weeks apart and "tall teams" is
 * not a query — the summary is what tells you whether this is the one that had
 * the conference narrowed, before you click it and lose the table you are
 * looking at.
 *
 * Ordered widest-scope-first: seasons, then who, then what, then how it is
 * dressed. Anything at its default is left out, so a summary only ever names
 * something the reader actually chose.
 */
export function describeQuery(query: string): string {
  const spec = specOf(query);
  const parts: string[] = [];

  if (spec.years.length === 1) parts.push(seasonLabel(spec.years[0]!));
  else parts.push(`${spec.years.length} seasons`);

  if (spec.teams.length === 1) parts.push(spec.teams[0]!);
  else if (spec.teams.length > 1) parts.push(`${spec.teams.length} teams`);

  if (spec.conf.length === 1) parts.push(confDisplay(spec.conf[0]!));
  else if (spec.conf.length > 1) parts.push(`${spec.conf.length} conferences`);

  if (spec.filters.length) {
    parts.push(`${spec.filters.length} filter${spec.filters.length === 1 ? "" : "s"}`);
  }
  if (spec.cols.length) {
    parts.push(`+${spec.cols.length} column${spec.cols.length === 1 ? "" : "s"}`);
  }
  if (spec.view) parts.push(viewByKey(spec.view).label);

  return parts.join(" · ");
}

/**
 * The name the save box opens with.
 *
 * Built from the most specific thing the query does, because that is what the
 * reader was thinking about when they built it. A stat filter beats a
 * conference beats a view beats the bare season — and the first filter's own
 * wording ("Pace ≥ 70") is used verbatim, so the suggestion reads as a
 * description rather than as a slot-filled template.
 */
export function suggestName(spec: TeamFilterSpec): string {
  const OP: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
  const first = spec.filters[0];
  if (first) {
    const meta = teamStatColumn(first.stat);
    const shown = meta?.format === "pct1"
      ? `${Math.round(first.value * 1000) / 10}%`
      : String(first.value);
    const base = `${meta?.label ?? first.stat} ${OP[first.op] ?? first.op} ${shown}`;
    const more = spec.filters.length - 1;
    return more > 0 ? `${base} +${more}` : base;
  }
  if (spec.conf.length === 1) return `${confDisplay(spec.conf[0]!)}, ${describeSeasons(spec)}`;
  if (spec.teams.length === 1) return `${spec.teams[0]}, ${describeSeasons(spec)}`;
  if (spec.view) return `${viewByKey(spec.view).label}, ${describeSeasons(spec)}`;
  return describeSeasons(spec);
}

function describeSeasons(spec: TeamFilterSpec): string {
  return spec.years.length === 1
    ? seasonLabel(spec.years[0]!)
    : `${spec.years.length} seasons`;
}
