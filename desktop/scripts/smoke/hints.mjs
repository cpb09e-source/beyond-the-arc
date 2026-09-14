/**
 * The discovery hints: resting on a team shows "Hold Q", resting on a number
 * after that shows "Alt-click", each once a run, and using the gesture retires
 * its hint. The reader's own hint counters are put back afterwards.
 */
import { SECTION, sleep } from "./cdp.mjs";

const tip = (app) => app.js(`document.querySelector('[role=status][aria-label=Tip]')?.innerText.replace(/\\s+/g, ' ') ?? null`);
const stored = (app) => app.js(`JSON.parse(localStorage.getItem('bta.hints') ?? 'null')`);

/** The middle of a numeric cell in a row of the table in front. */
const numberCell = (app, row) =>
  app.js(`(() => {
    const r = ${SECTION}.querySelectorAll('[role=grid] [role=row]')[${row}];
    const c = r && [...r.querySelectorAll('[role=gridcell]')].find((x) => /\\d/.test(x.textContent) && x.getBoundingClientRect().left > 320);
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  })()`);

export default async function hints(app, t) {
  const before = await app.js(`localStorage.getItem('bta.hints')`);
  try {
    await app.js(`localStorage.setItem('bta.hints', JSON.stringify({ focus: { shown: 0, used: false }, lens: { shown: 0, used: false } })); true`);
    await app.reload();
    await app.nav("Team Explorer");
    await app.setSeason("2025-26");
    await app.setQuery("");
    await app.js(`document.activeElement?.blur(); true`);

    const a = await numberCell(app, 3);
    await app.hover(a);
    await sleep(1700);
    const focusTip = await tip(app);
    t.check("resting on a team shows Hold Q", /Hold\s*Q/.test(focusTip ?? ""), focusTip);
    await app.shot("hint-focus");

    // Another row: Focus has had its hint this run, so the number's Lens hint is next.
    await app.hover({ x: a.x, y: a.y - 300 < 0 ? a.y + 200 : 40 });
    await sleep(400);
    const b = await numberCell(app, 7);
    await app.hover(b);
    await sleep(1700);
    const lensTip = await tip(app);
    t.check("resting on a number next shows Alt-click", /Alt/.test(lensTip ?? ""), lensTip);

    const counts = await stored(app);
    t.check("each hint counted one showing", counts?.focus?.shown === 1 && counts?.lens?.shown === 1, counts);

    // Holding Q over the row retires the Focus hint.
    await app.hover(a);
    await app.key("q", { hold: 500, wait: 500 });
    const used = await stored(app);
    t.check("using Focus retires its hint", used?.focus?.used === true, used);
    t.check("no hint is left on screen", (await tip(app)) === null, await tip(app));
  } finally {
    await app.js(before == null ? `localStorage.removeItem('bta.hints'); true` : `localStorage.setItem('bta.hints', ${JSON.stringify(before)}); true`);
    await app.reload();
  }
}
