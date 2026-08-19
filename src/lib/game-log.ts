import type { PlayerGameRow } from "@/lib/static-data";

/**
 * Formatting shared by the player hero (server) and its chart (client).
 *
 * Lives here rather than in the chart module because a "use client" file's
 * exports cannot be CALLED from the server — only rendered — and the hero's
 * "high 35 at Indiana St." note is built during the server render.
 */

/** "2026-02-08" → "2/8". No Date(): a date-only string shifts a day in some
 *  timezones, and these labels sit next to the opponent that would contradict. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}` : iso;
}

/** "at Indiana St." / "vs Indiana St." — a neutral floor is neither, so it
 *  takes "vs" rather than claiming a home game the player didn't have. */
export function opponentOf(g: PlayerGameRow | undefined): string {
  const opp = g?.opp_team_market ?? "—";
  return g && g.is_home === false && !g.is_neutral ? `at ${opp}` : `vs ${opp}`;
}
