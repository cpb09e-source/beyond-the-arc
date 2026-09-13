import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";

/**
 * A coach's mark. There are no coach headshots in the data, so a coach wears
 * initials on a quiet disc, and at a size that can carry it, the crest of the
 * school he coaches (or last coached) tucked into the corner, which is what
 * tells two coaches with the same initials apart at a glance.
 */
export function CoachAvatar({ name, team, size = 16 }: { name: string; team: string | null; size?: number }) {
  const words = name.replace(/[^A-Za-z' ]/g, " ").trim().split(/\s+/);
  const initials = ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase();
  const badge = size >= 28 && team ? Math.round(size * 0.44) : 0;
  return (
    <span aria-hidden className="relative inline-grid shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid place-items-center rounded-full bg-[color-mix(in_oklab,var(--ink)_9%,var(--card))] font-semibold tracking-[-0.02em] text-ink-soft"
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.38)) }}
      >
        {initials}
      </span>
      {badge > 0 && (
        <span
          className="absolute grid place-items-center rounded-full bg-card shadow-[0_0_0_1.5px_var(--card)]"
          style={{ width: badge, height: badge, right: -badge * 0.18, bottom: -badge * 0.18 }}
        >
          <TeamLogo id={logoIdOf(team!)} name={team!} size={Math.round(badge * 0.82)} />
        </span>
      )}
    </span>
  );
}
