import { Columns2, Ellipsis, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DetailAction, howOf } from "~/ui/details";
import { HeaderButton } from "~/ui/profile";
import { actionById, actionsFor, iconOf, type ActionGroup, type Local } from "./actions";
import { beginDrag } from "./drag";
import { carriesObject, droppedObject, objectDrag, recordOf, type Obj } from "./object";
import { useActionEnv, useObjectDragging, useObjectMenu } from "./use-object-actions";

/**
 * The small pieces every surface uses to show an object's actions, so a record
 * page, a Peek, the details rail and a name in a sentence all behave alike.
 */

/**
 * A name that is also the object: click opens it (Ctrl for a new tab, Shift
 * beside), right-click shows its menu, and it can be dragged to the tray, a tab
 * or the other pane.
 */
export function ObjectLink({ obj, title, className, children }: { obj: Obj; title?: string; className?: string; children: ReactNode }) {
  const env = useActionEnv();
  const menu = useObjectMenu();
  return (
    <button
      type="button"
      data-obj={JSON.stringify(obj)}
      title={title ?? "Ctrl-click for a new tab  ·  right-click for more"}
      draggable
      onDragStart={(e) => beginDrag(e, objectDrag(obj))}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => actionById("open")?.run(obj, env, howOf(e), {})}
      onContextMenu={(e) => menu(e, obj)}
      className={className}
    >
      {children}
    </button>
  );
}

/** The ⋯ button: the object's whole menu, below the button. */
export function MoreButton({ obj, local, className = "" }: { obj: Obj; local?: Local; className?: string }) {
  const menu = useObjectMenu();
  return (
    <button
      type="button"
      aria-label="More actions"
      title="More actions  ·  or right-click"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu({ x: r.left, y: r.bottom + 4 }, obj, local);
      }}
      className={`grid size-[26px] shrink-0 place-items-center rounded-md border border-hairline bg-card text-ink-muted transition-colors hover:border-ink-muted hover:text-ink ${className}`}
    >
      <Ellipsis size={15} strokeWidth={2} />
    </button>
  );
}

/** A record page's header: its most used actions as buttons, then ⋯ for the rest. */
export function RecordActions({ obj, primary }: { obj: Obj | null; primary: string[] }) {
  const env = useActionEnv();
  if (!obj) return null;
  return (
    <>
      {primary.map((id) => {
        const a = actionById(id);
        if (!a || !a.when(obj, env, {})) return null;
        const Icon = iconOf(a, obj, env);
        return (
          <HeaderButton key={id} title={`${a.phrase(obj, env)}  ·  Ctrl-click for a new tab`} onClick={(e) => a.run(obj, env, howOf(e), {})}>
            <Icon size={14} strokeWidth={2} />
            {a.short ?? a.label(obj, env)}
          </HeaderButton>
        );
      })}
      <MoreButton obj={obj} />
    </>
  );
}

/** The details rail's "Go to" and "Share": the same actions, as the rail's quiet rows. */
export function RailActions({ obj, groups }: { obj: Obj; groups: ActionGroup[] }) {
  const env = useActionEnv();
  const list = actionsFor(obj, env).filter((a) => groups.includes(a.group));
  return (
    <>
      {list.map((a) => {
        const Icon = iconOf(a, obj, env);
        return (
          <DetailAction
            key={a.id}
            icon={<Icon size={14} strokeWidth={2} />}
            label={a.label(obj, env)}
            hint={a.aside}
            title={`${a.phrase(obj, env)}  ·  Ctrl-click for a new tab`}
            onOpen={(how) => a.run(obj, env, how, {})}
          />
        );
      })}
    </>
  );
}

const PEEK_PRIMARY = ["open", "open-side", "compare"];

/** A Peek's buttons, above its key hints: open it, open it beside, compare it, and ⋯. */
export function PeekActions({ obj, local }: { obj: Obj; local: Local }) {
  const env = useActionEnv();
  return (
    <div className="flex items-center gap-1 border-t border-hairline px-2 py-1.5">
      {PEEK_PRIMARY.map((id) => {
        const a = actionById(id);
        if (!a || !a.when(obj, env, local)) return null;
        const Icon = iconOf(a, obj, env);
        return (
          <button
            key={id}
            type="button"
            title={a.hint ? `${a.phrase(obj, env)}  ·  ${a.hint}` : a.phrase(obj, env)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => a.run(obj, env, id === "open" ? howOf(e) : { newTab: false }, local)}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            <Icon size={13} strokeWidth={2} className="text-ink-muted" />
            {a.short ?? a.label(obj, env)}
          </button>
        );
      })}
      <span className="flex-1" />
      <MoreButton obj={obj} local={local} className="size-[24px] border-transparent bg-transparent" />
    </div>
  );
}

/**
 * Where a dragged object can open beside the tab in front: the right third of
 * the pane, while a drag is under way. The compare tray keeps the bottom.
 */
export function BesideDropZone({ onDrop }: { onDrop: (o: Obj) => void }) {
  const dragging = useObjectDragging();
  const [over, setOver] = useState(false);
  if (!dragging) return null;
  return (
    <div
      role="region"
      aria-label="Open beside"
      onDragOver={(e) => {
        if (!carriesObject(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const o = droppedObject(e.dataTransfer);
        if (o) onDrop(o);
      }}
      className={`fade-in absolute bottom-[84px] right-3 top-3 z-[25] flex w-[min(30%,360px)] min-w-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-[12.5px] font-medium transition-colors ${
        over
          ? "border-accent bg-[color-mix(in_oklab,var(--accent)_10%,var(--paper))] text-accent"
          : "border-hairline bg-[color-mix(in_oklab,var(--paper)_82%,transparent)] text-ink-muted"
      }`}
    >
      <Columns2 size={18} strokeWidth={2} />
      Open beside
    </div>
  );
}

/** A favorites slot at the top of the sidebar, while something with a page is dragged. */
export function FavoriteDropSlot({ onDrop }: { onDrop: (o: Obj) => void }) {
  const dragging = useObjectDragging();
  const [over, setOver] = useState(false);
  if (!dragging) return null;
  return (
    <div
      role="region"
      aria-label="Add to favorites"
      onDragOver={(e) => {
        if (!carriesObject(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const o = droppedObject(e.dataTransfer);
        if (o && recordOf(o)) onDrop(o);
      }}
      className={`fade-in mb-2 flex h-[34px] items-center gap-2 rounded-md border border-dashed px-2 text-[12.5px] transition-colors ${
        over ? "border-accent text-accent" : "border-hairline text-ink-muted"
      }`}
    >
      <Star size={14} strokeWidth={2} />
      Drop to add to favorites
    </div>
  );
}
