/**
 * Research history in its version 1 shape: a visit keeps its filter and table
 * layout, a Stat Lens step keeps its object, stat and the place it happened in,
 * and every step carries the version, the sitting and the tab.
 */
import { SECTION, sleep } from "./cdp.mjs";

const steps = (app) => app.js(`JSON.parse(localStorage.getItem('bta.research-history') ?? '[]')`);

export default async function history(app, t) {
  const hintsBefore = await app.js(`localStorage.getItem('bta.hints')`);
  try {
    await app.nav("Team Explorer");
    await app.setSeason("2025-26");
    await app.setQuery("");
    await sleep(1600);
    const start = (await steps(app)).length;

    await app.setQuery("conf: SEC");
    await sleep(1600);
    await app.pick("View", "Four Factors", 1800);

    // Alt-click a number: a Stat Lens step.
    const cell = await app.js(`(() => {
      const r = ${SECTION}.querySelectorAll('[role=grid] [role=row]')[1];
      const c = r && [...r.querySelectorAll('[role=gridcell]')].find((x) => /\\d/.test(x.textContent) && x.getBoundingClientRect().left > 320);
      if (!c) return null;
      const b = c.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (cell) {
      await app.click(cell, { mods: ["alt"] });
      await sleep(900);
      await app.key("Escape");
    }
    // Steps are written in a batch a moment after the last one.
    await sleep(2200);

    const all = await steps(app);
    const mine = all.slice(Math.max(0, start - 1));
    t.check("new steps were written", mine.length >= 2, mine.length);
    const fresh = mine.filter((s) => s.at > Date.now() - 120_000);
    t.check("every new step is version 1", fresh.length > 0 && fresh.every((s) => s.v === 1), fresh.map((s) => s.v));
    t.check("every new step has a sitting and a tab", fresh.every((s) => typeof s.session === "string" && typeof s.tab === "string"));
    t.check("one sitting for the whole run", new Set(fresh.map((s) => s.session)).size === 1, [...new Set(fresh.map((s) => s.session))]);

    const filtered = fresh.find((s) => s.kind === "visit" && /conf:\s*SEC/i.test(s.place?.query ?? ""));
    t.check("the filtered visit keeps its query", !!filtered, fresh.map((s) => s.title));
    const layout = fresh.find((s) => s.kind === "visit" && s.place?.table?.view);
    t.check("the Four Factors visit keeps its table layout", !!layout, fresh.map((s) => s.place?.table));
    const lens = fresh.find((s) => s.kind === "lens");
    t.check("the Stat Lens step keeps its team and stat", !!lens && lens.obj?.kind === "team" && typeof lens.stat === "string", lens);
    t.check("the Stat Lens step keeps where it happened", lens?.place?.viewId === "team-explorer" && /conf:\s*SEC/i.test(lens?.place?.query ?? ""), lens?.place);
  } finally {
    await app.setQuery("");
    await app.pick("View", "Overview", 1200);
    await app.js(hintsBefore == null ? `localStorage.removeItem('bta.hints'); true` : `localStorage.setItem('bta.hints', ${JSON.stringify(hintsBefore)}); true`);
  }
}
