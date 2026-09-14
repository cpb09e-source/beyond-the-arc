/**
 * The filter box: conditions and exact names as words, completion, the message
 * for a stat that does not exist, and Peek beside the name. Counts are 2025-26's.
 */
import { SECTION, sleep } from "./cdp.mjs";

const INPUT = `${SECTION}.querySelector('header input')`;
const offers = (app) =>
  app.js(`[...(document.querySelector('[role=listbox][aria-label="Filter suggestions"]')?.querySelectorAll('[role=option]') ?? [])].map((o) => o.innerText.replace(/\\s+/g, ' ').trim())`);

async function expectCount(app, t, query, want) {
  await app.setQuery(query);
  const got = await app.shown();
  t.check(`"${query}" keeps ${want}`, got === want, await app.meta());
}

export default async function filters(app, t) {
  await app.nav("Team Explorer");
  await app.setSeason("2025-26");
  await app.setQuery("");

  // Peek opens just past the Team column, not at the far edge.
  await app.js(`document.activeElement?.blur(); true`);
  const row = await app.rowPoint(4);
  await app.hover(row);
  await app.key(" ");
  await sleep(500);
  const place = await app.js(`(() => {
    const p = document.querySelector('.peek-panel')?.getBoundingClientRect();
    const team = [...${SECTION}.querySelectorAll('[role=columnheader]')].find((h) => h.textContent.trim().startsWith('Team'))?.getBoundingClientRect();
    return p && team ? { gap: Math.round(p.left - team.right) } : null;
  })()`);
  t.check("Peek opens beside the name", place != null && place.gap >= 0 && place.gap <= 16, place);
  await app.key(" ");

  await expectCount(app, t, "conf:SEC net>20 tempo<68", 1);
  await expectCount(app, t, "efg>55 3p>=36", 26);

  // Completion: Tab takes the first offer.
  await app.js(`(() => { const el = ${INPUT}; el.focus(); el.select(); return true; })()`);
  await app.type("te", 700);
  const teOffers = await offers(app);
  t.check("typing te offers completions", teOffers.length > 0, teOffers);
  await app.key("Tab");
  const afterTab = await app.query();
  t.check("Tab takes the first offer", typeof afterTab === "string" && afterTab.length > 2 && afterTab.startsWith("te"), afterTab);

  // A half-typed condition offers thresholds; an arrowed pick with Enter writes one.
  await app.js(`(() => { const el = ${INPUT}; el.focus(); el.select(); return true; })()`);
  await app.type("net>", 700);
  t.check("net> offers thresholds", (await offers(app)).length > 0);
  await app.key("ArrowDown");
  await app.key("Enter");
  t.check("the pick writes a number", /net\s*>=?\s*-?\d/.test((await app.query()) ?? ""), await app.query());

  await app.setQuery("temp>5");
  const problem = await app.js(`(${SECTION}.innerText.match(/[^\\n]*temp[^\\n]*/gi) ?? []).join(' | ')`);
  t.check("an unknown stat says so", /temp/i.test(problem) && (await app.shown()) === 0, problem);
  await app.setQuery("");

  await app.nav("Team Game Log");
  await app.setSeason("2025-26");
  await expectCount(app, t, "margin>30 home=0", 49);
  await app.setQuery("");

  await app.nav("Player Explorer");
  await app.setSeason("2025-26");
  await expectCount(app, t, "ppg>20 3p>38", 13);
  await expectCount(app, t, "team: Duke ts>60", 3);
  await app.setQuery("");

  await app.nav("Player Game Log");
  await app.setSeason("2025-26");
  await expectCount(app, t, "pts>=40", 42);
  await app.setQuery("");
  await app.nav("Team Explorer");
}
