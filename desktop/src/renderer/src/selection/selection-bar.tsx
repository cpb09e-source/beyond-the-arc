import { X } from "lucide-react";
import { useMemo } from "react";
import { SEASON_CEIL } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { useCorpus } from "~/data/use-corpus";
import { useActionEnv } from "~/objects/use-object-actions";
import { howOf } from "~/ui/details";
import { num1, seasonLabel, signed1 } from "~/ui/format";
import { SELECTION_ACTIONS, selectionPreview } from "./selection-actions";
import { useSelection } from "./selection";

/**
 * The floating toolbar a selection brings up, bottom center, while any teams are
 * picked: how many, what they average, and what to do with them.
 *
 * THE AVERAGES ARE THE POINT OF A LASSO. Circling a cluster on the scatter asks
 * "what do these teams have in common", and the bar answers before a click: their
 * mean net rating, offense, defense and tempo, and their record together.
 */

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

function mean(rows: Team[], pick: (t: Team) => number | null): number | null {
  const v = rows.map(pick).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function SelectionBar() {
  const { selection, clear } = useSelection();
  const env = useActionEnv();
  const [state] = useCorpus("teams", selection?.year ?? SEASON_CEIL, shapeTeams);

  const summary = useMemo(() => {
    if (!selection || state.status !== "ready" || state.value.year !== selection.year) return null;
    const picked = new Set(selection.names);
    const rows = state.value.teams.filter((t) => picked.has(t.name));
    if (rows.length === 0) return null;
    return {
      net: mean(rows, (t) => t.adjNet),
      o: mean(rows, (t) => t.adjO),
      d: mean(rows, (t) => t.adjD),
      tempo: mean(rows, (t) => t.tempo),
      w: rows.reduce((a, t) => a + t.wins, 0),
      l: rows.reduce((a, t) => a + t.losses, 0),
    };
  }, [state, selection]);

  if (!selection) return null;
  const n = selection.names.length;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div
        role="region"
        aria-label="Selection"
        className="toast-in pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border border-hairline bg-card p-1.5"
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <span className="flex shrink-0 items-center gap-2 pl-1 pr-2 text-[12.5px] text-ink-soft" title={selectionPreview(selection)}>
          <span className="grid h-[22px] min-w-[22px] place-items-center rounded-md bg-accent px-1.5 text-[11.5px] font-semibold text-white tabular">{n}</span>
          <span className="whitespace-nowrap">
            {n === 1 ? "team" : "teams"} · {seasonLabel(selection.year)}
          </span>
        </span>

        {summary && (
          <span
            title="Averages across the selected teams, and their record together"
            // Only in a wide window: with Explain and CSV on the bar, the averages crowded the actions off its end at 1440 px.
            className="hidden shrink-0 items-center gap-3.5 border-l border-hairline px-3 text-[12px] text-ink-muted min-[1600px]:flex"
          >
            <Figure label="Net" value={signed1(summary.net)} />
            <Figure label="Adj O" value={num1(summary.o)} />
            <Figure label="Adj D" value={num1(summary.d)} />
            <Figure label="Tempo" value={num1(summary.tempo)} />
            <Figure label="W-L" value={`${summary.w}–${summary.l}`} />
          </span>
        )}

        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-hairline" />

        {SELECTION_ACTIONS.filter((a) => a.id !== "clear" && a.when(selection, env)).map((a) => {
          const Icon = a.icon;
          const blocked = a.blocked?.(selection) ?? null;
          return (
            <button
              key={a.id}
              type="button"
              disabled={!!blocked}
              title={blocked ?? `${a.phrase(selection)}  ·  Ctrl-click for a new tab`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => a.run(selection, env, howOf(e), clear)}
              className="inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Icon size={14} strokeWidth={2} className="text-ink-muted" />
              {/* A narrow window keeps the icons, and the tooltip still names each one. */}
              <span className="max-[1200px]:sr-only">{a.short}</span>
            </button>
          );
        })}

        <button
          type="button"
          aria-label="Clear the selection"
          title="Clear the selection  ·  Esc"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="grid size-[30px] shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      {label}
      <span className="text-ink tabular">{value}</span>
    </span>
  );
}
