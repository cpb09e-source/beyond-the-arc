import { isFlaggedSeason, seasonFlagNote } from "@/lib/seasons";
import { seasonLabel } from "~/ui/format";

/**
 * The Season column of a table that spans seasons: "25-26" as the site's explorer
 * writes it, and the COVID season marked where it appears.
 */
export function SeasonCell({ year }: { year: number }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-soft tabular">
      {seasonLabel(year).slice(2)}
      {isFlaggedSeason(year) && (
        <span
          title={seasonFlagNote(year) ?? undefined}
          className="rounded-[4px] border border-hairline px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted"
        >
          Covid
        </span>
      )}
    </span>
  );
}

export const SEASON_COLUMN_TITLE = "The season this row is. Each row's percentiles rank it within its own season.";
