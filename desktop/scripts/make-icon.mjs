/**
 * The app icon, from the site's own favicon artwork.
 *
 *   node scripts/make-icon.mjs      writes build/icon.png (1024 x 1024)
 *
 * Rendered from the SVG rather than scaled from a small PNG, so the taskbar,
 * the Start menu and the installer all get a sharp mark. The square is rounded
 * the way current Windows app icons are. electron-builder makes the .ico from
 * this file.
 *
 * sharp comes from the site's node_modules (Next depends on it), so the desktop
 * package does not carry a second copy of a native image library.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const SIZE = 1024;
const RADIUS = 228;

const artwork = readFileSync(resolve(here, "../../public/images/bta_favicon-01.svg"));
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`,
);

const out = resolve(here, "../build/icon.png");
mkdirSync(dirname(out), { recursive: true });
await sharp(artwork, { density: 480 })
  .resize(SIZE, SIZE)
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toFile(out);
console.log(`icon -> ${out}`);
