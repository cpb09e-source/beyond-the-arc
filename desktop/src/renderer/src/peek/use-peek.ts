import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Space to peek, on Linear's rules.
 *
 *   hold Space   the preview shows while the key is down; releasing closes it
 *   tap Space    the preview stays; tap again, or press Esc, to close
 *
 * Arrow keys keep moving focus underneath while it is open, and the preview
 * follows, because it renders whatever is focused now rather than whatever was
 * focused when it opened.
 *
 * THE LINE BETWEEN A TAP AND A HOLD IS 220ms. A deliberate tap lands well under
 * 150; much above 220 and a quick glance-and-release starts pinning the panel
 * open by accident, which is the failure that teaches people to stop trusting
 * a gesture.
 *
 * NEVER WHILE TYPING. Space in the filter box is a space.
 */
const TAP_MS = 220;

type View = { open: boolean; pinned: boolean };
const CLOSED: View = { open: false, pinned: false };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function usePeek(): View & { close: () => void } {
  const [view, setView] = useState<View>(CLOSED);
  // The window listeners outlive any one render and need the CURRENT state, so
  // it lives in a ref as well; `apply` is the only writer and keeps both equal.
  const live = useRef<View>(CLOSED);
  const downAt = useRef<number | null>(null);
  const swallowNextUp = useRef(false);

  const apply = useCallback((next: View) => {
    live.current = next;
    setView(next);
  }, []);

  const close = useCallback(() => {
    downAt.current = null;
    apply(CLOSED);
  }, [apply]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live.current.open) {
        e.preventDefault();
        close();
        return;
      }
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // Always, including repeats: Space must never scroll the table or press
      // whatever button last took focus.
      e.preventDefault();
      if (e.repeat) return;
      if (live.current.open && live.current.pinned) {
        // This press closes a pinned panel; its own keyup must not re-pin it.
        swallowNextUp.current = true;
        close();
        return;
      }
      downAt.current = performance.now();
      apply({ open: true, pinned: false });
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (swallowNextUp.current) {
        swallowNextUp.current = false;
        return;
      }
      const started = downAt.current;
      if (started == null) return;
      downAt.current = null;
      if (performance.now() - started < TAP_MS) apply({ open: true, pinned: true });
      else close();
    };

    // A hold whose keyup lands in another window never arrives here, and an
    // unpinned panel left open by it would look stuck.
    const onBlur = () => {
      if (!live.current.pinned) close();
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [apply, close]);

  return { ...view, close };
}
