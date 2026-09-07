"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SearchableOption } from "@/components/explorer/searchable-select";
import { dataUrl } from "@/lib/data-url";
import { CONF_DISPLAY } from "@/lib/conf-display";
import { project, type MatchupPack, type MatchupTeam, type Site } from "@/lib/matchup";
import { MatchupView, type MatchupHandlers } from "@/components/matchup/matchup-view";

/**
 * State, URL and data for the Matchup Predictor.
 *
 * THE URL IS THE STATE. ?a=duke&b=michigan&site=neutral&oa=0,3&ob= is a
 * matchup someone can send to a friend, and a static export cannot enumerate
 * 365² of them — so the pair is chosen client-side and the page prerenders
 * one real default (the top two teams) as the Suspense fallback. That is
 * what a crawler reads; a reader sees the same thing until their URL, if it
 * differs, takes over on hydration.
 *
 * THE PACK ARRIVES SECOND. `initialPack` holds two teams and the league —
 * enough to draw the default without embedding 188 KB in the HTML. The full
 * file (~70 KB gzipped, every team and rotation) is fetched on mount, and
 * until it lands the view is pixel-identical: the pickers simply have one
 * option each.
 */
export function MatchupClient({
  initialPack,
  defaultA,
  defaultB,
}: {
  initialPack: MatchupPack;
  defaultA: string;
  defaultB: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [pack, setPack] = useState<MatchupPack>(initialPack);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    fetch(dataUrl(`/data/matchup/${initialPack.season}.json`))
      .then((r) => (r.ok ? (r.json() as Promise<MatchupPack>) : null))
      .then((j) => { if (live && j) setPack(j); })
      .catch(() => { /* the two-team pack still renders */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [initialPack.season]);

  const bySlug = useMemo(() => new Map(pack.teams.map((t) => [t.s, t])), [pack]);

  // ── Read the URL, tolerating anything ────────────────────────────────────
  const readIdx = (key: string, team: MatchupTeam | undefined): number[] => {
    const raw = sp.get(key);
    if (!raw || !team) return [];
    return [...new Set(raw.split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 0 && n < team.r.length))];
  };
  let a = bySlug.get(sp.get("a") ?? "") ?? bySlug.get(defaultA)!;
  let b = bySlug.get(sp.get("b") ?? "") ?? bySlug.get(defaultB)!;
  if (a === b) b = bySlug.get(defaultB === a.s ? defaultA : defaultB)!;
  const siteRaw = sp.get("site");
  const site: Site = siteRaw === "home" || siteRaw === "away" ? siteRaw : "neutral";
  const outA = readIdx("oa", a), outB = readIdx("ob", b);

  // The slim pack cannot show a team the URL asks for until the full one
  // arrives; in that window fall back to the defaults rather than crash.
  if (!a) a = bySlug.get(defaultA)!;
  if (!b) b = bySlug.get(defaultB)!;

  const projection = useMemo(
    () => project({ pack, a, b, site, outA, outB }),
    [pack, a, b, site, outA, outB],
  );

  // ── Write the URL ────────────────────────────────────────────────────────
  const write = useCallback((next: { a?: string; b?: string; site?: Site; oa?: number[]; ob?: number[] }) => {
    const q = new URLSearchParams(sp.toString());
    const set = (k: string, v: string | undefined) => { if (v) q.set(k, v); else q.delete(k); };
    if (next.a !== undefined) set("a", next.a);
    if (next.b !== undefined) set("b", next.b);
    if (next.site !== undefined) set("site", next.site === "neutral" ? undefined : next.site);
    if (next.oa !== undefined) set("oa", next.oa.length ? next.oa.join(",") : undefined);
    if (next.ob !== undefined) set("ob", next.ob.length ? next.ob.join(",") : undefined);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  const toggle = (list: number[], i: number) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((x, y) => x - y));

  const handlers: MatchupHandlers = {
    // Changing a team clears its absences: the indexes mean nothing on
    // another roster.
    onTeamA: (slug) => write({ a: slug, oa: [], ...(slug === b.s ? { b: a.s, ob: [] } : {}) }),
    onTeamB: (slug) => write({ b: slug, ob: [], ...(slug === a.s ? { a: b.s, oa: [] } : {}) }),
    onSite: (s) => write({ site: s }),
    onSwap: () => write({ a: b.s, b: a.s, oa: outB, ob: outA, site: site === "home" ? "away" : site === "away" ? "home" : "neutral" }),
    onToggleA: (i) => write({ oa: toggle(outA, i) }),
    onToggleB: (i) => write({ ob: toggle(outB, i) }),
    onClearOut: () => write({ oa: [], ob: [] }),
  };

  // ── Picker options, grouped by conference, strongest league first ────────
  const { options, groupLabels } = useMemo(() => {
    if (loading && pack.teams.length <= 2) return { options: undefined, groupLabels: undefined };
    const confRank = new Map<string, number>();
    for (const t of pack.teams) {
      const c = t.c ?? "Other";
      confRank.set(c, Math.min(confRank.get(c) ?? Infinity, t.rk));
    }
    const sorted = [...pack.teams].sort((x, y) => {
      const cx = x.c ?? "Other", cy = y.c ?? "Other";
      if (cx !== cy) return (confRank.get(cx)! - confRank.get(cy)!) || cx.localeCompare(cy);
      return x.rk - y.rk;
    });
    const labels: Record<string, string> = {};
    const options: SearchableOption[] = sorted.map((t) => {
      const c = t.c ?? "Other";
      labels[c] = CONF_DISPLAY[c] ?? c;
      return { value: t.s, label: t.b, group: c, desc: `#${t.rk} · ${t.w}–${t.l}` };
    });
    return { options, groupLabels: labels };
  }, [pack, loading]);

  return (
    <MatchupView
      pack={pack}
      projection={projection}
      options={options}
      groupLabels={groupLabels}
      handlers={handlers}
      loading={loading}
    />
  );
}
