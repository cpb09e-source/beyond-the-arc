import { ArrowLeft, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { confDisplay } from "@/lib/conf-display";
import { CLASS_MIN_STARS, type PortalFile, type TCPlayer, type TransferClassRow } from "@/lib/portal";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { PlayerPhoto } from "~/ui/player-photo";
import { Stars } from "~/ui/stars";
import { matchesQuery } from "~/ui/text";
import { hasPhotoFor } from "./portal-model";

type Classes = NonNullable<PortalFile["transfer_classes"]>;
type List = "best" | "worst";

const signedScore = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;

/**
 * Transfer classes beside the table: the best ten, the worst ten among the
 * power leagues, or any school's, and one class opened into who came and who
 * went.
 *
 * THE SITE'S TWO SIDEBARS AND ITS MODAL, AS ONE PANEL. A class opens in place,
 * so the table stays in view and a crest clicked in a row lands here too.
 */
export function ClassPanel({
  classes,
  open,
  onOpen,
  onOpenTeam,
  onOpenPlayer,
}: {
  classes: Classes;
  open: TransferClassRow | null;
  onOpen: (row: TransferClassRow | null) => void;
  onOpenTeam: (school: string, newTab: boolean) => void;
  onOpenPlayer: (p: TCPlayer, newTab: boolean) => void;
}) {
  const [list, setList] = useState<List>("best");
  const [query, setQuery] = useState("");

  const found = useMemo(() => {
    if (!query.trim()) return null;
    return Object.values(classes.by_school ?? {})
      .filter((r) => matchesQuery(query, r.school, confDisplay(r.conference) || "", r.conference ?? ""))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }, [classes, query]);

  if (open) return <ClassDetail row={open} onBack={() => onOpen(null)} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} />;

  const rows = found ?? (list === "best" ? classes.top_overall : classes.worst_power);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2.5 pt-3">
        <h2 className="text-[13px] font-semibold text-ink">Transfer classes</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">Rating in minus rating out, moves of two stars and up.</p>
        <div role="tablist" aria-label="Which classes" className="mt-2.5 grid grid-cols-2 gap-0.5 rounded-md border border-hairline bg-card p-[2px]">
          {(
            [
              ["best", "Best"],
              ["worst", "Worst power"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={!found && list === key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setList(key);
                setQuery("");
              }}
              className={`h-[22px] rounded-[4px] text-[12px] transition-colors ${
                !found && list === key ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-2 flex h-[28px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2 transition-colors focus-within:border-accent">
          <Search size={13} strokeWidth={2} className="shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                if (query) setQuery("");
                else e.currentTarget.blur();
              } else if (e.key === "Enter" && found?.[0]) {
                e.preventDefault();
                onOpen(found[0]);
              }
            }}
            placeholder="Any school's class"
            aria-label="Find a school's transfer class"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
          />
          {query && (
            <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery("")} className="text-ink-muted hover:text-ink">
              <X size={12} strokeWidth={2.25} />
            </button>
          )}
        </label>
        {!found && (
          <p className="mt-2 text-[11px] text-ink-muted">
            {list === "best" ? "All of Division I." : "The ACC, Big Ten, Big 12 and SEC only."}
          </p>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-2 py-1">
        {rows.length === 0 ? (
          <li className="px-2 py-6 text-center text-[12.5px] text-ink-muted">No school&rsquo;s class matches.</li>
        ) : (
          rows.map((r, i) => (
            <li key={r.school}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpen(r)}
                className="grid h-[44px] w-full grid-cols-[20px_24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-[var(--row-hover)]"
              >
                <span className="text-right text-[12px] text-ink-muted tabular">{found ? "" : i + 1}</span>
                <TeamLogo id={logoIdOf(r.school)} name={r.school} size={22} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{r.school}</span>
                  <span className="block truncate text-[11px] text-ink-muted tabular">
                    {r.conference ? `${confDisplay(r.conference) || r.conference} · ` : ""}
                    {r.in_count} in · {r.out_count} out
                  </span>
                </span>
                <span className={`text-[14px] font-semibold tabular ${r.score >= 0 ? "text-good" : "text-bad"}`}>{signedScore(r.score)}</span>
              </button>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function ClassDetail({
  row,
  onBack,
  onOpenTeam,
  onOpenPlayer,
}: {
  row: TransferClassRow;
  onBack: () => void;
  onOpenTeam: (school: string, newTab: boolean) => void;
  onOpenPlayer: (p: TCPlayer, newTab: boolean) => void;
}) {
  const incoming = row.in_players.filter((p) => p.stars >= CLASS_MIN_STARS);
  const outgoing = row.out_players.filter((p) => p.stars >= CLASS_MIN_STARS);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-hairline px-4 pb-3 pt-2.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
          className="-ml-1 inline-flex h-[24px] items-center gap-1 rounded-md px-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          All classes
        </button>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            title={`Open ${row.school}  ·  Ctrl-click for a new tab`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onOpenTeam(row.school, e.ctrlKey || e.metaKey)}
            className="shrink-0"
          >
            <TeamLogo id={logoIdOf(row.school)} name={row.school} size={38} />
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onOpenTeam(row.school, e.ctrlKey || e.metaKey)}
              className="block max-w-full truncate text-left text-[16px] font-semibold leading-tight text-ink hover:underline"
            >
              {row.school}
            </button>
            <div className="text-[11.5px] text-ink-muted">{confDisplay(row.conference) || "–"} · transfer class</div>
          </div>
          <div className="text-right">
            <div className={`text-[22px] font-semibold leading-none tabular ${row.score >= 0 ? "text-good" : "text-bad"}`}>{signedScore(row.score)}</div>
            {row.net_wins != null && (
              <div className="mt-1 text-[11px] text-ink-muted tabular">
                {row.net_wins > 0 ? "+" : ""}
                {row.net_wins.toFixed(1)} net wins
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Players title="Incoming" tone="text-good" counter="from" players={incoming} onOpenPlayer={onOpenPlayer} />
        <Players title="Outgoing" tone="text-bad" counter="to" players={outgoing} onOpenPlayer={onOpenPlayer} />
      </div>
    </div>
  );
}

function Players({
  title,
  tone,
  counter,
  players,
  onOpenPlayer,
}: {
  title: string;
  tone: string;
  counter: "from" | "to";
  players: TCPlayer[];
  onOpenPlayer: (p: TCPlayer, newTab: boolean) => void;
}) {
  const total = players.reduce((s, p) => s + (p.rating ?? 0), 0);
  return (
    <section className="px-2 pb-2 pt-2.5">
      <h3 className="mb-1 flex items-baseline justify-between px-2 text-[11.5px]">
        <span className={`font-semibold ${tone}`}>{title}</span>
        <span className="text-ink-muted tabular">
          {players.length} {players.length === 1 ? "player" : "players"} · {total > 0 ? "+" : ""}
          {Math.round(total)} rating
        </span>
      </h3>
      {players.length === 0 ? (
        <p className="px-2 py-1.5 text-[12px] text-ink-muted">Nobody with two stars or more.</p>
      ) : (
        <ul>
          {players.map((p) => (
            <li key={p.cbba_player_id}>
              <button
                type="button"
                disabled={p.bart_player_id == null}
                title={p.bart_player_id == null ? undefined : `Open ${p.name}  ·  Ctrl-click for a new tab`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => onOpenPlayer(p, e.ctrlKey || e.metaKey)}
                className="grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors enabled:hover:bg-[var(--row-hover)]"
              >
                <PlayerPhoto bartId={p.bart_player_id} hasPhoto={hasPhotoFor(p.bart_player_id)} name={p.name} size={26} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ink">{p.name}</span>
                    {p.t100 ? <TopHundredPill rank={p.t100} /> : null}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted">
                    <Stars stars={p.stars} size={9} />
                    <span className="truncate">
                      {p.counter_team ? `${counter} ${p.counter_team}` : counter === "to" ? "still in the portal" : ""}
                    </span>
                    {(p.dev_bump ?? 0) > 0 && <span className="shrink-0 text-accent">soph leap</span>}
                  </span>
                </span>
                <span className={`text-[13px] font-medium tabular ${(p.rating ?? 0) < 0 ? "text-bad" : "text-ink"}`}>
                  {p.rating == null ? "–" : p.rating}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
