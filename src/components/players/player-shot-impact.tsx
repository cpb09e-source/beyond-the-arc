"use client";

import { useEffect, useState } from "react";
import { PercentileGauge } from "@/components/players/player-stats-grid";
import { pctBg, pctColor } from "@/components/percentile-chip";

/**
 * Shot-profile data + presentational pieces (zone diet bars, minis), shared by
 * the merged Shot Chart card (player-shot-chart.tsx) and the profile-only
 * fallback card for players whose careers predate shot-location data (2024+).
 *
 * The Impact block (EPM / eWins / On-Off) that used to live beside these
 * stats was removed 2026-07 — impact already leads the Player Overview panel,
 * and the shooting section now stays about shooting.
 */
export type Shooting = {
  rim_pct: number | null; mid_pct: number | null; tp_pct: number | null;
  rim_ptile: number | null; mid_ptile: number | null; tp_ptile: number | null;
  asst: number | null; rim_rate: number | null; mid_rate: number | null;
  tp_rate: number | null; ftr: number | null; tracked: number | null;
};

export function seasonLabel(y: number) { return `${y - 1}-${String(y).slice(-2)}`; }
const jr = (r: Response) => (r.ok ? r.json() : null);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));

// The four CSS vars the site's .stat-tile / .stat-tile-color classes read. Set
// them on a container and any descendant tile bg / color / gauge picks up the
// percentile treatment.
//
// Same ramp as ZoneTile in the Shot Diet panel, which is the primary surface
// this card stands in for: identical zones, identical percentiles, so a reader
// who sees one on a 2019 player and the other on a 2025 player should be
// reading the same colours. It used to run on a separate three-band
// olive/amber/tomato ramp with cuts at 67/34, which put an 80th-percentile
// finisher two full bands away from where every chip on the site puts him.
//
// pctBg/pctColor are theme-agnostic by design, so light and dark take the same
// value — matching ZoneTile and StatTile rather than the old ramp's split.
function tileVars(pct: number | null): React.CSSProperties {
  return {
    "--tile-bg-light": pctBg(pct),
    "--tile-bg-dark": pctBg(pct),
    "--tile-color-light": pct == null ? "var(--ink-muted)" : pctColor(pct),
    "--tile-color-dark": pct == null ? "var(--ink-muted)" : pctColor(pct),
  } as React.CSSProperties;
}

/** Per-season shooting splits for one player; null = no data for that year. */
export function useShotProfile(bartPlayerId: number, year: number | null): Shooting | null {
  const [s, setS] = useState<Shooting | null>(null);
  useEffect(() => {
    if (year === null) { setS(null); return; }
    let cancelled = false;
    fetch(`/data/shooting-${year}.json`)
      .then(jr)
      .then((j) => { if (!cancelled) setS(j?.players?.[String(bartPlayerId)] ?? null); })
      .catch(() => { if (!cancelled) setS(null); });
    return () => { cancelled = true; };
  }, [bartPlayerId, year]);
  return s;
}

/** Zone diet bars — % of shots taken and FG% at Rim / Mid / 3PT. */
export function ZoneBars({ s }: { s: Shooting }) {
  const zones = [
    { key: "Rim", pct: s.rim_pct, ptile: s.rim_ptile, rate: s.rim_rate },
    { key: "Mid", pct: s.mid_pct, ptile: s.mid_ptile, rate: s.mid_rate },
    { key: "3PT", pct: s.tp_pct, ptile: s.tp_ptile, rate: s.tp_rate },
  ];
  return (
    <div className="space-y-3">
      {zones.map((z) => (
        <div key={z.key} className="flex items-center gap-3" style={tileVars(z.ptile)}>
          <span className="w-9 text-xs font-semibold text-ink-soft shrink-0">{z.key}</span>
          <div className="flex-1 h-7 rounded-md bg-paper-deep/50 overflow-hidden relative">
            <div className="stat-tile h-full" style={{ width: `${Math.min(100, z.rate ?? 0)}%` }} />
            <span className="absolute inset-y-0 left-2.5 flex items-center text-[0.68rem] text-ink-soft tabular">{f1(z.rate)}% of shots</span>
          </div>
          <span className="stat-tile-color w-12 text-right text-sm font-bold tabular shrink-0">{f1(z.pct)}%</span>
          {z.ptile != null ? <PercentileGauge pct={z.ptile} /> : <span className="w-[30px] shrink-0" />}
        </div>
      ))}
    </div>
  );
}

export function ProfileMinis({ s }: { s: Shooting }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      <Mini label="Assisted" value={`${f1(s.asst)}%`} hint="lower = more self-created" />
      <Mini label="FT rate" value={`${f1(s.ftr)}%`} />
      <Mini label="Tracked shots" value={f1(s.tracked)} />
    </div>
  );
}

/**
 * Standalone "Shot Profile" card — the fallback for players with no shot-chart
 * data. Scans seasons newest-first for the first with shooting splits, same
 * self-hiding contract as every other optional player-page card.
 */
export function ShotProfileFallbackCard({ bartPlayerId, years }: { bartPlayerId: number; years: number[] }) {
  const [state, setState] = useState<{ year: number; s: Shooting } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bid = String(bartPlayerId);
      for (const y of [...years].sort((a, b) => b - a)) {
        const shoot = await fetch(`/data/shooting-${y}.json`).then(jr).catch(() => null);
        const s: Shooting | undefined = shoot?.players?.[bid];
        if (!s) continue;
        if (!cancelled) setState({ year: y, s });
        return;
      }
    })();
    return () => { cancelled = true; };
  }, [bartPlayerId, years]);

  if (!state) return null;
  const { year, s } = state;

  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8">
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />{seasonLabel(year)} · shot profile
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Shot Profile</h2>
        </div>
        <div className="px-5 lg:px-7 py-6 max-w-2xl">
          <div className="text-[0.62rem] uppercase tracking-[0.18em] text-ink-muted font-semibold mb-4">Shot diet · FG% by zone</div>
          <ZoneBars s={s} />
          <div className="mt-5"><ProfileMinis s={s} /></div>
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted font-medium">{label}</div>
      <div className="text-sm font-semibold text-ink tabular mt-0.5">{value}</div>
      {hint && <div className="text-[0.6rem] text-ink-muted/80">{hint}</div>}
    </div>
  );
}
