import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { midrankPercentileMap } from "@/lib/percentile";
import { logoIdMap, metricCoverage, toScatterTeams, topByNet, type ScatterSourceRow, type ScatterTeam } from "@/lib/scatter-team";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { METRICS, METRIC_BY_KEY, METRIC_PRESETS, fmtMetric, type Metric } from "@/lib/team-scatter-metrics";
import { ZONE_X, ZONE_Y, buildZone, zoneAxes } from "@/lib/trapezoid";
import cbbTeams from "@/data/cbb-team-ids.json";
import { shapeSeason, type Season } from "~/data/team-model";
import { SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import { beginDrag } from "~/objects/drag";
import { objectDrag, type Obj } from "~/objects/object";
import { useObjectMenu } from "~/objects/use-object-actions";
import { useIsActive } from "~/shell/active";
import { Picker } from "~/shell/picker";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { LoadError, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ScatterPlot } from "./scatter-plot";

/**
 * Team Scatter: any two team metrics against each other, opening on Ryan
 * Hammer's contender trapezoid over tempo and adjusted net rating.
 *
 * THE SITE'S CHART, WITH THE SITE'S RULES. The metrics and presets are the
 * site's catalog, the zone is lib/trapezoid.ts built from the whole field, the
 * opening field is the site's topByNet, and seasons whose adjusted net rating
 * is withheld (see lib/cbbd-rating-trust.ts) say so instead of drawing an empty
 * grid. Every team on it opens its own page.
 *
 * THE LIST BESIDE THE PLOT IS THE SAME TEAMS, in rank order, hover-linked both
 * ways; ↑ ↓ walk it and Enter opens the team, so the chart is as reachable from
 * the keyboard as a table.
 */

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);
const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

const METRIC_OPTIONS = METRICS.map((m) => ({ key: m.key, label: m.label, desc: m.group }));

type Field = string;

export function TeamScatterView({ year, setYear, query }: ViewProps) {
  const { openRecord } = useShell();
  const setStatus = useSetStatus();
  const active = useIsActive();
  const [state, retry] = useCorpus("teams", year, shapeTeams);
  const [field, setField] = useState<Field>("field:top75");
  const [xKey, setXKey] = useState<string>(ZONE_X);
  const [yKey, setYKey] = useState<string>(ZONE_Y);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const menu = useObjectMenu();
  const listRef = useRef<HTMLUListElement>(null);
  const teamObj = (t: ScatterTeam): Obj => ({ kind: "team", name: t.name, logoId: t.id, year, conf: t.conf });

  // Arriving from "Show on Team Scatter": team= lights that team, field= picks the field (a conference).
  const asked = useMemo(() => new URLSearchParams(query), [query]);
  const askedTeam = asked.get("team");
  const askedField = asked.get("field");
  useEffect(() => {
    if (askedField) setField(askedField);
  }, [askedField]);

  const season = state.status === "ready" ? state.value : null;
  const teams = useMemo<ScatterTeam[]>(
    () => (season ? toScatterTeams(season.cohort as unknown as ScatterSourceRow[], LOGOS) : []),
    [season],
  );
  const xM = METRIC_BY_KEY[xKey]!;
  const yM = METRIC_BY_KEY[yKey]!;

  // Built from every team, never the selection: it is a claim about Division I.
  const zone = useMemo(() => buildZone(teams), [teams]);
  const zoneLive = zone && zoneAxes(xM, yM) ? zone : null;

  const shown = useMemo(() => {
    if (field === "field:all") return teams;
    if (field.startsWith("conf:")) return teams.filter((t) => t.conf === field.slice(5));
    const names = new Set(topByNet(teams, field === "field:top25" ? 25 : 75));
    return teams.filter((t) => names.has(t.name));
  }, [teams, field]);

  const inZone = useMemo(
    () => new Set(zoneLive ? shown.filter((t) => zoneLive.contains(t.m[ZONE_X], t.m[ZONE_Y])).map((t) => t.name) : []),
    [zoneLive, shown],
  );

  // The field's percentiles for the two axes, for the hover card.
  const pctFor = useMemo(() => {
    const make = (m: Metric) => midrankPercentileMap(teams.map((t) => [t.name, t.m[m.key]] as const), !m.lowerBetter);
    return { [xM.key]: make(xM), [yM.key]: make(yM) } as Record<string, Map<string, number>>;
  }, [teams, xM, yM]);
  const pct = useCallback((key: string, name: string) => pctFor[key]?.get(name) ?? null, [pctFor]);

  const list = useMemo(() => [...shown].sort((a, b) => a.rank - b.rank), [shown]);
  const at = Math.min(cursor, Math.max(0, list.length - 1));

  useEffect(() => {
    if (!askedTeam || teams.length === 0) return;
    // A team outside the opening field widens the field until it is on the chart.
    if (!shown.some((t) => t.name === askedTeam)) {
      if (teams.some((t) => t.name === askedTeam)) setField("field:all");
      return;
    }
    const i = list.findIndex((t) => t.name === askedTeam);
    if (i < 0) return;
    setCursor(i);
    setHover(askedTeam);
    listRef.current?.querySelector(`[data-scatter-row="${CSS.escape(askedTeam)}"]`)?.scrollIntoView({ block: "center" });
    // Once per arrival, and again when the field has grown to include the team.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedTeam, teams.length, shown.length]);

  const open = useCallback(
    (t: ScatterTeam, newTab: boolean) => openRecord({ kind: "team", name: t.name, logoId: t.id }, { newTab, year }),
    [openRecord, year],
  );

  // ↑ ↓ walk the list (and light the crest), Enter opens the team.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
        setCursor(next);
        setHover(list[next]?.name ?? null);
      } else if (e.key === "Enter" && list[at]) {
        e.preventDefault();
        open(list[at], e.ctrlKey || e.metaKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, list, at, open]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
  }, [state, setStatus]);

  const presetOptions = useMemo(() => {
    const opts = [
      { key: "zone", label: "Contender zone", desc: "Tempo against adjusted net rating, with Ryan Hammer's trapezoid." },
      ...METRIC_PRESETS.map((p, i) => ({
        key: `preset:${i}`,
        label: p.label,
        desc: `${METRIC_BY_KEY[p.x]!.label} across, ${METRIC_BY_KEY[p.y]!.label.toLowerCase()} up`,
      })),
    ];
    return opts;
  }, []);
  const presetValue =
    xKey === ZONE_X && yKey === ZONE_Y
      ? "zone"
      : (() => {
          const i = METRIC_PRESETS.findIndex((p) => p.x === xKey && p.y === yKey);
          return i >= 0 ? `preset:${i}` : "custom";
        })();
  const pickPreset = (key: string) => {
    if (key === "zone") {
      setXKey(ZONE_X);
      setYKey(ZONE_Y);
      setField("field:top75");
      return;
    }
    const p = METRIC_PRESETS[Number(key.slice(7))];
    if (p) {
      setXKey(p.x);
      setYKey(p.y);
    }
  };

  const fieldOptions = useMemo(() => {
    // topByNet falls back to rank in a season with net rating withheld; the label says which.
    const by = metricCoverage(teams, ZONE_Y) >= 75 ? "net rating" : "rank";
    const counts = new Map<string, number>();
    for (const t of teams) counts.set(t.conf, (counts.get(t.conf) ?? 0) + 1);
    const confs = [...counts.entries()].sort((a, b) => {
      const pa = POWER_CONFS.has(a[0]) ? 0 : 1;
      const pb = POWER_CONFS.has(b[0]) ? 0 : 1;
      return pa - pb || confDisplay(a[0]).localeCompare(confDisplay(b[0]));
    });
    return [
      { key: "field:top75", label: `Top 75 by ${by}`, desc: "The field the contender zone is read against." },
      { key: "field:top25", label: `Top 25 by ${by}`, desc: "The very top of the sport." },
      { key: "field:all", label: "Every team", desc: `All ${teams.length} Division I teams.` },
      ...confs.map(([code, n]) => ({
        key: `conf:${code}`,
        label: confDisplay(code),
        desc: `${n} teams · ${POWER_CONFS.has(code) ? "Power conference" : "Mid-major"}`,
      })),
    ];
  }, [teams]);

  const covX = useMemo(() => metricCoverage(teams, xM.key), [teams, xM]);
  const covY = useMemo(() => metricCoverage(teams, yM.key), [teams, yM]);
  const emptyAxis = teams.length > 0 ? (covX === 0 ? xM : covY === 0 ? yM : null) : null;
  const thin = teams.length > 0 && !emptyAxis ? [xM, yM].filter((m, i) => [covX, covY][i]! < teams.length * 0.97) : [];

  const meta = season
    ? `${shown.length} teams${zoneLive ? ` · ${inZone.size} in the zone` : ""}${thin.length ? ` · ${thin.map((m) => m.short).join(", ")} partial` : ""}`
    : undefined;

  const presetOpts = presetValue === "custom" ? [...presetOptions, { key: "custom", label: "Custom", desc: "Your own two metrics." }] : presetOptions;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Scatter"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={
          <>
            <Picker label="Chart" value={presetValue} options={presetOpts} onChange={pickPreset} />
            <Picker label="Teams" value={field} options={fieldOptions} onChange={setField} />
          </>
        }
      />
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2.5">
        <Picker label="Across" value={xKey} options={METRIC_OPTIONS} onChange={setXKey} />
        <Picker label="Up" value={yKey} options={METRIC_OPTIONS} onChange={setYKey} />
        {zoneLive ? (
          <span className="ml-1 text-[12px] text-ink-muted">
            Zone floor <span className="text-ink tabular">{zoneLive.floor.toFixed(1)}</span> net · centred on{" "}
            <span className="text-ink tabular">{zoneLive.centre.toFixed(1)}</span> possessions
          </span>
        ) : zoneAxes(xM, yM) && season ? (
          <span className="ml-1 text-[12px] text-ink-muted">No contender zone in {seasonLabel(year)}: adjusted net rating is withheld.</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 border-t border-hairline">
        <div className="relative min-h-0 min-w-0 flex-1 px-3 pb-2 pt-3">
          {state.status === "error" ? (
            <LoadError year={year} reason={state.reason} message={state.message} what="Teams" onRetry={retry} />
          ) : !season ? (
            <TableSkeleton rowHeight={42} label="Loading teams" />
          ) : emptyAxis ? (
            <div className="grid h-full place-content-center gap-2 px-6 text-center">
              <p className="text-[14px] font-medium text-ink">
                {emptyAxis.label} is not available for {seasonLabel(year)}.
              </p>
              <p className="mx-auto max-w-[52ch] text-[12.5px] text-ink-muted">
                {emptyAxis.key === ZONE_Y
                  ? "Adjusted net rating is withheld in five seasons where CBBD's adjusted ratings do not describe the season that was played. Pick another metric, or another season."
                  : "This season's play-by-play does not carry it. Pick another metric, or another season."}
              </p>
            </div>
          ) : (
            <ScatterPlot
              teams={teams}
              shown={shown}
              xM={xM}
              yM={yM}
              zone={zoneLive}
              inZone={inZone}
              hover={hover}
              setHover={setHover}
              onOpen={open}
              onMenu={(e, t) => menu(e, teamObj(t))}
              pct={pct}
            />
          )}
        </div>

        <aside aria-label="Teams on the chart" className="flex w-[320px] shrink-0 flex-col border-l border-hairline bg-paper">
          <div className="grid h-[32px] shrink-0 grid-cols-[26px_minmax(0,1fr)_44px_44px_8px] items-center gap-2 border-b border-hairline px-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            <span className="text-right">#</span>
            <span>Team</span>
            <span className="text-right" title={xM.label}>
              {xM.short}
            </span>
            <span className="text-right" title={yM.label}>
              {yM.short}
            </span>
            <span />
          </div>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {list.map((t, i) => {
              const lit = hover === t.name || i === at;
              return (
                <li key={t.name}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerEnter={() => {
                      setHover(t.name);
                      setCursor(i);
                    }}
                    onClick={(e) => open(t, e.ctrlKey || e.metaKey)}
                    onContextMenu={(e) => menu(e, teamObj(t))}
                    draggable
                    onDragStart={(e) => beginDrag(e, objectDrag(teamObj(t)))}
                    data-scatter-row={t.name}
                    className={`grid h-[34px] w-full grid-cols-[26px_minmax(0,1fr)_44px_44px_8px] items-center gap-2 px-3 text-left text-[12.5px] ${
                      lit ? "bg-[var(--row-focus)]" : "hover:bg-[var(--row-hover)]"
                    }`}
                  >
                    <span className="text-right text-ink-muted tabular">{t.rank < 999 ? t.rank : "–"}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamLogo id={t.id} name={t.name} size={16} />
                      <span className="truncate text-ink" title={t.name}>{t.name}</span>
                    </span>
                    <span className="text-right text-ink-soft tabular">{fmtMetric(xM, t.m[xM.key] ?? null)}</span>
                    <span className="text-right text-ink-soft tabular">{fmtMetric(yM, t.m[yM.key] ?? null)}</span>
                    <span className="flex justify-center">
                      {inZone.has(t.name) && <span className="size-[6px] rounded-full bg-good" title="Inside the contender zone" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </>
  );
}
