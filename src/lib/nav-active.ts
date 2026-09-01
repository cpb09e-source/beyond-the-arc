/**
 * Which entry in a menu is the page you are on.
 *
 * WHY THIS IS NOT `pathname.startsWith(href)`. Menu entries nest: /players is
 * the Player Explorer and /players/games is the Game Log Explorer, and on the
 * second of those a plain startsWith lights BOTH — the reader is told they are
 * on two pages at once.
 *
 * The rule is longest match wins. Every entry that could claim the path is
 * considered, and only the most specific one gets it, so a parent stops
 * lighting the moment a child of it is the better answer.
 *
 * "/" IS EXACT, ALWAYS. Every path starts with it, so a prefix test would make
 * the home link permanently current.
 *
 * THIS HAS BEEN GOT WRONG THREE TIMES. The mobile menu carries a comment about
 * the first — Team Explorer and Conference Power Rankings lit together — and
 * the fix it applied did not cover a sibling nested under another. One helper,
 * used by both menus, is what stops a fourth.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");
    if (!hit) continue;
    // Longest wins: /players/games beats /players on /players/games/.
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}
