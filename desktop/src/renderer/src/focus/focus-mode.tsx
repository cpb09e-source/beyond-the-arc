import { Lock, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { confDisplay } from "@/lib/conf-display";
import { overrideTeam } from "@/lib/win-calc";
import { isObj, type Obj } from "~/objects/object";
import { recordStep } from "~/shell/research-history";
import { ConfLogo } from "~/ui/conf-logo";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { markHintUsed } from "~/ui/key-hints";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { scopedQuery } from "~/ui/scoped-query";
import { parseCalc, serializeCalc } from "~/views/win-calc/calc-state";

/**
 * Focus: the whole workspace follows one object while a key is held.
 *
 * POINT AT MICHIGAN AND HOLD Q. Every open pane that can say something about
 * Michigan does, at once: the Team Explorer lights its row, the scatter isolates
 * its crest, a game log becomes its games, the Player Explorer its roster, the
 * Scoreboard steps every other game back and marks its nights. Let go and every
 * pane is as it was. A tap instead of a hold keeps it on until Q or Esc.
 *
 * A LAYER, NOT A NAVIGATION. Nothing is written: no pane's query, history, sort,
 * favorite or selection changes. A following pane is handed a stand-in query
 * (focusQuery) or reads the subject (useFocusSubject) and draws from it, which
 * is why letting go costs nothing.
 *
 * TEAMS, PLAYERS AND CONFERENCES. A game log row focuses its player, or its
 * team; a coach focuses the school. A game names two teams and focuses neither.
 */

export type FocusSubject =
  | { kind: "team"; name: string; logoId: number | null; year: number; conf?: string }
  | {
      kind: "player";
      bartId: number;
      name: string;
      hasPhoto: boolean;
      year: number;
      team?: string;
      teamLogoId?: number | null;
      conf?: string;
    }
  | { kind: "conference"; conf: string; label: string; year: number };

export type FocusMode = { subject: FocusSubject; locked: boolean };

type FocusCtx = {
  mode: FocusMode | null;
  start: (subject: FocusSubject, locked: boolean) => void;
  lock: () => void;
  release: () => void;
};

const Ctx = createContext<FocusCtx>({ mode: null, start: () => {}, lock: () => {}, release: () => {} });

export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<FocusMode | null>(null);
  const start = useCallback((subject: FocusSubject, locked: boolean) => {
    recordStep({ kind: "focus", title: `Focused ${subject.kind === "conference" ? subject.label : subject.name}`, obj: subject });
    markHintUsed("focus");
    setMode({ subject, locked });
  }, []);
  const lock = useCallback(() => setMode((m) => (m ? { ...m, locked: true } : m)), []);
  const release = useCallback(() => setMode(null), []);
  const value = useMemo(() => ({ mode, start, lock, release }), [mode, start, lock, release]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFocusMode = (): FocusCtx => useContext(Ctx);
export const useFocusSubject = (): FocusSubject | null => useContext(Ctx).mode?.subject ?? null;

/** What an object focuses, if anything. `year` places a coach's school, which carries no season. */
export function subjectOf(o: Obj, year: number): FocusSubject | null {
  switch (o.kind) {
    case "team":
      return { kind: "team", name: o.name, logoId: o.logoId, year: o.year, conf: o.conf };
    case "player":
      return { kind: "player", bartId: o.bartId, name: o.name, hasPhoto: o.hasPhoto, year: o.year, team: o.team, teamLogoId: o.teamLogoId, conf: o.conf };
    case "conference":
      return { kind: "conference", conf: o.conf, label: o.label, year: o.year };
    case "log-game":
      return o.player
        ? { kind: "player", bartId: o.player.bartId, name: o.player.name, hasPhoto: o.player.hasPhoto, year: o.year, team: o.team, teamLogoId: o.teamLogoId }
        : { kind: "team", name: o.team, logoId: o.teamLogoId, year: o.year };
    case "coach":
      return o.team ? { kind: "team", name: o.team, logoId: null, year } : null;
    case "game":
      return null;
  }
}

/** The school a subject is about: the team, or a player's team. */
export const focusTeam = (s: FocusSubject | null): string | null =>
  !s ? null : s.kind === "team" ? s.name : s.kind === "player" ? (s.team ?? null) : null;

/** A conference, by code and by the words a filter uses, when the subject names one. */
export function focusConf(s: FocusSubject | null): { conf: string; label: string } | null {
  if (!s) return null;
  if (s.kind === "conference") return { conf: s.conf, label: s.label };
  return s.conf ? { conf: s.conf, label: confDisplay(s.conf) } : null;
}

/** Whether a conference, written as a code or as its name, is this one. */
export const sameConf = (c: { conf: string; label: string }, code: string | null | undefined): boolean =>
  !!code && (code === c.conf || confDisplay(code) === c.label);

/**
 * The stand-in query a following pane is given, in the words its filter already
 * reads ("team: Michigan"), so the pane needs no code of its own and its filter
 * box says why the rows are the rows. Undefined: the pane reads the subject
 * itself, or does not follow.
 */
export function focusQuery(viewId: string, s: FocusSubject, query: string): string | undefined {
  const team = focusTeam(s);
  switch (viewId) {
    case "team-explorer":
      // One team is lit in place (the view reads the subject); a conference narrows the table.
      return s.kind === "conference" ? scopedQuery("conf", s.label) : undefined;
    case "team-game-log":
      return s.kind === "conference" ? scopedQuery("conf", s.label) : team ? scopedQuery("team", team) : undefined;
    case "player-explorer":
      return s.kind === "conference" ? scopedQuery("conf", s.label) : team ? scopedQuery("team", team) : scopedQuery("player", s.name);
    case "player-game-log":
      return s.kind === "player" ? scopedQuery("player", s.name) : s.kind === "conference" ? scopedQuery("conf", s.label) : scopedQuery("team", s.name);
    case "win-calc": {
      // The question stays; whose games it asks about changes.
      const calc = parseCalc(query);
      if (s.kind === "conference") return serializeCalc({ ...calc, teams: [], coaches: [], conferences: [s.conf] });
      return team ? serializeCalc({ ...calc, teams: [overrideTeam(team)], coaches: [], conferences: [] }) : undefined;
    }
    default:
      return undefined;
  }
}

/** Whether a pane of this view has anything to show about the subject. */
export function follows(viewId: string, s: FocusSubject): boolean {
  switch (viewId) {
    case "player-explorer":
    case "player-game-log":
      return true;
    case "team-explorer":
    case "team-game-log":
    case "team-scatter":
    case "scoreboard":
    case "win-calc":
      return s.kind === "conference" || focusTeam(s) != null;
    case "conferences":
      return focusConf(s) != null;
    default:
      return false;
  }
}

function objectOfHost(host: Element | null): Obj | null {
  const raw = host instanceof HTMLElement ? host.dataset.obj : undefined;
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The object under a point: whatever declares one with data-obj (a row, a crest, a name). */
export const objectAt = (x: number, y: number): Obj | null => objectOfHost(document.elementFromPoint(x, y)?.closest("[data-obj]") ?? null);

/** A tab's focused table row, for Q pressed with the pointer over nothing. */
export const focusedRowObject = (tabId: string): Obj | null =>
  objectOfHost(document.querySelector(`[data-tab="${CSS.escape(tabId)}"] [data-row-focus][data-obj]`));

/**
 * The strip at the foot of the workspace while a focus is on: who, how many
 * panes follow, and the way out. At the foot, above the selection bar and the
 * compare tray (`bottom`), because at the top it covered the panes' filters.
 */
export function FocusPill({ mode, following, bottom, onRelease }: { mode: FocusMode; following: number; bottom: number; onRelease: () => void }) {
  const s = mode.subject;
  const name = s.kind === "conference" ? s.label : s.name;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4" style={{ bottom }}>
      <div
        role="status"
        aria-label="Focus"
        className="fade-in pointer-events-auto flex h-[34px] min-w-0 max-w-full items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-card pl-1.5 pr-1 text-[12.5px]"
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <span className="grid size-[24px] shrink-0 place-items-center">
          {s.kind === "team" ? (
            <TeamLogo id={s.logoId} name={s.name} size={20} />
          ) : s.kind === "player" ? (
            <PlayerPhoto bartId={s.bartId} hasPhoto={s.hasPhoto} name={s.name} size={24} />
          ) : (
            <ConfLogo conf={s.conf} size={20} />
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-accent">Focus</span>
          <span className="truncate font-semibold text-ink">{name}</span>
          <span className="shrink-0 text-ink-muted tabular">{seasonLabel(s.year)}</span>
        </span>
        <span className="hidden shrink-0 text-ink-muted @3xl:inline">
          · {following === 0 ? "no open pane follows" : following === 1 ? "1 pane following" : `${following} panes following`}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-muted">
          {mode.locked ? (
            <>
              <Lock size={12} strokeWidth={2} />
              <Kbd>Esc</Kbd>
            </>
          ) : (
            <>
              release <Kbd>Q</Kbd>
            </>
          )}
        </span>
        <button
          type="button"
          aria-label="Let the focus go"
          title="Let the focus go  ·  Q or Esc"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRelease}
          className="grid size-[24px] shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
