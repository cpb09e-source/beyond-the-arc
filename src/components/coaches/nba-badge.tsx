/**
 * Tiny "NBA" pill rendered next to a player's name in the box-score modal
 * when they appear in our drafted-players lookup (scraped from
 * basketball-reference.com NBA Draft pages, 2013-2026).
 *
 * Hover surfaces draft year + pick + team.
 */
export function NbaBadge({ year, pick, team }: { year: number; pick: number | null; team: string | null }) {
  const title = `Drafted ${year}${pick ? ` · pick #${pick}` : ""}${team ? ` · ${team}` : ""}`;
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
