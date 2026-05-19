"use client";

import { useEffect } from "react";

/**
 * Lock body scroll while a modal/dialog is open, AND compensate for the
 * removed vertical scrollbar so the underlying page doesn't shift to the
 * right by the scrollbar's width.
 *
 * Pass `active=true` while the modal is open. The hook restores the previous
 * `overflow` and `padding-right` values on unmount.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [active]);
}
