import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/**
 * The whole surface the renderer can reach. Kept deliberately small: every
 * function here is a door out of the sandbox, and the main process validates
 * everything that comes through it.
 */

export type Corpus =
  | "teams"
  | "players"
  | "player-impact"
  | "player-box"
  | "player-shooting"
  | "team-games"
  | "player-games"
  | "player-stats"
  | "matchup"
  | "conference-rankings"
  | "conference-splits"
  | "portal"
  | "scoreboard-day"
  | "game"
  | "player-photo-index"
  | "team-names"
  | "game-logs"
  | "game-box"
  | "team-ratings"
  | "player-splits"
  | "team-splits"
  | "player-career"
  | "teams-index"
  | "players-index"
  | "search-index";
export type DataSource = "memory" | "repo" | "cache" | "network";
export type DataPayload = { json: string; source: DataSource };
export type ThemeMode = "system" | "light" | "dark";

export type AuthUser = { id: string; email: string | null; role: string | null };

/**
 * Where signing in stands.
 *   waiting   the browser is open on the connect page
 *   refused   a real account the app is not open to yet
 *   error     a sign-in that did not go through, with what to do next
 */
export type AuthState =
  | { status: "signedOut" }
  | { status: "waiting" }
  | { status: "signedIn"; user: AuthUser }
  | { status: "refused"; message: string }
  | { status: "error"; message: string };

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "current" }
  | { status: "error"; message: string };

/** Subscribe to a push channel; returns the unsubscribe. */
function listen<T>(channel: string, fn: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => fn(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  platform: process.platform,
  version: (): Promise<string> => ipcRenderer.invoke("app:version"),
  requiresAccount: (): Promise<boolean> => ipcRenderer.invoke("app:requires-account"),
  /** A corpus-season, and for a per-day or per-game corpus, which day or game. */
  data: (corpus: Corpus, year: number, key?: string): Promise<DataPayload> => ipcRenderer.invoke("data:get", corpus, year, key),
  setTheme: (mode: ThemeMode): void => ipcRenderer.send("theme:set", mode),
  /** Written by the main process, so a copy lands whether or not the window has focus. */
  clipboard: {
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke("clipboard:write-text", text),
  },
  /** A table as a CSV file, saved where the reader chooses. */
  files: {
    saveCsv: (text: string, name: string): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke("export:save-csv", text, name),
    /** A Download menu's workbook (bytes) or CSV (text), under the name given. */
    saveFile: (data: Uint8Array | string, name: string): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke("export:save-file", data, name),
    reveal: (path: string): void => ipcRenderer.send("export:reveal", path),
  },
  /** Snapshot cards: the window's own pixels inside a rectangle of the page, then to the clipboard or a PNG. */
  snapshot: {
    grab: (rect: { x: number; y: number; width: number; height: number }): Promise<string | null> => ipcRenderer.invoke("snapshot:grab", rect),
    deliver: (
      dataUrl: string,
      how: { action: "copy" | "save"; name: string; width: number; height: number },
    ): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke("snapshot:deliver", dataUrl, how),
  },
  /** Ask the Win Calculator: the site's parser turns a question into filters. */
  calc: {
    parse: (query: string): Promise<{ status: number; body: unknown }> => ipcRenderer.invoke("calc:parse", query),
  },
  auth: {
    state: (): Promise<AuthState> => ipcRenderer.invoke("auth:state"),
    signIn: (): Promise<void> => ipcRenderer.invoke("auth:sign-in"),
    cancel: (): Promise<void> => ipcRenderer.invoke("auth:cancel"),
    /** Copy the browser page a waiting sign-in opened, for when the browser opened it out of sight. */
    copyLink: (): Promise<boolean> => ipcRenderer.invoke("auth:copy-link"),
    /** Development only; a packaged build ignores it. */
    preview: (status: AuthState["status"]): Promise<void> => ipcRenderer.invoke("auth:preview", status),
    signOut: (): Promise<void> => ipcRenderer.invoke("auth:sign-out"),
    onChange: (fn: (s: AuthState) => void): (() => void) => listen("auth:changed", fn),
  },
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke("update:state"),
    check: (): Promise<void> => ipcRenderer.invoke("update:check"),
    install: (): Promise<void> => ipcRenderer.invoke("update:install"),
    onChange: (fn: (s: UpdateState) => void): (() => void) => listen("update:changed", fn),
  },
};

export type BtaApi = typeof api;

contextBridge.exposeInMainWorld("bta", api);
