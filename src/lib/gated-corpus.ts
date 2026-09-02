/**
 * Fetching a per-season BULK corpus that is too big to hand through a function.
 *
 * WHY THIS EXISTS ALONGSIDE season-data.ts. That file gates the explorer
 * corpora by streaming the bytes out of `/api/season/*`, which works because
 * those files are ~1.2 MB. The game-log corpora are not: `game-index` is 6.3 MB
 * a season and `team-game-index` 1.6 MB. Passing those through a Netlify
 * function means paying function egress for something R2 serves for free, and
 * game-index is at or over the response ceiling a function runs under anyway.
 *
 * So this moves the CHECK to the function and leaves the BYTES on R2. The
 * function signs a short-lived URL, the browser fetches the object directly,
 * and nothing large passes through Netlify. See netlify/functions/data-url.mts.
 *
 * WHY IT IS A REAL GATE AND THE OLD ONE WAS NOT. Until now these corpora sat on
 * the PUBLIC bucket for every season including paid ones, so anyone who opened
 * the network tab could read the whole archive without an account. The Game Log
 * Explorer's five-row preview was a sign, not a door — the browser already held
 * every row it was declining to draw. Signed objects live in a bucket with no
 * public access and no r2.dev subdomain, so presigning is the only way in and
 * it needs a credential that exists only in the function's environment.
 *
 * ORDERING, IF YOU ARE MOVING THE OBJECTS: this file must be DEPLOYED before
 * the paid-season objects leave the public bucket. Deploy first and the client
 * asks for a signature, gets one, and reads from the private bucket; move the
 * objects first and every game log in production breaks until the deploy lands.
 */
import { dataUrl } from "@/lib/data-url";
import { isSeasonFree } from "@/lib/access";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";

/**
 * The corpora this can sign for, and where each one lives publicly.
 *
 * `kind` is the wire value `/api/data-url` matches against its own allow-list —
 * the two lists are the same contract written twice, deliberately, so a change
 * on one side cannot silently widen the other.
 */
export const SIGNED_CORPORA = {
  games: "/data/game-index",
  "team-games": "/data/team-game-index",
} as const;

export type SignedCorpus = keyof typeof SIGNED_CORPORA;

/** The public path for a season, as written in /public. */
export function corpusPublicPath(kind: SignedCorpus, year: number): string {
  return `${SIGNED_CORPORA[kind]}/${year}.json`;
}

/**
 * The access token for the signed-in reader, or null.
 *
 * Read at call time, not passed in — same reason as season-data.ts: a token
 * expires and an explorer can sit open for an hour before someone picks a
 * different season. getSession() refreshes when needed.
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

/**
 * Fetch one season's corpus, free or paid.
 *
 * RESOLVES TO NULL RATHER THAN THROWING, on every failure including a denial.
 * That is the contract the two callers already had, and it is what keeps this
 * change to the gate alone: the table says it has no rows for that season
 * instead of taking the page down. The Game Log Explorer already runs its own
 * paywall messaging off GAME_LOG_ACCESS, so a denial here does not need to
 * carry a reason for anything to be said to the reader.
 */
export async function loadSignedCorpus<T>(
  kind: SignedCorpus,
  year: number,
): Promise<T | null> {
  // The common path: a free season is an ordinary CDN object. No token, no
  // round trip, cacheable at the edge. Only a paid season pays for the gate.
  if (isSeasonFree(year)) {
    return fetchJson<T>(dataUrl(corpusPublicPath(kind, year)));
  }

  const token = await accessToken();
  // Nothing to send, so skip the round trip — the function would answer 401.
  if (!token) return null;

  let signed: string;
  try {
    const res = await fetch(`/api/data-url?kind=${kind}&year=${year}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // 400 + reason "free" means the function considers this season public
      // and there is nothing in the private bucket to sign. That can only
      // happen if this file and the function disagree about FREE_SEASONS,
      // which is a deploy skew rather than a denial — so fall back to the
      // public object instead of showing an empty table.
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { reason?: string } | null;
        if (body?.reason === "free") {
          return fetchJson<T>(dataUrl(corpusPublicPath(kind, year)));
        }
      }
      return null;
    }
    const body = (await res.json()) as { url?: string };
    if (!body.url) return null;
    signed = body.url;
  } catch {
    return null;
  }

  // The signed URL is absolute and points at R2, so it does NOT go through
  // dataUrl — that helper rewrites public-bucket paths and would mangle this.
  return fetchJson<T>(signed);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
