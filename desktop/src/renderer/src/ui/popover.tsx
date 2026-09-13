import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that opens from a control and closes the moment attention goes
 * elsewhere: a click outside, a scroll behind it, a resize, Esc from inside.
 *
 * IN A PORTAL, placed against the control that opened it, because the control
 * usually sits inside something that clips (a wrapping filter row, a card).
 *
 * PLACED AFTER LAYOUT. The control can appear in the same commit as its panel
 * (a filter chosen from the add menu draws its chip and opens it at once), so
 * the position is read once the control exists, and the panel draws nothing
 * until then rather than flashing in a corner. It opens upward when there is
 * more room above.
 *
 * FOCUS GOES BACK to what had it, unless whatever was chosen put focus
 * somewhere on purpose (a new condition's value box).
 */
export function Popover({
  anchor,
  onClose,
  width,
  align = "left",
  label,
  children,
}: {
  anchor: { readonly current: HTMLElement | null };
  onClose: () => void;
  width: number;
  align?: "left" | "right";
  label: string;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = anchor.current?.getBoundingClientRect();
    if (!r) {
      setPos({ left: Math.max(8, (vw - width) / 2), top: 96, maxHeight: vh - 140 });
      return;
    }
    const left = Math.max(8, Math.min(align === "right" ? r.right - width : r.left, vw - width - 8));
    const below = vh - r.bottom - 14;
    const above = r.top - 14;
    if (below >= 300 || below >= above) setPos({ left, top: r.bottom + 6, maxHeight: Math.min(480, below) });
    else setPos({ left, bottom: vh - r.top + 6, maxHeight: Math.min(480, above) });
    // Placed once: anything that would move the control closes the panel instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onScroll = (e: Event) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close.current();
    };
    const onResize = () => close.current();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      const now = document.activeElement;
      if ((now == null || now === document.body) && previous && previous !== document.body && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [anchor, previous]);

  // Nothing until placed. Drawing the panel hidden for that frame instead let its
  // contents mount first, and a search box cannot take focus while it is hidden.
  if (!pos) return null;

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      className="menu-in fixed z-50 flex flex-col overflow-hidden rounded-lg border border-hairline bg-card"
      style={{
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width,
        maxHeight: pos.maxHeight,
        boxShadow: "var(--overlay-shadow)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
