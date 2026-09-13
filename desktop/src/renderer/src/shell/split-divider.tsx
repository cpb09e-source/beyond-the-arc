import { X } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;

/**
 * The seam between the two panes of split view.
 *
 * Drag it to share the width (a quarter to three quarters each), double-click
 * to even it out, or close the split from the button that appears on hover.
 * The pane in front is the one with the accent line along its top: it has the
 * keyboard, and F6 hands it to the other.
 */
export function SplitDivider({
  ratio,
  onRatio,
  onClose,
}: {
  ratio: number;
  onRatio: (ratio: number) => void;
  onClose: () => void;
}) {
  const box = useRef<{ left: number; width: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const main = e.currentTarget.parentElement;
    if (!main) return;
    const r = main.getBoundingClientRect();
    box.current = { left: r.left, width: r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const b = box.current;
    if (!b || b.width <= 0) return;
    const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (e.clientX - b.left) / b.width));
    if (Math.abs(next - ratio) > 0.002) onRatio(next);
  };
  const up = () => {
    box.current = null;
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split view"
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onRatio(0.5)}
      className="group relative z-30 w-[7px] shrink-0 cursor-col-resize"
      style={{ order: 2 }}
    >
      <span className="absolute inset-y-0 left-[3px] w-px bg-hairline transition-colors group-hover:bg-[color-mix(in_oklab,var(--accent)_60%,transparent)]" />
      <button
        type="button"
        aria-label="Close split view"
        title="Close split view  ·  Ctrl Shift \"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
        className="absolute left-1/2 top-2.5 grid size-5 -translate-x-1/2 place-items-center rounded-md border border-hairline bg-card text-ink-muted opacity-0 shadow-sm transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={11} strokeWidth={2.25} />
      </button>
    </div>
  );
}
