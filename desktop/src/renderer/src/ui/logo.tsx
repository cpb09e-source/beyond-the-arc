import { useState } from "react";

/**
 * A school crest from the app's own bta://logo/ protocol, or its initials.
 *
 * The fallback is not decoration: two of the 368 names across thirteen seasons
 * have no crest, and a broken-image glyph in a dense table reads as a bug in
 * the row rather than as a missing asset.
 */
export function TeamLogo({ id, name, size = 18 }: { id: number | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);

  if (id == null || broken) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-paper-deep font-semibold text-ink-muted"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={`bta://logo/${id}.png`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setBroken(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
