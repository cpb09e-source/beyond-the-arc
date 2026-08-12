import { abbrevName } from "@/lib/player-name";

/**
 * A player's name at table width: abbreviated on phones, whole from `sm` up.
 *
 * The abbreviation exists because a phone has no width to spare — a two-line
 * name pushes the numbers off the screen, and "J. Morton" keeps the part a
 * reader searches on. None of that is true on a desktop, where the frozen
 * Player column has room for the given name and the initial was just throwing
 * away the most recognisable half of it.
 *
 * Both forms are rendered and one is hidden in CSS, rather than measuring the
 * viewport in JS. A width read would have to happen after mount, so the first
 * paint would show the wrong form on one of the two — and on a static export
 * that first paint is what the crawler and the share preview see.
 *
 * The full name stays on `title` at both widths, so the abbreviated form is
 * still hoverable back to the whole thing.
 */
export function PlayerName({ name }: { name: string }) {
  const short = abbrevName(name);
  // Nothing to switch between when the name is a single token, or when
  // abbreviating didn't shorten it. Emitting one span keeps the DOM honest.
  if (short === name) return <>{name}</>;
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{name}</span>
    </>
  );
}
