#!/usr/bin/env node
/**
 * Offsite backup for data/cbbd — the raw archive everything else is built from.
 *
 *   node scripts/backup-archive-to-r2.mjs            # upload what changed
 *   node scripts/backup-archive-to-r2.mjs --verify   # is the backup real?
 *   node scripts/backup-archive-to-r2.mjs --restore  # pull it back down
 *   …            --season 2025   # narrow any of the three to one season
 *   …            --dry-run       # say what would happen, touch nothing
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. data/cbbd is 913 MB across 2,111 files, it is gitignored,
 * and until this script ran it existed in exactly one place: this machine.
 * Losing it would not take the site down — every derived file under
 * public/data is committed — but it would end the ability to CHANGE anything,
 * because all twenty-odd build-*.mjs scripts read from it.
 *
 * Re-pulling is not a recovery plan. 1,883 of those files are one day of
 * play-by-play each, fetched against a quota through a 3,000-row response cap
 * that is what forced the windowed-pull design in the first place. It is hours
 * of runtime, real money, and older seasons would not come back byte-identical
 * because upstream corrects history.
 *
 * A SEPARATE, PRIVATE BUCKET. Not the one sync-data-to-r2.mjs writes to. That
 * bucket is public — it is what NEXT_PUBLIC_DATA_BASE serves — so putting raw
 * CBBD responses in it would republish the upstream API at a guessable URL.
 * R2's public access is per-bucket, so there is no safe corner of the existing
 * one. Hence R2_ARCHIVE_* credentials, scoped to a bucket with no public
 * access and no custom domain.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * RESUME AND DEDUPE, the same trick as sync-data-to-r2.mjs: R2 returns the
 * md5 of a single-part upload as the object's ETag, so a HEAD tells us whether
 * the local bytes are already there. A re-run after an interrupted upload, or
 * after a fresh ingest, costs one Class B HEAD per file and uploads only what
 * is actually new. An interrupted backup is therefore free to retry.
 *
 * THE MANIFEST IS THE POINT, nearly as much as the bytes. Every run writes
 * data/cbbd-manifest.json — path, size, md5, mtime for every file — and that
 * file IS tracked in git. It is what turns "there is a backup somewhere" into
 * "here is exactly what is in it, and here is the checksum that proves a
 * restore came back whole". ~200 KB of text against 913 MB of archive.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

dotenvConfig({ path: ".env.local" });

const ARCHIVE_DIR = path.resolve("data/cbbd");
const MANIFEST = path.resolve("data/cbbd-manifest.json");
/** Key prefix inside the bucket, so the archive can share with future backups. */
const PREFIX = "cbbd/";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const MODE = has("--restore") ? "restore" : has("--verify") ? "verify" : "backup";
const DRY = has("--dry-run");
const SEASON = valueOf("--season");
const CONCURRENCY = Number(valueOf("--concurrency") ?? 6);

// ── Credentials ────────────────────────────────────────────────────────────
// Deliberately NOT falling back to R2_BUCKET. A typo that silently wrote the
// raw archive into the public bucket is the one mistake this script must be
// incapable of making.
const {
  R2_ENDPOINT,
  R2_ARCHIVE_BUCKET,
  R2_ARCHIVE_ACCESS_KEY_ID,
  R2_ARCHIVE_SECRET_ACCESS_KEY,
} = process.env;

const missing = Object.entries({
  R2_ENDPOINT,
  R2_ARCHIVE_BUCKET,
  R2_ARCHIVE_ACCESS_KEY_ID,
  R2_ARCHIVE_SECRET_ACCESS_KEY,
}).filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error(`\nMissing from .env.local: ${missing.join(", ")}\n`);
  console.error("Set up, once, in the Cloudflare dashboard:");
  console.error("  1. R2 → Create bucket, e.g. bta-archive.");
  console.error("     Do NOT enable public access, an r2.dev subdomain or a custom domain.");
  console.error("  2. R2 → API → Create API token, Object Read & Write, scoped to THAT bucket only.");
  console.error("  3. Add to .env.local:");
  console.error("       R2_ARCHIVE_BUCKET=bta-archive");
  console.error("       R2_ARCHIVE_ACCESS_KEY_ID=…");
  console.error("       R2_ARCHIVE_SECRET_ACCESS_KEY=…");
  console.error("     (R2_ENDPOINT is already set — the archive bucket shares the account URL.)\n");
  process.exit(1);
}

if (R2_ARCHIVE_BUCKET === process.env.R2_BUCKET) {
  console.error(
    `\nR2_ARCHIVE_BUCKET is the same bucket as R2_BUCKET (${R2_ARCHIVE_BUCKET}).\n` +
    "That bucket is PUBLIC — it is what the site serves data from. The raw archive\n" +
    "must not go in it. Create a separate private bucket.\n",
  );
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ARCHIVE_ACCESS_KEY_ID,
    secretAccessKey: R2_ARCHIVE_SECRET_ACCESS_KEY,
  },
});

// ── Walking ────────────────────────────────────────────────────────────────

/** Every file under data/cbbd, as paths relative to it, sorted. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const mb = (n) => (n / 1e6).toFixed(1);

/**
 * Run `worker` over `items`, `limit` at a time.
 *
 * A THROW FROM ONE ITEM MUST NOT END THE RUN. The first version let it: one
 * worker rejecting took down Promise.all, which took down a 945 MB upload
 * three hundred files in, with no summary and no manifest. Over two thousand
 * requests, a transient failure is not an edge case — it is Tuesday. Errors
 * are collected and reported at the end instead.
 */
async function pool(items, limit, worker) {
  let next = 0;
  const errors = [];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch (e) {
        errors.push({ item: items[i], message: e?.message ?? String(e) });
      }
    }
  });
  await Promise.all(runners);
  return errors;
}

/**
 * Retry an S3 call through the failures that mean "try again in a moment".
 *
 * Exponential backoff, four attempts. A 404 is not a failure here — callers
 * treat it as "not there yet" — so it is passed straight through rather than
 * retried into a delay for every new file.
 */
async function withRetry(label, fn, attempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 404 || e?.name === "NotFound") throw e;
      lastErr = e;
      if (attempt === attempts) break;
      const wait = 250 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${label}: ${lastErr?.name ?? "failed"} — ${lastErr?.message ?? ""}`);
}

// ── Modes ──────────────────────────────────────────────────────────────────

async function remoteEtag(key) {
  try {
    const head = await withRetry(
      `HEAD ${key}`,
      () => s3.send(new HeadObjectCommand({ Bucket: R2_ARCHIVE_BUCKET, Key: key })),
    );
    return (head.ETag ?? "").replaceAll('"', "");
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    throw e;
  }
}

async function backup(files) {
  let uploaded = 0, skipped = 0, bytes = 0, failed = 0;
  const manifest = {};

  const errors = await pool(files, CONCURRENCY, async (rel, i) => {
    const local = path.join(ARCHIVE_DIR, rel);
    const buf = await fsp.readFile(local);
    const sum = md5(buf);
    const stat = await fsp.stat(local);
    manifest[rel] = { size: stat.size, md5: sum, mtime: stat.mtime.toISOString() };

    const key = PREFIX + rel;
    const etag = await remoteEtag(key);
    if (etag === sum) {
      skipped++;
    } else if (DRY) {
      uploaded++;
      bytes += stat.size;
    } else {
      try {
        await withRetry(`PUT ${key}`, () => s3.send(new PutObjectCommand({
          Bucket: R2_ARCHIVE_BUCKET,
          Key: key,
          Body: buf,
          // Everything here is either already gzipped or a csv. No
          // Content-Encoding: these objects are archive blobs to be restored
          // byte-for-byte, never served to a browser.
          ContentType: "application/octet-stream",
        })));
        uploaded++;
        bytes += stat.size;
      } catch (e) {
        failed++;
        // A file that did not make it does not go in the manifest — the
        // manifest is a claim about what is IN the bucket, and a claim that
        // outruns the bucket is worse than no claim at all.
        delete manifest[rel];
        console.error(`  ! ${rel}: ${e.message}`);
      }
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  …${i + 1}/${files.length}  (${uploaded} up, ${skipped} already there)`);
    }
  });

  if (!DRY) {
    // The manifest is written LAST and only over the files just walked, so a
    // --season run updates that season's entries and leaves the rest alone.
    const prev = fs.existsSync(MANIFEST) ? JSON.parse(await fsp.readFile(MANIFEST, "utf8")) : { files: {} };
    const merged = { ...prev.files, ...manifest };
    await fsp.writeFile(MANIFEST, JSON.stringify({
      generated: new Date().toISOString(),
      bucket: R2_ARCHIVE_BUCKET,
      prefix: PREFIX,
      count: Object.keys(merged).length,
      bytes: Object.values(merged).reduce((a, f) => a + f.size, 0),
      files: merged,
    }, null, 1) + "\n");
  }

  for (const e of errors) console.error(`  ! ${e.item}: ${e.message}`);
  console.log(
    `\n${DRY ? "[dry run] " : ""}uploaded ${uploaded}, already present ${skipped}` +
    `${failed + errors.length ? `, FAILED ${failed + errors.length}` : ""} — ${mb(bytes)} MB moved`,
  );
  if (failed || errors.length) {
    console.log("Re-run to retry only what failed — matching files are skipped by ETag.");
    process.exitCode = 1;
  }
}

async function verify(files) {
  let ok = 0, wrong = 0, absent = 0;
  const errors = await pool(files, CONCURRENCY, async (rel, i) => {
    const buf = await fsp.readFile(path.join(ARCHIVE_DIR, rel));
    const etag = await remoteEtag(PREFIX + rel);
    if (etag === null) { absent++; console.error(`  MISSING  ${rel}`); }
    else if (etag !== md5(buf)) { wrong++; console.error(`  DIFFERS  ${rel}`); }
    else ok++;
    if ((i + 1) % 250 === 0) console.log(`  …${i + 1}/${files.length}`);
  });
  for (const e of errors) console.error(`  ! ${e.item}: ${e.message}`);
  console.log(
    `\n${ok} match, ${wrong} differ, ${absent} missing` +
    `${errors.length ? `, ${errors.length} errored` : ""}, of ${files.length}`,
  );
  if (errors.length) process.exitCode = 1;
  // A backup that is not complete is not a backup, and the exit code is what a
  // scheduled check would read.
  if (wrong || absent) process.exitCode = 1;
}

async function restore(files) {
  let pulled = 0, kept = 0, bytes = 0, recreated = 0;
  const errors = await pool(files, CONCURRENCY, async (rel, i) => {
    const local = path.join(ARCHIVE_DIR, rel);
    const existed = fs.existsSync(local);
    if (existed) {
      const etag = await remoteEtag(PREFIX + rel);
      if (etag === md5(await fsp.readFile(local))) { kept++; return; }
    } else {
      recreated++;
    }
    if (DRY) { pulled++; return; }
    const got = await withRetry(
      `GET ${rel}`,
      () => s3.send(new GetObjectCommand({ Bucket: R2_ARCHIVE_BUCKET, Key: PREFIX + rel })),
    );
    const body = Buffer.from(await got.Body.transformToByteArray());
    await fsp.mkdir(path.dirname(local), { recursive: true });
    await fsp.writeFile(local, body);
    pulled++;
    bytes += body.length;
    if ((i + 1) % 100 === 0) console.log(`  …${i + 1}/${files.length}`);
  });
  for (const e of errors) console.error(`  ! ${e.item}: ${e.message}`);
  console.log(
    `\n${DRY ? "[dry run] " : ""}restored ${pulled} (${recreated} were missing locally), ` +
    `already correct ${kept}${errors.length ? `, FAILED ${errors.length}` : ""} — ${mb(bytes)} MB`,
  );
  if (errors.length) process.exitCode = 1;
}

// ── Go ─────────────────────────────────────────────────────────────────────

/**
 * What to work over.
 *
 * A RESTORE READS THE MANIFEST, NOT THE DISK — always, not just when the
 * archive is missing entirely. The first version walked the local directory
 * and restored what it found there, which is precisely backwards: a file that
 * is gone locally never appears in the walk, so the one case a restore exists
 * for — something is missing — was the one case it could not fix. Caught by
 * deleting a file and watching `--restore` report "5 already correct" and do
 * nothing.
 *
 * Backup and verify walk the disk, because their question is "what do I have
 * right now". Restore's question is "what am I supposed to have", and only the
 * manifest knows that.
 */
let files;
if (MODE === "restore") {
  if (!fs.existsSync(MANIFEST)) {
    console.error(
      "No data/cbbd-manifest.json — a restore has no way to know what should exist.\n" +
      "The manifest is written by a backup run and committed to git; recover it from there.",
    );
    process.exit(1);
  }
  files = Object.keys(JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files);
} else {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.error(`No ${ARCHIVE_DIR}. Nothing to do.`);
    process.exit(1);
  }
  files = walk(ARCHIVE_DIR);
}

if (SEASON) files = files.filter((f) => f.startsWith(`${SEASON}/`));
if (!files.length) {
  console.error(SEASON ? `No files for season ${SEASON}.` : "No files found.");
  process.exit(1);
}

// Only counts what is actually on disk: during a restore most of these paths
// are missing by definition, and statting them would throw before the first
// byte came back.
const totalBytes = files.reduce((a, f) => {
  const p = path.join(ARCHIVE_DIR, f);
  return a + (fs.existsSync(p) ? fs.statSync(p).size : 0);
}, 0);

console.log(
  `${MODE}${DRY ? " (dry run)" : ""} — ${files.length.toLocaleString()} files` +
  `${totalBytes ? `, ${mb(totalBytes)} MB` : ""}` +
  `${SEASON ? `, season ${SEASON}` : ""}` +
  ` → ${R2_ARCHIVE_BUCKET}/${PREFIX}\n`,
);

process.on("unhandledRejection", (e) => {
  console.error(`\nunhandled: ${e?.message ?? e}`);
  process.exit(1);
});

const run = MODE === "verify" ? verify : MODE === "restore" ? restore : backup;
await run(files);
