"use client";

import { useState } from "react";
import photoMap from "@/data/coach-photos.json";
import { cn } from "@/lib/utils";

const PHOTOS = photoMap as Record<string, string>;

/**
 * Headshots are OFF. Flip to true to bring them back — the manifest, the two
 * size variants and the error fallback are all still wired below.
 *
 * We hold photos for 17 of 804 coaches, so the monogram was the normal state
 * and the headshot the exception, and a grid where one row in fifty carries a
 * face reads as broken rather than as sparse. Initials for everyone is a
 * consistent design; initials for everyone except Tony Bennett is an accident.
 */
// Annotated `boolean` rather than left to infer `false`, so TypeScript does not
// narrow the photo branch to unreachable and start erroring inside it.
const HAVE_ENOUGH_COVERAGE: boolean = false;

/**
 * Two independent reasons to show nothing, kept as two flags because they are
 * two different decisions. Coverage is a design judgement that flips back the
 * day the manifest fills out; the env flag is the site-wide photo kill switch
 * documented in player-photo.tsx and netlify.toml. Folding them into one
 * constant would mean turning coverage on quietly re-enables photos that a
 * takedown had switched off.
 */
const SHOW_PHOTOS: boolean =
  HAVE_ENOUGH_COVERAGE && process.env.NEXT_PUBLIC_BTA_PHOTOS !== "off";

function initials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z\s.'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * CoachPhoto — the headshot if we have one, otherwise an initials monogram.
 * Circular crop, same treatment as PlayerPhoto.
 *
 * Keyed by SLUG rather than an id: coaches have no numeric key, and the slug is
 * already the stable identifier the URL uses. Photos are added by hand, so the
 * manifest will be sparse for a long time — the monogram is the normal state
 * here, not an edge case, and it has to look deliberate rather than broken.
 */
export function CoachPhoto({
  slug,
  name,
  size = 48,
  className,
}: {
  slug: string;
  name: string;
  size?: number;
  className?: string;
}) {
  // Two variants per coach, same 60px threshold as the players. Table rows and
  // list avatars take the 240x174 thumb; only a profile hero is big enough to
  // need the 600x436 source.
  const fullSrc = SHOW_PHOTOS ? PHOTOS[slug] ?? null : null;
  const src = fullSrc ? (size <= 60 ? fullSrc.replace(/\.webp$/, "-sm.webp") : fullSrc) : null;
  const [errored, setErrored] = useState(false);

  if (src && !errored) {
    return (
      <img
        src={src}
        alt={`${name} headshot`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className={cn(
          "inline-block object-cover object-top rounded-full bg-paper-deep shrink-0 max-w-none",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-paper-deep text-ink-muted font-display font-medium shrink-0 select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-label={`${name} (no photo)`}
    >
      {initials(name)}
    </span>
  );
}
