/**
 * The site-style table controls: column views, Add a filter, Add columns, the
 * scope pickers, Download (when the app writes files without a dialog), Save
 * view, and the player stat packs. Each table is left as it was found.
 */
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { POPOVER, SECTION, sleep } from "./cdp.mjs";

const bands = (app) => app.js(`[...${SECTION}.querySelectorAll('[role=presentation][title]')].map((b) => b.title)`);

async function waitFiles(dir, n, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const files = readdirSync(dir);
    if (files.length >= n) return files;
    await sleep(400);
  }
  return readdirSync(dir);
}

export default async function tables(app, t) {
  // ── Team Explorer ──
  await app.nav("Team Explorer");
  await app.setSeason("2025-26");
  await app.setQuery("");
  t.check("the View picker switches to Four Factors", await app.pick("View", "Four Factors"));
  t.check("Four Factors draws its bands", (await bands(app)).length > 0, await bands(app));

  await app.press("Add a filter");
  await app.type("wab");
  await app.key("Enter");
  await sleep(400);
  await app.type("3");
  await app.js(`document.activeElement?.blur(); true`);
  await sleep(700);
  const wab = (await app.query()) ?? "";
  t.check("Add a filter writes WAB ≥ 3 into the box", /wab\s*>=\s*3/i.test(wab), wab);
  t.check("WAB ≥ 3 keeps 35 teams", (await app.shown()) === 35, await app.meta());

  await app.press("Add columns");
  await app.type("eff height");
  await app.key("Enter");
  await app.press("Done", POPOVER);
  t.check("an added column lands under Your columns", (await bands(app)).some((b) => /your columns/i.test(b)), await bands(app));

  await app.press("Conference");
  await app.type("SEC");
  await app.key("Enter");
  await app.closePopover();
  const sec = (await app.query()) ?? "";
  t.check("the Conference picker writes conf: SEC", /conf:\s*SEC/i.test(sec), sec);
  t.check("SEC with WAB ≥ 3 keeps 6 teams", (await app.shown()) === 6, await app.meta());

  if (t.exportsDir) {
    for (const f of readdirSync(t.exportsDir)) rmSync(join(t.exportsDir, f));
    await app.press("Download");
    await app.press("CSV", POPOVER);
    await app.press("Download");
    await app.press("Excel workbook", POPOVER);
    await app.press("Download");
    await app.press("Excel, select views", POPOVER);
    await app.press("Download 13", POPOVER);
    const files = await waitFiles(t.exportsDir, 3);
    t.check("three downloads were written", files.length === 3, files);
    const csv = files.find((f) => f.endsWith(".csv"));
    if (csv) {
      const lines = readFileSync(join(t.exportsDir, csv), "utf8").split(/\r?\n/).filter(Boolean);
      t.check("the CSV holds the 6 rows", lines.length - 1 === 6, lines.length - 1);
    }
    const books = files.filter((f) => f.endsWith(".xlsx"));
    t.check("both workbooks are real xlsx files", books.length === 2 && books.every((f) => readFileSync(join(t.exportsDir, f)).subarray(0, 2).toString() === "PK"), books);
    const sizes = books.map((f) => statSync(join(t.exportsDir, f)).size).sort((a, b) => a - b);
    t.check("the all-views workbook is the bigger one", sizes.length === 2 && sizes[1] > sizes[0] * 2, sizes);
  }

  await app.press("Save view");
  const saved = await app.js(`[...${SECTION}.querySelectorAll('header button[aria-pressed]')].some((b) => /saved/i.test(b.textContent) && b.getAttribute('aria-pressed') === 'true')`);
  t.check("Save view stars the place", saved);
  await app.press("Saved");

  await app.press("Clear");
  await app.setQuery("");
  await app.pick("View", "Overview");
  t.check("the Team Explorer is back as it was", (await app.query()) === "" && !(await bands(app)).some((b) => /your columns/i.test(b)), await app.query());

  // ── Player Explorer, with the stat packs ──
  await app.nav("Player Explorer");
  await app.setSeason("2025-26");
  await app.setQuery("");
  t.check("the View picker switches to Traditional Boxscore", await app.pick("View", "Traditional Boxscore", 3500));
  await app.setQuery("class: Fr pts>=500");
  t.check("freshmen with 500+ points: 30", (await app.shown()) === 30, await app.meta());
  await app.setQuery("");
  await app.pick("View", "Overview");

  // ── Team Game Log ──
  await app.nav("Team Game Log");
  await app.setSeason("2025-26");
  await app.setQuery("");
  await app.press("Add columns");
  await app.type("largest lead");
  await app.key("Enter");
  await app.press("Done", POPOVER);
  t.check("Largest lead lands under Your columns", (await bands(app)).some((b) => /your columns/i.test(b)), await bands(app));
  await app.press("Opponent");
  await app.type("Duke");
  await app.key("Enter");
  await app.closePopover();
  t.check("games against Duke: 38", (await app.shown()) === 38, await app.meta());
  await app.js(`${SECTION}.querySelector('button[aria-label="Remove LEAD"]')?.click(); true`);
  await sleep(400);
  await app.setQuery("");
  await app.nav("Team Explorer");
}
