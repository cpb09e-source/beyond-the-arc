import { useEffect, useState } from "react";

/**
 * Find Similar's saved teams and players: the ones a reader keeps coming back
 * to, one pick away from their matches again.
 *
 * ON THIS COMPUTER, like recents, and one list for every tab and pane: a save
 * announces itself, so the pane beside this one shows it at once.
 *
 * A SEASON EACH. Houston 2024-25 and Houston 2025-26 are two saves, because they
 * are two profiles with two sets of matches.
 */

export type SubjectRef =
  | { kind: "team"; year: number; name: string; logoId: number | null }
  | { kind: "player"; year: number; bartId: number; name: string; team: string; hasPhoto: boolean };

export type SavedSubject = SubjectRef & { at: number };

const KEY = "bta.similar.saved";
const EVENT = "bta:similar-saved";
const CAP = 200;

export const savedKey = (s: SubjectRef): string => (s.kind === "team" ? `team|${s.year}|${s.name}` : `player|${s.year}|${s.bartId}`);

function isSaved(v: unknown): v is SavedSubject {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.year !== "number" || typeof o.name !== "string" || typeof o.at !== "number") return false;
  if (o.kind === "team") return o.logoId === null || typeof o.logoId === "number";
  if (o.kind === "player") return typeof o.bartId === "number" && typeof o.team === "string" && typeof o.hasPhoto === "boolean";
  return false;
}

function read(): SavedSubject[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isSaved) : [];
  } catch {
    return [];
  }
}

function write(list: SavedSubject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* not kept; the list simply stays as it was */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Saves it, newest first, or takes it out when it is already saved. Returns whether it is saved now. */
export function toggleSaved(s: SubjectRef): boolean {
  const key = savedKey(s);
  const list = read();
  if (list.some((x) => savedKey(x) === key)) {
    write(list.filter((x) => savedKey(x) !== key));
    return false;
  }
  write([{ ...s, at: Date.now() }, ...list]);
  return true;
}

export function useSavedSubjects(): SavedSubject[] {
  const [list, setList] = useState(read);
  useEffect(() => {
    const on = () => setList(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return list;
}
