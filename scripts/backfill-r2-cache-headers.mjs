#!/usr/bin/env node
/**
 * backfill-r2-cache-headers.mjs — rewrite Cache-Control across the R2 bucket.
 *
 * WHY THIS CAN'T BE A RE-SYNC: sync-data-to-r2.mjs skips any object whose md5
 * matches the remote ETag. That is a CONTENT comparison, so objects whose
 * bytes haven't changed keep their old metadata forever no matter how many
 * times the sync runs. Changing the cache policy needs a pass that rewrites
 * metadata specifically — this one.
 *
 * HOW: CopyObject with MetadataDirective REPLACE, source == destination. The
 * copy happens server-side inside R2, so nothing is uploaded or downloaded;
 * we pay one Class A operation per object and no bandwidth.
 *
 * MetadataDirective REPLACE DISCARDS EVERY HEADER NOT RESTATED, so ContentType
 * is set explicitly alongside CacheControl. The script refuses to touch any key
 * that isn't `.json` rather than guess a content type for it — every object
 * this bucket is supposed to hold is JSON, so a non-JSON key means something
 * unexpected is in there and should be looked at, not silently rewritten.
 *
 * Idempotent: re-running just rewrites the same headers. Safe to interrupt and
 * resume — pass --skip-correct to HEAD each object first and only rewrite the
 * ones that don't already carry the target header (one Class B per object,
 * cheaper than a Class A when most are already done).
 *
 * Usage:
 *   node scripts/backfill-r2-cache-headers.mjs --dry
 *   node scripts/backfill-r2-cache-headers.mjs
 *   node scripts/backfill-r2-cache-headers.mjs --prefix shots/
 *   node scripts/backfill-r2-cache-headers.mjs --skip-correct   (resume a partial run)
 */
import { config as dotenvConfig } from "dotenv";
import {
  S3Client, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { CACHE_CONTROL } from "./lib/r2-cache.mjs";

dotenvConfig({ path: ".env.local" });

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) { console.error(`Missing ${k} in .env.local. Aborting.`); process.exit(1); }
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const SKIP_CORRECT = args.includes("--skip-correct");
const pi = args.indexOf("--prefix");
const PREFIX = pi > -1 ? args[pi + 1] : "";

const CONCURRENCY = 50;

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function* listAll(prefix) {
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix || undefined, ContinuationToken: token, MaxKeys: 1000,
    }));
    for (const o of res.Contents ?? []) yield o;
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

console.log(`Target Cache-Control: ${CACHE_CONTROL}`);
process.stdout.write(`Listing ${R2_BUCKET}/${PREFIX || "(whole bucket)"} …`);
const keys = [];
const skipped = [];
for await (const o of listAll(PREFIX)) {
  if (o.Key.endsWith(".json")) keys.push(o.Key);
  else skipped.push(o.Key);
  if ((keys.length + skipped.length) % 20000 === 0) {
    process.stdout.write(`\rListing ${R2_BUCKET}/${PREFIX || "(whole bucket)"} … ${keys.length.toLocaleString()}`);
  }
}
process.stdout.write(`\rListing ${R2_BUCKET}/${PREFIX || "(whole bucket)"} … ${keys.length.toLocaleString()} JSON objects\n`);

if (skipped.length) {
  console.warn(`\n! ${skipped.length} non-.json key(s) left untouched (unknown content type):`);
  for (const k of skipped.slice(0, 10)) console.warn(`    ${k}`);
}
if (keys.length === 0) { console.log("Nothing to do."); process.exit(0); }

// Sample the current header so the run reports what it's actually changing.
const sample = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: keys[0] }));
console.log(`Current header on ${keys[0]}: ${sample.CacheControl ?? "(none)"}`);

if (DRY) {
  console.log(`\nDry run. Re-run without --dry to rewrite ${keys.length.toLocaleString()} objects.`);
  process.exit(0);
}

let done = 0, rewritten = 0, alreadyOk = 0, failed = 0;
const t0 = Date.now();

function tick() {
  done++;
  if (done % 2000 === 0 || done === keys.length) {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = done / Math.max(elapsed, 1);
    const eta = Math.round((keys.length - done) / Math.max(rate, 0.1));
    process.stdout.write(
      `\r${done.toLocaleString()}/${keys.length.toLocaleString()} ` +
      `· rewrote ${rewritten.toLocaleString()} skip ${alreadyOk.toLocaleString()} fail ${failed} ` +
      `· ${rate.toFixed(0)}/s · ETA ${eta}s   `,
    );
  }
}

async function fixOne(key) {
  try {
    if (SKIP_CORRECT) {
      const h = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      if (h.CacheControl === CACHE_CONTROL) { alreadyOk++; tick(); return; }
    }
    await client.send(new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      // Same object in, same object out — the point is the metadata rewrite.
      CopySource: `${R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
      MetadataDirective: "REPLACE",
      CacheControl: CACHE_CONTROL,
      ContentType: "application/json",
    }));
    rewritten++;
  } catch (e) {
    failed++;
    if (failed <= 10) console.error(`\n  ${key}: ${e.message ?? e.name}`);
  }
  tick();
}

let i = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < keys.length) await fixOne(keys[i++]);
}));
process.stdout.write("\n");

// Verify against the bucket rather than trusting the copy responses: sample
// across prefixes so a prefix that silently failed can't hide behind a
// healthy one.
const byPrefix = new Map();
for (const k of keys) {
  const p = k.split("/")[0];
  if (!byPrefix.has(p)) byPrefix.set(p, k);
}
console.log("\nVerifying one object per prefix:");
let bad = 0;
for (const [p, k] of byPrefix) {
  const h = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: k }));
  const ok = h.CacheControl === CACHE_CONTROL;
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${p.padEnd(18)} ${h.CacheControl ?? "(none)"}`);
}

console.log(
  `\n${failed === 0 && bad === 0 ? "✓" : "✗"} rewrote ${rewritten.toLocaleString()}, ` +
  `already correct ${alreadyOk.toLocaleString()}, failed ${failed} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
if (failed > 0 || bad > 0) {
  console.log("Re-run with --skip-correct to retry only what's still wrong.");
  process.exit(1);
}
