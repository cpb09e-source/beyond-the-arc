#!/usr/bin/env node
/**
 * sync-gated-corpora.mjs — move the paid game-log corpora off the public bucket.
 *
 * THE HOLE THIS CLOSES. game-index (6.3 MB a season) and team-game-index
 * (1.6 MB) have been on the PUBLIC R2 bucket for every season, paid ones
 * included. Anyone who opened the network tab could read the entire archive
 * without an account. The Game Log Explorer's five-row preview was a sign, not
 * a door — the browser already held every row it was declining to draw.
 *
 * They were never staged into the function bundle like the other gated corpora
 * (see GATED_CORPORA in src/lib/access.ts) because ten seasons of game-index is
 * ~77 MB and Netlify's function limit is 50 MB zipped. So the gate for these is
 * a presigned URL instead: netlify/functions/data-url.mts signs, the browser
 * fetches R2 directly, and no large payload passes through a function.
 *
 *   node scripts/sync-gated-corpora.mjs --push
 *       Upload every PAID season to R2_GATED_BUCKET. Safe, additive, and
 *       idempotent — run it as often as you like.
 *
 *   node scripts/sync-gated-corpora.mjs --verify
 *       Report what is in each bucket without writing anything.
 *
 *   node scripts/sync-gated-corpora.mjs --purge-public --yes
 *       DESTRUCTIVE. Delete the paid seasons from the PUBLIC bucket. This is
 *       the step that actually closes the hole, and the one with an ordering
 *       requirement — see below.
 *
 * ORDER MATTERS AND GETTING IT WRONG BREAKS PRODUCTION:
 *
 *   1. Deploy the client (src/lib/gated-corpus.ts) so the browser knows to ask
 *      /api/data-url for a signature.
 *   2. Set R2_GATED_BUCKET on Netlify so the function can sign.
 *   3. --push, so the objects exist in the private bucket.
 *   4. --verify, and only then
 *   5. --purge-public.
 *
 * Purge before the deploy and every game log in production 404s until the
 * deploy lands. That is why purge is a separate invocation behind --yes rather
 * than the tail end of --push: the two halves are not safe to run together and
 * the script should not pretend otherwise.
 *
 * WHY IT REFUSES TO PURGE WHAT IT HAS NOT CONFIRMED. --purge-public HEADs the
 * gated bucket for every object before deleting the public copy, and skips any
 * that is missing. Deleting the only copy of a corpus because a push half
 * failed is the one unrecoverable mistake available here.
 */
import fs from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { config as dotenvConfig } from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

dotenvConfig({ path: ".env.local" });

/**
 * Seasons anyone may read. DUPLICATED from src/lib/access.ts, and from
 * netlify/functions/data-url.mts, on purpose.
 *
 * Three copies is not an oversight to tidy into one import. This script MOVES
 * FILES; access.ts decides what to draw; the function decides what to sign. A
 * single constant would mean that widening the free tier on the front page also
 * silently deletes objects out of the private bucket the next time this runs.
 * The lists are meant to be changed together, deliberately, by someone who has
 * read all three.
 *
 * 2027 is the preview season and is free — it is in the function's list for the
 * same reason and must stay in step with it.
 */
const FREE_SEASONS = new Set([2027, 2026, 2025]);

/** Corpus directory under public/data → object prefix in either bucket. */
const CORPORA = ["game-index", "team-game-index"];

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_GATED_BUCKET,
} = process.env;

const args = process.argv.slice(2);
const PUSH = args.includes("--push");
const VERIFY = args.includes("--verify");
const PURGE = args.includes("--purge-public");
const YES = args.includes("--yes");

if (!PUSH && !VERIFY && !PURGE) {
  console.error("usage: --push | --verify | --purge-public --yes");
  process.exit(1);
}

const required = { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_GATED_BUCKET };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`\nMissing from .env.local: ${missing.join(", ")}\n`);
  if (missing.includes("R2_GATED_BUCKET")) {
    console.error("Set up, once, in the Cloudflare dashboard:");
    console.error("  1. R2 → Create bucket, e.g. bta-gated.");
    console.error("     Do NOT enable public access, an r2.dev subdomain or a custom domain.");
    console.error("     That is the whole gate — a public bucket makes presigning theatre.");
    console.error("  2. Add R2_GATED_BUCKET=bta-gated to .env.local AND to Netlify,");
    console.error("     where netlify/functions/data-url.mts reads it.\n");
  }
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

/** Every paid season that has a file on disk, as {corpus, year, key, file}. */
function paidObjects() {
  const out = [];
  for (const corpus of CORPORA) {
    const dir = path.resolve("public/data", corpus);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d{4})\.json$/.exec(name);
      if (!m) continue;
      const year = Number(m[1]);
      if (FREE_SEASONS.has(year)) continue;
      out.push({ corpus, year, key: `${corpus}/${year}.json`, file: path.join(dir, name) });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

async function head(Bucket, Key) {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket, Key }));
    return r.ContentLength ?? 0;
  } catch {
    return null;
  }
}

const mb = (n) => (n / 1048576).toFixed(1) + " MB";

const objects = paidObjects();
if (!objects.length) {
  console.error("No paid-season corpus files found under public/data. Nothing to do.");
  process.exit(1);
}

if (PUSH) {
  console.log(`\nPushing ${objects.length} paid-season objects → ${R2_GATED_BUCKET}\n`);
  let up = 0, same = 0;
  for (const o of objects) {
    const body = await readFile(o.file);
    const existing = await head(R2_GATED_BUCKET, o.key);
    if (existing === body.length) { same++; console.log(`  = ${o.key} (${mb(body.length)})`); continue; }
    await client.send(new PutObjectCommand({
      Bucket: R2_GATED_BUCKET,
      Key: o.key,
      Body: body,
      ContentType: "application/json",
      // No CDN cache-control: these are handed out as signed URLs to
      // individual subscribers, and a shared cache is exactly what the gate
      // exists to avoid.
      CacheControl: "private, max-age=0, no-store",
    }));
    up++;
    console.log(`  ↑ ${o.key} (${mb(body.length)})`);
  }
  console.log(`\n✓ uploaded ${up}, unchanged ${same}\n`);
}

if (VERIFY || PUSH) {
  console.log("Where each paid season lives now:\n");
  let leaking = 0, missingGated = 0;
  for (const o of objects) {
    const [pub, gated] = await Promise.all([
      head(R2_BUCKET, o.key),
      head(R2_GATED_BUCKET, o.key),
    ]);
    if (pub !== null) leaking++;
    if (gated === null) missingGated++;
    console.log(
      `  ${o.key.padEnd(28)} public:${pub === null ? "absent " : "PRESENT"}  gated:${gated === null ? "ABSENT" : "present"}`,
    );
  }
  console.log();
  if (missingGated) console.log(`  ${missingGated} object(s) not yet in the gated bucket — run --push.`);
  if (leaking) {
    console.log(`  ${leaking} paid object(s) still readable on the PUBLIC bucket.`);
    console.log("  The hole is open until --purge-public runs, and that must come AFTER");
    console.log("  the client deploy. See the header.");
  }
  if (!leaking && !missingGated) console.log("  ✓ Every paid season is gated and none is public.");
  console.log();
}

if (PURGE) {
  if (!YES) {
    console.error("\n--purge-public deletes objects from the PUBLIC bucket and needs --yes.\n");
    console.error("Confirm all three before you run it:");
    console.error("  1. The client (src/lib/gated-corpus.ts) is DEPLOYED to production.");
    console.error("  2. R2_GATED_BUCKET is set on Netlify.");
    console.error("  3. --verify shows every paid season present in the gated bucket.\n");
    process.exit(1);
  }
  console.log(`\nPurging paid seasons from the PUBLIC bucket ${R2_BUCKET}\n`);
  let gone = 0, skipped = 0;
  for (const o of objects) {
    // Never delete the public copy of something the private bucket does not
    // have. A half-finished push plus a purge is the one unrecoverable
    // mistake available in this script.
    const gated = await head(R2_GATED_BUCKET, o.key);
    if (gated === null) {
      skipped++;
      console.log(`  ! ${o.key} — NOT in the gated bucket, refusing to delete the only copy`);
      continue;
    }
    if ((await head(R2_BUCKET, o.key)) === null) {
      console.log(`  = ${o.key} already gone`);
      continue;
    }
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: o.key }));
    gone++;
    console.log(`  ✗ ${o.key} deleted from public`);
  }
  console.log(`\n✓ deleted ${gone}, refused ${skipped}`);
  if (skipped) {
    console.log("  Refusals mean --push has not finished. Run it, then --verify, then this again.");
    process.exitCode = 1;
  }
  console.log();
}
