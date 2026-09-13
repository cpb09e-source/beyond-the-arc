import type { Obj } from "~/objects/object";
import type { RecordRef } from "./views";

/**
 * Research history: the steps of an analysis, in the words a person would use.
 *
 * NOT BACK AND FORWARD. A tab's history walks its places; this keeps what the
 * reader did across every tab: "Michigan: what changed", "Compare Michigan",
 * "Focused Duke", "Duke at North Carolina", "Stat Lens: Duke, Offensive rating".
 *
 * WRITTEN NOW, READ LATER. Nothing shows it yet. A history panel that jumps
 * back to any step, and replaying an analysis, both need months of these
 * already on disk the day they are built, so capture comes first.
 *
 * ONE PLACE PER KIND OF STEP. Registry actions record themselves
 * (~/objects/actions.tsx and ~/selection/selection-actions.tsx wrap their
 * runs), Focus and the Stat Lens record from their providers, exports from the
 * app, and visits from the frame once a tab has settled.
 *
 * ON THIS COMPUTER, AND BOUNDED: localStorage, the newest 2,000 steps, written
 * in a batch a moment after the last step rather than on every one.
 */

export type ResearchStep = {
  at: number;
  kind: "visit" | "action" | "selection" | "focus" | "lens" | "export";
  /** How a history list would say it. */
  title: string;
  /** Where a visit was: enough to open it again. */
  place?: { viewId: string; year: number; query: string; record?: RecordRef };
  /** The object an action, a focus or a lens was about. */
  obj?: Obj;
  /** The registry action's id. */
  action?: string;
  /** The teams a selection action ran on. */
  names?: string[];
  /** The stat a lens broke down. */
  stat?: string;
};

const KEY = "bta.research-history";
const CAP = 2000;
const FLUSH_MS = 1500;
/** The same step again this soon is the same step: a menu clicked twice, Q tapped twice. */
const SAME_MS = 2000;

let steps: ResearchStep[] | null = null;
let timer: number | null = null;

function load(): ResearchStep[] {
  if (steps) return steps;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    steps = Array.isArray(v) ? (v as ResearchStep[]) : [];
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

export function recordStep(step: Omit<ResearchStep, "at">): void {
  const list = load();
  const now = Date.now();
  const last = list[list.length - 1];
  if (last && last.kind === step.kind && last.title === step.title && now - last.at < SAME_MS) last.at = now;
  else list.push({ ...step, at: now });
  if (list.length > CAP + 100) list.splice(0, list.length - CAP);
  if (timer == null) timer = window.setTimeout(flush, FLUSH_MS);
}

/** Every step kept, oldest first. */
export const researchHistory = (): ResearchStep[] => [...load()];

// A step taken just before the window closes is still written.
if (typeof window !== "undefined") window.addEventListener("beforeunload", flush);
