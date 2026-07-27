#!/usr/bin/env node
/**
 * prune-r2-prefix.mjs — delete an obsolete key prefix from the R2 bucket.
 *
 * sync-data-to-r2.mjs only ever uploads, so a directory that gets renamed or
 * retired locally leaves its objects behind in the bucket forever. They cost
 * storage and, worse, keep serving a shape the app no longer expects if any
 * old client is still pointed at them.
 *
 * DRY BY DEFAULT. Pass --delete to actually remove. The dry run prints the
 * key count, total size, and a sample so the prefix can be eyeballed before
 * anything is destroyed.
 *
 * Usage:
 *   node scripts/prune-r2-prefix.mjs --prefix team-games/
 *   node scripts/prune-r2-prefix.mjs --prefix team-games/ --delete
 */
import path from "node:path";
import fs from "node:fs";
import { config as dotenvConfig } from "dotenv";
import {
  S3Client, ListObjectsV2Command, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

dotenvConfig({ path: ".env.local" });

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) { console.error(`Missing ${k} in .env.local. Aborting.`); process.exit(1); }
}

const args = process.argv.slice(2);
const DELETE = args.includes("--delete");
const pi = args.indexOf("--prefix");
const PREFIX = pi > -1 ? args[pi + 1] : null;
if (!PREFIX) { console.error("Usage: prune-r2-prefix.mjs --prefix <keyPrefix/> [--delete]"); process.exit(1); }

// Guard: refuse a prefix that still exists locally under public/data. If the
// directory is live, this is a mistake, not a prune.
const localMirror = path.join("public/data", PREFIX);
if (fs.existsSync(localMirror)) {
  console.error(`REFUSING: ${localMirror} still exists locally — this prefix is live, not stale.`);
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function* listAll(prefix) {
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000,
    }));
    for (const o of res.Contents ?? []) yield o;
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

const keys = [];
let bytes = 0;
process.stdout.write(`Listing ${R2_BUCKET}/${PREFIX} …`);
for await (const o of listAll(PREFIX)) {
  keys.push(o.Key);
  bytes += o.Size ?? 0;
  if (keys.length % 5000 === 0) process.stdout.write(`\rListing ${R2_BUCKET}/${PREFIX} … ${keys.length.toLocaleString()}`);
}
process.stdout.write(`\rListing ${R2_BUCKET}/${PREFIX} … ${keys.length.toLocaleString()} objects, ${(bytes / 1e6).toFixed(1)} MB\n`);

if (keys.length === 0) { console.log("Nothing to prune."); process.exit(0); }
console.log("Sample:", keys.slice(0, 3).join(", "));
console.log("Last:  ", keys.slice(-2).join(", "));

if (!DELETE) {
  console.log(`\nDry run. Re-run with --delete to remove these ${keys.length.toLocaleString()} objects.`);
  process.exit(0);
}

let deleted = 0, failed = 0;
for (let i = 0; i < keys.length; i += 1000) {
  const batch = keys.slice(i, i + 1000);
  const res = await client.send(new DeleteObjectsCommand({
    Bucket: R2_BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
  }));
  deleted += batch.length - (res.Errors?.length ?? 0);
  for (const e of res.Errors ?? []) { failed++; console.error(`  ${e.Key}: ${e.Message}`); }
  process.stdout.write(`\rDeleted ${deleted.toLocaleString()}/${keys.length.toLocaleString()}`);
}
process.stdout.write("\n");

// Verify by re-listing rather than trusting the delete responses.
let remaining = 0;
for await (const _ of listAll(PREFIX)) remaining++;
console.log(`\n✓ deleted ${deleted.toLocaleString()}, failed ${failed}, remaining under prefix: ${remaining}`);
if (remaining > 0 || failed > 0) process.exit(1);
