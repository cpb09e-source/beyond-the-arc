"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measure a table cell's rendered width so a second sticky column can pin
 * exactly where the first one ends.
 *
 * Width utilities do NOT stick on these cells: in auto table layout a `width`
 * is a preference, and once the table overflows its container the browser
 * shrinks columns toward min-content — a `w-12` (48px) rank column was
 * measuring 38.5px on the teams table once the reader pinned a few extra
 * columns. A hardcoded `left-12` on the neighbour then left 9.5px of unpainted
 * gap between the two frozen columns. Measuring makes the pinned position equal
 * the natural flow position, whatever the browser settles on.
 */
export function useMeasuredWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const measure = () => {
      const w = ref.current?.getBoundingClientRect().width;
      if (w) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return [ref, width] as const;
}
