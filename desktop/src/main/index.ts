import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isCorpus, isValidYear, loadCorpus } from "./data";

/**
 * bta:// is the app's own asset protocol. Registered before the app is ready,
 * as a standard secure scheme, so the renderer can use it in <img> under a
 * strict Content-Security-Policy. Deep links for sign-in reuse a separate
 * scheme in P3; this one only ever serves files the app ships with.
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
  return app.isPackaged
    ? join(process.resourcesPath, "logos")
    : resolve(app.getAppPath(), "../public/ttz-logos");
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

function registerIpc(): void {
  ipcMain.handle("data:get", (_event, corpus: unknown, year: unknown) => {
    // Validated here, not trusted from the renderer: both values become part
    // of a filesystem path and a URL.
    if (!isCorpus(corpus) || !isValidYear(year)) throw new Error("bad-request");
    return loadCorpus(corpus, year);
  });

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
    return new Response(null, { status: 404 });
  });
}

// One running copy. A second launch focuses the first, which is also what makes
// sign-in links arrive at the right window in P3.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
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
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
