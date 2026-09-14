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

  // Save view asks for a name first, then stars the place under it.
  await app.press("Save view");
  const suggested = await app.js(`document.querySelector('body > div[role=dialog] input')?.value ?? null`);
  t.check("Save view opens with a name suggested", typeof suggested === "string" && /Teams, Four Factors/.test(suggested), suggested);
  await app.js(`(() => { const el = document.querySelector('body > div[role=dialog] input'); el.focus(); el.select(); return true; })()`);
  await app.type("Smoke SEC view", 300);
  await app.press("Save", POPOVER);
  const saved = await app.js(`[...${SECTION}.querySelectorAll('header button[aria-pressed]')].some((b) => /saved/i.test(b.textContent) && b.getAttribute('aria-pressed') === 'true')`);
  t.check("Save stars the place", saved);
  const inSidebar = await app.js(`[...document.querySelectorAll('nav[aria-label=Workspace] *')].some((x) => x.childElementCount === 0 && x.textContent.trim() === 'Smoke SEC view')`);
  t.check("the favorite carries the name given", inSidebar);
  await app.press("Saved");
  await app.press("Remove", POPOVER);
  const gone = await app.js(`![...${SECTION}.querySelectorAll('header button[aria-pressed]')].some((b) => b.getAttribute('aria-pressed') === 'true' && /saved/i.test(b.textContent))`);
  t.check("Remove takes it out of favorites", gone);

  await app.press("Clear");
  await app.setQuery("");
  await app.pick("View", "Overview");
  t.check("the Team Explorer is back as it was", (await app.query()) === "" && !(await bands(app)).some((b) => /your columns/i.test(b)), await app.query());

  // ── Several seasons at once ──
  t.check("the season picker adds 2024-25", await app.addSeason("2024-25"));
  const twoMeta = await app.meta();
  t.check("two seasons read as team-seasons", /team-seasons/.test(twoMeta) && /2024-25 → 2025-26/.test(twoMeta), twoMeta);
  t.check("two seasons hold both seasons' teams", ((await app.shown()) ?? 0) > 700, await app.shown());
  t.check("a Season column appears", await app.js(`[...${SECTION}.querySelectorAll('[role=columnheader]')].some((h) => h.textContent.trim().startsWith('Season'))`));
  await app.setQuery("team: Houston");
  t.check("team: Houston keeps one row a season", (await app.shown()) === 2, await app.meta());
  await app.setQuery("");
  t.check("Only takes it back to one season", await app.setSeason("2025-26"));
  t.check("one season again reads as teams", /\b365 teams\b/.test(await app.meta()), await app.meta());

  // ── Player Explorer, with the stat packs ──
  await app.nav("Player Explorer");
  await app.setSeason("2025-26");
  await app.setQuery("");
  t.check("the View picker switches to Traditional Boxscore", await app.pick("View", "Traditional Boxscore", 3500));
  await app.setQuery("class: Fr pts>=500");
  t.check("freshmen with 500+ points: 30", (await app.shown()) === 30, await app.meta());
  await app.setQuery("");
  t.check("the player season picker adds 2024-25", await app.addSeason("2024-25"));
  const playerMeta = await app.meta();
  t.check("two seasons read as player-seasons", /player-seasons/.test(playerMeta) && /2024-25 → 2025-26/.test(playerMeta), playerMeta);
  await app.setQuery("player: Cooper Flagg");
  t.check("a player from the older season is there", ((await app.shown()) ?? 0) >= 1, await app.meta());
  await app.setQuery("");
  t.check("Only takes the players back to one season", await app.setSeason("2025-26"));
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
