/**
 * Resolves the URL for a static data file.
 *
 * Heavy per-entity JSON (team-games, player-games, player, player-ranks,
 * tournament-box, team) lives on Cloudflare R2 in production — too many
 * files to ship via Netlify's deploy upload. Small top-level JSONs
 * (conferences.json, search-index.json, etc.) and per-year bundles
 * (players-by-year, game-logs-by-year) still ride along in /public.
 *
 * Pass the path AS WRITTEN in /public (e.g. "/data/team-games/2025/123.json").
 * In development NEXT_PUBLIC_DATA_BASE is unset → returns the path as-is so
 * the browser hits the local /public mirror. In production it returns the
 * R2 public-bucket URL with the same key.
 *
 * Files outside the R2-mirrored dirs always resolve to the local path
 * regardless of env (they're not on R2 and don't need to be).
 */

// Dirs whose contents live on R2. Match the prefix exactly. Anything not in
// this list stays on /public and ignores NEXT_PUBLIC_DATA_BASE.
const R2_DIRS = [
  "/data/team-games/",
  "/data/player-games/",
  "/data/player/",
  "/data/player-ranks/",
  "/data/tournament-box/",
  "/data/team/",
] as const;

export function dataUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_DATA_BASE;
  if (!base) return path;
  for (const dir of R2_DIRS) {
    if (path.startsWith(dir)) {
      // R2 keys don't include the "/data/" prefix — we mirror the structure
      // under the bucket root.
      return `${base}${path.slice("/data".length)}`;
    }
  }
  return path;
}
