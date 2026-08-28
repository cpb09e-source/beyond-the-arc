"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A conference's mark, by our own conference code.
 *
 * LOCAL FILES, NOT A HOTLINK. Team logos on this site come from a bucket
 * somebody else maintains, which is fine for 365 marks that would be a
 * nuisance to keep; there are 32 conferences and they change once a decade, so
 * these are in the repo where nothing can 404 them mid-season. Fetched once
 * from ESPN's conference set and resized to 128px — the whole set is 141 KB,
 * down from 1 MB at the source resolution, and nothing here renders above 24.
 *
 * Falls back to NOTHING rather than to a monogram. A missing mark leaves the
 * name it sits beside, which already says which league this is; a grey circle
 * with two letters in it says only that something failed.
 */
export function ConferenceLogo({
  conf,
  size = 18,
  className,
}: {
  /** Our conference code — "B10", "SEC", "MWC". */
  conf: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no loader
    <img
      src={`/images/conf/${conf}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
