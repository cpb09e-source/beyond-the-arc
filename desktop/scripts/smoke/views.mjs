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
  await app.nav("Team Explorer");
  await app.setQuery("");
}
