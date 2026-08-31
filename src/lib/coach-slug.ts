/**
 * The URL slug for a coach name.
 *
 * SPLIT OUT OF lib/coaches.ts SO CLIENT COMPONENTS CAN HAVE IT. That module is
 * the coaches data layer — it reads files off disk to build profiles — so
 * importing it from a `"use client"` component drags the whole server-side
 * loader into the browser bundle. Turbopack does not merely tree-shake that
 * away; it fails outright, and the page 500s with "Code generation for chunk
 * item errored" rather than anything that names the real problem. The season
 * grid needed nothing but this six-line transform.
 *
 * lib/coaches.ts re-exports this rather than keeping its own copy, so the
 * slugs the routes are generated from and the slugs links are built from are
 * the same function, not two functions that agree today.
 */
export function coachSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
