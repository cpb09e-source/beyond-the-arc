import { Columns2, Copy, PanelRightClose, Plus, Star, StarOff, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { TeamLogo } from "~/ui/logo";
import { Menu, type MenuEntry } from "~/ui/menu";
import { PlayerPhoto } from "~/ui/player-photo";
import { viewById } from "./views";
import type { Tab } from "./workspace";

/**
 * The tabs, in the title bar.
 *
 * A TAB ACTIVATES ON PRESS, not release, as in a browser: switching is the
 * common case and should not wait for the finger to lift. Dragging past a few
 * pixels reorders instead; middle click closes; the × appears on the tab in
 * front and on hover, so a row of tabs is not a row of buttons asking to be
 * pressed by accident.
 *
 * THE STRIP STOPS SHORT OF THE CAPTION BUTTONS. Windows draws minimize,
 * maximize and close over the right end of the title bar; the Window Controls
 * Overlay env() variables say exactly how much of it they take.
 */

const DRAG_THRESHOLD = 5;

export function TabStrip({
  tabs,
  active,
  onActivate,
  onClose,
  onNew,
  onMove,
  isFavorite,
  onFavorite,
  onDuplicate,
  onCloseOthers,
  split,
  onSplitWith,
  onUnsplit,
}: {
  tabs: Tab[];
  active: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onMove: (id: string, to: number) => void;
  isFavorite: (id: string) => boolean;
  onFavorite: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCloseOthers: (id: string) => void;
  /** The pair on screen in split view, if any. */
  split: { a: string; b: string } | null;
  onSplitWith: (id: string) => void;
  onUnsplit: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    onActivate(id);
    drag.current = { id, x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(d.id);
    }
    // The slot is how many other tabs have their middle left of the pointer.
    const others = [...(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])].filter(
      (el) => el.dataset.tabId !== d.id,
    );
    const to = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    if (tabs.findIndex((t) => t.id === d.id) !== to) onMove(d.id, to);
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Open tabs"
      className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden px-1.5"
      style={{ paddingRight: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)" }}
    >
      {tabs.map((tab) => {
        const view = viewById(tab.viewId);
        const Icon = view.icon;
        const label = tab.title ?? tab.record?.name ?? view.label;
        const isActive = tab.id === active;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            role="tab"
            aria-selected={isActive}
            title={view.seasonless ? label : `${label} · ${seasonLabel(tab.year)}`}
            onPointerDown={(e) => onPointerDown(e, tab.id)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onMouseDown={(e) => {
              // Middle click would otherwise start Chromium's autoscroll.
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: tab.id, x: e.clientX, y: e.clientY });
            }}
            className={`no-drag group relative flex h-[28px] min-w-[112px] max-w-[220px] flex-1 cursor-default select-none items-center gap-2 rounded-[7px] pl-2.5 pr-1 text-[12.5px] transition-colors ${
              isActive
                ? "bg-paper text-ink shadow-[0_0_0_1px_var(--hairline),0_1px_2px_rgb(0_0_0/0.05)]"
                : "text-ink-muted hover:bg-[var(--row-hover)] hover:text-ink-soft"
            } ${dragging === tab.id ? "z-10 opacity-90" : ""}`}
          >
            {tab.record?.kind === "team" ? (
              <TeamLogo id={tab.record.logoId} name={tab.record.name} size={15} />
            ) : tab.record?.kind === "player" ? (
              <PlayerPhoto bartId={tab.record.bartId} hasPhoto={tab.record.hasPhoto} name={tab.record.name} size={16} />
            ) : tab.record?.kind === "game" ? (
              <span className="flex shrink-0 items-center">
                <TeamLogo id={tab.record.awayLogo} name={tab.record.away} size={14} />
                <span className="-ml-1">
                  <TeamLogo id={tab.record.homeLogo} name={tab.record.home} size={14} />
                </span>
              </span>
            ) : (
              <Icon size={14} strokeWidth={2} className={`shrink-0 ${isActive ? "text-ink-soft" : "text-ink-muted"}`} />
            )}
            <span className="min-w-0 truncate">{label}</span>
            {split && (split.a === tab.id || split.b === tab.id) && (
              // The two tabs on screen together share an underline, as a pair.
              <span aria-hidden className="pointer-events-none absolute inset-x-2 -bottom-[6px] h-[2px] rounded-full bg-[color-mix(in_oklab,var(--accent)_70%,transparent)]" />
            )}
            {!view.seasonless && (
              <span className="shrink-0 text-[11px] text-ink-muted tabular">{seasonLabel(tab.year).slice(2)}</span>
            )}
            <button
              type="button"
              aria-label={`Close ${label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onClose(tab.id)}
              className={`ml-auto grid size-[18px] shrink-0 place-items-center rounded-[4px] text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X size={12} strokeWidth={2.25} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        title="New tab  Ctrl T"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNew}
        className="no-drag grid size-[28px] shrink-0 place-items-center rounded-[7px] text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
      >
        <Plus size={15} strokeWidth={2} />
      </button>
      {menu &&
        createPortal(
          <Menu
            label="Tab"
            entries={tabMenu(menu.id)}
            onClose={() => setMenu(null)}
            className="fixed"
            style={{ left: Math.min(menu.x, window.innerWidth - 240), top: menu.y + 4 }}
          />,
          document.body,
        )}
    </div>
  );

  // Rebuilt each time it opens, so it names the tab's current state.
  function tabMenu(id: string): MenuEntry[] {
    const starred = isFavorite(id);
    return [
      {
        kind: "item",
        id: "favorite",
        label: starred ? "Remove from favorites" : "Add to favorites",
        icon: starred ? <StarOff size={14} /> : <Star size={14} />,
        hint: <Kbd>Ctrl D</Kbd>,
        onSelect: () => onFavorite(id),
      },
      { kind: "item", id: "duplicate", label: "Duplicate tab", icon: <Copy size={14} />, onSelect: () => onDuplicate(id) },
      split && (split.a === id || split.b === id)
        ? { kind: "item", id: "unsplit", label: "Close split view", icon: <PanelRightClose size={14} />, hint: <Kbd>Ctrl Shift \</Kbd>, onSelect: onUnsplit }
        : {
            kind: "item",
            id: "split",
            label: id === active ? "Split view" : "Show beside the current tab",
            icon: <Columns2 size={14} />,
            hint: id === active ? <Kbd>Ctrl Shift \</Kbd> : undefined,
            disabled: tabs.length < 2 && id !== active,
            onSelect: () => onSplitWith(id),
          },
      { kind: "separator", id: "s1" },
      { kind: "item", id: "close", label: "Close tab", icon: <X size={14} />, hint: <Kbd>Ctrl W</Kbd>, onSelect: () => onClose(id) },
      {
        kind: "item",
        id: "close-others",
        label: "Close other tabs",
        disabled: tabs.length < 2,
        onSelect: () => onCloseOthers(id),
      },
    ];
  }
}
