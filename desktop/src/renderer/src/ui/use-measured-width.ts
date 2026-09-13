import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The width an element is given, kept current as the window or a sidebar moves.
 *
 * For drawings laid out in real pixels, so an 11px label is 11px at every
 * width instead of scaling with a viewBox.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
