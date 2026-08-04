"use client";

import { useEffect, useState } from "react";
import { dataUrl } from "@/lib/data-url";

/**
 * Per-player split stats, built by scripts/build-player-splits.mjs and served
 * from R2 one file per player. See that script for the shape's reasoning; this
 * is only the client half.
 *
 * `[value, percentile]` pairs rather than objects — the file carries ~400 of
 * them per season and the key names would be most of the bytes.
 */
export type Cell = [number | null, number | null];
export type SplitBlock = {
  /** Games in this split. */
  n: number;
  /** Meta + rate stats — the same under either basis. */
  m: Record<string, Cell>;
  /** Counting stats per game. */
  g: Record<string, Cell>;
  /** Counting stats per 40 minutes. */
  f: Record<string, Cell>;
};
export type SplitSeason = {
  bucket: "G" | "F" | "C";
  cohort: number | null;
  /** Season-level and deliberately unsplit — see the builder's header. */
  impact?: Record<string, Cell>;
  splits: Record<string, SplitBlock>;
};
export type PlayerSplits = { bartId: number; seasons: Record<string, SplitSeason> };

export const SPLIT_OPTIONS = [
  { key: "full", label: "Full Season" },
  { key: "conf", label: "Conference Games" },
  { key: "nonconf", label: "Non-Conference Games" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "awayn", label: "Away + Neutral" },
  { key: "wins", label: "Wins" },
  { key: "losses", label: "Losses" },
] as const;

export type Basis = "g" | "f";
export const BASIS_OPTIONS = [
  { key: "g" as const, label: "Stats / Game" },
  { key: "f" as const, label: "Stats / 40 Min" },
];

/**
 * One fetch per player, all seasons in it — the file is small enough that
 * splitting it per season would cost more round trips than bytes saved, and
 * the year dropdown would then stall on every change.
 */
export function usePlayerSplits(bartPlayerId: number): PlayerSplits | null | undefined {
  // The id the stored payload belongs to is kept WITH it, and "loading" is a
  // mismatch between that and the one being asked for. Resetting to undefined
  // at the top of the effect would say the same thing by writing state during
  // the effect body, which React now flags — and it would also serve one render
  // of the previous player's numbers under the new player's name.
  const [got, setGot] = useState<{ id: number; data: PlayerSplits | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl(`/data/player-splits/${bartPlayerId}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setGot({ id: bartPlayerId, data: j ?? null }); })
      .catch(() => { if (!cancelled) setGot({ id: bartPlayerId, data: null }); });
    return () => { cancelled = true; };
  }, [bartPlayerId]);
  return got && got.id === bartPlayerId ? got.data : undefined;
}
