import { contextBridge, ipcRenderer } from "electron";

/**
 * The whole surface the renderer can reach. Kept deliberately small: every
 * function here is a door out of the sandbox, and the main process validates
 * everything that comes through it.
 */

export type SeasonSource = "memory" | "repo" | "cache" | "network";
export type SeasonPayload = { json: string; source: SeasonSource };
export type ThemeMode = "system" | "light" | "dark";

const api = {
  platform: process.platform,
  season: (kind: "teams", year: number): Promise<SeasonPayload> =>
    ipcRenderer.invoke("season:get", kind, year),
  setTheme: (mode: ThemeMode): void => ipcRenderer.send("theme:set", mode),
};

export type BtaApi = typeof api;

contextBridge.exposeInMainWorld("bta", api);
