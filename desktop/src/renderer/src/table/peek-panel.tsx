import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Kbd } from "~/ui/kbd";

/**
 * The Peek shell: position, entrance, and the key hints. What a Peek SAYS is the
 * view's business; how a Peek BEHAVES is the same everywhere, which is the
 * point: a reader who has learned it on teams already knows it on players.
 */
export function PeekPanel({
  label,
  pinned,
  top,
  onHeight,
  children,
}: {
  label: string;
  pinned: boolean;
  top: number;
  onHeight: (px: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  // The table clamps the panel inside its viewport, which needs the panel's
  // real height. Content length varies by row, so it is measured, not assumed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  return (
    <aside
      ref={ref}
      aria-label={`${label} preview`}
      className="peek-panel absolute right-4 top-0 z-20 w-[372px] overflow-hidden rounded-[10px] border border-hairline bg-card"
      style={{ transform: `translate3d(0, ${top}px, 0)` }}
    >
      {children}
      <footer className="flex items-center gap-3 border-t border-hairline bg-paper-deep/40 px-4 py-2 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>Space</Kbd>
          {pinned ? "close" : "release to close"}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          next
        </span>
        {pinned && (
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
          </span>
        )}
      </footer>
    </aside>
  );
}
