"use client";

import { useState } from "react";
import photoMap from "@/data/player-photos.json";
import { cn } from "@/lib/utils";

const PHOTOS = photoMap as Record<string, string>;

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
 * PlayerPhoto — ESPN headshot if we have one downloaded for this player,
 * otherwise an initials-on-paper-deep monogram. Square-cropped.
 */
export function PlayerPhoto({
  bartPlayerId,
  name,
  size = 48,
  className,
}: {
  bartPlayerId: number | null;
  name: string;
  size?: number;
  className?: string;
}) {
  // The fetch script writes both <id>.webp (full 600x436) and
  // <id>-sm.webp (240x174 face-cropped). Size-conditional swap:
  //   • size ≤ 60 → use the thumbnail (240→display is a 4–8x downsample on
  //     2x retina = crisp). Saves ~75% bandwidth on roster/leaderboard
  //     avatars where dozens render at once.
  //   • size > 60 → use the full 600x436 source so the player-profile
  //     headshot (120px on retina = 240 device px) doesn't upscale the
  //     thumb's 174px height. Downsampling 600→240 = still crisp.
  const fullSrc = bartPlayerId ? PHOTOS[String(bartPlayerId)] ?? null : null;
  const src = fullSrc
    ? (size <= 60 ? fullSrc.replace(/\.webp$/, "-sm.webp") : fullSrc)
    : null;
  const [errored, setErrored] = useState(false);

  if (src && !errored) {
    return (
      <img
        src={src}
        alt={`${name} headshot`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className={cn(
          "inline-block object-cover object-top rounded-full bg-paper-deep shrink-0 max-w-none",
          className
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-paper-deep text-ink-muted font-display font-medium shrink-0 select-none",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
      aria-label={`${name} (no photo)`}
    >
      {initials(name)}
    </span>
  );
}
