/**
 * The table a visitor sees before JavaScript arrives — and the only table a
 * crawler sees at all.
 *
 * WHY THIS EXISTS. Both explorers read `useSearchParams`, which forces them
 * inside a Suspense boundary; on a static export that means the prerendered
 * HTML contains the BOUNDARY'S FALLBACK and nothing else. The two most
 * important pages on the site were shipping "Loading teams…" in a div: a
 * second of blank paper for a reader, and zero rows for Google, on the page
 * every visitor lands on first.
 *
 * So the fallback stopped being a spinner. This renders real rows, server-side,
 * from the same data and the same default sort the client is about to apply —
 * then React swaps it for the live table on hydration.
 *
 * A SERVER COMPONENT, deliberately: no hooks, no state, no "use client". It can
 * therefore run inside the fallback of the very boundary whose child cannot be
 * prerendered.
 *
 * IT IS A PREVIEW, NOT A COPY. Twenty-five rows and a handful of columns
 * against the live table's hundred rows and forty. Matching the full grid —
 * percentile chips, band headers, sticky columns, the column picker — would be
 * a second implementation of the thing most likely to drift, to be seen for
 * about one second. What it must get right is the ORDER and the NUMBERS, so
 * that the rows a crawler indexes are the rows a reader ends up looking at,
 * and the swap is a table gaining columns rather than a table changing its
 * mind about who is first.
 */
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";

export type PreviewColumn = {
  /** Header text — matches the live table's label for the same stat. */
  label: string;
  /** Pre-formatted value per row, in row order. */
  values: string[];
};

export type PreviewRow = {
  /** Team or player name. */
  name: string;
  /** Team name for the crest — the team itself, or the player's team. */
  team: string;
  /** Conference, class, record: whatever the live table puts under the name. */
  meta?: string;
  /** Where the name links, when the destination is prerendered. */
  href?: string;
};

export function TablePreview({
  rows,
  columns,
  nameHeader,
  caption,
}: {
  rows: PreviewRow[];
  columns: PreviewColumn[];
  /** "Team" or "Player". */
  nameHeader: string;
  /** One line under the table saying this is a partial view. */
  caption: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 -mx-6 lg:mx-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center">
                #
              </th>
              <th className="bg-paper-deep border-b border-hairline px-2 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left">
                {nameHeader}
              </th>
              {columns.map((c) => (
                <th
                  key={c.label}
                  className="bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
              <th aria-hidden className="bg-paper-deep border-b border-hairline w-full p-0" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
              return (
                <tr key={`${r.name}-${i}`} className={zebra}>
                  <td className="w-10 min-w-10 px-1 sm:px-2 py-1.5 text-center text-ink-muted tabular text-xs font-semibold">
                    {i + 1}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <TeamLogo name={r.team} size={20} />
                      <span className="min-w-0">
                        {r.href ? (
                          <Link href={r.href} className="font-medium text-ink hover:text-coral transition-colors">
                            {r.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{r.name}</span>
                        )}
                        {r.meta && <span className="ml-1.5 text-[0.65rem] text-ink-muted">{r.meta}</span>}
                      </span>
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td key={c.label} className="px-2 py-1.5 text-right tabular text-ink">
                      {c.values[i] ?? "—"}
                    </td>
                  ))}
                  <td aria-hidden className="p-0" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Says what this is, so the row count does not read as the whole table
          to anyone — reader or crawler — who never gets past it. */}
      <div className="px-3 lg:px-4 py-2 border-t border-hairline bg-paper-deep/30 text-xs text-ink-muted">
        {caption}
      </div>
    </div>
  );
}
