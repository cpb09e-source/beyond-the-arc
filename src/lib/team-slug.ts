/**
 * The URL slug for a team name.
 *
 * This exact transform is currently duplicated in four places — the team page,
 * the explorer, the sitemap and the preview index. It is reproduced here rather
 * than imported by them because those four are load-bearing routes and this
 * module exists to serve new callers; the intent is that they migrate onto it,
 * not that this one drifts. Any change here must be made in all five or in none.
 */
export function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
