/**
 * Desktop stand-in for src/lib/data-url.ts, swapped in by the Vite alias.
 *
 * The site builds CDN and R2 URLs from a Next public env var. The renderer never
 * fetches data by URL (its content policy forbids it; files come through the
 * main process), so a path comes back as given, and anything that tries to
 * fetch it fails in plain sight instead of reaching the network.
 */
export function dataUrl(path: string): string {
  return path;
}
