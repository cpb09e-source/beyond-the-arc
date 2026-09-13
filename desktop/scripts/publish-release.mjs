/**
 * Publish a built release: the installer, its blockmap, and the update feed,
 * to the public R2 bucket under desktop/.
 *
 *   npm run dist                          builds release/Beyond-the-Arc-Setup-<version>.exe
 *   node scripts/publish-release.mjs      checks what would be uploaded
 *   node scripts/publish-release.mjs --apply
 *
 * THE FEED GOES LAST. electron-updater and the site's download button both read
 * desktop/latest.yml to find the installer, so the installer and its blockmap
 * are uploaded and confirmed first; a feed that names a file not yet there
 * would hand every copy of the app a broken update.
 *
 * WHY THE BUCKET IS PUBLIC. The installer is harmless without an account: the
 * app opens nothing until a Season Pass signs in, and the download button is
 * behind the same rule (netlify/functions/desktop-download.mts). Public bytes
 * are what let the updater fetch without credentials.
 *
 * Credentials come from the site's .env.local and are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(DESKTOP, "..");
const require = createRequire(join(REPO, "package.json"));
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const env = {};
for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!env[k]) throw new Error(`.env.local is missing ${k}`);
}

const PREFIX = "desktop";
const PUBLIC = "https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev";
const APPLY = process.argv.includes("--apply");

const version = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8")).version;
const release = join(DESKTOP, "release");
const feedPath = join(release, "latest.yml");
if (!existsSync(feedPath)) throw new Error("No release/latest.yml. Run npm run dist first.");
const feed = readFileSync(feedPath, "utf8");
const feedVersion = /^version:\s*(.+)$/m.exec(feed)?.[1]?.trim();
const installer = /^path:\s*(.+)$/m.exec(feed)?.[1]?.trim();
if (feedVersion !== version) throw new Error(`latest.yml says ${feedVersion}, package.json says ${version}. Rebuild.`);
if (!installer || !/^[\w.-]+\.exe$/.test(installer)) throw new Error("latest.yml names no installer.");

const files = [
  { name: installer, type: "application/vnd.microsoft.portable-executable", cache: "public, max-age=31536000, immutable" },
  { name: `${installer}.blockmap`, type: "application/octet-stream", cache: "public, max-age=31536000, immutable" },
  // The feed changes with every release, so nothing may cache it for long.
  { name: "latest.yml", type: "text/yaml", cache: "no-cache" },
];
for (const f of files) {
  f.path = join(release, f.name);
  if (!existsSync(f.path)) throw new Error(`Missing ${f.path}`);
  f.bytes = readFileSync(f.path);
  f.md5 = createHash("md5").update(f.bytes).digest("hex");
}

// The sha512 in the feed must be the installer's, or the updater refuses it.
const sha512 = /sha512:\s*(\S+)/.exec(feed)?.[1];
const actual = createHash("sha512").update(files[0].bytes).digest("base64");
if (sha512 !== actual) throw new Error("latest.yml's sha512 does not match the installer. Rebuild.");

console.log(`Beyond the Arc ${version}`);
for (const f of files) console.log(`  ${PREFIX}/${f.name}  ${(f.bytes.length / 1e6).toFixed(1)} MB`);
if (!APPLY) {
  console.log("\nCheck only. Pass --apply to upload.");
  process.exit(0);
}

const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
for (const f of files) {
  const Key = `${PREFIX}/${f.name}`;
  await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key, Body: f.bytes, ContentType: f.type, CacheControl: f.cache }));
  const head = await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key }));
  const etag = (head.ETag ?? "").replace(/"/g, "");
  // Large uploads come back multipart, whose ETag is not an MD5; the size still has to agree.
  if (head.ContentLength !== f.bytes.length || (!etag.includes("-") && etag !== f.md5)) {
    throw new Error(`${Key} did not arrive intact; the feed was not published.`);
  }
  console.log(`uploaded ${Key}`);
}

const res = await fetch(`${PUBLIC}/${PREFIX}/latest.yml`, { headers: { "cache-control": "no-cache" } });
console.log(`public feed: ${res.status}`, res.ok ? (/^version:\s*(.+)$/m.exec(await res.text())?.[1] ?? "") : "");
