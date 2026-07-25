"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  pctBgStrong, pctBgStrongDark, pctColorLight, pctColorDark, PercentileGauge,
} from "@/components/players/player-stats-grid";

/**
 * Player-page "Shot Profile & Impact" card. Client-fetches per-season shooting
 * splits (/data/shooting-<year>.json) + impact (epm-/box-epm-<year>.json) for
 * the player's most recent season with data. Zone FG%s are colored on the same
 * percentile treatment as the Player Overview stat tiles (pctBgStrong + gauge).
 */
type Shooting = {
  rim_pct: number | null; mid_pct: number | null; tp_pct: number | null;
  rim_ptile: number | null; mid_ptile: number | null; tp_ptile: number | null;
  asst: number | null; rim_rate: number | null; mid_rate: number | null;
  tp_rate: number | null; ftr: number | null; tracked: number | null;
};
type Impact = { epm: number; off: number; def: number; ewins?: number | null; on_off?: number | null };

function seasonLabel(y: number) { return `${y - 1}-${String(y).slice(-2)}`; }
const jr = (r: Response) => (r.ok ? r.json() : null);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const sgn = (v: number | null | undefined) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { maximumFractionDigits: 1 }));

// The four CSS vars the site's .stat-tile / .stat-tile-color classes read
// (theme-aware). Set them on a container and any descendant tile bg / color /
// gauge picks up the percentile treatment.
function tileVars(pct: number | null): React.CSSProperties {
  return {
    "--tile-bg-light": pctBgStrong(pct),
    "--tile-bg-dark": pctBgStrongDark(pct),
    "--tile-color-light": pct == null ? "var(--ink-muted)" : pctColorLight(pct),
    "--tile-color-dark": pct == null ? "var(--ink-muted)" : pctColorDark(pct),
  } as React.CSSProperties;
}

export function PlayerShotImpact({ bartPlayerId, years }: { bartPlayerId: number; years: number[] }) {
  const [state, setState] = useState<{ year: number; s: Shooting; impact: Impact | null; estimated: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bid = String(bartPlayerId);
      for (const y of [...years].sort((a, b) => b - a)) {
        const shoot = await fetch(`/data/shooting-${y}.json`).then(jr).catch(() => null);
        const s: Shooting | undefined = shoot?.players?.[bid];
        if (!s) continue;
        let impact: Impact | null = null, estimated = false;
        const real = await fetch(`/data/epm-${y}.json`).then(jr).catch(() => null);
        if (real?.players?.[bid]) impact = real.players[bid];
        else {
          const box = await fetch(`/data/box-epm-${y}.json`).then(jr).catch(() => null);
          if (box?.players?.[bid]) { impact = box.players[bid]; estimated = true; }
        }
        if (!cancelled) setState({ year: y, s, impact, estimated });
        return;
      }
    })();
    return () => { cancelled = true; };
  }, [bartPlayerId, years]);

  if (!state) return null;
  const { year, s, impact, estimated } = state;
  const zones = [
    { key: "Rim", pct: s.rim_pct, ptile: s.rim_ptile, rate: s.rim_rate },
    { key: "Mid", pct: s.mid_pct, ptile: s.mid_ptile, rate: s.mid_rate },
    { key: "3PT", pct: s.tp_pct, ptile: s.tp_ptile, rate: s.tp_rate },
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />{seasonLabel(year)} · shot profile &amp; impact
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Shot Profile &amp; Impact</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 px-5 lg:px-7 py-6">
          {/* Shot diet + FG% by zone */}
          <div className="lg:col-span-3">
            <div className="text-[0.62rem] uppercase tracking-[0.18em] text-ink-muted font-semibold mb-4">Shot diet · FG% by zone</div>
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
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
              <Mini label="Assisted" value={`${f1(s.asst)}%`} hint="lower = more self-created" />
              <Mini label="FT rate" value={`${f1(s.ftr)}%`} />
              <Mini label="Tracked shots" value={f1(s.tracked)} />
            </div>
          </div>

          {/* Impact */}
          <div className="lg:col-span-2 lg:border-l lg:border-hairline lg:pl-8">
            <div className="text-[0.62rem] uppercase tracking-[0.18em] text-ink-muted font-semibold mb-4">
              Impact {estimated && <span className="text-coral/70 normal-case tracking-normal">· estimated</span>}
            </div>
            {impact ? (
              <div className="grid grid-cols-3 gap-4">
                <Big label="EPM" value={sgn(impact.epm)} marker={estimated} />
                <Big label="eWins" value={impact.ewins != null ? f1(impact.ewins) : "—"} />
                <Big label="On/Off" value={impact.on_off != null ? sgn(Math.round(impact.on_off)) : "—"} />
                <Stat label="Off EPM" value={sgn(impact.off)} />
                <Stat label="Def EPM" value={sgn(impact.def)} />
              </div>
            ) : <p className="text-sm text-ink-muted">No impact data for this season.</p>}
            {estimated && (
              <p className="mt-4 text-[0.66rem] text-ink-muted leading-snug">≈ Estimated — box-score model (pre-2024 seasons predate play-by-play tracking).</p>
            )}
          </div>
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
function Big({ label, value, marker }: { label: string; value: string; marker?: boolean }) {
  return (
    <div>
      <div className={cn("font-display text-2xl lg:text-[1.75rem] tabular leading-none tracking-tight", marker ? "text-ink-soft" : "text-ink")}>
        {marker && <span className="text-coral/70 text-lg mr-0.5">≈</span>}{value}
      </div>
      <div className="mt-1.5 text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted font-medium">{label}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-ink tabular">{value}</div>
      <div className="text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted font-medium mt-0.5">{label}</div>
    </div>
  );
}
