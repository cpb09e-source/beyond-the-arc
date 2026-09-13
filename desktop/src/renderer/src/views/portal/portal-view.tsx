import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { confDisplay } from "@/lib/conf-display";
import {
  boardBlock,
  boardCompare,
  committedAt,
  fmtPortalDate,
  passesPortalBaseline,
  portalRatingTitle,
  type PortalEntry,
  type PortalFile,
  type TransferClassRow,
} from "@/lib/portal";
import { SEASON_CEIL } from "@/lib/seasons";
import { SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { PlayerPhoto } from "~/ui/player-photo";
import { Stars } from "~/ui/stars";
import { matchesQuery } from "~/ui/text";
import { ClassPanel } from "./class-panel";
import { PortalPeekBody } from "./portal-peek";
import { hasPhotoFor, playerRecord } from "./portal-model";

/**
 * Transfer Portal: every Division I move worth a row, the top 100 first, rated
 * in wins, beside the best and worst transfer classes.
 *
 * THE SITE'S PORTAL AND ITS RULES (lib/portal.ts): the same baseline decides
 * who gets a row, the board leads every sort, and the rating's arithmetic is
 * the file's own. The app lays that arithmetic out in Peek as a ledger, and
 * opens a class in the panel beside the table instead of a modal over it.
 *
 * Enter opens the player's page for the season he left; a crest opens his old
 * or new school's class.
 */

const ROW_H = 44;

const shapePortal = (json: string): PortalFile => JSON.parse(json) as PortalFile;
const entryKey = (e: PortalEntry) => `${e.cbba_player_id}-${e.date_entered ?? ""}`;
const byBoard = (a: PortalEntry, b: PortalEntry) => boardCompare(a, b);
const one = (v: number | null) => (v == null ? "–" : v.toFixed(1));

const TIER_OPTIONS = [
  { key: "0", label: "Every tier", desc: "Everyone past the baseline: ten games, twelve minutes and four points a game." },
  { key: "5", label: "Five stars", desc: "Top-100 players." },
  { key: "4", label: "Four stars and up" },
  { key: "3", label: "Three stars and up" },
];

export function PortalView({ year, query, setQuery }: ViewProps) {
  const { openRecord } = useShell();
  const setStatus = useSetStatus();
  const [state, retry] = useCorpus("portal", SEASON_CEIL, shapePortal);
  const [dest, setDest] = useState("all");
  const [tier, setTier] = useState("0");
  const [openClass, setOpenClass] = useState<TransferClassRow | null>(null);

  const file = state.status === "ready" ? state.value : null;
  const pool = useMemo(() => (file ? file.entries.filter(passesPortalBaseline) : []), [file]);
  const bySchool = file?.transfer_classes?.by_school;

  const destOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of pool) if (e.conf_to) counts.set(e.conf_to, (counts.get(e.conf_to) ?? 0) + 1);
    return [
      { key: "all", label: "Anywhere", desc: `All ${pool.length} transfers.` },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || (confDisplay(a[0]) || a[0]).localeCompare(confDisplay(b[0]) || b[0]))
        .map(([code, n]) => ({ key: code, label: confDisplay(code) || code, desc: `${n} ${n === 1 ? "transfer" : "transfers"} in` })),
    ];
  }, [pool]);

  const rows = useMemo(() => {
    const minStars = Number(tier);
    return pool.filter(
      (e) =>
        (dest === "all" || e.conf_to === dest) &&
        e.stars >= minStars &&
        matchesQuery(query, e.name, e.team_from ?? "", e.team_to ?? "", confDisplay(e.conf_to) || "", confDisplay(e.conf_from) || ""),
    );
  }, [pool, dest, tier, query]);

  const openSchoolClass = (school: string | null) => {
    const row = school ? bySchool?.[school] : undefined;
    if (row) setOpenClass(row);
  };

  const columns = useMemo<Column<PortalEntry>[]>(() => {
    const school = (name: string | null, conf: string | null) =>
      name ? (
        <span className="flex min-w-0 items-center gap-2">
          {bySchool?.[name] ? (
            <button
              type="button"
              title={`${name}: open the transfer class`}
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={() => openSchoolClass(name)}
              className="shrink-0 rounded transition-transform hover:scale-110"
            >
              <TeamLogo id={logoIdOf(name)} name={name} size={20} />
            </button>
          ) : (
            <TeamLogo id={logoIdOf(name)} name={name} size={20} />
          )}
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-ink">{name}</span>
            {conf && <span className="block truncate text-[10.5px] leading-tight text-ink-muted">{confDisplay(conf) || conf}</span>}
          </span>
        </span>
      ) : (
        <span className="text-ink-muted">–</span>
      );
    return [
      {
        key: "board", label: "Top 100", title: "Position on last season's top-100 board", width: 94, align: "left", first: 1, pin: true,
        sortValue: (e) => e.t100 ?? null,
        cell: (e) => (e.t100 ? <TopHundredPill rank={e.t100} /> : null),
      },
      {
        key: "name", label: "Player", width: 220, align: "left", first: 1, pin: true,
        sortValue: (e) => e.name,
        cell: (e) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <PlayerPhoto bartId={e.bart_player_id} hasPhoto={hasPhotoFor(e.bart_player_id)} name={e.name} size={28} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{e.name}</span>
              <span className="block truncate text-[11px] leading-tight text-ink-muted">{e.eligibility}</span>
            </span>
          </span>
        ),
      },
      {
        key: "stars", label: "Tier", width: 84, align: "left", first: -1,
        sortValue: (e) => e.stars,
        cell: (e) => <Stars stars={e.stars} size={11} />,
      },
      // THE RATING SITS BESIDE THE TIER, not after the dates: beside the class
      // panel the table is wider than its space, and the number people came
      // for must not open scrolled out of view.
      {
        key: "rating", label: "Rating", title: "Wins over an average player, on a 0-100 reading scale", width: 76, align: "right", first: -1,
        sortValue: (e) => e.rating ?? null,
        cell: (e) =>
          e.rating_basis === "return" ? (
            <span
              title={`Rated on ${e.rating_year ? seasonLabel(e.rating_year) : "an earlier season"} at ${e.team_to}, the school he is going back to`}
              className={`font-semibold tabular ${(e.rating ?? 0) < 0 ? "text-bad" : "text-ink"}`}
            >
              {e.rating ?? "–"}
              <span aria-hidden className="ml-0.5 align-super text-[9px] font-medium text-ink-muted">
                R
              </span>
            </span>
          ) : (
            <span title={portalRatingTitle(e)} className={`font-semibold tabular ${(e.rating ?? 0) < 0 ? "text-bad" : "text-ink"}`}>
              {e.rating ?? "–"}
            </span>
          ),
      },
      {
        key: "from", label: "From", width: 164, align: "left", first: 1,
        sortValue: (e) => e.team_from ?? "",
        cell: (e) => school(e.team_from, e.conf_from),
      },
      {
        key: "arrow", label: "", width: 34, align: "center", first: 1,
        cell: () => <ArrowRight size={13} strokeWidth={2} className="shrink-0 text-ink-muted" />,
      },
      {
        key: "to", label: "To", width: 164, align: "left", first: 1,
        sortValue: (e) => e.team_to ?? "zzz_uncommitted",
        cell: (e) => school(e.team_to, e.conf_to),
      },
      {
        key: "entered", label: "Entered", width: 88, align: "right", first: -1,
        sortValue: (e) => e.date_entered ?? "",
        cell: (e) => <span className="text-ink-muted tabular">{fmtPortalDate(e.date_entered)}</span>,
      },
      {
        key: "committed", label: "Committed", width: 106, align: "right", first: -1,
        sortValue: committedAt,
        cell: (e) => <span className="text-ink-muted tabular">{e.team_to ? fmtPortalDate(e.date_updated) : "–"}</span>,
      },
      ...(["mpg", "ppg", "rpg", "apg"] as const).map(
        (k): Column<PortalEntry> => ({
          key: k, label: k.toUpperCase(), width: 58, align: "right", first: -1,
          sortValue: (e) => e[k],
          cell: (e) => <span className="text-ink-soft tabular">{one(e[k])}</span>,
        }),
      ),
      {
        key: "epm", label: "EPM", title: "Estimated plus-minus last season", width: 60, align: "right", first: -1,
        sortValue: (e) => e.epm,
        cell: (e) => <span className="text-ink-soft tabular">{e.epm == null ? "–" : `${e.epm > 0 ? "+" : ""}${e.epm.toFixed(1)}`}</span>,
      },
    ];
    // openSchoolClass reads bySchool, which is the only thing it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySchool]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
  }, [state, setStatus]);

  const meta = file
    ? `${rows.length !== pool.length ? `${rows.length} of ${pool.length}` : pool.length} transfers · updated ${fmtPortalDate(file.generated_at)}`
    : undefined;

  return (
    <>
      <ViewHeader
        kicker="Players"
        title="Transfer Portal"
        year={year}
        seasonNote={`Players who left their teams after ${seasonLabel(year)}.`}
        meta={meta}
        controls={
          <>
            <Picker label="Destination" value={dest} options={destOptions} onChange={setDest} />
            <Picker label="Tier" value={tier} options={TIER_OPTIONS} onChange={setTier} />
          </>
        }
        filter={{ value: query, onChange: setQuery, placeholder: "Filter players or schools" }}
      />
      <div className="flex min-h-0 flex-1 border-t border-hairline">
        <div className="relative min-h-0 min-w-0 flex-1">
          {state.status === "error" ? (
            <LoadError year={year} reason={state.reason} message={state.message} what="The transfer portal" onRetry={retry} />
          ) : !file ? (
            <TableSkeleton rowHeight={ROW_H} label="Loading the portal" />
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={entryKey}
              rowHeight={ROW_H}
              defaultSort={{ key: "board", dir: 1 }}
              group={boardBlock}
              tieBreak={byBoard}
              ariaLabel="Transfers"
              empty={<NoMatches query={query} noun="transfer" />}
              peek={{ label: (e) => e.name, body: (e) => <PortalPeekBody entry={e} /> }}
              onOpen={(e, how) => {
                const record = playerRecord(e);
                if (record) openRecord(record, { newTab: how.newTab, year: e.last_year ?? SEASON_CEIL });
              }}
            />
          )}
        </div>
        {file?.transfer_classes && (
          <aside aria-label="Transfer classes" className="flex w-[320px] shrink-0 flex-col border-l border-hairline bg-paper">
            <ClassPanel
              classes={file.transfer_classes}
              open={openClass}
              onOpen={setOpenClass}
              onOpenTeam={(name, newTab) => openRecord({ kind: "team", name, logoId: logoIdOf(name) }, { newTab, year: SEASON_CEIL })}
              onOpenPlayer={(p, newTab) => {
                const record = playerRecord(p);
                if (record) openRecord(record, { newTab, year: SEASON_CEIL });
              }}
            />
          </aside>
        )}
      </div>
    </>
  );
}
