import { contextBridge, ipcRenderer } from "electron";

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
  | "teams-index"
  | "players-index"
  | "search-index";
export type DataSource = "memory" | "repo" | "cache" | "network";
export type DataPayload = { json: string; source: DataSource };
export type ThemeMode = "system" | "light" | "dark";

const api = {
  platform: process.platform,
  data: (corpus: Corpus, year: number): Promise<DataPayload> => ipcRenderer.invoke("data:get", corpus, year),
  setTheme: (mode: ThemeMode): void => ipcRenderer.send("theme:set", mode),
};

export type BtaApi = typeof api;

contextBridge.exposeInMainWorld("bta", api);
