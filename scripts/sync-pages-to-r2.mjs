#!/usr/bin/env node
/**
 * sync-pages-to-r2.mjs — the game pages themselves, mirrored to R2.
 *
 *   node scripts/sync-pages-to-r2.mjs            # after a build
 *   node scripts/sync-pages-to-r2.mjs --limit 40 # smoke test a handful
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT sync-data-to-r2.mjs.
 *
 * That script mirrors DATA out of public/data. This one mirrors rendered
 * PAGES out of out/. Same bucket, same dedupe, different source and a
 * different reason.
 *
 * The reason is a hard ceiling we hit on 2026-09-09. The scoreboard archive
 * gives every game since 2014 its own prerendered page — 74,307 of them — and
 * Next 16 writes ten files per page, not one: index.html plus nine RSC
 * payloads (`index.txt`, `__next._tree.txt`, `__next._full.txt` and the
 * per-segment payloads). That is ~743,000 files, which took the deploy from
 * ~361,000 files (the last one that succeeded, 72 minutes) to 1,104,267.
 *
 * Netlify hashed all of them and then failed while diffing against the CDN —
 * a 422 with an internal Mongo read timeout on the first attempt, a bare 500
 * on the second. Two different backend errors at the same stage, so it is the
 * manifest size rather than bad luck. Netlify documents no per-deploy file cap
 * (only 54,000 per directory, which we are nowhere near — our largest is
 * out/players at 15,729), so there is no number to design against; the only
 * lever is to stop shipping the files through the deploy at all.
 *
 * WHY NOT JUST DROP THE PAGES. They are the entire point of the archive:
 * somebody googling "oklahoma vs florida state basketball score" lands on one.
 * Serving them from R2 behind a Netlify rewrite keeps every URL exactly as it
 * was — same origin, same path, a 200 with real HTML — so the SEO plan is
 * untouched while the deploy drops back to its known-good size.
 *
 * KEY PREFIX. Data keys are relative to public/data, so the bucket root
 * already has a `games/` (the per-game JSON bundles). Pages therefore go under
 * `pages/`, and out/games/2026/x/index.html becomes pages/games/2026/x/index.html.
 * Do not flatten this; the two would collide.
 *
 * CONTENT TYPE MATTERS HERE, unlike the data sync where everything is JSON. R2
 * serves what we stamp at upload, and the browser gets that through the proxy
 * verbatim. An index.html served as application/json renders as text.
 *
 * netlify.toml carries the matching rewrite. If you change the prefix here,
 * change it there in the same commit or every game page 404s.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { config as dotenvConfig } from "dotenv";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { CACHE_CONTROL } from "./lib/r2-cache.mjs";
import { PAGE_MIRRORED_DIRS } from "./lib/out-strip-lists.mjs";

dotenvConfig({ path: ".env.local" });

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
}

/**
 * Where the pages are by the time this runs.
 *
 * The build wrapper MOVES them to page-mirror/ as its last act, so that is the
 * normal source. out/ is the fallback for a tree built before the wrapper
 * learned to move them — and the keys are identical either way, because the
 * `games/...` part of the path is all that survives into the R2 key.
 */
const SRC_ROOT = fs.existsSync(path.resolve("page-mirror", "games"))
  ? path.resolve("page-mirror")
  : path.resolve("out");
const KEY_PREFIX = "pages";

const args = process.argv.slice(2);
const limitArg = Number(args[args.indexOf("--limit") + 1]) || 0;

/**
 * Higher than the data sync's 50, and tunable, because this job is a different
 * shape: three quarters of a million files averaging a few KB each, nearly all
 * of them genuine PUTs on a first run rather than the HEAD-and-skip the data
 * sync mostly does. At 50 the observed rate was ~98 files/s — about 0.5 MB/s,
 * far under the link's capacity, which means the limit was round-trip latency
 * and not bandwidth. More requests in flight is the only thing that helps.
 */
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 200;

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const md5Hex = (buf) => createHash("md5").update(buf).digest("hex");

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

/** out/games/2026/x/index.html → pages/games/2026/x/index.html */
function toKey(localPath) {
  const rel = path.relative(SRC_ROOT, localPath).split(path.sep).join("/");
  return `${KEY_PREFIX}/${rel}`;
}

/**
 * Only two extensions exist under out/games, but guess deliberately rather
 * than defaulting — a wrong Content-Type here is invisible until a browser
 * renders markup as plain text.
 */
function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (p.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

let uploaded = 0, skipped = 0, failed = 0;
const startMs = Date.now();
const totalRef = { count: 0 };

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

  // ETag is the md5 for non-multipart PUTs, so unchanged pages cost one HEAD
  // instead of an upload. A rebuild rewrites every file's mtime but almost
  // none of their bytes, which is what makes a re-sync cheap.
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if ((head.ETag ?? "").replace(/"/g, "") === localMd5) {
      skipped++;
      tick();
      return;
    }
  } catch (e) {
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") {
      console.warn(`HEAD fail ${key}: ${e.message ?? e.name}`);
    }
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: contentType(localPath),
      CacheControl: CACHE_CONTROL,
    }));
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

async function main() {
  const files = [];
  for (const dir of PAGE_MIRRORED_DIRS) {
    const abs = path.join(SRC_ROOT, dir);
    if (!fs.existsSync(abs)) {
      console.error(`No ${path.relative(process.cwd(), abs)} — run the build first.`);
      process.exit(1);
    }
    let n = 0;
    for (const f of walk(abs)) {
      files.push(f);
      n++;
    }
    console.log(`  ${path.basename(SRC_ROOT)}/${dir}: ${n.toLocaleString()} files`);
  }

  const queue = limitArg ? files.slice(0, limitArg) : files;
  totalRef.count = queue.length;
  console.log(`\nUploading ${queue.length.toLocaleString()} files to "${R2_BUCKET}" under ${KEY_PREFIX}/`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) await uploadOne(queue[cursor++]);
    }),
  );

  console.log(`\n\nDone in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
  console.log(`  uploaded: ${uploaded.toLocaleString()}`);
  console.log(`  skipped:  ${skipped.toLocaleString()}`);
  console.log(`  failed:   ${failed}`);
  if (failed) process.exit(1);
}

main();
