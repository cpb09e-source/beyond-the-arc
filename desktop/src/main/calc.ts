import { accessToken, SITE } from "./auth";

/**
 * Ask the Win Calculator: a plain-English question, turned into filters by the
 * site's parser (netlify/functions/parse-query.mts).
 *
 * THROUGH THE SITE, NEVER A KEY OF OUR OWN. The parser is a model call, and the
 * key that pays for it lives only on the server. An app that carried a key
 * would hand it to anyone who unpacked the installer.
 *
 * FROM THE MAIN PROCESS, not the renderer, so the page's Content-Security-Policy
 * stays closed to the network and the question is checked once more here. The
 * reader's session goes along when there is one, so the endpoint can start
 * requiring an account without the app changing.
 *
 * The reply is passed back whole, status and body, and the renderer resolves
 * the names in it against its own lists (src/lib/win-calc.ts).
 */

export type ParseReply = { status: number; body: unknown };

const MIN_CHARS = 3;
const MAX_CHARS = 500;
/** The parser allows itself 30 s per model call and may make two. */
const TIMEOUT_MS = 75_000;

export async function parseQuestion(query: unknown): Promise<ParseReply> {
  if (typeof query !== "string" || query.trim().length < MIN_CHARS || query.length > MAX_CHARS) {
    return { status: 400, body: { error: `Ask a question between ${MIN_CHARS} and ${MAX_CHARS} characters long.` } };
  }
  const token = await accessToken().catch(() => null);
  try {
    const res = await fetch(`${SITE}/api/parse-query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => ({ error: `The parser answered ${res.status} without a reply.` }));
    return { status: res.status, body };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      status: 0,
      body: {
        error: timedOut
          ? "That question took too long to work out. Naming a team usually helps, or set the filters by hand."
          : "Could not reach btacbb.xyz. Check the connection, or set the filters by hand.",
      },
    };
  }
}
