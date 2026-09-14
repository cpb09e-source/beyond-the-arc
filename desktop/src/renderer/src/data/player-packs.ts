import { useEffect, useState } from "react";
import { indexPack, type PackGroup, type StatPack } from "@/lib/player-stat-pack";
import { loadOnce } from "./use-corpus";

/**
 * The Player Explorer's extended stats: a hundred more numbers a season, in ten
 * group files the site fetches only when a view needs them
 * (src/lib/player-stat-pack.ts). Here they come through the app's data door as
 * the "player-stats" corpus, and are read the same lazy way.
 *
 * ONE LOOKUP FOR EVERY TAB, keyed by season and column, so a filter condition
 * or a column in any tab reads a number the moment its file has arrived, with
 * nothing to thread through. A player's value is by bart id, which is what the
 * build keys on.
 *
 * THE PERCENTILES COME WITH THE FILE. The cohort is not "whoever the filter
 * kept": per-40 stats rank only over players past a minutes floor, and ranking
 * on the client would move a player's chip when someone else was filtered out.
 */

const VALUES = new Map<string, Map<number, number | null>>();
const PCTS = new Map<string, Map<number, number | null>>();

export const packValue = (year: number, key: string, bartId: number | null): number | null =>
  bartId == null ? null : (VALUES.get(`${year}|${key}`)?.get(bartId) ?? null);

export const packPct = (year: number, key: string, bartId: number | null): number | null =>
  bartId == null ? null : (PCTS.get(`${year}|${key}`)?.get(bartId) ?? null);

/** One season's group, once. Resolves false when the season has no such file. */
export function loadPlayerPack(year: number, group: PackGroup): Promise<boolean> {
  return loadOnce(`player-stats|${year}|${group}`, async () => {
    const res = await window.bta.data("player-stats", year, group);
    const pack = JSON.parse(res.json) as StatPack | null;
    if (pack) {
      const ix = indexPack(pack);
      for (const [col, m] of ix.value) VALUES.set(`${year}|${col}`, m);
      for (const [col, m] of ix.pct) PCTS.set(`${year}|${col}`, m);
    }
    return { value: pack != null, source: res.source };
  });
}

/**
 * The groups a table needs, loaded for each of its seasons; the number that
 * comes back changes as each one lands, which is what re-renders the table with
 * its values.
 */
export function usePlayerPacks(years: number | readonly number[], groups: readonly PackGroup[]): number {
  const [landed, setLanded] = useState(0);
  const list = typeof years === "number" ? [years] : years;
  const key = `${list.join(",")}|${[...groups].sort().join(",")}`;
  useEffect(() => {
    if (groups.length === 0) return;
    let stale = false;
    for (const y of list) {
      for (const g of groups) {
        loadPlayerPack(y, g).then(
          () => {
            if (!stale) setLanded((n) => n + 1);
          },
          () => {},
        );
      }
    }
    return () => {
      stale = true;
    };
    // `list` and `groups` are read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return landed;
}
