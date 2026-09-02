#!/usr/bin/env node
/**
 * publish-run-record.mjs — put tonight's run record where the admin page reads it.
 *
 * WHY THIS IS A SEPARATE STEP AND NOT PART OF THE SYNC. nightly-refresh.mts
 * writes refresh-status.json LAST, after every phase including the R2 sync has
 * finished — it has to, the record is the outcome. So the sync uploaded
 * whatever status file was on disk BEFORE the run, and the one that says what
 * tonight did never left the machine. On GitHub Actions the machine is thrown
 * away minutes later. The admin page was therefore reading last night's
 * record at best and, on a failed run, nothing at all — the one night it
 * mattered.
 *
 * This runs after the record is written, on success AND on failure, and puts
 * two objects on R2:
 *
 *   live/refresh-status.json   the run that just happened, in full
 *   live/refresh-history.json  one line per run, last HISTORY_KEEP of them
 *
 * The history is READ FROM R2 FIRST rather than from disk, because disk is
 * ephemeral on Actions and gitignored everywhere. R2 is the only place the
 * previous runs exist.
 *
 * BOTH ARE UPLOADED WITH `no-cache`, not the bucket's usual hour. Everything
 * else in the bucket is data that changes once a day and can be an hour stale
 * without anyone noticing. A run record is read by one person, on the morning
 * a run failed, and an hour-old copy of it says "Succeeded". The sync script
 * will re-upload the same bytes with the longer header on its next pass — that
 * is harmless, because the dashboard busts the cache on its side too.
 *
 *   node scripts/publish-run-record.mjs              # read status, append, upload
 *   node scripts/publish-run-record.mjs --no-upload  # append locally, touch nothing remote
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as dotenvConfig } from "dotenv";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

dotenvConfig({ path: ".env.local" });

const ROOT = process.cwd();
const LIVE_DIR = path.join(ROOT, "public", "data", "live");
const STATUS_PATH = path.join(LIVE_DIR, "refresh-status.json");
const HISTORY_PATH = path.join(LIVE_DIR, "refresh-history.json");
const STATUS_KEY = "live/refresh-status.json";
const HISTORY_KEY = "live/refresh-history.json";

/** Sixty nights is two months of a season — enough to see a trend, not an archive. */
const HISTORY_KEEP = 60;

const NO_UPLOAD = process.argv.includes("--no-upload");

if (!fs.existsSync(STATUS_PATH)) {
  console.error(`No run record at ${STATUS_PATH}. nightly-refresh.mts writes it; run that first.`);
  process.exit(1);
}
const status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));

/**
 * One line per run. Steps are summarised to counts — the full list lives in
 * the status file for the latest run, and sixty copies of a 30-row table is
 * not what a trend needs.
 */
const entry = {
  startedAt: status.startedAt,
  finishedAt: status.finishedAt,
  durationMs: status.durationMs,
  outcome: status.outcome,
  failedAt: status.failedAt ?? null,
  dryRun: Boolean(status.dryRun),
  season: status.season,
  phases: status.phases,
  steps: Array.isArray(status.steps) ? status.steps.length : 0,
  ok: Array.isArray(status.steps) ? status.steps.filter((s) => s.status === "ok").length : 0,
};

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const haveCreds = R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;

if (!NO_UPLOAD && !haveCreds) {
  console.error("Missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET. Pass --no-upload to write locally only.");
  process.exit(1);
}

const s3 = haveCreds
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

async function readRemoteHistory() {
  if (!s3) return null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: HISTORY_KEY }));
    const text = await r.Body.transformToString();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey") return [];
    throw e;
  }
}

function readLocalHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

async function put(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: "application/json",
    // See the header. A run record that can be an hour stale is worse than
    // no record, because it is confidently wrong on the morning it matters.
    CacheControl: "no-cache",
  }));
}

async function main() {
  // Remote is the truth when it can be reached; local is what a --no-upload
  // run (or a machine with no creds) has to fall back on.
  const prior = NO_UPLOAD ? readLocalHistory() : await readRemoteHistory();

  // Re-running the publisher for the same run must not double the entry.
  const runs = prior.filter((r) => r.startedAt !== entry.startedAt);
  runs.push(entry);
  runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const kept = runs.slice(-HISTORY_KEEP);

  const history = { updatedAt: new Date().toISOString(), runs: kept };
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`history: ${kept.length} run${kept.length === 1 ? "" : "s"} -> public/data/live/refresh-history.json`);

  if (NO_UPLOAD) {
    console.log("--no-upload: nothing sent to R2.");
    return;
  }

  await put(STATUS_KEY, fs.readFileSync(STATUS_PATH));
  await put(HISTORY_KEY, JSON.stringify(history));
  console.log(`uploaded ${STATUS_KEY} and ${HISTORY_KEY} (no-cache)`);
}

main().catch((e) => {
  console.error(`publish-run-record failed: ${e?.message ?? e}`);
  process.exit(1);
});
