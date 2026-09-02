import type { Context } from "@netlify/functions";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requirePaid } from "../shared/billing.mts";

/**
 * Hand a subscriber a short-lived URL for one gated data file.
 *
 * GET /api/data-url?kind=team-games&year=2020
 *   -> 200 { url, expires }   a presigned R2 GET, good for the rest of the hour
 *   -> 401 / 403              signed out, or signed in without a Pass
 *
 * WHY A SIGNED URL RATHER THAN THE BYTES. season.mts serves gated corpora
 * directly, and that works because those files are ~1.2 MB. The game-log
 * corpora are not: game-index is 6.3 MB a season, which is at or over the
 * response ceiling a Netlify function runs under, and even under it the site
 * would be paying function egress for something R2 gives away. So this
 * endpoint moves the CHECK to the function and leaves the BYTES on R2 — the
 * function signs, the browser fetches, nothing large passes through here.
 *
 * WHAT MAKES IT A REAL GATE. The signed objects live in a bucket with no
 * public access, so the r2.dev URL that serves every free file does not reach
 * them. Presigning is the only way in and it requires a credential that exists
 * only in this function's environment. Compare the client-side row cap in the
 * game log, which is a sign rather than a door: the browser already holds
 * every row it is declining to draw.
 *
 * THE EXPIRY IS ROUNDED TO THE HOUR, ON PURPOSE. A signature that embedded the
 * current second would produce a different URL on every call, so every
 * navigation would miss the browser cache and re-download 6.3 MB — the gate
 * would work and the product would feel broken. Rounding down to the hour
 * means every request inside the same hour signs the SAME url string, which
 * the browser can cache normally, and the signature still dies within two
 * hours of being issued.
 */

/**
 * The only files this will sign, as a fixed map.
 *
 * AN ALLOW-LIST, NOT A PATH JOIN — the same rule as season.mts, and for the
 * same reason: `kind` reaches an object key, so it is matched rather than
 * interpolated. A caller cannot walk out of the gated prefix and cannot ask
 * for something that was never meant to be signed.
 */
const CORPUS_KEY: Record<string, string> = {
  games: "game-index",
  "team-games": "team-game-index",
};

/**
 * Seasons anyone may read, duplicated from src/lib/access.ts.
 *
 * SAME ARGUMENT AS ACTIVE_STATUSES. That file is client code and decides what
 * to draw; this decides what to sign. If the two are one constant, a change
 * made to open up the front page also opens the archive, silently.
 *
 * A free season is refused here rather than signed, because free seasons are
 * not in the private bucket at all — they stay on the public mirror where the
 * browser fetches them with no round trip. Signing one would hand back a URL
 * for an object that does not exist.
 */
const FREE_SEASONS = new Set([2026, 2025, 2027]);

/** How long a signature stays valid. Two hours, so an hour-rounded issue time
 *  still leaves at least an hour of life on the URL a browser cached. */
const TTL_SECONDS = 2 * 60 * 60;

function parseYear(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 2000 && y <= 2100 ? y : null;
}

let client: S3Client | null = null;

/**
 * PREFERS A CREDENTIAL SCOPED TO THE GATED BUCKET, falls back to the main pair.
 *
 * R2 API tokens can be scoped to specific buckets, and this account's main
 * token is: it answers AccessDenied to ListBuckets, which means it was issued
 * against bta-data alone and cannot see a bucket created later. The archive
 * bucket already hit this and carries its own R2_ARCHIVE_* pair for the same
 * reason.
 *
 * So R2_GATED_ACCESS_KEY_ID / R2_GATED_SECRET_ACCESS_KEY win when present. The
 * fallback is not dead code: an account-wide token would make them unnecessary,
 * and this way that setup works without an env var nobody needed. If signing
 * returns AccessDenied in production, the scoped pair is what is missing.
 */
function r2(): S3Client | null {
  if (client) return client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_GATED_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_GATED_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export const config = { path: "/api/data-url" };

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") {
    return Response.json({ error: "GET only" }, { status: 405 });
  }

  const url = new URL(req.url);
  const key = CORPUS_KEY[url.searchParams.get("kind") ?? ""];
  const year = parseYear(url.searchParams.get("year"));
  if (!key || year === null) {
    return Response.json(
      { error: "Expected ?kind=<games|team-games>&year=<yyyy>." },
      { status: 400 },
    );
  }
  if (FREE_SEASONS.has(year)) {
    // Not an error the caller should route around — it means "fetch this the
    // ordinary way", and the client treats it as such.
    return Response.json({ error: "That season is free.", reason: "free" }, { status: 400 });
  }

  const gate = await requirePaid(req, "data-url");
  if ("response" in gate) return gate.response;

  const s3 = r2();
  const bucket = process.env.R2_GATED_BUCKET;
  if (!s3 || !bucket) {
    return Response.json(
      { error: "Gated storage is not configured on this deploy." },
      { status: 503 },
    );
  }

  // Round DOWN to the hour so the same request signs the same string all hour
  // — see the note above about cache misses.
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const signed = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: `${key}/${year}.json` }),
    { expiresIn: TTL_SECONDS, signingDate: new Date(hour) },
  );

  return Response.json(
    { url: signed, expires: hour + TTL_SECONDS * 1000 },
    {
      status: 200,
      headers: {
        // PRIVATE. This is entitlement-specific; a shared edge cache would
        // hand a subscriber's signature to the next visitor. Half the TTL so
        // a cached answer is never close to expiring when it is used.
        "cache-control": "private, max-age=3600",
      },
    },
  );
};
