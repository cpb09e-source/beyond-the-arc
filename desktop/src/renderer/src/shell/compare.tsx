import { ArrowRight, GitCompareArrows, X } from "lucide-react";
import { carriesObject, droppedObject, objectDrag, type DragSpec, type Obj } from "~/objects/object";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { TeamLogo } from "~/ui/logo";
import { usePersisted } from "~/ui/persisted";
import { PlayerPhoto } from "~/ui/player-photo";
import { useToast } from "~/ui/toast";

/**
 * The compare tray: up to four teams or players, from any seasons, gathered
 * from wherever they were found and opened side by side in a Compare tab.
 *
 * GATHERED THREE WAYS, so it is there however someone works: C on a focused row
 * in an explorer, a row dragged onto the tray, or Compare on a team or player
 * page. The tray is one kind at a time; a team added to a tray of players starts
 * it over, and says so.
 *
 * THE TRAY IS NOT THE COMPARISON. Opening it writes its items into a Compare
 * tab's query, so two tabs can hold two comparisons, history restores one, and
 * the tray is free to be filled again.
 */

export type CompareItem =
  | { kind: "team"; name: string; logoId: number | null; year: number }
  | { kind: "player"; bartId: number; name: string; hasPhoto: boolean; year: number };

export type CompareRef = { year: number; id: string };

export const COMPARE_MAX = 4;
export const COMPARE_DRAG_TYPE = "application/x-bta-compare";

const idOf = (it: CompareItem): string => (it.kind === "team" ? it.name : String(it.bartId));
const sameItem = (a: CompareItem, b: CompareItem) => a.kind === b.kind && a.year === b.year && idOf(a) === idOf(b);
const shortSeason = (y: number) => `${String(y - 1).slice(2)}-${String(y).slice(2)}`;

export function isCompareItem(v: unknown): v is CompareItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.year !== "number" || typeof o.name !== "string") return false;
  if (o.kind === "team") return o.logoId === null || typeof o.logoId === "number";
  if (o.kind === "player") return typeof o.bartId === "number" && typeof o.hasPhoto === "boolean";
  return false;
}

/** A comparison as a tab's query: k=team&i=2026:Duke&i=2015:Duke. */
export function compareRefsQuery(kind: CompareItem["kind"], refs: CompareRef[]): string {
  const q = new URLSearchParams();
  q.set("k", kind);
  for (const r of refs.slice(0, COMPARE_MAX)) q.append("i", `${r.year}:${r.id}`);
  return q.toString();
}

export const compareQuery = (items: CompareItem[]): string =>
  compareRefsQuery(items[0]?.kind ?? "team", items.map((it) => ({ year: it.year, id: idOf(it) })));

export function parseCompareQuery(query: string): { kind: CompareItem["kind"]; refs: CompareRef[] } {
  const q = new URLSearchParams(query);
  const kind = q.get("k") === "player" ? "player" : "team";
  const refs = q
    .getAll("i")
    .flatMap((s): CompareRef[] => {
      const at = s.indexOf(":");
      const year = Number(s.slice(0, at));
      const id = s.slice(at + 1);
      return at > 0 && Number.isInteger(year) && id ? [{ year, id }] : [];
    })
    .slice(0, COMPARE_MAX);
  return { kind, refs };
}

/** What a dragged row carries to the tray: the object itself, which the tray and every other drop target read. */
export const compareDrag = (item: CompareItem): DragSpec => objectDrag(item);

/** The tray's item for a dropped object: a team or player, or whose game a game log row was. */
export function compareItemOf(o: Obj): CompareItem | null {
  if (o.kind === "team") return { kind: "team", name: o.name, logoId: o.logoId, year: o.year };
  if (o.kind === "player") return { kind: "player", bartId: o.bartId, name: o.name, hasPhoto: o.hasPhoto, year: o.year };
  if (o.kind === "log-game") return o.player ? { kind: "player", ...o.player, year: o.year } : { kind: "team", name: o.team, logoId: o.teamLogoId, year: o.year };
  return null;
}

type Compare = {
  items: CompareItem[];
  add: (item: CompareItem) => void;
  remove: (index: number) => void;
  clear: () => void;
};

const CompareContext = createContext<Compare>({ items: [], add: () => {}, remove: () => {}, clear: () => {} });

export const useCompare = (): Compare => useContext(CompareContext);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = usePersisted<CompareItem[]>(
    "bta.compare",
    [],
    (v): v is CompareItem[] => Array.isArray(v) && v.length <= COMPARE_MAX && v.every(isCompareItem),
  );
  const toast = useToast();

  const add = useCallback(
    (item: CompareItem) => {
      if (items.some((c) => sameItem(c, item))) {
        toast({ title: `${item.name} ${shortSeason(item.year)} is already in the tray` });
        return;
      }
      if (items.length > 0 && items[0]!.kind !== item.kind) {
        setItems([item]);
        toast({
          title: "The tray holds teams or players, not both",
          body: `It started over with ${item.name}.`,
        });
        return;
      }
      const next = [...items, item];
      if (next.length > COMPARE_MAX) {
        toast({ title: `The tray holds ${COMPARE_MAX}`, body: `${next[0]!.name} made room for ${item.name}.` });
      }
      setItems(next.slice(-COMPARE_MAX));
    },
    [items, setItems, toast],
  );

  const value = useMemo<Compare>(
    () => ({
      items,
      add,
      remove: (i) => setItems((cur) => cur.filter((_, j) => j !== i)),
      clear: () => setItems([]),
    }),
    [items, add, setItems],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

/**
 * The tray itself, floating over the bottom of the window while it holds
 * anything, and while a row is being dragged, so there is somewhere to drop it.
 */
export function CompareDock({
  hidden = false,
  lift = false,
  onOpen,
}: {
  /** The selection bar has the bottom edge: the tray sits above it. */
  lift?: boolean;
  /** The tab in front already shows this tray's comparison. A drag still brings the tray back. */
  hidden?: boolean;
  onOpen: (items: CompareItem[], newTab: boolean) => void;
}) {
  const { items, add, remove, clear } = useCompare();
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const carries = (e: DragEvent) => carriesObject(e.dataTransfer);
    const onEnter = (e: DragEvent) => {
      if (carries(e)) setDragging(true);
    };
    const onEnd = () => {
      setDragging(false);
      setOver(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  if ((items.length === 0 || hidden) && !dragging) return null;
  const noun = items[0]?.kind === "player" ? "players" : "teams";

  return (
    <div className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${lift ? "bottom-[64px]" : "bottom-4"}`}>
      <div
        role="region"
        aria-label="Compare tray"
        onDragOver={(e) => {
          if (!carriesObject(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          const o = droppedObject(e.dataTransfer);
          const item = o ? compareItemOf(o) : null;
          if (item) add(item);
          setOver(false);
          setDragging(false);
        }}
        className={`toast-in pointer-events-auto flex max-w-full items-center gap-1.5 rounded-xl border bg-card p-1.5 transition-colors ${
          over ? "border-accent" : "border-hairline"
        }`}
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <span className="flex shrink-0 items-center gap-1.5 px-2 text-[12px] font-medium text-ink-soft">
          <GitCompareArrows size={14} strokeWidth={2} />
          Compare
        </span>
        {items.map((it, i) => (
          <span
            key={`${it.kind}:${idOf(it)}:${it.year}`}
            className="flex h-[30px] min-w-0 items-center gap-2 rounded-lg bg-paper pl-1.5 pr-1 text-[12.5px] text-ink"
          >
            {it.kind === "team" ? (
              <TeamLogo id={it.logoId} name={it.name} size={18} />
            ) : (
              <PlayerPhoto bartId={it.bartId} hasPhoto={it.hasPhoto} name={it.name} size={20} />
            )}
            <span className="max-w-[140px] truncate">{it.name}</span>
            <span className="text-[11px] text-ink-muted tabular">{shortSeason(it.year)}</span>
            <button
              type="button"
              aria-label={`Remove ${it.name} from the tray`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(i)}
              className="grid size-5 place-items-center rounded text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
            >
              <X size={12} strokeWidth={2.25} />
            </button>
          </span>
        ))}
        {Array.from({ length: Math.max(0, 2 - items.length) }, (_, i) => (
          <span
            key={`slot-${i}`}
            className={`flex h-[30px] shrink-0 items-center rounded-lg border border-dashed px-3 text-[12px] ${
              over ? "border-accent text-accent" : "border-hairline text-ink-muted"
            }`}
          >
            {dragging ? "Drop here" : "Press C on a row"}
          </span>
        ))}
        <button
          type="button"
          disabled={items.length < 2}
          title="Ctrl-click for a new tab"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onOpen(items, e.ctrlKey || e.metaKey)}
          className="ml-1 inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
        >
          Compare {items.length > 1 ? `${items.length} ${noun}` : ""}
          <ArrowRight size={13} strokeWidth={2} />
        </button>
        {items.length > 0 && (
          <button
            type="button"
            aria-label="Empty the tray"
            title="Empty the tray"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            className="grid size-[30px] shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
