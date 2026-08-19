"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * NBA franchise mark for the draft chip on a player page.
 *
 * Mirrors TeamLogo's contract — remote image, monogram on failure — rather than
 * introducing a second pattern. Falls back to a neutral monogram instead of
 * franchise colours: thirty hand-entered hex values would be thirty chances to
 * put the wrong blue next to a team's name, and the name is right there.
 */
export function NbaTeamLogo({
  src,
  name,
  size = 18,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (src && !errored) {
    return (
      <img
        src={src}
        alt={`${name} logo`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className={cn("inline-block object-contain shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm bg-paper-deep text-ink-muted font-display font-medium shrink-0 select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}
