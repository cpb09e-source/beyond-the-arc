/**
 * The sidebar hides and comes back: the button hides it and the page takes the
 * room; resting on the window's left edge slides it in over the page without
 * moving the page; leaving sends it away; a destination picked from it opens and
 * closes it; the button pins a peeking sidebar where it is. The sections never fold.
 */
import { SECTION, sleep } from "./cdp.mjs";

const state = (app) => app.js(`document.querySelector('[data-sidebar]')?.dataset.sidebar ?? null`);
const pageLeft = (app) => app.js(`Math.round(document.querySelector('main').getBoundingClientRect().left)`);
const toggle = (app) =>
  app.js(`[...document.querySelectorAll('header button')].find((b) => /sidebar/i.test(b.getAttribute('aria-label') ?? ''))?.click(); true`);

export default async function sidebar(app, t) {
  const y = 420;
  const before = await app.js(`localStorage.getItem('bta.sidebar.collapsed')`);
  if ((await state(app)) !== "pinned") {
    await toggle(app);
    await sleep(500);
  }

  t.check("no section folds", await app.js(`![...document.querySelectorAll('nav[aria-label=Workspace] button[aria-expanded]')].some((b) => /^(Teams|Players|Games|Tools)$/.test(b.textContent.trim()))`));
  t.check("pinned, the page starts after the sidebar", (await pageLeft(app)) >= 220, await pageLeft(app));

  await toggle(app);
  await sleep(500);
  t.check("the button hides it", (await state(app)) === "hidden", await state(app));
  t.check("hidden, the page takes the room", (await pageLeft(app)) < 10, await pageLeft(app));
  await app.shot("sidebar-hidden");

  // Brushing the edge on the way past does nothing; resting on it peeks.
  await app.mouse("mouseMoved", { x: 400, y });
  await app.mouse("mouseMoved", { x: 2, y });
  await sleep(60);
  await app.mouse("mouseMoved", { x: 400, y });
  await sleep(400);
  t.check("brushing the edge does not open it", (await state(app)) === "hidden", await state(app));
  await app.mouse("mouseMoved", { x: 2, y });
  await sleep(600);
  t.check("resting on the left edge peeks", (await state(app)) === "peek", await state(app));
  t.check("the peek leaves the page where it was", (await pageLeft(app)) < 10, await pageLeft(app));
  const right = await app.js(`Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().right)`);
  t.check("the peeking sidebar is its full width", right >= 220, right);
  await app.shot("sidebar-peek");

  // Leaving sends it away.
  await app.mouse("mouseMoved", { x: 120, y });
  await app.mouse("mouseMoved", { x: 700, y });
  await sleep(700);
  t.check("leaving it sends it away", (await state(app)) === "hidden", await state(app));

  // A destination picked from the peek opens, and the peek closes.
  await app.mouse("mouseMoved", { x: 2, y });
  await sleep(600);
  const at = await app.js(`(() => {
    const b = [...document.querySelectorAll('nav[aria-label=Workspace] button')].find((x) => x.textContent.trim() === 'Team Scatter');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (at) {
    await app.mouse("mouseMoved", { x: 100, y });
    await app.mouse("mouseMoved", at);
    await app.mouse("mousePressed", at, { button: "left", clickCount: 1 });
    await app.mouse("mouseReleased", at, { button: "left", clickCount: 1 });
  }
  await sleep(900);
  t.check("a destination picked from the peek opens", /Team Scatter/.test(await app.js(`${SECTION}?.querySelector('header')?.innerText ?? ''`)));
  t.check("and the peek closes", (await state(app)) === "hidden", await state(app));

  // The button pins a peeking sidebar where it is, and the page moves over for it.
  await app.mouse("mouseMoved", { x: 2, y });
  await sleep(600);
  t.check("it peeks again", (await state(app)) === "peek", await state(app));
  await toggle(app);
  await sleep(500);
  t.check("the button pins a peeking sidebar", (await state(app)) === "pinned", await state(app));
  t.check("pinned, the page moves over for it", (await pageLeft(app)) >= 220, await pageLeft(app));
  t.check("which is remembered", (await app.js(`localStorage.getItem('bta.sidebar.collapsed')`)) === "false");

  await app.mouse("mouseMoved", { x: 900, y });
  if (before === "true") {
    await toggle(app);
    await sleep(500);
  }
  await app.nav("Team Explorer");
}
