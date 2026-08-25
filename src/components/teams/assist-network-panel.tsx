import type { AssistNetwork } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * Who set up whom, and who had to make their own.
 *
 * WHAT THIS IS NOT. There is no pass, touch or dribble in the play-by-play —
 * the only pass ever recorded is the one immediately before a MADE field goal.
 * So a connection here is an ASSIST connection, and a player who creates good
 * looks that rattle out is indistinguishable from one who creates nothing. The
 * panel says "assisted", never "passes", for that reason.
 *
 * THE SECOND HALF IS THE INTERESTING HALF. Assisted rate is taken over a
 * player's MAKES, split by range, and that split is what separates roles: a
 * centre finishing lobs runs ~65% assisted at the rim, a guard who gets there
 * himself runs under 20%. Threes sit at 75–95% for nearly everyone, so the rim
 * column is where the information is — which is why it is the one shown.
 *
 * NO LINKS, DELIBERATELY. Not every bart id on a connection has a player page
 * — walk-ons and deep-bench names resolve to an id without one — and a roster
 * table two panels down already links everyone who has one. A list where a
 * third of the names are dead links is worse than a list of plain names.
 */

const pct0 = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function AssistNetworkPanel({
  network,
  max = 8,
}: {
  network: AssistNetwork;
  /** Connections shown before the list stops being a list. */
  max?: number;
}) {
  const { edges, names, players } = network;
  if (!edges.length) return null;

  const top = edges.slice(0, max);
  const busiest = top[0]?.[2] ?? 1;

  // Rim assisted rate, for the roles strip. Only players with enough makes for
  // the rate to mean anything — a 4-for-6 season is noise, not a role.
  const roles = Object.entries(players)
    .filter(([, p]) => p.fgm >= 40 && p.rim_ast_rate != null)
    .sort((a, b) => (a[1].rim_ast_rate ?? 0) - (b[1].rim_ast_rate ?? 0))
    .slice(0, 6);

  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h3 className="font-display text-xl text-ink">Assist network</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted whitespace-nowrap">
          {network.games} games
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-5 max-w-[52ch]">
        The connections that produced baskets. Only made shots carry an assist,
        so this is what went in — not everything that was created.
      </p>

      <ol className="space-y-2.5 mb-6">
        {top.map(([passer, shooter, n, rim, mid, three]) => (
          <li key={`${passer}>${shooter}`}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-sm text-ink-soft min-w-0 truncate">
                <span className="text-ink">{names[passer] ?? "—"}</span>
                <span className="text-ink-muted mx-1.5" aria-label="assisted">→</span>
                <span className="text-ink">{names[shooter] ?? "—"}</span>
              </span>
              <span className="text-sm tabular font-semibold text-ink shrink-0">{n}</span>
            </div>
            {/* One bar, split by where the shot came from. Width is the
                connection's size against the team's busiest, so the list reads
                as a hierarchy rather than eight equal rows. */}
            <div
              className="h-1.5 rounded-full overflow-hidden bg-hairline flex"
              style={{ width: `${Math.max(12, (n / busiest) * 100)}%` }}
              title={`${rim} at the rim · ${mid} mid-range · ${three} from three`}
            >
              <span className="bg-coral" style={{ flex: rim }} />
              <span className="bg-coral/55" style={{ flex: mid }} />
              <span className="bg-coral/25" style={{ flex: three }} />
            </div>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 mb-5 text-[0.58rem] uppercase tracking-[0.14em] text-ink-muted">
        <Key className="bg-coral" label="Rim" />
        <Key className="bg-coral/55" label="Mid" />
        <Key className="bg-coral/25" label="Three" />
      </div>

      {roles.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <h4 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft mb-1">
            Made it themselves
          </h4>
          <p className="text-[0.62rem] text-ink-muted mb-3">
            Share of each player&apos;s rim makes that were assisted — lowest first.
          </p>
          <ul className="space-y-1.5">
            {roles.map(([id, p]) => (
              <li key={id} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink-soft min-w-0 truncate">
                  {names[id] ?? id}
                </span>
                <span
                  className={cn(
                    "text-sm tabular shrink-0",
                    (p.rim_ast_rate ?? 1) < 0.35 ? "text-ink font-semibold" : "text-ink-soft",
                  )}
                >
                  {pct0(p.rim_ast_rate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("w-3 h-1.5 rounded-full", className)} aria-hidden />
      {label}
    </span>
  );
}
