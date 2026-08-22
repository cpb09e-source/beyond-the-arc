/**
 * The "where am I" line at the top of a data page.
 *
 * None of the four table pages had one. On desktop the nav's segmented control
 * answers the question — the current page sits in a raised chip — but that nav
 * does not exist below `lg`, so a phone opened the teams table to a wordmark, a
 * Scope row and a grid of numbers, with nothing naming the thing being ranked.
 *
 * NO DISPLAY TITLE. This started as an eyebrow over a 30px `font-display`
 * heading over a standfirst — three lines to say one thing, on the page with
 * the least room to say it. The kicker alone does the naming: "TEAM RATINGS"
 * is what the table IS, where "Teams Explorer" was a name for the page that
 * contains it, and the two together were saying it twice.
 *
 * The standfirst stays desktop-only. On a phone the header is competing with
 * the Scope row and the toolbar for the space above the first result, and a
 * sentence of context is exactly the sort of thing that pushed the table off
 * the fold to begin with.
 *
 * Still an <h1>: the page needs one heading for a screen reader's document
 * outline and for the search result, whatever size it is drawn at.
 */
export function PageHeading({
  label,
  sub,
}: {
  /** What the table is — set in small caps, not as a display title. */
  label: string;
  /** One line of context. Desktop only — see the note above. */
  sub?: string;
}) {
  return (
    <header className="mb-2.5 sm:mb-5">
      <h1
        className="text-[0.7rem] uppercase tracking-[0.15em] font-bold leading-none"
        style={{ color: "var(--court-ink)" }}
      >
        {label}
      </h1>
      {sub && (
        <p className="hidden sm:block mt-2 text-sm text-ink-soft leading-relaxed max-w-[58ch]">
          {sub}
        </p>
      )}
    </header>
  );
}
