#!/usr/bin/env node
/**
 * r2-snapshot.mjs — keep one previous copy of the live season, and put it back.
 *
 * WHY THIS EXISTS. During the season the site is only as good as last night's
 * job. The nightly rewrites every live-season file, and until now a bad run —
 * a feed that returned half a slate, a builder that shipped nulls — replaced
 * good numbers with bad ones and there was no way back except running the
 * whole chain again and hoping. That is the wrong thing to be doing at 7am.
 *
 * ONE GENERATION, NOT A HISTORY. `live/_prev/` holds exactly the state before
 * the most recent publish. A deeper history sounds better and is not: the
 * failure this guards against is noticed within a day, restoring two nights
 * back would silently discard a good night in between, and every extra
 * generation is another full copy of 47 MB to store and to reason about.
 *
 * SERVER-SIDE COPIES. CopyObject never moves the bytes through here, so a
 * snapshot of 5,000 objects costs a few seconds of API calls rather than a
 * download and re-upload of the whole season.
 *
 * THE SNAPSHOT IS TAKEN BEFORE THE PUBLISH, NOT AFTER. Taken after, "previous"
 * would mean the run that just happened, and rolling back a bad night would
 * restore the bad night.
 *
 *   node scripts/r2-snapshot.mjs --snapshot        before publishing
 *   node scripts/r2-snapshot.mjs --restore         put the previous copy back
 *   node scripts/r2-snapshot.mjs --status          what is in each
 */
import { config as dotenvConfig } from "dotenv";
import {
  S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { CACHE_CONTROL } from "./lib/r2-cache.mjs";

dotenvConfig({ path: ".env.local" });

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) { console.error(`Missing ${k}. Aborting.`); process.exit(1); }
}

/**
 * The prefixes a rollback covers, and deliberately only these.
 *
 * They are what a nightly run rewrites. The frozen seasons are not here and
 * must never be: restoring them is not a rollback, it is discarding a
 * correction that was probably the reason someone rebuilt in the first place.
 */
const LIVE = "live/";
const PREV = "_prev/live/";

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function listAll(prefix) {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of r.Contents ?? []) keys.push({ key: o.Key, size: o.Size, at: o.LastModified });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Copy every object under `from` to the same path under `to`, replacing what is there. */
async function copyPrefix(from, to, label) {
  const src = await listAll(from);
  if (src.length === 0) {
    console.log(`${label}: nothing under ${from} — nothing to do.`);
    return 0;
  }
  // Clear the destination first, so an object deleted at source (a team that
  // dropped out) does not survive in the copy and get restored later.
  const stale = await listAll(to);
  for (const o of stale) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: o.key }));
  }

  let n = 0;
  for (const o of src) {
    const dest = to + o.key.slice(from.length);
    await s3.send(new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: `${R2_BUCKET}/${encodeURIComponent(o.key).replace(/%2F/g, "/")}`,
      Key: dest,
      CacheControl: CACHE_CONTROL,
      MetadataDirective: "REPLACE",
      ContentType: "application/json",
    }));
    n++;
    if (n % 500 === 0) console.log(`  ${n}/${src.length}…`);
  }
  console.log(`${label}: ${n} objects ${from} → ${to}`);
  return n;
}

const mode =
  process.argv.includes("--restore") ? "restore" :
  process.argv.includes("--status") ? "status" :
  process.argv.includes("--snapshot") ? "snapshot" : null;

if (!mode) {
  console.error("Pass --snapshot, --restore or --status.");
  process.exit(1);
}

if (mode === "status") {
  const [live, prev] = await Promise.all([listAll(LIVE), listAll(PREV)]);
  const newest = (a) => a.reduce((m, o) => (o.at > m ? o.at : m), new Date(0));
  const mb = (a) => (a.reduce((s, o) => s + (o.size ?? 0), 0) / 1024 / 1024).toFixed(1);
  console.log(`live   ${String(live.length).padStart(6)} objects  ${mb(live).padStart(6)} MB  newest ${live.length ? newest(live).toISOString() : "—"}`);
  console.log(`_prev  ${String(prev.length).padStart(6)} objects  ${mb(prev).padStart(6)} MB  newest ${prev.length ? newest(prev).toISOString() : "—"}`);
  if (prev.length === 0) console.log("\nNo snapshot yet — a rollback would have nothing to restore.");
  process.exit(0);
}

if (mode === "snapshot") {
  await copyPrefix(LIVE, PREV, "snapshot");
} else {
  const prev = await listAll(PREV);
  if (prev.length === 0) {
    // Refusing beats "restoring" nothing and reporting success, which would
    // leave a bad night in place while the log said the rollback worked.
    console.error("REFUSING: there is no snapshot under _prev/live/. Nothing to restore.");
    process.exit(1);
  }
  await copyPrefix(PREV, LIVE, "restore");
  console.log("\nRolled back. The site serves the previous run's numbers from the next cache expiry.");
}
