import { ExternalLink, Link2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { beginDrag } from "~/objects/drag";
import { objectDrag, type Obj } from "~/objects/object";
import { useObjectMenu } from "~/objects/use-object-actions";
import { useIsActive } from "~/shell/active";
import { usePersisted } from "~/ui/persisted";
import { useToast } from "~/ui/toast";

/**
 * A record's details, down the right of its page: Linear's issue sidebar,
 * Attio's record details.
 *
 * WHAT PLACES THE RECORD, NOT MORE OF ITS NUMBERS. The page already leads with
 * six numbers and their chips; the rail holds the facts around them (who
 * coached, what seed, what came before) and the ways out to the rest of the
 * app, so the page reads as one object with edges rather than a stack of cards.
 *
 * ONE SWITCH FOR EVERY PROFILE. The button at the rail's top folds it to a slim
 * edge, the edge unfolds it, and Ctrl+I does both, remembered, the way Linear's
 * issue sidebar is. It only appears in a pane wide enough to give the page its
 * full width beside it; narrower, the page keeps the room.
 */

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export type OpenHow = { newTab: boolean; side?: boolean };
export const howOf = (e: React.MouseEvent): OpenHow => ({ newTab: e.ctrlKey || e.metaKey, side: e.shiftKey && !(e.ctrlKey || e.metaKey) });

/** Whether the rail is out, and the switch, with Ctrl+I bound while this tab is in front. */
export function useDetailsRail(): [boolean, () => void] {
  const [open, setOpen] = usePersisted("bta.profile.details", true, isBool);
  const active = useIsActive();
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, setOpen]);
  return [open, () => setOpen((o) => !o)];
}

export function DetailsRail({ label, onCollapse, children }: { label: string; onCollapse: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      className="details-in hidden w-[300px] shrink-0 overflow-y-auto border-l border-hairline bg-[color-mix(in_oklab,var(--chrome)_55%,var(--paper))] @5xl:block"
    >
      <div className="flex justify-end px-2.5 pt-2.5">
        <button
          type="button"
          aria-label="Hide details"
          title="Hide details  ·  Ctrl I"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCollapse}
          className="grid size-[26px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
        >
          <PanelRightClose size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col gap-7 px-5 pb-10 pt-1">{children}</div>
    </aside>
  );
}

/**
 * The rail folded away: a slim edge where it was, so the way back sits where the
 * rail went rather than in the page's header. Ctrl+I works either way.
 */
export function DetailsCollapsed({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="hidden w-[36px] shrink-0 border-l border-hairline bg-[color-mix(in_oklab,var(--chrome)_55%,var(--paper))] @5xl:block">
      <button
        type="button"
        aria-label="Show details"
        title="Show details  ·  Ctrl I"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onExpand}
        className="group flex h-full w-full flex-col items-center gap-3 pt-2.5 text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
      >
        <span className="grid size-[26px] place-items-center">
          <PanelRightOpen size={14} strokeWidth={2} />
        </span>
        <span className="text-[11.5px] font-medium tracking-[0.02em] [writing-mode:vertical-rl]">Details</span>
      </button>
    </div>
  );
}

export function DetailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-medium text-ink-muted">{title}</h2>
        {aside && <span className="truncate text-[11.5px] text-ink-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A property: its name on the left in the quiet ink, its value on the right. */
export function DetailRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div title={title} className="grid min-h-[30px] grid-cols-[88px_minmax(0,1fr)] items-center gap-3 text-[13px]">
      <span className="truncate text-ink-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-ink">{children}</span>
    </div>
  );
}

/** A value that goes somewhere: the row's own ink, a quiet fill on hover. With its object, it right-clicks and drags as that object. */
export function DetailLink({ onOpen, title, object, children }: { onOpen: (how: OpenHow) => void; title?: string; object?: Obj; children: ReactNode }) {
  const menu = useObjectMenu();
  return (
    <button
      type="button"
      title={title}
      data-obj={object ? JSON.stringify(object) : undefined}
      draggable={object ? true : undefined}
      onDragStart={object ? (e) => beginDrag(e, objectDrag(object)) : undefined}
      onContextMenu={object ? (e) => menu(e, object) : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onOpen(howOf(e))}
      className="-mx-1.5 flex min-w-0 max-w-[calc(100%+12px)] items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-ink transition-colors hover:bg-[var(--row-hover)]"
    >
      {children}
    </button>
  );
}

/** A way out to another view, with the words for where it leads. */
export function DetailAction({
  icon,
  label,
  hint,
  title,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  hint?: ReactNode;
  title?: string;
  onOpen: (how: OpenHow) => void;
}) {
  return (
    <button
      type="button"
      title={title ?? `${label}  ·  Ctrl-click for a new tab`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onOpen(howOf(e))}
      className="-mx-2 flex h-[30px] w-[calc(100%+16px)] items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
    >
      <span className="flex w-4 shrink-0 justify-center text-ink-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-ink-muted">{hint}</span>}
    </button>
  );
}

/** The same page on btacbb.xyz: open it in the browser, or copy the link to send. */
export function SiteLinks({ url }: { url: string }) {
  const toast = useToast();
  return (
    <>
      <DetailAction icon={<ExternalLink size={14} strokeWidth={2} />} label="Open on btacbb.xyz" title={url} onOpen={() => window.open(url)} />
      <DetailAction
        icon={<Link2 size={14} strokeWidth={2} />}
        label="Copy link"
        title={url}
        onOpen={() =>
          void navigator.clipboard.writeText(url).then(
            () => toast({ title: "Link copied", body: url }),
            () => toast({ title: "The link could not be copied", body: url }),
          )
        }
      />
    </>
  );
}
