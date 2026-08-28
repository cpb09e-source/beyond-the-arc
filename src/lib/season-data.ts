/**
 * Fetching a season's team rows, free or paid.
 *
 * The explorer used to `fetch(dataUrl(...))` and get a static file every time.
 * A gated season is not a static file — it comes from a function that wants to
 * know who is asking — so the fetch has to carry the reader's token and has to
 * be able to come back with "you are not signed in" rather than rows.
 *
 * ONE ENTRY POINT for both, because the caller should not have to know which
 * kind of season it asked for. `src/lib/access.ts` decides; this just does
 * what it says.
 *
 * A DENIAL IS A RESULT, NOT AN ERROR. `loadSeason` resolves either way and
 * says which happened. A rejected promise would make the table's loading state
 * the only place the difference could be handled, and "no rows" and "sign in
 * to see these rows" are not the same thing to a reader — one is an empty
 * table, the other is a sales conversation.
 */
import { dataUrl } from "@/lib/data-url";
import { isSeasonFree, publicSeasonFile, seasonEndpoint } from "@/lib/access";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";

/** Why a season came back without rows. */
export type SeasonDenial = "signed-out" | "not-subscribed" | "unavailable";

export type SeasonResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; denial: SeasonDenial };

/**
 * The access token for the signed-in reader, or null.
 *
 * Read at call time rather than passed in: a token expires, and the explorer
 * may sit open for an hour before someone adds a season. getSession() refreshes
 * it when needed, so asking late is the only way to be sure it is still good.
 */
async function accessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function loadSeason<T>(year: number): Promise<SeasonResult<T>> {
  // The common path, unchanged: a plain CDN file, no token, no function.
  if (isSeasonFree(year)) {
    try {
      const res = await fetch(dataUrl(publicSeasonFile(year)));
      if (!res.ok) return { ok: false, denial: "unavailable" };
      return { ok: true, rows: (await res.json()) as T[] };
    } catch {
      return { ok: false, denial: "unavailable" };
    }
  }

  const token = await accessToken();
  // Skip the round trip when there is nothing to send. The function would
  // answer 401 anyway, and the reader gets the same message a beat sooner.
  if (!token) return { ok: false, denial: "signed-out" };

  try {
    const res = await fetch(seasonEndpoint(year), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, rows: (await res.json()) as T[] };
    if (res.status === 401) return { ok: false, denial: "signed-out" };
    if (res.status === 403) return { ok: false, denial: "not-subscribed" };
    return { ok: false, denial: "unavailable" };
  } catch {
    return { ok: false, denial: "unavailable" };
  }
}
