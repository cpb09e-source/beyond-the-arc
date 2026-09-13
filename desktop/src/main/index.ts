import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AuthState } from "../preload";
import {
  accessToken,
  authState,
  cancelSignIn,
  handleDeepLink,
  onAuthChange,
  pendingLink,
  previewAuthState,
  restoreSession,
  settledAuthState,
  SCHEME,
  signIn,
  signOut,
} from "./auth";
import { parseQuestion } from "./calc";
import { isCorpus, isValidKey, isValidYear, loadCorpus, purgePaidCache, setTokenProvider } from "./data";
import { checkForUpdates, installUpdate, onUpdateChange, startUpdater, updateState } from "./updater";

/**
 * bta:// is the app's own asset protocol. Registered before the app is ready,
 * as a standard secure scheme, so the renderer can use it in <img> under a
 * strict Content-Security-Policy. It only ever serves files the app ships with.
 *
 * btacbb:// is a different thing entirely: the operating system's route from
 * the browser back into the app during sign-in (see ./auth.ts).
 */
protocol.registerSchemesAsPrivileged([
  { scheme: "bta", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Scripted verification, development only. BTA_CDP_PORT opens Chromium's
 * debugging port so a test script can drive the real window: press Space, read
 * the DOM, take screenshots. It must be switched on before the app is ready,
 * and a packaged build ignores it entirely.
 */
const CDP_PORT = app.isPackaged ? undefined : process.env.BTA_CDP_PORT;
if (CDP_PORT) app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);

/** Window ground and title-bar colors, matched to the renderer's tokens. */
const CHROME = {
  light: { ground: "#faf7f2", bar: "#f3efe7", symbol: "#3a425c" },
  dark: { ground: "#1c1c1c", bar: "#171717", symbol: "#b4afa6" },
} as const;

/** Must equal the renderer's title bar height, or the caption buttons float. */
const TITLE_BAR_H = 40;

let win: BrowserWindow | null = null;

const chrome = () => (nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light);

/** Team crests: the site's own folder in development, bundled when packaged. */
function logosDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "logos") : resolve(app.getAppPath(), "../public/ttz-logos");
}

/** Conference marks: the site's 32 files (public/images/conf), shipped beside the crests. */
function confDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "conf") : resolve(app.getAppPath(), "../public/images/conf");
}

function createWindow(): void {
  const c = chrome();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    // Shown on ready-to-show, painted in the theme's own ground, so launch
    // never flashes a white rectangle before the app draws.
    show: false,
    backgroundColor: c.ground,
    title: "Beyond the Arc",
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: c.bar, symbolColor: c.symbol, height: TITLE_BAR_H } }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // A scripted run shows the window without taking focus from whatever the
  // person at the machine is doing.
  win.once("ready-to-show", () => (CDP_PORT ? win?.showInactive() : win?.show()));

  // Links leave for the real browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const home = process.env.ELECTRON_RENDERER_URL ?? "file://";
    if (!url.startsWith(home)) event.preventDefault();
  });

  if (!app.isPackaged) {
    // The application menu is removed below, which takes its default reload and
    // devtools accelerators with it. Restore the two that development needs.
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      if (input.key === "F12" || (input.control && input.shift && key === "i")) {
        win?.webContents.toggleDevTools();
      } else if (input.control && !input.shift && key === "r") {
        win?.webContents.reload();
      }
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));

  win.on("closed", () => {
    win = null;
  });
}

function bringToFront(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function registerIpc(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  // An installed copy opens nothing until an entitled account signs in. A run
  // from the repo opens straight in, unless BTA_REQUIRE_ACCOUNT=1 asks to try
  // the welcome screen.
  ipcMain.handle("app:requires-account", () => app.isPackaged || process.env.BTA_REQUIRE_ACCOUNT === "1");

  ipcMain.handle("data:get", (_event, corpus: unknown, year: unknown, key: unknown) => {
    // Validated here, not trusted from the renderer: all three become part of a
    // filesystem path and a URL.
    if (!isCorpus(corpus) || !isValidYear(year) || !isValidKey(corpus, key)) throw new Error("bad-request");
    return loadCorpus(corpus, year, key ?? "");
  });

  // Ask the Win Calculator. The site's parser holds the model key; see ./calc.ts.
  ipcMain.handle("calc:parse", (_event, query: unknown) => parseQuestion(query));

  // The renderer owns the choice; the OS-level pieces (caption buttons, window
  // ground, prefers-color-scheme inside the page) follow nativeTheme.
  ipcMain.on("theme:set", (_event, mode: unknown) => {
    if (mode === "system" || mode === "light" || mode === "dark") nativeTheme.themeSource = mode;
  });

  nativeTheme.on("updated", () => {
    if (!win) return;
    const c = chrome();
    win.setBackgroundColor(c.ground);
    if (process.platform !== "darwin") win.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol });
  });

  // Copy link, Copy stats, a table for a spreadsheet: text only, up to what a paste can reasonably hold.
  ipcMain.handle("clipboard:write-text", async (_event, text: unknown) => {
    if (typeof text !== "string" || text.length > 30_000_000) return false;
    await clipboard.writeText(text);
    return true;
  });

  // Export: a table as a CSV file, only where the reader chose to save it. A byte-order mark goes first, so
  // Excel opens the file as UTF-8 and "Hawai'i" and accented names survive.
  ipcMain.handle("export:save-csv", async (_event, text: unknown, name: unknown) => {
    if (!win || typeof text !== "string" || text.length > 80_000_000 || typeof name !== "string") return { ok: false };
    const safe = name.replace(/[^\w .()-]+/g, "-").replace(/^[-. ]+/, "").trim().slice(0, 100) || "beyond-the-arc";
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save as CSV",
      defaultPath: join(app.getPath("documents"), `${safe}.csv`),
      filters: [{ name: "CSV (comma separated)", extensions: ["csv"] }],
    });
    if (canceled || !filePath) return { ok: false };
    await writeFile(filePath, `﻿${text}`, "utf8");
    return { ok: true, path: filePath };
  });

  // Snapshot cards. The page names a rectangle of itself; the pixels leave only as
  // the clipboard image or the file the reader asked for.
  const inRange = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
  ipcMain.handle("snapshot:grab", async (_event, rect: unknown) => {
    const r = (rect ?? {}) as Record<string, unknown>;
    if (!win || !inRange(r.x, 20000) || !inRange(r.y, 20000) || !inRange(r.width, 20000) || !inRange(r.height, 20000)) return null;
    if (r.width < 1 || r.height < 1) return null;
    const image = await win.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
    return image.isEmpty() ? null : image.toDataURL();
  });
  ipcMain.handle("snapshot:deliver", async (_event, dataUrl: unknown, how: unknown) => {
    const h = (how ?? {}) as Record<string, unknown>;
    if (!win || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 150_000_000) return { ok: false };
    if ((h.action !== "copy" && h.action !== "save") || typeof h.name !== "string" || !inRange(h.width, 20000) || !inRange(h.height, 20000)) return { ok: false };
    let image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return { ok: false };
    // A preview zoomed to fit a small window captures smaller than the card: bring it back to the card's size.
    if (image.getSize().width < h.width) image = image.resize({ width: Math.round(h.width), height: Math.round(h.height), quality: "best" });
    if (h.action === "copy") {
      // Electron 44's clipboard is the W3C shape: an image is a PNG blob in a ClipboardItem.
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]);
      return { ok: true };
    }
    const safe = h.name.replace(/[^\w.-]+/g, "-").replace(/^-+/, "").slice(0, 100) || "beyond-the-arc.png";
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save snapshot",
      defaultPath: join(app.getPath("pictures"), safe.endsWith(".png") ? safe : `${safe}.png`),
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (canceled || !filePath) return { ok: false };
    await writeFile(filePath, image.toPNG());
    return { ok: true, path: filePath };
  });

  ipcMain.handle("auth:state", () => settledAuthState());
  // Copied here rather than by the page: the system clipboard takes it whether or not the window has focus.
  ipcMain.handle("auth:copy-link", () => {
    const link = pendingLink();
    if (link) clipboard.writeText(link);
    return link !== null;
  });
  ipcMain.handle("auth:preview", (_event, status: unknown) => previewAuthState(status));
  ipcMain.handle("auth:sign-in", () => signIn());
  ipcMain.handle("auth:cancel", () => cancelSignIn());
  ipcMain.handle("auth:sign-out", () => signOut());

  ipcMain.handle("update:state", () => updateState());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:install", () => installUpdate());

  // Gated seasons ask for the reader's session, refreshed first if it is about to lapse.
  setTokenProvider(accessToken);

  let previous: AuthState["status"] = authState().status;
  onAuthChange((s) => {
    win?.webContents.send("auth:changed", s);
    // The browser had focus for the Allow button; finishing sign-in brings the app back.
    if (previous === "waiting" && s.status === "signedIn") bringToFront();
    // Paid seasons leave the disk with the account that could open them.
    if (s.status === "signedOut" || s.status === "refused") void purgePaidCache();
    previous = s.status;
  });
  onUpdateChange((s) => win?.webContents.send("update:changed", s));
}

/** Player headshots: the site's own folder in development. */
function playersDir(): string | null {
  return app.isPackaged ? null : resolve(app.getAppPath(), "../public/images/players");
}

function serveAssets(): void {
  protocol.handle("bta", (request) => {
    const url = new URL(request.url);
    if (url.hostname === "logo") {
      // Digits only: the id becomes a filename, and nothing else may.
      const m = /^\/(\d{1,9})\.png$/.exec(url.pathname);
      const file = m ? join(logosDir(), `${m[1]}.png`) : null;
      if (file && existsSync(file)) return net.fetch(pathToFileURL(file).toString());
    }
    if (url.hostname === "conf") {
      // A conference code as the site spells it ("B10", "SEC"): letters and digits, nothing else.
      const m = /^\/([A-Za-z0-9]{1,8})\.png$/.exec(url.pathname);
      const file = m ? join(confDir(), `${m[1]}.png`) : null;
      if (file && existsSync(file)) return net.fetch(pathToFileURL(file).toString());
    }
    if (url.hostname === "player") {
      // <bart id>.webp (600x436) or <bart id>-sm.webp (240x174, face-cropped),
      // the two sizes the site's fetch script writes.
      const m = /^\/(\d{1,9})(-sm)?\.webp$/.exec(url.pathname);
      if (m) {
        const name = `${m[1]}${m[2] ?? ""}.webp`;
        const dir = playersDir();
        const file = dir ? join(dir, name) : null;
        if (file && existsSync(file)) return net.fetch(pathToFileURL(file).toString());
        // 344 MB of headshots is not something to ship in an installer. A
        // packaged app asks the site for the one it needs, and Chromium's
        // cache keeps it after the first view.
        return net.fetch(`https://btacbb.xyz/images/players/${name}`);
      }
    }
    if (url.hostname === "nba") {
      // An NBA franchise mark for a draft badge, by ESPN's slug ("dal", "gs"). Fetched here
      // because the page does not reach other hosts; Chromium's cache keeps it after.
      const m = /^\/([a-z]{2,4})\.png$/.exec(url.pathname);
      if (m) return net.fetch(`https://a.espncdn.com/i/teamlogos/nba/500/${m[1]}.png`);
    }
    return new Response(null, { status: 404 });
  });
}

/**
 * btacbb:// belongs to this app.
 *
 * An installed build is registered by its installer (electron-builder's
 * `protocols`) and again here, which repairs a registration another program
 * took over. Development registers only when asked, with
 * BTA_REGISTER_PROTOCOL=1: it writes to the Windows registry, and would point
 * the scheme at a development copy that is gone tomorrow.
 */
function registerScheme(): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(SCHEME);
  } else if (process.env.BTA_REGISTER_PROTOCOL === "1") {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1] ?? ".")]);
  }
}

const linkIn = (argv: readonly string[]): string | undefined => argv.find((a) => a.startsWith(`${SCHEME}://`));

// One running copy. A second launch focuses the first, and on Windows that
// second launch is also how a btacbb:// link arrives: in its command line.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerScheme();

  app.on("second-instance", (_event, argv) => {
    const link = linkIn(argv);
    if (link) void handleDeepLink(link);
    bringToFront();
  });

  // macOS delivers the link as an event instead.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  void app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("xyz.btacbb.desktop");
    // No native menu on Windows or Linux. Its only visible effect in a window
    // with a custom title bar is that Alt steals focus into an invisible menu,
    // which would break every Alt shortcut the app will define. macOS keeps
    // its menu, where Edit and Quit live.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    serveAssets();
    registerIpc();
    createWindow();
    void restoreSession();
    startUpdater();

    // Launched by a link while not running: there is no sign-in waiting in
    // this fresh process, and handleDeepLink says so instead of redeeming.
    const first = linkIn(process.argv);
    if (first) void handleDeepLink(first);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
