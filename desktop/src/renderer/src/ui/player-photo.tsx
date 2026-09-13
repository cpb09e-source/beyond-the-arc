import { useState } from "react";
import { CLASS_BADGE } from "@/lib/class-badge";

/**
 * A headshot from the app's own bta://player/ protocol, or initials.
 *
 * Only players with a downloaded photo ask for one (see PHOTOS in
 * data/player-model.ts), and at 60px and under the face-cropped 240px copy is
 * used, the same size rule as the site's PlayerPhoto.
 */
export function PlayerPhoto({
  bartId,
  hasPhoto,
  name,
  size,
}: {
  bartId: number | null;
  hasPhoto: boolean;
  name: string;
  size: number;
}) {
  const [broken, setBroken] = useState(false);

  if (!hasPhoto || bartId == null || broken) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .filter((c): c is string => !!c)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-paper-deep font-semibold text-ink-muted"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={`bta://player/${bartId}${size <= 60 ? "-sm" : ""}.webp`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-paper-deep object-cover object-top"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The academic-year badge, in the site's four class hues. Off the percentile
 * ramp's red-to-green axis on purpose: a class is a category, not a grade.
 */
export function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const tone = CLASS_BADGE[cls];
  return (
    <span
      className="inline-flex h-[16px] shrink-0 items-center rounded-[4px] px-1 text-[10px] font-semibold leading-none"
      style={tone ? { background: tone.bg, color: tone.fg } : undefined}
    >
      {cls}
    </span>
  );
}
