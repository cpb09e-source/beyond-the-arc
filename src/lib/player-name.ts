/**
 * Display forms for a player's name.
 *
 * Tables are the width-constrained surface on this site: the explorer wants
 * every column it can fit, and on a phone a two-line name pushes the numbers
 * off the screen entirely. Abbreviating the given name buys most of that width
 * back while keeping the part a reader actually searches on.
 *
 * Kept in one place because four tables render player names and they were
 * about to grow four slightly different ideas of what to do with "Rob Lee, Jr."
 */

/** Suffixes we keep attached to the surname rather than treating as one. */
const SUFFIX = /^(jr|sr|ii|iii|iv|v|vi|lll|ll)\.?$/i;

/**
 * "Jerone Morton" → "J. Morton".
 *
 * Rules that matter, in the order they bite:
 *   - A trailing suffix rides along: "Jeremy Fears Jr." → "J. Fears Jr."
 *     Dropping it would merge a father and son who are both in the data.
 *   - Particles stay with the surname: "Enel St. Bernard" → "E. St. Bernard",
 *     because "E. Bernard" is a different person's name.
 *   - A single-token name is returned untouched — there is no given name to
 *     abbreviate, and "M." helps nobody.
 *   - An already-initialed given name is not re-abbreviated: "J.J. Starling"
 *     keeps both initials rather than collapsing to "J. Starling", which would
 *     be a different player on some rosters.
 */
export function abbrevName(full: string | null | undefined): string {
  const name = (full ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "";

  // Strip a trailing suffix so it can be re-attached after the surname.
  let suffix = "";
  let core = name.replace(/,\s*/g, " ").trim();
  const toks = core.split(" ");
  if (toks.length > 2 && SUFFIX.test(toks[toks.length - 1]!)) {
    suffix = ` ${toks.pop()!}`;
    core = toks.join(" ");
  }

  const parts = core.split(" ");
  if (parts.length < 2) return name;

  const given = parts[0]!;
  // Everything after the given name is the surname, particles included:
  // "Enel St. Bernard" must stay "E. St. Bernard", because "E. Bernard" is a
  // different person's name. The one thing dropped is a bare middle initial
  // ("Robert V Smith" → "R. Smith"), which carries no identifying weight in a
  // table and is the only token here that costs width for nothing.
  const rest = parts.slice(1);
  const surname = rest
    .filter((tok, i) => i === rest.length - 1 || !/^[A-Za-z]\.?$/.test(tok))
    .join(" ");
  if (!surname) return name;

  // "J.J." / "A.J." already read as initials — leave them whole.
  const alreadyInitials = /^(?:[A-Za-z]\.){2,}$|^[A-Z]{2,3}$/.test(given);
  const head = alreadyInitials ? given : `${given[0]!.toUpperCase()}.`;

  return `${head} ${surname}${suffix}`;
}
