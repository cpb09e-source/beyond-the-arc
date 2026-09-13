import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu, type MenuEntry } from "./menu";

/**
 * Right-click, wherever it happens: one menu at a time, at the pointer, kept
 * inside the window.
 *
 * ONE HOST FOR THE WHOLE APP, so a second right-click replaces the first menu
 * rather than stacking a second one, and every surface opens the same Menu with
 * the same keyboard. What the menu says comes from the object's actions
 * (~/objects/actions.tsx); where it appears is decided here.
 */

export type MenuRequest = { x: number; y: number; label: string; entries: MenuEntry[] };

const ContextMenuContext = createContext<(req: MenuRequest) => void>(() => {});

export const useContextMenu = () => useContext(ContextMenuContext);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(MenuRequest & { n: number }) | null>(null);
  const seq = useRef(0);
  const open = useCallback((r: MenuRequest) => {
    seq.current += 1;
    setReq({ ...r, n: seq.current });
  }, []);
  const close = useCallback(() => setReq(null), []);

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {req && req.entries.length > 0 && createPortal(<Floating key={req.n} req={req} onClose={close} />, document.body)}
    </ContextMenuContext.Provider>
  );
}

/** Opens down and right of the pointer, and up or left of it where the window ends. */
function Floating({ req, onClose }: { req: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: req.x, top: req.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(req.x, window.innerWidth - w - 8)),
      top: req.y + h > window.innerHeight - 8 ? Math.max(8, req.y - h) : req.y,
    });
  }, [req]);
  return (
    <div ref={ref} className="fixed z-[60]" style={pos}>
      <Menu label={req.label} entries={req.entries} onClose={onClose} />
    </div>
  );
}
