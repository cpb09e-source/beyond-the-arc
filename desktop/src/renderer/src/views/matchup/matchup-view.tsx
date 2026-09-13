import { ArrowLeftRight, ArrowUpRight, Dices } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  applyMatchupChange,
  matchupMoves,
  pickOpeningPair,
  pickerOrder,
  project,
  readMatchup,
  type MatchupChange,
  type MatchupPack,
  type MatchupTeam,
  type Site,
} from "@/lib/matchup";
import { pairInks } from "@/lib/matchup-inks";
import { SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import { useIsActive } from "~/shell/active";
import { useShell } from "~/shell/shell-context";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { SectionTitle } from "~/ui/profile";
import { Ledger } from "./ledger";
import { logoIdOf } from "~/ui/logo-id";
import { Rotation } from "./rotation";
import { SeamCard, type Side } from "./seam";
import { SiteControl } from "./site-control";

/**
 * The Matchup Predictor: any two teams, the floor, who is ruled out, and the
 * projected score with every step of the arithmetic.
 *
 * THE SITE'S MODEL AND THE SITE'S RULES. The projection is lib/matchup.ts
 * `project`, the two colors are lib/matchup-inks.ts, and what each control
 * changes is lib/matchup.ts `matchupMoves`, the same functions the website runs.
 *
 * THE TAB'S QUERY IS THE STATE, the way the site's URL is: a=duke&b=michigan
 * &site=home&oa=<player ids>. So a tab reopens on the matchup it closed with,
 * Alt+Left comes back to it, and a team page can open the predictor on itself.
 * A tab with no matchup draws one, from the strongest 24 of one tier, as the
 * site's opening draw does (src/app/matchup/page.tsx).
 *
 * ONE SEASON. The predictor is fitted and published for the latest completed
 * season only, so the view is pinned to it (views.ts) and the season shows
 * without a switcher.
 */

const shapePack = (json: string): MatchupPack | null => JSON.parse(json) as MatchupPack | null;

const NEXT_SITE: Record<Site, Site> = { home: "neutral", neutral: "away", away: "home" };

const openingPool = (teams: readonly MatchupTeam[]): MatchupTeam[] => [
  ...teams.filter((t) => t.p === 1).slice(0, 24),
  ...teams.filter((t) => t.p === 0).slice(0, 24),
];

const METHOD_URL = "https://btacbb.xyz/matchup/method/";

export function MatchupView({ year, query, setQuery }: ViewProps) {
  const { openRecord } = useShell();
  const setStatus = useSetStatus();
  const active = useIsActive();
  const [state, retry] = useCorpus("matchup", year, shapePack);
  const pack = state.status === "ready" ? state.value : null;
  const [picking, setPicking] = useState<Side | null>(null);

  const bySlug = useMemo(() => new Map((pack?.teams ?? []).map((t) => [t.s, t])), [pack]);
  const ordered = useMemo(() => (pack ? pickerOrder(pack.teams) : []), [pack]);

  const matchup = useMemo(() => {
    if (!pack || pack.teams.length < 2) return null;
    const params = new URLSearchParams(query);
    return readMatchup((k) => params.get(k), bySlug, pack.teams[0]!.s, pack.teams[1]!.s);
  }, [pack, bySlug, query]);
  const p = useMemo(() => (pack && matchup ? project({ pack, ...matchup }) : null), [pack, matchup]);

  const change = useCallback(
    (next: MatchupChange) => {
      const q = new URLSearchParams(query);
      applyMatchupChange(q, next);
      setQuery(q.toString());
    },
    [query, setQuery],
  );

  const draw = useCallback(() => {
    if (!pack) return;
    const pick = pickOpeningPair(openingPool(pack.teams));
    if (pick) setQuery(`a=${pick[0]}&b=${pick[1]}`);
  }, [pack, setQuery]);

  // A tab with no matchup yet draws one into its query, so it survives a restart.
  const needsDraw = !!pack && !/(^|&)(a|b)=/.test(query);
  useEffect(() => {
    if (needsDraw) draw();
  }, [needsDraw, draw]);

  useEffect(() => {
    if (!active) setPicking(null);
  }, [active]);

  // A S F R, when this tab is in front and nothing is being typed.
  useEffect(() => {
    if (!active || !matchup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      const k = e.key.toLowerCase();
      if (k === "a") run(() => setPicking("a"));
      else if (k === "b") run(() => setPicking("b"));
      else if (k === "s") run(() => change(matchupMoves.swap(matchup)));
      else if (k === "f") run(() => change(matchupMoves.site(matchup, NEXT_SITE[matchup.site])));
      else if (k === "r") run(draw);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, matchup, change, draw]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
  }, [state, setStatus]);

  const openTeam = useCallback(
    (t: MatchupTeam, newTab: boolean) =>
      openRecord({ kind: "team", name: t.b, logoId: logoIdOf(t.b) }, { newTab, year: pack?.season ?? year }),
    [openRecord, pack, year],
  );

  const inkVars = useMemo<CSSProperties | undefined>(() => {
    if (!matchup) return undefined;
    const { a, b } = pairInks(matchup.a.b, matchup.b.b);
    return {
      ["--ma-light" as string]: a.light,
      ["--ma-dark" as string]: a.dark,
      ["--ma-brand" as string]: a.brand,
      ["--mb-light" as string]: b.light,
      ["--mb-dark" as string]: b.dark,
      ["--mb-brand" as string]: b.brand,
    };
  }, [matchup]);

  const outCount = matchup ? matchup.outA.length + matchup.outB.length : 0;
  // Named the way the game would be billed: the visitor at the host, or "vs" on a neutral floor.
  useTabTitle(
    !matchup
      ? null
      : matchup.site === "home"
        ? `${matchup.b.b} at ${matchup.a.b}`
        : matchup.site === "away"
          ? `${matchup.a.b} at ${matchup.b.b}`
          : `${matchup.a.b} vs ${matchup.b.b}`,
  );

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Matchup Predictor"
        year={year}
        seasonNote={`The predictor projects games from ${seasonLabel(year)} ratings, the latest completed season.`}
        meta={pack ? `Rated on ${pack.games.toLocaleString()} games` : undefined}
        controls={
          matchup && (
            <>
              <SiteControl site={matchup.site} a={matchup.a} b={matchup.b} onSite={(s) => change(matchupMoves.site(matchup, s))} />
              <ToolButton title="Swap the teams, and the floor with them" hotkey="S" onClick={() => change(matchupMoves.swap(matchup))}>
                <ArrowLeftRight size={14} strokeWidth={2} />
                Swap
              </ToolButton>
              <ToolButton title="Draw another matchup from the top of one tier" hotkey="R" onClick={draw}>
                <Dices size={14} strokeWidth={2} />
                New matchup
              </ToolButton>
            </>
          )
        }
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto border-t border-hairline">
        {state.status === "error" ? (
          <LoadError year={year} reason={state.reason} message={state.message} what="The matchup ratings" onRetry={retry} />
        ) : state.status === "loading" || (pack && !p) ? (
          <MatchupSkeleton />
        ) : !pack || !p || !matchup ? (
          <div className="grid h-full place-content-center gap-2 px-6 text-center">
            <p className="text-[14px] font-medium text-ink">No matchup ratings for {seasonLabel(year)}.</p>
            <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">
              The predictor is published for the latest completed season once its ratings are built.
            </p>
          </div>
        ) : (
          <div className="matchup-root mx-auto w-full max-w-[1180px] px-6 pb-12 pt-5" style={inkVars}>
            <SeamCard
              pack={pack}
              p={p}
              teams={ordered}
              picking={picking}
              setPicking={setPicking}
              onPick={(side, slug) => change(side === "a" ? matchupMoves.teamA(matchup, slug) : matchupMoves.teamB(matchup, slug))}
              onOpenTeam={openTeam}
              onSite={(s) => change(matchupMoves.site(matchup, s))}
              onToggle={(side, i) => change(side === "a" ? matchupMoves.toggleA(matchup, i) : matchupMoves.toggleB(matchup, i))}
            />

            <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-2">
              <section aria-label="How the number is made">
                <SectionTitle
                  aside={
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => window.open(METHOD_URL)}
                      className="inline-flex items-center gap-0.5 text-ink-muted transition-colors hover:text-ink"
                    >
                      The method
                      <ArrowUpRight size={12} strokeWidth={2} />
                    </button>
                  }
                >
                  How the number is made
                </SectionTitle>
                <Ledger p={p} pack={pack} />
              </section>

              <section aria-label="Who's playing">
                <SectionTitle
                  aside={
                    outCount > 0 ? (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => change(matchupMoves.clearOut(matchup))}
                        className="text-accent hover:underline"
                      >
                        Restore everyone ({outCount})
                      </button>
                    ) : (
                      "Click a player to rule him out"
                    )
                  }
                >
                  Who&rsquo;s playing
                </SectionTitle>
                <Rotation
                  p={p}
                  onToggle={(side, i) => change(side === "a" ? matchupMoves.toggleA(matchup, i) : matchupMoves.toggleB(matchup, i))}
                  onOpenTeam={openTeam}
                />
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ToolButton({
  title,
  hotkey,
  onClick,
  children,
}: {
  title: string;
  hotkey: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={`${title}  ·  ${hotkey}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card pl-2 pr-1 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
    >
      {children}
      <Kbd>{hotkey}</Kbd>
    </button>
  );
}

/** The card and the two columns, in place, so nothing jumps when the ratings land. */
function MatchupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the matchup" className="mx-auto w-full max-w-[1180px] px-6 pt-5">
      <div className="skeleton h-[372px] rounded-xl" />
      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-2">
        {[0, 1].map((c) => (
          <div key={c} className="space-y-2.5">
            <span className="skeleton block h-[10px] w-[140px] rounded" />
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="skeleton block h-[9px] rounded" style={{ width: `${62 + ((i * 29 + c * 13) % 34)}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
