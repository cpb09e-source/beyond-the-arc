/**
 * Find Similar: Houston 2025-26 against every team-season, the score that opens
 * into where its points went, Peek's side by side, the profile and season
 * pickers, and (with --full) Cameron Boozer against every player-season.
 */
import { SECTION, sleep } from "./cdp.mjs";

const summary = (app) => app.js(`[...${SECTION}.querySelectorAll('section p')].map((p) => p.innerText).find((x) => /Closest:|Reading every season|Nothing in these seasons/.test(x)) ?? null`);
const ready = (app, ms) => app.waitFor(`!!${SECTION}.querySelector('[role=grid] [role=row]') && !/Reading every season/.test(${SECTION}.innerText)`, ms, 700);

/** Opens the chooser (it opens by itself only on an empty Find Similar) and picks by typing. */
async function choose(app, text) {
  if (!(await app.js(`!!document.querySelector('body > div[role=dialog]')`))) {
    await app.js(`[...${SECTION}.querySelectorAll('section')].find((s) => /Teams like|Players like/.test(s.innerText))?.querySelector('button')?.click(); true`);
    await sleep(500);
  }
  await app.type(text, 900);
  await app.key("Enter");
}

export default async function similar(app, t) {
  await app.nav("Find Similar");
  if (!(await app.js(`/Teams/.test(${SECTION}.querySelector('header button[aria-label^="Find,"]')?.getAttribute('aria-label') ?? '')`))) await app.pick("Find", "Teams");
  await app.pick("Match on", "Overall", 600);
  await app.pick("Seasons", "Every season", 600);
  await choose(app, "Houston");
  // The chooser takes the tab's season, which the scenarios before this one left on 2025-26.
  t.check("the team pool loads", await ready(app, 120_000));
  const meta = await app.meta();
  t.check("matches come from 4,620 team-seasons", /of 4,620 team-seasons/.test(meta), meta);
  const top = await summary(app);
  t.check("Houston 2024-25 is the closest, a 78", /Closest: Houston 2024-25, a 78/.test(top ?? ""), top);
  const rows = await app.rowsText(3);
  t.check("Cincinnati 2016-17 is second, a 73", /Cincinnati/.test(rows[2] ?? "") && /2016-17/.test(rows[2] ?? "") && /\b73\b/.test(rows[2] ?? ""), rows[2]);
  await app.shot("similar-houston");

  // The score opens into its points, and they add up to it.
  await app.js(`${SECTION}.querySelectorAll('[role=grid] [role=row]')[1]?.querySelector('button[aria-label^="Match"]')?.click(); true`);
  await sleep(600);
  const box = await app.js(`(() => {
    const d = [...document.querySelectorAll('body > div[role=dialog]')].find((x) => /Starts at 100/.test(x.innerText));
    if (!d) return null;
    return { text: d.innerText.replace(/\\s+/g, ' ').slice(0, 300), points: [...d.querySelectorAll('[data-points]')].map((p) => Number(p.dataset.points)) };
  })()`);
  t.check("the score opens where its points went", box != null, box);
  if (box) t.check("the points add up to 100 − 78", box.points.reduce((s, v) => s + v, 0) === 22, box.points);
  await app.shot("similar-breakdown");
  await app.closePopover();

  // Peek sets the two side by side, with points per stat.
  const row = await app.rowPoint(1, 120);
  await app.hover(row);
  await app.key(" ");
  await sleep(600);
  const peek = await app.js(`(() => { const p = document.querySelector('.peek-panel'); return p ? { text: p.innerText.replace(/\\s+/g, ' ').slice(0, 200), points: [...p.querySelectorAll('[data-points]')].map((x) => Number(x.dataset.points)) } : null; })()`);
  t.check("Peek shows the match side by side", peek != null && /match/i.test(peek.text), peek?.text);
  if (peek) t.check("Peek's points add up to 100 − 78", peek.points.reduce((s, v) => s + v, 0) === 22, peek.points);
  await app.key(" ");

  t.check("Match on Style", await app.pick("Match on", "Style"));
  t.check("Style still draws matches", (await app.rowsText(2)).length === 2);
  await app.pick("Match on", "Overall", 800);
  t.check("Other seasons", await app.pick("Seasons", "Other seasons"));
  const others = await app.rowsText(6);
  t.check("Other seasons leaves 2025-26 out", others.slice(1).every((r) => !/2025-26/.test(r)), others);
  await app.pick("Seasons", "Every season", 800);

  if (t.full) {
    await app.pick("Find", "Players", 800);
    await choose(app, "Cameron Boozer");
    t.check("the player pool loads", await ready(app, 300_000));
    const players = await app.rowsText(7);
    t.check("Minix is among Boozer's closest", players.some((r) => /Minix/.test(r)), players);
    await app.pick("Find", "Teams", 800);
  }
  await app.nav("Team Explorer");
}
