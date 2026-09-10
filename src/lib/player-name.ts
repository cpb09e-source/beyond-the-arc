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
  const p = parseName(full);
  if (!p) return "";
  if (!p.given) return p.raw;

  // "J.J." / "A.J." already read as initials — leave them whole.
  const alreadyInitials = /^(?:[A-Za-z]\.){2,}$|^[A-Z]{2,3}$/.test(p.given);
  const head = alreadyInitials ? p.given : `${p.given[0]!.toUpperCase()}.`;

  return `${head} ${p.surname}${p.suffix}`;
}

type Parsed = { given: string; surname: string; suffix: string; raw: string };

/**
 * Split a name into the pieces the display forms are built from.
 *
 * `given` is empty when there is nothing to abbreviate — a single-token name,
 * or one where the surname could not be isolated. Callers fall back to `raw`.
 */
function parseName(full: string | null | undefined): Parsed | null {
  const name = (full ?? "").trim().replace(/\s+/g, " ");
  if (!name) return null;

  // Strip a trailing suffix so it can be re-attached after the surname.
  let suffix = "";
  let core = name.replace(/,\s*/g, " ").trim();
  const toks = core.split(" ");
  if (toks.length > 2 && SUFFIX.test(toks[toks.length - 1]!)) {
    suffix = ` ${toks.pop()!}`;
    core = toks.join(" ");
  }

  const parts = core.split(" ");
  if (parts.length < 2) return { given: "", surname: name, suffix: "", raw: name };

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
  if (!surname) return { given: "", surname: name, suffix: "", raw: name };

  return { given, surname, suffix, raw: name };
}

/** "Jeremy Fears Jr." → "Fears Jr." — the shortest form a chart can label. */
export function surnameOf(full: string | null | undefined): string {
  const p = parseName(full);
  return p ? `${p.surname}${p.suffix}` : "";
}

/**
 * Display names that stay unambiguous WITHIN ONE GROUP — a roster, a lineup,
 * the players on one chart.
 *
 * Duke 2026 is why this exists. Cameron and Cayden Boozer are the team's two
 * biggest creators, and a chart that labels them both "Boozer" — or even
 * "C. Boozer", which is what abbrevName gives for each — is not cramped, it is
 * wrong: it says the wrong player made the pass. Any surface labelling several
 * teammates at once needs this rather than mapping abbrevName over them.
 *
 * The given name grows only as far as the collision forces: "Boozer" when
 * nobody shares it, "Cam. Boozer" / "Cay. Boozer" when someone does, and the
 * whole given name if even six letters cannot separate them (twins with the
 * same first name do not exist, but "Chris" and "Christopher" do).
 *
 * Both forms are returned because the same chart usually wants both — a tick
 * label wants `surname`, a legend wants `abbrev` — and they must agree about
 * which players needed disambiguating.
 */
export function uniqueNames(names: Record<string, string>): {
  surname: Record<string, string>;
  abbrev: Record<string, string>;
} {
  const byLast = new Map<string, string[]>();
  for (const [id, full] of Object.entries(names)) {
    const key = surnameOf(full) || full;
    byLast.set(key, [...(byLast.get(key) ?? []), id]);
  }

  const surname: Record<string, string> = {};
  const abbrev: Record<string, string> = {};

  for (const [last, ids] of byLast) {
    if (ids.length === 1) {
      const id = ids[0]!;
      surname[id] = last;
      abbrev[id] = abbrevName(names[id]);
      continue;
    }

    const givens = ids.map((id) => parseName(names[id])?.given ?? "");
    let k = 1;
    while (k < 6 && new Set(givens.map((g) => g.slice(0, k))).size < givens.length) k++;
    const separated = new Set(givens.map((g) => g.slice(0, k))).size === givens.length;

    ids.forEach((id, i) => {
      const g = givens[i]!;
      // A prefix that ends on the punctuation of "J.J." would read as a typo.
      const head = separated ? `${g.slice(0, k).replace(/\.$/, "")}.` : g;
      const label = g ? `${head} ${last}` : last;
      surname[id] = label;
      abbrev[id] = label;
    });
  }

  return { surname, abbrev };
}
