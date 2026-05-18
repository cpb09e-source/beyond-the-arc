"use client";

import { useState, type ReactNode } from "react";
import { BoxscoreModal } from "./boxscore-modal";

/**
 * Client wrapper rendering a clickable `<tr>` that opens the in-browser
 * box-score modal. Children are the row's `<td>` cells. If `gameSlug` is
 * null (we don't have a box score URL for this game), the row renders as
 * a static `<tr>` with no click handler.
 */
export function GameRowTr({
  children,
  year,
  gameSlug,
  sportsRefHref,
  title,
}: {
  children: ReactNode;
  year: number;
  gameSlug: string | null;
  sportsRefHref: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  if (!gameSlug) {
    return (
      <tr title={title} className="border-b border-hairline/40 last:border-0">
        {children}
      </tr>
    );
  }
  return (
    <>
      <tr
        onClick={() => setOpen(true)}
        title={title}
        className="border-b border-hairline/40 last:border-0 cursor-pointer hover:bg-paper-deep/40 transition-colors"
      >
        {children}
      </tr>
      <BoxscoreModal
        open={open}
        onClose={() => setOpen(false)}
        year={year}
        gameSlug={gameSlug}
        sportsRefHref={sportsRefHref}
      />
    </>
  );
}
