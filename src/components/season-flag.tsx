import { seasonFlagNote } from "@/lib/seasons";

/**
 * The marker on a flagged season — currently only 2020-21.
 *
 * AN ASTERISK, NOT A WARNING. The season is real and the page showing it is
 * correct; what the marker says is "do not put this one in an average with the
 * others". A banner would overstate that, and colouring it like an error would
 * tell a reader the data is wrong when the data is fine.
 *
 * Renders NOTHING for an unflagged season, so callers can drop it beside any
 * season label without a conditional of their own.
 */
export function SeasonFlag({ year, className = "" }: { year: number; className?: string }) {
  const note = seasonFlagNote(year);
  if (!note) return null;
  return (
    <abbr
      title={note}
      aria-label={note}
      className={`no-underline cursor-help text-ink-muted font-normal align-super text-[0.7em] leading-none ${className}`}
    >
      *
    </abbr>
  );
}

/**
 * The same fact as a sentence, for somewhere a floating asterisk would be
 * missed — under a table that has several seasons pooled, say.
 */
export function SeasonFlagNote({ years, className = "" }: { years: readonly number[]; className?: string }) {
  const flagged = years.filter((y) => seasonFlagNote(y) !== null);
  if (flagged.length === 0) return null;
  return (
    <p className={`text-xs text-ink-muted ${className}`}>
      {flagged.map((y) => `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`).join(", ")}
      {flagged.length === 1 ? " is" : " are"} in this selection.{" "}
      {seasonFlagNote(flagged[0]!)}
    </p>
  );
}
