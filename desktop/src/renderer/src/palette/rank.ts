import { normalizeText } from "~/ui/text";

/**
 * How well one palette entry answers a query, or -1 when it does not.
 *
 * EVERY WORD MUST LAND. "duke 2019" means Duke in one season, not everything
 * that says Duke plus everything from 2019, so an entry missing any word is out.
 *
 * WHERE A WORD LANDS DECIDES THE ORDER. At the start of the title beats the
 * start of a later title word, which beats the middle of one, which beats the
 * subtitle or a hidden keyword. So "mich" puts Michigan above Central Michigan,
 * and both above a player whose subtitle says Michigan. A title typed out in
 * full outranks everything that merely starts with it: "duke" is the school,
 * not Duke Deen.
 *
 * WHAT IS PROMINENT IS THE LIST'S CALL, passed in as `weight`: a shorter school
 * name, a bigger role, a newer season. Name length means nothing for a person,
 * so it is not scored here.
 *
 * Entries are prepared once when the list is built, so a keystroke costs a
 * comparison per entry and nothing else.
 */

export type Rankable = { title: string; subtitle?: string; keywords?: string[] };

export type Prepared = { title: string; titleWords: string[]; rest: string; restWords: string[] };

export function prepare(item: Rankable): Prepared {
  const title = normalizeText(item.title);
  const rest = normalizeText([item.subtitle ?? "", ...(item.keywords ?? [])].join(" "));
  return { title, titleWords: title.split(" "), rest, restWords: rest ? rest.split(" ") : [] };
}

/** `words` is the query already folded by normalizeText and split on spaces. */
export function score(words: string[], p: Prepared, weight = 0): number {
  if (words.length === 0) return weight;
  const joined = words.join(" ");
  let s = p.title === joined ? 700 : p.title.startsWith(joined) ? 400 : 0;
  for (const w of words) {
    if (p.titleWords[0]?.startsWith(w)) s += 120;
    else if (p.titleWords.some((t) => t.startsWith(w))) s += 80;
    else if (p.title.includes(w)) s += 30;
    else if (p.restWords.some((t) => t.startsWith(w))) s += 12;
    else if (p.rest.includes(w)) s += 4;
    else return -1;
  }
  return s + weight;
}
