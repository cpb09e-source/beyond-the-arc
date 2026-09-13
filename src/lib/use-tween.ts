import { useEffect, useRef, useState } from "react";

/**
 * Ease a number toward its target over a few frames, so a toggled player
 * moves the score rather than replacing it. The eye reads the DIRECTION of a
 * change far more easily than it reads two numbers, and direction is the
 * whole point of a control that says "what if he's out".
 *
 * Off under prefers-reduced-motion, and it always lands exactly on target.
 */
export function useTween(target: number, ms = 320): number {
  const [v, setV] = useState(target);
  // Where the value actually is, frame by frame — so a change that lands
  // mid-tween continues from the current position rather than jumping back.
  const at = useRef(target);
  useEffect(() => {
    let raf = 0;
    const start = performance.now(), from = at.current, d = target - from;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Every state update happens inside the frame callback, never in the
    // effect body itself: the first frame does the reduced-motion snap too.
    const tick = (now: number) => {
      const t = reduce || Math.abs(d) < 1e-6 ? 1 : Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = t >= 1 ? target : from + d * e;
      at.current = cur;
      setV(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
