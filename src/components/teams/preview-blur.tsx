import type { ReactNode } from "react";

/**
 * Wraps a section's DATA body (not its header) on the next-season preview page:
 * softens the content and centers the "no games yet" note over it, scoped to
 * this box only. Section headers are rendered outside the wrapper so they stay
 * sharp and readable.
 */
export function BlurOverlay({
  children,
  subtext = "This section populates once four games have been played.",
}: {
  children: ReactNode;
  /** Secondary line under "No games played yet". Pass null to omit it. */
  subtext?: string | null;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-[4px] opacity-40 saturate-50" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 grid place-items-center px-4">
        <div className="text-center max-w-[15rem] rounded-lg bg-paper/85 backdrop-blur-sm border border-hairline shadow-sm px-4 py-3">
          <p className="text-sm font-semibold text-ink">No games played yet</p>
          {subtext != null && <p className="text-xs text-ink-muted mt-1">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}
