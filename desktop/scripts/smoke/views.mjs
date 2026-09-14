/**
 * Every view in the sidebar opens and draws something, with no error in the page.
 */
import { SECTION, sleep } from "./cdp.mjs";

const VIEWS = [
  "Home",
  "Team Explorer",
  "Team Game Log",
  "What Changed",
  "Team Scatter",
  "Conference Power Rankings",
  "Coaches",
  "Matchup Predictor",
  "Player Explorer",
  "Player Game Log",
  "Transfer Portal",
  "Scoreboard",
  "Win Calculator",
  "Difference Explainer",
  "Find Similar",
];

export default async function views(app, t) {
  for (const label of VIEWS) {
    const found = await app.nav(label, 3000);
    if (!found) {
      t.check(`${label} is in the sidebar`, false);
      continue;
    }
    // A view that opens on a chooser (Find Similar, the explainers) is still a view that drew.
    if (await app.js(`!!document.querySelector('body > div[role=dialog]')`)) {
      await app.key("Escape");
      await sleep(300);
    }
    const chars = await app.js(`(${SECTION}?.innerText ?? '').trim().length`);
    t.check(`${label} draws`, chars > 40, chars);
  }

  // ── A team's page: the details rail folds to an edge and back ──
  await app.nav("Team Explorer");
  await app.setSeason("2025-26");
  await app.setQuery("team: Duke");
  const row = await app.rowPoint(0);
  if (row) {
    await app.mouse("mouseMoved", row);
    await app.mouse("mousePressed", row, { button: "left", clickCount: 1 });
    await app.mouse("mouseReleased", row, { button: "left", clickCount: 1 });
    await app.mouse("mousePressed", row, { button: "left", clickCount: 2 });
    await app.mouse("mouseReleased", row, { button: "left", clickCount: 2 });
  }
  await sleep(2500);
  const railBefore = await app.js(`localStorage.getItem('bta.profile.details')`);
  const rail = () => app.js(`!!${SECTION}.querySelector('aside[aria-label="Duke details"]')`);
  if (!(await rail())) await app.js(`${SECTION}.querySelector('button[aria-label="Show details"]')?.click(); true`);
  await sleep(500);
  t.check("Duke's page opens with its details rail", await rail());
  await app.js(`${SECTION}.querySelector('button[aria-label="Hide details"]')?.click(); true`);
  await sleep(500);
  t.check("Hide details folds the rail away", !(await rail()) && (await app.js(`!!${SECTION}.querySelector('button[aria-label="Show details"]')`)));
  await app.js(`${SECTION}.querySelector('button[aria-label="Show details"]')?.click(); true`);
  await sleep(500);
  t.check("the folded edge brings it back", await rail());
  await app.js(railBefore == null ? `localStorage.removeItem('bta.profile.details'); true` : `localStorage.setItem('bta.profile.details', ${JSON.stringify(railBefore)}); true`);

  // The page's Snapshot opens the sheet on Duke's card, ready to copy.
  t.check("Snapshot opens on Duke's page", await app.press("Snapshot"));
  const sheet = `document.querySelector('[role=dialog][aria-label^="Snapshot of Duke"]')`;
  t.check("the card is ready to copy", await app.waitFor(`!!${sheet} && /Duke/.test(${sheet}.innerText) && ![...${sheet}.querySelectorAll('footer button')].some((b) => b.disabled)`, 20_000, 400));
  await app.key("Escape");
  await sleep(400);
  t.check("Esc closes the sheet", !(await app.js(`!!document.querySelector('[aria-label^="Snapshot of"]')`)));

  // ── A player's Career tab: the site's ledger, per game and in totals ──
  await app.nav("Player Explorer");
  await app.setSeason("2015-16");
  await app.setQuery("player: Denzel Valentine");
  await sleep(800);
  const prow = await app.rowPoint(0);
  if (prow) {
    await app.mouse("mouseMoved", prow);
    await app.mouse("mousePressed", prow, { button: "left", clickCount: 2 });
    await app.mouse("mouseReleased", prow, { button: "left", clickCount: 2 });
  }
  await sleep(2500);
  await app.press("Career");
  const ledger = `${SECTION}.querySelector('section[aria-label="Career"]')`;
  t.check("Valentine's Career tab draws the ledger", await app.waitFor(`!!${ledger}?.querySelector('[data-career-total]')`, 20_000, 400));
  const careerCells = () => app.js(`[...(${ledger}?.querySelectorAll('[data-career-total] td') ?? [])].map((td) => td.textContent.trim())`);
  t.check("three seasons and a career line", (await app.js(`${ledger}?.querySelectorAll('[data-career-season]').length ?? 0`)) === 3);
  const perGame = await careerCells();
  t.check("the career line reads 13.6 points a game", perGame[perGame.length - 1] === "13.6", perGame);
  t.check("its 3P% is made over attempted, 42%", perGame.includes("42%"), perGame);
  await app.shot("player-career");
  const viewBefore = await app.js(`localStorage.getItem('bta.profile.career.view')`);
  await app.pick("Show", "Totals", 600);
  const totals = await careerCells();
  t.check("Totals turns MPG into MIN", await app.js(`[...(${ledger}?.querySelectorAll('th') ?? [])].some((th) => th.textContent.trim() === "MIN")`));
  t.check("Totals counts the career's points", /^\d{1,2},\d{3}$/.test(totals[totals.length - 1] ?? ""), totals);
  await app.js(viewBefore == null ? `localStorage.removeItem('bta.profile.career.view'); true` : `localStorage.setItem('bta.profile.career.view', ${JSON.stringify(viewBefore)}); true`);
  await app.nav("Player Explorer");
  await app.setQuery("");
  await app.setSeason("2025-26");
  await app.nav("Team Explorer");
  await app.setQuery("");
}
