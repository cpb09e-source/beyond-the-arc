import type { BtaApi } from "../../preload";

declare global {
  interface Window {
    bta: BtaApi;
  }
}

export {};
