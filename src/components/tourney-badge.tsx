import { Trophy } from "lucide-react";
import { tourneyBadge } from "@/data/tournament-results";
import { cn } from "@/lib/utils";

/**
 * Visual marker for tournament accomplishments. Renders a small trophy for the
 * national champion and a coral "F4" pill for the other Final Four teams.
 * Returns null when the team didn't make the Final Four that season.
 */
export function TourneyBadge({
  teamName,
  year,
  size = 14,
  className,
}: {
  teamName: string;
  year: number;
  size?: number;
  className?: string;
}) {
  const kind = tourneyBadge(teamName, year);
  if (!kind) return null;

  if (kind === "champion") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-amber-500 text-white shadow-sm",
          className,
        )}
        style={{ width: size + 8, height: size + 8 }}
        title={`${year - 1}-${String(year).slice(-2)} national champion`}
        aria-label="National champion"
      >
        <Trophy size={size} strokeWidth={2.5} fill="currentColor" fillOpacity={0.3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-coral text-white text-[0.7rem] font-display font-bold leading-none tabular tracking-wide shadow-sm",
        className,
      )}
      title={`${year - 1}-${String(year).slice(-2)} Final Four`}
      aria-label="Final Four"
    >
      F4
    </span>
  );
}
