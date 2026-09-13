/**
 * Folds a name and a query into the same shape before matching.
 *
 * NUMBER WORDS BECOME DIGITS. The site labels conferences "Big 10", "Big 12",
 * "Atlantic 10", while people type "big ten". Folding the words into digits on
 * both sides matches either spelling against either label, without a
 * hand-kept alias list that would need a new entry every time a conference
 * is renamed. Accents fold away too, so "Jose" finds "José".
 */
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => NUMBER_WORDS[w] ?? w)
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every word of the query appears somewhere in the haystack. */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = fields.map(normalizeText).join(" ");
  return q.split(" ").every((word) => hay.includes(word));
}
