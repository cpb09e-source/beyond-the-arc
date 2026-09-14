import { LIVE_SEASON } from "@/lib/seasons";
import type { Obj } from "~/objects/object";
import type { TableLayout } from "./table-layout";
import type { RecordRef } from "./views";

/**
 * Research history: the steps of an analysis, in the words a person would use.
 *
 * NOT BACK AND FORWARD. A tab's history walks its places; this keeps what the
 * reader did across every tab: "Michigan: what changed", "Compare Michigan",
 * "Focused Duke", "Duke at North Carolina", "Stat Lens: Duke, Offensive rating".
 *
 * WRITTEN NOW, READ LATER. Nothing shows it yet. A history panel that jumps
 * back to any step, and Save Trail, which turns a stretch of steps into a named
 * analysis, both need months of these already on disk the day they are built,
 * so capture comes first, and in the shape they will need.
 *
 * A VERSIONED EVENT LOG, NOT DISPLAY TEXT. A step keeps the words a list would
 * show and the state behind them: where the reader was (view, season, filter,
 * table layout, record), the object, the action's id, a selection's season and
 * teams, a lens's stat, an export's format and rows, the tab, and the sitting it
 * happened in. `v` names the shape; steps written before it read as version 0.
 *
 * LIVE NUMBERS MOVE. A step on the live season is marked `live`, so a trail
 * replayed after a nightly refresh can say its numbers have changed since `at`.
 * A frozen season replays exactly.
 *
 * ONE PLACE PER KIND OF STEP. Registry actions record themselves
 * (~/objects/actions.tsx and ~/selection/selection-actions.tsx wrap their
 * runs), Focus and the Stat Lens record from their providers, exports from where
 * they are saved, and visits from the frame once a tab has settled. The frame
 * also keeps setHistoryContext current, so a step that names no place of its
 * own takes the place and tab it happened in.
 *
 * ON THIS COMPUTER, AND BOUNDED: localStorage, the newest 2,000 steps, written
 * in a batch a moment after the last step rather than on every one.
 */

export const HISTORY_VERSION = 1;

export type HistoryPlace = { viewId: string; year: number; query: string; record?: RecordRef; table?: TableLayout };

export type ResearchStep = {
  /** The shape of this step: 1 today, 0 for steps written before the version existed. */
  v: number;
  at: number;
  /** One run of the app. Steps sharing it were taken in one sitting. */
  session: string;
  /** The tab the step happened in. */
  tab?: string;
  kind: "visit" | "action" | "selection" | "focus" | "lens" | "export";
  /** How a history list would say it. */
  title: string;
  /** Where the reader was, enough to open it again. For a visit, the place itself. */
  place?: HistoryPlace;
  /** The object an action, a focus or a lens was about. */
  obj?: Obj;
  /** The registry action's id. */
  action?: string;
  /** The teams a selection action ran on: within a season, a team's name is its id. Season 0 when not recorded. */
  selection?: { year: number; names: string[] };
  /** The stat a lens broke down. */
  stat?: string;
  /** What a download or a copy carried. */
  export?: { format: "xlsx" | "xlsx-views" | "csv" | "tsv"; rows?: number; name?: string };
  /** The step's season was live when it was taken. */
  live?: true;
};

/** What a caller records; the version, time, sitting, tab and live mark are added here. */
export type StepInput = Pick<ResearchStep, "kind" | "title"> &
  Partial<Pick<ResearchStep, "place" | "obj" | "action" | "selection" | "stat" | "export">>;

const KEY = "bta.research-history";
const CAP = 2000;
const FLUSH_MS = 1500;
/** The same step again this soon is the same step: a menu clicked twice, Q tapped twice. */
const SAME_MS = 2000;

const SESSION =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let steps: ResearchStep[] | null = null;
let timer: number | null = null;
let context: { tab?: string; place?: HistoryPlace } = {};

/** Where the reader is now. The frame calls it whenever the tab in front changes place. */
export function setHistoryContext(next: { tab: string; place: HistoryPlace }): void {
  context = next;
}

const seasonOf = (o: Obj | undefined): number | undefined => (!o ? undefined : o.kind === "game" ? o.season : "year" in o ? o.year : undefined);

/** A stored step in today's shape; null for anything unreadable. */
function upgrade(raw: unknown): ResearchStep | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ResearchStep> & { names?: unknown };
  if (typeof s.at !== "number" || typeof s.kind !== "string" || typeof s.title !== "string") return null;
  if (s.v === HISTORY_VERSION) return s as ResearchStep;
  // Version 0, before 2026-09-14: no sitting or tab, and a selection's names without their season.
  const { names, ...rest } = s;
  const year = rest.place?.year ?? seasonOf(rest.obj) ?? 0;
  return {
    ...(rest as ResearchStep),
    v: 0,
    session: "before-v1",
    ...(Array.isArray(names) ? { selection: { year, names: names.filter((n): n is string => typeof n === "string") } } : {}),
  };
}

function load(): ResearchStep[] {
  if (steps) return steps;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    steps = Array.isArray(v) ? v.map(upgrade).filter((s): s is ResearchStep => s !== null) : [];
  } catch {
    steps = [];
  }
  return steps;
}

function flush(): void {
  timer = null;
  if (!steps) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(steps.slice(-CAP)));
  } catch {
    /* not kept; the app works the same without it */
  }
}

export function recordStep(input: StepInput): void {
  const list = load();
  const now = Date.now();
  const place = input.place ?? context.place;
  const year = seasonOf(input.obj) ?? input.selection?.year ?? place?.year;
  const step: ResearchStep = {
    v: HISTORY_VERSION,
    at: now,
    session: SESSION,
    ...(context.tab ? { tab: context.tab } : {}),
    ...input,
    ...(place ? { place } : {}),
    ...(LIVE_SEASON != null && year === LIVE_SEASON ? { live: true as const } : {}),
  };
  const last = list[list.length - 1];
  if (last && last.kind === step.kind && last.title === step.title && now - last.at < SAME_MS) last.at = now;
  else list.push(step);
  if (list.length > CAP + 100) list.splice(0, list.length - CAP);
  if (timer == null) timer = window.setTimeout(flush, FLUSH_MS);
}

/** Every step kept, oldest first. */
export const researchHistory = (): ResearchStep[] => [...load()];

// A step taken just before the window closes is still written.
if (typeof window !== "undefined") window.addEventListener("beforeunload", flush);
