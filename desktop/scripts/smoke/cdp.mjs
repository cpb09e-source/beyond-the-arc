/**
 * cdp.mjs — the smoke suite's hands in the real window: one DevTools connection,
 * and the gestures every scenario needs (go to a view, type a filter, press a
 * key, click, hover, read the header).
 *
 * FOCUS EMULATION IS ON. The window usually sits behind the editor, and without
 * Emulation.setFocusEmulationEnabled key events are silently dropped.
 *
 * SELECTORS FOLLOW THE APP'S OWN LABELS: the sidebar is nav[aria-label=Workspace],
 * the pane in front is main > section:not([hidden]), pickers are header buttons
 * whose aria-label starts "<Label>,". A rename there is a rename here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

export const SECTION = `document.querySelector('main > section:not([hidden])')`;
export const POPOVER = `document.querySelector('body > div[role=dialog]')`;

const KEYS = {
  Backspace: [8, "Backspace"],
  Tab: [9, "Tab"],
  Enter: [13, "Enter"],
  Escape: [27, "Escape"],
  " ": [32, "Space"],
  ArrowUp: [38, "ArrowUp"],
  ArrowDown: [40, "ArrowDown"],
  q: [81, "KeyQ"],
};
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export async function connect(port, shotsDir = null) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === "page" && /^(http:\/\/localhost|file:)/.test(t.url));
  if (!target) throw new Error(`no app window on port ${port}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("could not connect to the window"));
  });

  let nextId = 0;
  const pending = new Map();
  /** Uncaught exceptions and console.error calls since the last reset. */
  const errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(`${d.text} ${d.exception?.description ?? ""}`.slice(0, 400));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`.slice(0, 400));
    }
  };
  // Without this, a window that dies mid-command leaves its promise hanging, and Node
  // exits on an unsettled await without saying which check was running.
  let closed = false;
  ws.onclose = () => {
    closed = true;
    for (const { rej } of pending.values()) rej(new Error("the app window closed"));
    pending.clear();
  };

  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      if (closed) return rej(new Error("the app window closed"));
      pending.set(++nextId, { res, rej });
      ws.send(JSON.stringify({ id: nextId, method, params }));
    });

  const js = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
    return r.result.value;
  };

  const key = async (k, { mods = [], hold = 0, wait = 250 } = {}) => {
    const [code, name] = KEYS[k] ?? [k.toUpperCase().charCodeAt(0), `Key${k.toUpperCase()}`];
    const modifiers = mods.reduce((s, m) => s | MOD[m], 0);
    const base = { key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.length === 1 && !modifiers ? { text: k } : {}) });
    if (hold) await sleep(hold);
    await cmd("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(wait);
  };

  const type = async (text, wait = 450) => {
    await cmd("Input.insertText", { text });
    await sleep(wait);
  };

  const mouse = (type, { x, y }, extra = {}) => cmd("Input.dispatchMouseEvent", { type, x, y, ...extra });

  const hover = async (at) => {
    await mouse("mouseMoved", { x: at.x - 4, y: at.y });
    await mouse("mouseMoved", at);
    await sleep(250);
  };

  const click = async (at, { button = "left", mods = [] } = {}) => {
    const modifiers = mods.reduce((s, m) => s | MOD[m], 0);
    await mouse("mouseMoved", at, { modifiers });
    await mouse("mousePressed", at, { button, clickCount: 1, modifiers });
    await mouse("mouseReleased", at, { button, clickCount: 1, modifiers });
    await sleep(400);
  };

  const waitFor = async (expression, ms = 30_000, every = 400) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await js(expression).catch(() => false)) return true;
      await sleep(every);
    }
    return false;
  };

  const nav = async (label, wait = 2500) => {
    const ok = await js(
      `(() => { const b = [...document.querySelectorAll('nav[aria-label=Workspace] button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`,
    );
    await sleep(wait);
    return ok;
  };

  const setQuery = async (text) => {
    await js(`(() => { const el = ${SECTION}.querySelector('header input'); el.focus(); el.select(); return true; })()`);
    if (text) await cmd("Input.insertText", { text });
    else await key("Backspace", { wait: 0 });
    await sleep(900);
    await js(`document.activeElement?.blur(); true`);
    await sleep(150);
  };

  const query = () => js(`${SECTION}.querySelector('header input')?.value ?? null`);
  const meta = () => js(`${SECTION}.querySelector('header')?.innerText.replace(/\\s+/g, ' ') ?? ''`);

  /** The rows a table's header counts: the first "N of M" or "N <noun>" in the header. */
  const shown = async () => {
    const text = await meta();
    const m = /([\d,]+)\s+of\s+[\d,]+/.exec(text) ?? /([\d,]+)\s+(?:teams?|players?|games?|player-games?|rows?)\b/i.exec(text);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };

  const press = async (text, where = SECTION) => {
    const ok = await js(
      `(() => { const b = [...((${where})?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`,
    );
    await sleep(500);
    return ok;
  };

  /** Chooses an option in one of the header's pickers ("View", "Match on", "Seasons", ...). */
  const pick = async (picker, label, wait = 1500) => {
    await js(`[...${SECTION}.querySelectorAll('header button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(`${picker},`)}))?.click(); true`);
    await sleep(400);
    const ok = await js(
      `(() => { const o = [...document.querySelectorAll('[role=option]')].find((x) => x.innerText.split('\\n')[0].trim() === ${JSON.stringify(label)}); if (!o) return false; o.click(); return true; })()`,
    );
    await sleep(wait);
    return ok;
  };

  /**
   * Puts the pane in front on one season, through the header's season control: the
   * single switcher's option, or "Only" on the explorers' several-season picker.
   */
  const setSeason = async (label) => {
    const now = await js(`${SECTION}.querySelector('header button[aria-label^="Season,"]')?.getAttribute('aria-label') ?? null`);
    if (now == null || now === `Season, ${label}`) return now != null;
    await js(`${SECTION}.querySelector('header button[aria-label^="Season,"]')?.click(); true`);
    await sleep(400);
    const year = Number(label.slice(0, 4)) + 1;
    const ok = await js(`(() => {
      const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find((x) => x.dataset.season === ${JSON.stringify(String(year))} || x.innerText.split('\\n')[0].trim() === ${JSON.stringify(label)});
      if (!o) return false;
      (o.querySelector('[data-only]') ?? o).click();
      return true;
    })()`);
    await sleep(2500);
    return ok;
  };

  /** Adds a season to the explorers' picker, keeping the ones already picked. */
  const addSeason = async (label) => {
    await js(`${SECTION}.querySelector('header button[aria-label^="Season,"]')?.click(); true`);
    await sleep(400);
    const year = Number(label.slice(0, 4)) + 1;
    const ok = await js(`(() => { const o = document.querySelector('[role=listbox][aria-label=Seasons] [role=option][data-season="${year}"]'); if (!o || o.getAttribute('aria-selected') === 'true') return false; o.click(); return true; })()`);
    await sleep(300);
    await key("Escape");
    await sleep(2500);
    return ok;
  };

  /** A click on the pane's empty header, which counts as outside any popover. */
  const closePopover = async () => {
    const at = await js(`(() => { const r = ${SECTION}.querySelector('header').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 4 }; })()`);
    await click(at);
  };

  const popoverText = () => js(`${POPOVER}?.innerText.replace(/\\s+/g, ' ').slice(0, 800) ?? null`);
  const rowsText = (n) => js(`[...${SECTION}.querySelectorAll('[role=grid] [role=row]')].slice(0, ${n}).map((r) => r.innerText.replace(/\\s+/g, ' ').slice(0, 240))`);
  const rowPoint = (i, dx = 150) =>
    js(`(() => { const r = ${SECTION}.querySelectorAll('[role=grid] [role=row]')[${i}]?.getBoundingClientRect(); return r ? { x: r.left + ${dx}, y: r.top + r.height / 2 } : null; })()`);

  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const s = await cmd("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  await cmd("Page.enable");
  await cmd("Runtime.enable");
  await cmd("Emulation.setFocusEmulationEnabled", { enabled: true });

  return {
    cmd, js, errors, key, type, mouse, hover, click, waitFor, nav, setQuery, query, meta, shown, press, pick, setSeason, addSeason,
    closePopover, popoverText, rowsText, rowPoint, shot,
    reload: async () => {
      await cmd("Page.reload", { ignoreCache: true });
      await waitFor(`!!document.querySelector('nav[aria-label=Workspace]')`, 60_000);
      await sleep(2500);
      errors.length = 0;
    },
    close: () => ws.close(),
  };
}
