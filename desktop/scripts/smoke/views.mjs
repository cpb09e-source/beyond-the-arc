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
  await app.nav("Team Explorer");
}
