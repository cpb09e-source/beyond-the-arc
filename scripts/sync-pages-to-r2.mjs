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
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "node:https";
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
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 64;

/**
 * Retries per file. Connection-level failures here arrive with NO message and
 * no status — the socket simply goes away — so they cannot be distinguished
 * from a real error by inspection, only by trying again.
 */
const MAX_TRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * RAISING CONCURRENCY ALONE DOES NOTHING — the SDK's connection pool defaults
 * to 50 sockets, so 200 workers just queue behind 50 and the run gets slower
 * from the contention rather than faster. The SDK says so out loud:
 *
 *   @smithy/node-http-handler:WARN - socket usage at capacity=50 and 149
 *   additional requests are enqueued.
 *
 * The pool has to be widened to match, which is the whole point of a job that
 * is round-trip-bound rather than bandwidth-bound.
 *
 * AND IT GOES ON THE AGENT, NOT THE HANDLER. `new NodeHttpHandler({ maxSockets })`
 * looks right, type-checks, runs — and does nothing, because maxSockets is an
 * https.Agent option and NodeHttpHandler quietly ignores the unknown key. The
 * tell is that the capacity=50 warning keeps printing after you "fixed" it.
 *
 * keepAlive matters as much as the pool size here: 743,070 requests to one
 * host, averaging 8.7 KB, so a fresh TLS handshake per request would cost more
 * than the payloads do.
 *
 * WHY 64 AND NOT 200. 200 works, in the sense that it went four times faster —
 * 1,337 files/s against 91. It also produced 6,347 failed HEADs and 5,657
 * failed PUTs, every one of them with an empty error message, which is what a
 * connection dying underneath the SDK looks like. Windows hands out a finite
 * ephemeral port range and R2 has its own opinion about how many connections
 * one client may hold; somewhere past 64 we are past both. A sync that is fast
 * and drops 5,657 pages is not fast, it is a bucket with 5,657 holes in it,
 * and each hole is a URL that 404s with nothing to say why.
 */
function makeClient() {
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    // The SDK's own retry, for the errors it recognizes. The per-file loop
    // below covers the ones it does not.
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY }),
      connectionTimeout: 10_000,
      requestTimeout: 60_000,
    }),
  });
}

let client = makeClient();

/** Tear the pool down between batches — see the batching note in main(). */
function resetClient() {
  try {
    client.destroy();
  } catch {
    // Nothing to do if it is already gone; the point is only to release it.
  }
  client = makeClient();
}

/**
 * Files per batch. Small enough to stay well clear of the ~300,000 mark where
 * the process dies, large enough that the per-batch handshake is noise.
 */
const BATCH = Number(args[args.indexOf("--batch") + 1]) || 50_000;

/**
 * A silent death at 11,500 files with nothing in either log is how the first
 * attempt at this ended. Whatever the cause, the run must say so — a sync that
 * stops early without a word leaves the bucket half-populated and the next
 * deploy serving 404s for the missing half.
 */
process.on("unhandledRejection", (e) => {
  console.error(`\n\nUNHANDLED REJECTION — sync stopped early:\n${e?.stack ?? e}`);
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  console.error(`\n\nUNCAUGHT EXCEPTION — sync stopped early:\n${e?.stack ?? e}`);
  process.exit(1);
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

let uploaded = 0, skipped = 0, failed = 0, headMisses = 0;
/** Keys that exhausted their retries, so the summary can name them. */
const failedKeys = [];
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
    // A HEAD that fails for any reason other than "not there" is not fatal —
    // we simply do not learn whether the object matches, and fall through to
    // upload it, which is idempotent. Counted rather than printed: when the
    // connection pool is under strain these arrive in the thousands and the
    // log noise buries the failures that actually matter.
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") headMisses++;
  }

  // A failed PUT used to just increment a counter and move on, which meant a
  // dropped connection became a page that is missing from the bucket forever —
  // a 404 on a URL the sitemap advertises. Retry instead, with a widening gap
  // so a burst of refusals backs off rather than hammering.
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buf,
        ContentType: contentType(localPath),
        CacheControl: CACHE_CONTROL,
      }));
      uploaded++;
      tick();
      return;
    } catch (e) {
      if (attempt === MAX_TRIES) {
        const why = e?.message || e?.name || e?.code || `${e}`;
        console.error(`PUT fail ${key} after ${MAX_TRIES} tries: ${why}`);
        failed++;
        failedKeys.push(key);
      } else {
        await sleep(250 * 2 ** attempt);
      }
    }
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

/**
 * Repair mode: `--keys <file>`, one R2 key per line.
 *
 * A full pass walks 743,070 files and spends ~85 minutes doing it, which is a
 * absurd price for putting back the handful that a dropped connection lost.
 * The keys come straight from this script's own failure output, so a failed
 * run tells you exactly what to feed the next one.
 */
async function repairFromKeys(keysFile) {
  const keys = fs.readFileSync(keysFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const paths = keys.map((k) => path.join(SRC_ROOT, k.replace(/^pages\//, "")));
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error(`${missing.length} key(s) have no local file — is out/ from the same build?`);
    for (const m of missing.slice(0, 5)) console.error(`  ${m}`);
    process.exit(1);
  }
  totalRef.count = paths.length;
  console.log(`Repairing ${paths.length} key(s) from ${path.basename(keysFile)}\n`);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, paths.length) }, async () => {
      while (cursor < paths.length) await uploadOne(paths[cursor++]);
    }),
  );
  console.log(`\n\nuploaded ${uploaded}, skipped ${skipped}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
}

async function main() {
  const keysIdx = args.indexOf("--keys");
  if (keysIdx !== -1 && args[keysIdx + 1]) return repairFromKeys(args[keysIdx + 1]);

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
  console.log(`Concurrency: ${CONCURRENCY}, batch ${BATCH.toLocaleString()}\n`);

  /**
   * WHY THIS IS BATCHED RATHER THAN ONE LONG PASS.
   *
   * A single pass over all 743,070 files kills the process every time, at
   * ~300,000 requests, with exit code 127 and not one line of explanation —
   * observed three times, including on a run that was only issuing HEADs and
   * uploading nothing, so it is neither the uploads nor R2 rejecting us. It is
   * something accumulating inside a client that has serviced 300k requests.
   *
   * Rather than hunt it, bound it: work in batches and build a fresh client
   * for each, which drops the old connection pool and everything hanging off
   * it. The cost is one extra TLS handshake per batch — 15 of them across the
   * whole run — against a job that otherwise cannot finish at all.
   */
  for (let start = 0; start < queue.length; start += BATCH) {
    const batch = queue.slice(start, start + BATCH);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (cursor < batch.length) await uploadOne(batch[cursor++]);
      }),
    );
    resetClient();
  }

  console.log(`\n\nDone in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
  console.log(`  uploaded:    ${uploaded.toLocaleString()}`);
  console.log(`  skipped:     ${skipped.toLocaleString()}`);
  console.log(`  failed:      ${failed.toLocaleString()}`);
  console.log(`  head misses: ${headMisses.toLocaleString()} (harmless — re-uploaded instead)`);
  if (failed) {
    console.error(`\n${failed.toLocaleString()} file(s) never made it. Each one is a URL that will 404.`);
    console.error("Re-run this script — everything already uploaded is skipped by content hash.");
    for (const k of failedKeys.slice(0, 10)) console.error(`  ${k}`);
    if (failedKeys.length > 10) console.error(`  …and ${failedKeys.length - 10} more`);
    process.exit(1);
  }
}

main();
