/**
 * Tiny "NBA" pill rendered next to a player's name in the box-score modal
 * when they appear in our NBA-players lookup. The lookup contains:
 *   - Drafted players: pick is a number (from NBA Draft scrape 2013-2025)
 *   - Undrafted but played in NBA: pick is null (from NBA per-season totals
 *     scrape 2013-2026 — catches Fred VanVleet-style cases)
 *
 * Hover surfaces the relevant context per type.
 */
export function NbaBadge({ year, pick, team }: { year: number; pick: number | null; team: string | null }) {
  const title = pick !== null
    ? `Drafted ${year}${pick ? ` · pick #${pick}` : ""}${team ? ` · ${team}` : ""}`
    : `Played in the NBA · first season ${year}${team ? ` · ${team}` : ""}`;
  return (
    <span
      className="inline-flex items-center justify-center align-middle h-3.5 px-1 ml-1.5 rounded-[2px] bg-[#17408b] text-white text-[0.5rem] font-bold tabular tracking-wider leading-none shrink-0"
      title={title}
      aria-label={title}
    >
      NBA
    </span>
  );
}
