"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SearchableOption } from "@/components/explorer/searchable-select";
import { dataUrl } from "@/lib/data-url";
import { CONF_DISPLAY } from "@/lib/conf-display";
import { isLiveSeason } from "@/lib/seasons";
import { outIndexes, pickOpeningPair, project, type MatchupPack, type MatchupTeam, type Site } from "@/lib/matchup";
import { MatchupView, type MatchupHandlers } from "@/components/matchup/matchup-view";

/**
 * State, URL and data for the Matchup Predictor.
 *
 * THE URL IS THE STATE. ?a=duke&b=michigan&site=neutral&oa=<player ids> is a
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
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    /**
     * A SEASON BEING PLAYED IS NOT IN THE DEPLOY. The baked file is whatever
     * the last upload held, which during a season is last week's ratings. The
     * nightly job writes /data/live/matchup.json to R2 instead — same pattern
     * as the live team pages, and the same reason: publishing a number should
     * not cost a full-site rebuild. Between seasons there is no live file and
     * the per-season one is correct and final.
     */
    const path = isLiveSeason(initialPack.season)
      ? "/data/live/matchup.json"
      : `/data/matchup/${initialPack.season}.json`;
    fetch(dataUrl(path))
      .then((r) => (r.ok ? (r.json() as Promise<MatchupPack>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setPack(j); })
      // The two-team pack still renders the default matchup; the banner says
      // why nothing else can be picked.
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [initialPack.season]);

  const bySlug = useMemo(() => new Map(pack.teams.map((t) => [t.s, t])), [pack]);

  /**
   * ── Read the URL, tolerating anything ──────────────────────────────────
   *
   * PLAYER IDS, NOT ROSTER POSITIONS. `oa=0,1` meant "the first two names in
   * the rotation", which is only stable until the next rebuild reorders it —
   * at which point a link someone shared benches two different players and
   * says nothing. Ids survive a rebuild and a season roll-over, and an id that
   * no longer exists resolves to nobody rather than to somebody else.
   */
  const readOut = (key: string, team: MatchupTeam | undefined): number[] => {
    const raw = sp.get(key);
    if (!raw || !team) return [];
    return outIndexes(team, raw.split(",").filter(Boolean));
  };
  const idsOf = (team: MatchupTeam, idx: readonly number[]) =>
    idx.map((i) => team.r[i]?.[4]).filter((x): x is string => !!x);
  const urlA = sp.get("a"), urlB = sp.get("b");
  let a = bySlug.get(urlA ?? "") ?? bySlug.get(defaultA)!;
  let b = bySlug.get(urlB ?? "") ?? bySlug.get(defaultB)!;
  if (a === b) b = bySlug.get(defaultB === a.s ? defaultA : defaultB)!;
  const siteRaw = sp.get("site");
  const site: Site = siteRaw === "home" || siteRaw === "away" ? siteRaw : "neutral";
  const outA = readOut("oa", a), outB = readOut("ob", b);

  // The slim pack cannot show a team the URL asks for until the full one
  // arrives; in that window fall back to the defaults rather than crash.
  if (!a) a = bySlug.get(defaultA)!;
  if (!b) b = bySlug.get(defaultB)!;

  const projection = useMemo(
    () => project({ pack, a, b, site, outA, outB }),
    [pack, a, b, site, outA, outB],
  );

  // ── Write the URL ────────────────────────────────────────────────────────
  const write = useCallback((next: { a?: string; b?: string; site?: Site; oa?: string[]; ob?: string[] }) => {
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

  /**
   * A DIFFERENT MATCHUP EVERY VISIT, drawn into the URL.
   *
   * IN AN EFFECT, NOT DURING RENDER. Randomising in a lazy `useState` was the
   * obvious way and it is wrong: this component IS server-rendered — by the
   * dev server always, and by the export whenever Next can answer its hooks —
   * so a draw during render disagrees with the HTML and React throws a
   * hydration mismatch, then rebuilds the whole tree client-side. An effect
   * runs only on the client and only after the markup has matched.
   *
   * The pair goes into the URL rather than into state, so everything else
   * keeps reading the one source of truth it already reads. That also fixes
   * what would otherwise be a nasty little bug: with the address bar still
   * saying `/matchup/`, Share would copy a link that draws a DIFFERENT
   * matchup for whoever opened it. `replace`, not `push`, so Back still
   * leaves the page instead of stepping through the draw.
   *
   * A URL naming either team wins outright — a shared link has to survive,
   * and half a link should pair against the default, not against a stranger.
   */
  useEffect(() => {
    if (urlA || urlB) return;
    const pick = pickOpeningPair(initialPack.teams);
    if (pick) router.replace(`${pathname}?a=${pick[0]}&b=${pick[1]}`, { scroll: false });
    // Mount only. Re-running on a URL change would redraw mid-visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (team: MatchupTeam, list: number[], i: number) =>
    idsOf(team, list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((x, y) => x - y));

  const handlers: MatchupHandlers = {
    // Changing a team clears its absences: the ids belong to the old roster.
    onTeamA: (slug) => write({ a: slug, oa: [], ...(slug === b.s ? { b: a.s, ob: [] } : {}) }),
    onTeamB: (slug) => write({ b: slug, ob: [], ...(slug === a.s ? { a: b.s, oa: [] } : {}) }),
    onSite: (s) => write({ site: s }),
    // Swapping carries each side's absences with its team, not with its slot.
    onSwap: () => write({ a: b.s, b: a.s, oa: idsOf(b, outB), ob: idsOf(a, outA), site: site === "home" ? "away" : site === "away" ? "home" : "neutral" }),
    onToggleA: (i) => write({ oa: toggle(a, outA, i) }),
    onToggleB: (i) => write({ ob: toggle(b, outB, i) }),
    onClearOut: () => write({ oa: [], ob: [] }),
    // Only offered once something has actually been changed.
    ...(sp.toString() ? { onReset: () => router.replace(pathname, { scroll: false }) } : {}),
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
      // BTA rank, not the model's ordering — `rk` sorts this list, but the
      // number a reader sees has to be the one the team page shows.
      return { value: t.s, label: t.b, group: c, desc: `${t.br != null ? `#${t.br} · ` : ""}${t.w}–${t.l}` };
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
      error={error}
    />
  );
}
