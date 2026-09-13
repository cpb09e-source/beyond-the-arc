import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "../preload";

/**
 * Staying current, the way Linear and Notion do it: download quietly, say so
 * once, install on the next restart or when asked.
 *
 * THE FEED IS PUBLIC, on the site's public R2 bucket next to the installer
 * (see netlify/functions/desktop-download.mts for why that is safe). A request
 * carrying the reader's session would be forwarded by electron-updater to
 * storage that refuses two kinds of credential, and there is nothing in an
 * installer worth guarding: the app opens nothing until an entitled account
 * signs in.
 *
 * DEVELOPMENT NEVER UPDATES ITSELF. Only an installed build has a version to
 * compare against the feed.
 */

export const RELEASE_BASE = "https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev/desktop";
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let state: UpdateState = { status: "idle" };
const listeners = new Set<(s: UpdateState) => void>();

function publish(next: UpdateState): void {
  state = next;
  for (const fn of listeners) fn(next);
}

/**
 * An update problem, in words a reader can use. electron-updater's own message
 * is a raw HTTP dump; the full error goes to the log instead.
 *
 * NO FEED IS NOT AN ERROR. Until a release is published there is no latest.yml,
 * and "up to date" is the true answer for the version that is running.
 */
function publishError(err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  console.warn("[updater]", raw);
  if (/\b404\b/.test(raw) && /latest\.yml/.test(raw)) {
    publish({ status: "current" });
    return;
  }
  const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(raw);
  publish({ status: "error", message: offline ? "Offline. Updates will be checked when you reconnect." : "Could not check for updates." });
}

export const updateState = (): UpdateState => state;

export function onUpdateChange(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.setFeedURL({ provider: "generic", url: RELEASE_BASE });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    // A download in progress or waiting to install is more useful to show than "checking".
    if (state.status !== "available" && state.status !== "ready") publish({ status: "checking" });
  });
  autoUpdater.on("update-available", (info) => publish({ status: "available", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => {
    if (state.status === "available") publish({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => publish({ status: "ready", version: info.version }));
  autoUpdater.on("update-not-available", () => publish({ status: "current" }));
  autoUpdater.on("error", (err) => publishError(err));

  void checkForUpdates();
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref();
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    publish({ status: "current" });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    publish({ status: "error", message: err instanceof Error ? err.message : "Could not check for updates." });
  }
}

/** Restart into the downloaded version. Does nothing until one is ready. */
export function installUpdate(): void {
  if (state.status === "ready") autoUpdater.quitAndInstall(false, true);
}
