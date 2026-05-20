#!/usr/bin/env node
/**
 * One-shot uploader: public/data/{team-games,player-games,player,player-ranks,tournament-box,team}
 * → Cloudflare R2.
 *
 * Why this exists: the directories above contain ~152k tiny JSON files. Netlify's
 * deploy upload caps out at ~18 min and times out on this many files. R2 has
 * S3-compatible writes (no per-file Netlify timeout) and free egress, so we
 * mirror the directory structure there and have the browser fetch from
 * pub-*.r2.dev instead of the local /data/ path.
 *
 * Resume / dedupe: each PutObject sets the ETag (md5 of body) on R2. We HEAD
 * each candidate first and skip if local md5 == remote ETag. So a re-run of
 * this script after a partial failure only uploads what changed, costing one
 * Class B HEAD per file instead of a full re-upload.
 *
 * Usage: npm run sync:r2
 *
 * Reads creds from .env.local (R2_ENDPOINT, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET). Errors loudly if any are missing.
 */

import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { config as dotenvConfig } from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

dotenvConfig({ path: ".env.local" });

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

for (const [k, v] of Object.entries({
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
})) {
  if (!v) {
    console.error(`Missing ${k} in .env.local. Aborting.`);
    process.exit(1);
  }
}

// Match dirs to the R2 mirror — same prefixes the dataUrl() helper expects.
const DIRS = [
  "public/data/team-games",
  "public/data/player-games",
  "public/data/player",
  "public/data/player-ranks",
  "public/data/tournament-box",
  "public/data/team",
];

// Concurrency: R2 happily takes hundreds of parallel writes; we don't want to
// thrash the local file system or saturate the upload bandwidth, so 50 is a
// safe-ish middle ground. Bump if your link is fat.
const CONCURRENCY = 50;

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

function md5Hex(buf) {
  return createHash("md5").update(buf).digest("hex");
}

// Walk a dir recursively, yielding absolute paths to every file.
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

// Convert local path → R2 key (strip "public/data/" prefix, normalize slashes).
function toKey(localPath) {
  const rel = path.relative("public/data", localPath);
  return rel.split(path.sep).join("/");
}

let uploaded = 0;
let skipped = 0;
let failed = 0;
const startMs = Date.now();
const totalRef = { count: 0 }; // set after enumeration

async function uploadOne(localPath) {
  const key = toKey(localPath);
  let buf;
  try {
    buf = await readFile(localPath);
  } catch (e) {
    console.error(`Read fail ${localPath}: ${e.message}`);
    failed++;
    return;
  }
  const localMd5 = md5Hex(buf);

  // Skip if R2 already has this exact bytes (ETag == md5 for non-multipart PUTs).
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    // ETag comes wrapped in quotes; strip and compare.
    const remoteEtag = (head.ETag ?? "").replace(/"/g, "");
    if (remoteEtag === localMd5) {
      skipped++;
      tick();
      return;
    }
  } catch (e) {
    // 404 means "doesn't exist" — proceed to upload.
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") {
      console.warn(`HEAD fail ${key}: ${e.message ?? e.name}`);
      // Continue to upload anyway — it's idempotent.
    }
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buf,
        ContentType: "application/json",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    uploaded++;
  } catch (e) {
    console.error(`PUT fail ${key}: ${e.message ?? e.name}`);
    failed++;
  }
  tick();
}

let lastLogged = 0;
function tick() {
  const done = uploaded + skipped + failed;
  // Throttle progress logging to once every 500 files (or final tick).
  if (done - lastLogged >= 500 || done === totalRef.count) {
    const elapsed = (Date.now() - startMs) / 1000;
    const rate = done / Math.max(elapsed, 1);
    const eta = totalRef.count > done ? (totalRef.count - done) / Math.max(rate, 0.1) : 0;
    process.stdout.write(
      `\r${done.toLocaleString()}/${totalRef.count.toLocaleString()} ` +
      `· up ${uploaded.toLocaleString()} skip ${skipped.toLocaleString()} fail ${failed} ` +
      `· ${rate.toFixed(0)}/s · ETA ${Math.round(eta)}s   `,
    );
    lastLogged = done;
  }
}

// Bounded-concurrency pool: keeps CONCURRENCY in-flight; pulls from `files`.
async function runPool(files) {
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const idx = i++;
      await uploadOne(files[idx]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function main() {
  console.log(`Enumerating files under ${DIRS.length} dirs…`);
  const files = [];
  for (const dir of DIRS) {
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
    } catch {
      console.warn(`  skip missing ${dir}`);
      continue;
    }
    let n = 0;
    for (const p of walk(dir)) { files.push(p); n++; }
    console.log(`  ${dir}: ${n.toLocaleString()} files`);
  }
  totalRef.count = files.length;
  console.log(`\nUploading ${files.length.toLocaleString()} files to R2 bucket "${R2_BUCKET}"`);
  console.log(`Concurrency: ${CONCURRENCY}. Endpoint: ${R2_ENDPOINT}\n`);

  await runPool(files);

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  process.stdout.write("\n\n");
  console.log(`Done in ${elapsed}s`);
  console.log(`  uploaded: ${uploaded.toLocaleString()}`);
  console.log(`  skipped (already in R2): ${skipped.toLocaleString()}`);
  console.log(`  failed: ${failed.toLocaleString()}`);
  if (failed > 0) {
    console.log("\nRe-run to retry failed uploads. The script is idempotent.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nFatal:", e);
  process.exit(1);
});
