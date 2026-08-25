"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A phone-only header bar that rides at the top of the screen while a table is
 * under it, so the column names stay readable without the table becoming a
 * scrolling window.
 *
 * WHY THIS EXISTS AT ALL. `position: sticky` on a <th> sticks to the nearest
 * SCROLLPORT, and these tables need `overflow-x: auto` to reach their stat
 * columns — which forces `overflow-y` to `auto` as well, making the wrapper a
 * scroll container in both axes. So a sticky header only works if the wrapper
 * also has a height, and a height turns the grid into a window: a finger in the
 * data area scrolls the table instead of the page, iOS rubber-bands the pane
 * away from its own frame on both axes at once, and the whole 100-row grid gets
 * looked at through a 620px slot. Measured on a 390x844 phone, even a
 * FULL-viewport window shows 17 of 100 rows.
 *
 * So: no height, no window. The wrapper goes back to being page-height, the
 * page scrolls the way it always did, and the header is drawn a second time in
 * a fixed bar that appears only while the table is crossing the top of the
 * screen. Nothing nests, so there is nothing to rubber-band and no cap to size.
 *
 * IT CLONES THE DOM RATHER THAN RE-RENDERING THE MARKUP. The four tables have
 * four different headers — two of them two rows deep with colSpan band captions
 * and frozen left columns — and a second copy of that JSX would be four more
 * things to keep in step every time a column moves. `cloneNode(true)` inherits
 * the classes, the spans, the sort arrows and the frozen cells as they actually
 * are, and re-clones whenever the real header changes.
 *
 * The frozen first columns keep working because the host is a real scroll
 * container (`overflow: hidden` still scrolls programmatically) whose
 * scrollLeft is driven from the table's own. `left-0` sticky cells inside it
 * therefore pin against the host exactly as they pin against the table. A
 * transform would have broken that — sticky resolves against the scrollport,
 * and translating the content moves the sticky cells along with it.
 *
 * Widths come from measuring the real header's bottom row and writing them into
 * a <colgroup> with `table-layout: fixed`. They cannot be inferred: a column's
 * width is decided by the widest cell in it, and every one of those lives in a
 * <tbody> this bar does not have.
 *
 * Portalled to <body> so no ancestor's transform can capture the fixed
 * position — Tailwind's translate utilities are all over these pages, and any
 * one of them would turn `fixed` into "fixed to that div".
 */
export function StickyHeaderClone({
  scrollerRef,
}: {
  /** The `overflow-x: auto` wrapper holding the table. */
  scrollerRef: React.RefObject<HTMLElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Hydration check without a cascading render. This DOES render on the
  // server — it sits in the table's tree on every page — so the portal cannot
  // be created on the first pass. useSyncExternalStore is the sanctioned way
  // to ask "am I on the client yet": it returns the server snapshot (false)
  // during SSR and the client one (true) after, with no effect and no
  // setState. The subscribe callback never fires because the answer never
  // changes once it is true.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!mounted) return;
    const scroller = scrollerRef.current;
    const host = hostRef.current;
    if (!scroller || !host) return;

    const phone = window.matchMedia("(max-width: 47.99rem)");
    let raf = 0;

    /** Rebuild the bar's contents from the live header. */
    const build = () => {
      const table = scroller.querySelector("table");
      const thead = table?.querySelector("thead");
      if (!table || !thead) return false;

      // The bottom header row is the one with a cell per column; a band row
      // above it carries colSpans and cannot describe the column widths.
      const rows = [...thead.rows];
      const widthRow = rows[rows.length - 1];
      if (!widthRow) return false;
      const widths = [...widthRow.cells].map((c) => c.getBoundingClientRect().width);
      if (!widths.length || widths.every((w) => w === 0)) return false;

      const clone = document.createElement("table");
      clone.className = table.className;
      clone.style.tableLayout = "fixed";
      clone.style.width = `${table.getBoundingClientRect().width}px`;

      const colgroup = document.createElement("colgroup");
      for (const w of widths) {
        const col = document.createElement("col");
        col.style.width = `${w}px`;
        colgroup.appendChild(col);
      }
      clone.appendChild(colgroup);
      clone.appendChild(thead.cloneNode(true));

      host.replaceChildren(clone);
      host.style.height = `${thead.getBoundingClientRect().height}px`;
      host.scrollLeft = scroller.scrollLeft;
      return true;
    };

    /** Should the bar be showing, and where has the table been scrolled to? */
    const sync = () => {
      raf = 0;
      if (!phone.matches) {
        setVisible(false);
        return;
      }
      const table = scroller.querySelector("table");
      const thead = table?.querySelector("thead");
      if (!table || !thead) {
        setVisible(false);
        return;
      }
      const headRect = thead.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      // Show once the real header has left the top of the screen, and stop
      // before the table's last row does — a bar hanging over the pagination
      // would be labelling nothing.
      const show = headRect.bottom <= 0 && tableRect.bottom > headRect.height;
      setVisible(show);
      if (show) host.scrollLeft = scroller.scrollLeft;
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(sync);
    };

    // Widths move when a column is sorted, a filter changes the widest cell, or
    // the phone is rotated. Rebuild on any of it, then re-sync.
    const rebuild = () => {
      if (!phone.matches) return;
      if (build()) sync();
    };

    const ro = new ResizeObserver(rebuild);
    const table = scroller.querySelector("table");
    if (table) ro.observe(table);

    const mo = new MutationObserver(rebuild);
    const thead = table?.querySelector("thead");
    if (thead) mo.observe(thead, { childList: true, subtree: true, characterData: true });

    rebuild();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", rebuild);
    scroller.addEventListener("scroll", schedule, { passive: true });
    phone.addEventListener("change", rebuild);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", rebuild);
      scroller.removeEventListener("scroll", schedule);
      phone.removeEventListener("change", rebuild);
    };
  }, [mounted, scrollerRef]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={hostRef}
      // pointer-events-none: this is a readout, not a control. The sort buttons
      // it copies would be dead ringers for the real ones and fire nothing, so
      // taps fall through to whatever is genuinely underneath.
      className="md:hidden fixed top-0 inset-x-0 z-40 overflow-hidden pointer-events-none shadow-[0_1px_0_var(--color-hairline)]"
      style={{ display: visible ? "block" : "none" }}
      aria-hidden
    />,
    document.body,
  );
}
