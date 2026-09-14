/**
 * Find Similar: Houston 2025-26 against every team-season, the score that opens
 * into where its points went, Peek's side by side, the profile and season
 * pickers, and (with --full) Cameron Boozer against every player-season.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { POPOVER, SECTION, sleep } from "./cdp.mjs";

const summary = (app) => app.js(`[...${SECTION}.querySelectorAll('section p')].map((p) => p.innerText).find((x) => /Closest:|Reading every season|Nothing in these seasons/.test(x)) ?? null`);
const ready = (app, ms) => app.waitFor(`!!${SECTION}.querySelector('[role=grid] [role=row]') && !/Reading every season/.test(${SECTION}.innerText)`, ms, 700);

/** Opens the chooser (it opens by itself only on an empty Find Similar) and picks by typing. */
async function choose(app, text) {
  if (!(await app.js(`!!document.querySelector('body > div[role=dialog]')`))) {
    await app.js(`[...${SECTION}.querySelectorAll('section')].find((s) => /teams like|players like/i.test(s.innerText))?.querySelector('button')?.click(); true`);
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
  t.check("Cincinnati 2016-17 is the closest, an 84", /Closest: Cincinnati 2016-17, an 84/.test(top ?? ""), top);
  const rows = await app.rowsText(3);
  t.check("Houston 2022-23 is second, an 82", /Houston/.test(rows[2] ?? "") && /2022-23/.test(rows[2] ?? "") && /\b82\b/.test(rows[2] ?? ""), rows[2]);
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
  if (box) t.check("the points add up to 100 − 84", box.points.reduce((s, v) => s + v, 0) === 16, box.points);
  await app.shot("similar-breakdown");
  await app.closePopover();

  // Peek sets the two side by side, with points per stat.
  const row = await app.rowPoint(1, 120);
  await app.hover(row);
  await app.key(" ");
  await sleep(600);
  const peek = await app.js(`(() => { const p = document.querySelector('.peek-panel'); return p ? { text: p.innerText.replace(/\\s+/g, ' ').slice(0, 200), points: [...p.querySelectorAll('[data-points]')].map((x) => Number(x.dataset.points)) } : null; })()`);
  t.check("Peek shows the match side by side", peek != null && /match/i.test(peek.text), peek?.text);
  if (peek) t.check("Peek's points add up to 100 − 84", peek.points.reduce((s, v) => s + v, 0) === 16, peek.points);
  await app.key(" ");

  t.check("Match on Style", await app.pick("Match on", "Style"));
  t.check("Style still draws matches", (await app.rowsText(2)).length === 2);
  await app.pick("Match on", "Overall", 800);
  t.check("Other seasons", await app.pick("Seasons", "Other seasons"));
  const others = await app.rowsText(6);
  t.check("Other seasons leaves 2025-26 out", others.slice(1).every((r) => !/2025-26/.test(r)), others);
  await app.pick("Seasons", "Every season", 800);

  // Download writes the chosen team and its matches.
  if (t.exportsDir) {
    for (const f of readdirSync(t.exportsDir)) rmSync(join(t.exportsDir, f));
    await app.press("Download");
    await app.press("CSV", POPOVER);
    const until = Date.now() + 30_000;
    let files = readdirSync(t.exportsDir);
    while (!files.length && Date.now() < until) {
      await sleep(400);
      files = readdirSync(t.exportsDir);
    }
    const csv = files.find((f) => f.endsWith(".csv"));
    const lines = csv ? readFileSync(join(t.exportsDir, csv), "utf8").split(/\r?\n/).filter(Boolean) : [];
    t.check("Download writes Houston and its 50 matches", lines.length - 1 === 51, lines.length - 1);
    t.check("the file is named for similar teams", /^bta-similar-teams-/.test(csv ?? ""), csv);
  }

  // Snapshot sets the closest ten, or fifteen, on a card.
  t.check("Snapshot opens its sheet", await app.press("Snapshot"));
  await sleep(700);
  const cardRows = () => app.js(`document.querySelectorAll('[role=dialog][aria-label^="Snapshot of Teams like Houston"] [data-card-row]').length`);
  const topN = (n) => app.js(`[...document.querySelectorAll('[role=radiogroup][aria-label="How many matches"] button')].find((b) => b.textContent.trim() === "Top ${n}")?.click(); true`);
  t.check("the card holds the closest 10", (await cardRows()) === 10, await cardRows());
  await topN(15);
  await sleep(400);
  t.check("Top 15 holds 15", (await cardRows()) === 15, await cardRows());
  await app.shot("similar-snapshot-15");
  await topN(10);
  await sleep(300);
  await app.shot("similar-snapshot-10");
  await app.key("Escape");
  await sleep(400);
  t.check("Esc closes the sheet", !(await app.js(`!!document.querySelector('[aria-label^="Snapshot of"]')`)));

  // Save keeps Houston; the saved list runs it again from another team, and takes it back out.
  const saveButton = `[...${SECTION}.querySelectorAll('header button[aria-haspopup=dialog]')].find((b) => /^Saved?/.test(b.textContent.trim()))`;
  const savedCount = () => app.js(`JSON.parse(localStorage.getItem('bta.similar.saved') ?? '[]').length`);
  const before = await savedCount();
  await app.js(`${saveButton}?.click(); true`);
  await sleep(500);
  t.check("Save offers to keep Houston 2025-26", await app.press("Save Houston 2025-26", POPOVER));
  const label = await app.js(`${saveButton}?.textContent.trim() ?? ''`);
  t.check("the button reads Saved", /^Saved/.test(label ?? ""), label);
  await app.shot("similar-saved");
  // Its own button closes it; the header's middle can hold a picker once Save and Download wrap it.
  await app.js(`${saveButton}?.click(); true`);
  await sleep(400);
  t.check("the saved list closes", !(await app.js(`!!${POPOVER}`)));
  await choose(app, "Duke");
  await sleep(800);
  t.check("another team draws its matches", (await ready(app, 60_000)) && (await app.rowsText(2)).some((r) => /Duke/.test(r)));
  await app.js(`${saveButton}?.click(); true`);
  await sleep(500);
  await app.type("Houston", 600);
  await app.key("Enter");
  await sleep(800);
  await ready(app, 60_000);
  const again = await summary(app);
  t.check("picking the saved Houston runs it again", /Closest: Cincinnati 2016-17, an 84/.test(again ?? ""), again);
  await app.js(`${saveButton}?.click(); true`);
  await sleep(500);
  t.check("Remove is offered for Houston", await app.press("Remove Houston 2025-26", POPOVER));
  await app.js(`${saveButton}?.click(); true`);
  await sleep(400);
  t.check("Remove takes it back out of saved", (await savedCount()) === before, await savedCount());

  if (t.full) {
    await app.pick("Find", "Players", 800);
    await choose(app, "Cameron Boozer");
    t.check("the player pool loads", await ready(app, 300_000));
    const players = await app.rowsText(7);
    t.check("Minix is among Boozer's closest", players.some((r) => /Minix/.test(r)), players);
    await app.pick("Find", "Teams", 800);
  }

  // The sidebar lists Find Similar under Teams and under Players, each opening on its own kind.
  const entry = (section) =>
    `[...document.querySelectorAll('nav[aria-label=Workspace] ul')].find((u) => u.previousElementSibling?.textContent.trim() === ${JSON.stringify(section)})?.querySelector('li button[title^="Find Similar"]')`;
  const findLabel = () => app.js(`${SECTION}.querySelector('header button[aria-label^="Find,"]')?.getAttribute('aria-label') ?? ''`);
  t.check("Find Similar is listed under Teams and Players", await app.js(`!!${entry("Teams")} && !!${entry("Players")}`));
  await app.js(`${entry("Players")}?.click(); true`);
  await sleep(900);
  const asPlayers = await findLabel();
  t.check("under Players it opens on players", /Players/.test(asPlayers), asPlayers);
  t.check("the Players entry is the one lit", await app.js(`${entry("Players")}?.getAttribute('aria-current') === 'page' && ${entry("Teams")}?.getAttribute('aria-current') !== 'page'`));
  await app.js(`${entry("Teams")}?.click(); true`);
  await sleep(900);
  const asTeams = await findLabel();
  t.check("under Teams it opens on teams", /Teams/.test(asTeams), asTeams);
  await app.nav("Team Explorer");
}
