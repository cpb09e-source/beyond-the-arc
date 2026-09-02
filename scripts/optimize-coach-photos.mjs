#!/usr/bin/env node
/**
 * ORPHANED 2026-09-02, KEPT ON PURPOSE. public/images/coaches/, the manifest
 * this writes, and the CoachPhoto component that read it were all deleted:
 * the photos were ESPN-sourced, nothing rendered them, and they carried the
 * full legal exposure for no product value. Nothing consumes this script's
 * output today.
 *
 * It survives because it is the recipe, and the recipe is still right. If
 * coach photos come back they should come back LICENSED — Sportradar, or
 * direct permission from the schools — and this is what turns whatever arrives
 * into the two sizes the site wants. See docs/TODO-legal-sources.md section 2.
 *
 * optimize-coach-photos.mjs — turn whatever lands in public/images/coaches/
 * into the two variants the site serves, and write the manifest the component
 * reads.
 *
 * Unlike the player photos, which arrive from ESPN through
 * scripts/fetch-player-images.mjs, coach photos are dropped into the folder by
 * hand. So this script has to be safe to run over its own output: WebP is
 * lossy, and re-encoding an already-encoded file on every run would grind the
 * image down a little each time. `src/data/coach-photos-optimized.json` records
 * the SHA-1 of each file this script produced; a file whose hash still matches
 * is left alone, and anything new or replaced gets processed.
 *
 *   node scripts/optimize-coach-photos.mjs [--dry-run] [--force]
 *
 * Input:  public/images/coaches/<slug>.(webp|png|jpg|jpeg) at any size
 * Output: public/images/coaches/<slug>.webp     600x436, q82  (~25 KB)
 *         public/images/coaches/<slug>-sm.webp  240x174, q78  (~6 KB)
 *         src/data/coach-photos.json            slug -> public path
 *
 * Filenames ARE the key: <slug> must be coachSlug(name) from src/lib/coaches.ts
 * — lowercase, accents stripped, non-alphanumeric to hyphen. All 804 coach
 * names in the window produce distinct slugs, so there is nothing to collide.
 *
 * Geometry matches the player pipeline exactly (600x436 / 240x174, a 1.376:1
 * landscape) because both feed the same circular CSS crop, and `position: top`
 * on the thumb keeps the head in frame — a centre crop takes the top off it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");

const DIR = path.resolve("public/images/coaches");
const MANIFEST = path.resolve("src/data/coach-photos.json");
const HASHES = path.resolve("src/data/coach-photos-optimized.json");

const FULL = { w: 600, h: 436, quality: 82 };
const THUMB = { w: 240, h: 174, quality: 78 };
const SOURCE_EXT = /\.(webp|png|jpe?g)$/i;

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

async function encode(input, { w, h, quality }) {
  return sharp(input)
    .resize(w, h, { fit: "cover", position: "top" })
    .webp({ quality })
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`  ${path.relative(process.cwd(), DIR)} does not exist — nothing to do.`);
    process.exit(1);
  }

  const hashes = FORCE ? {} : readJson(HASHES, {});
  // Source files only: the -sm variants are output, never input.
  const sources = fs.readdirSync(DIR)
    .filter((f) => SOURCE_EXT.test(f) && !f.endsWith("-sm.webp"))
    .sort();

  if (sources.length === 0) {
    console.log("  no source images found.");
    return;
  }

  const manifest = {};
  let processed = 0, skipped = 0, savedBytes = 0;

  for (const file of sources) {
    const slug = file.replace(SOURCE_EXT, "");
    const fullPath = path.join(DIR, `${slug}.webp`);
    const thumbPath = path.join(DIR, `${slug}-sm.webp`);
    manifest[slug] = `/images/coaches/${slug}.webp`;

    const srcPath = path.join(DIR, file);
    const before = fs.readFileSync(srcPath);

    // Already ours, and the thumb survived alongside it — leave it be.
    if (!FORCE && hashes[slug] === sha1(before) && fs.existsSync(thumbPath)) {
      skipped++;
      continue;
    }

    const meta = await sharp(before).metadata();
    const [full, thumb] = await Promise.all([
      encode(before, FULL),
      encode(before, THUMB),
    ]);

    console.log(
      `  ${slug.padEnd(22)} ${meta.width}x${meta.height} ${kb(before.length).padStart(9)}` +
      `  ->  ${kb(full.length).padStart(8)} + ${kb(thumb.length).padStart(7)} thumb`,
    );
    savedBytes += before.length - full.length;

    if (!DRY) {
      // A non-webp source becomes <slug>.webp; drop the original so the folder
      // holds exactly the two variants per coach that ship.
      fs.writeFileSync(fullPath, full);
      fs.writeFileSync(thumbPath, thumb);
      if (srcPath !== fullPath) fs.unlinkSync(srcPath);
      hashes[slug] = sha1(full);
    }
    processed++;
  }

  if (DRY) {
    console.log(`\n  --dry-run: ${processed} would be processed, ${skipped} already optimized. Nothing written.`);
    return;
  }

  const sortedKeys = Object.keys(manifest).sort();
  fs.writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(sortedKeys.map((k) => [k, manifest[k]])), null, 2) + "\n");
  fs.writeFileSync(HASHES, JSON.stringify(Object.fromEntries(sortedKeys.filter((k) => hashes[k]).map((k) => [k, hashes[k]])), null, 2) + "\n");

  console.log(
    `\n  ${processed} processed, ${skipped} already optimized. ` +
    (savedBytes > 0 ? `Saved ${kb(savedBytes)} on the full variants. ` : "") +
    `${sortedKeys.length} coaches in the manifest.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
