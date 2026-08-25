import Link from "next/link";
import type { AssistPlayerSeason } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * Who set this player up, and who they set up.
 *
 * THE TEAM PANEL ANSWERS A DIFFERENT QUESTION. On the team page the network
 * shows how an offense fits together; here it is personal, and the two
 * directions are worth separating because they describe different players. A
 * high `fed_by` with a low `fed` is a finisher; the reverse is a hub.
 *
 * ASSISTS ONLY. The play-by-play carries no pass, so a connection exists only
 * where a shot went in. A player who creates open looks that rattle out is
 * invisible here, which is why the panel says "assisted" and never "passes".
 *
 * THE RIM NUMBER IS THE ONE TO READ. Threes are assisted 75–95% of the time
 * for nearly everyone, so that rate separates nobody. At the rim it ranges from
 * under 20% to over 80% and cleanly divides players who get there themselves
 * from players who are delivered there.
 *
 * Names link only when the other player has a page — `linkable` is the same
 * ranked-id set the rest of the player surface uses. A roster is full of ids
 * with no page behind them, and a dead link is worse than plain text.
 */

const pct0 = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function AssistConnections({
  season,
  names,
  linkable,
  seasonLabel,
}: {
  season: AssistPlayerSeason;
  names: Record<string, string>;
  /** Bart ids that have a player page. */
  linkable: Set<number>;
  /** e.g. "25-26", for the eyebrow. */
  seasonLabel: string;
}) {
  const { fed, fed_by: fedBy } = season;
  if (!fed.length && !fedBy.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-10">
      <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="font-display text-xl text-ink">Assist connections</h2>
          <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted whitespace-nowrap">
            {seasonLabel}
          </span>
        </div>
        <p className="text-xs text-ink-muted mb-5 max-w-[56ch]">
          Only made shots carry an assist, so these are the connections that
          produced baskets — not everything that was created.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
          <Column
            title="Set up by"
            empty="Nobody assisted a make of theirs this season."
            rows={fedBy}
            names={names}
            linkable={linkable}
          />
          <Column
            title="Set up"
            empty="No assists to a teammate's make this season."
            rows={fed}
            names={names}
            linkable={linkable}
          />
        </div>

        <div className="border-t border-hairline mt-6 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Rate label="Assisted overall" value={season.ast_rate} />
          <Rate label="At the rim" value={season.rim_ast_rate} emphasis />
          <Rate label="Mid-range" value={season.mid_ast_rate} />
          <Rate label="From three" value={season.three_ast_rate} />
        </div>
        <p className="text-[0.62rem] text-ink-muted mt-3">
          Share of this player&apos;s made field goals that were assisted. The
          rim column is the one that separates players — threes run 75–95% for
          nearly everyone.
        </p>
      </div>
    </section>
  );
}

function Column({
  title,
  empty,
  rows,
  names,
  linkable,
}: {
  title: string;
  empty: string;
  rows: [number, number][];
  names: Record<string, string>;
  linkable: Set<number>;
}) {
  const busiest = rows[0]?.[1] ?? 1;
  return (
    <div>
      <h3 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft mb-3">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{empty}</p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map(([id, n]) => {
            const name = names[id] ?? "—";
            return (
              <li key={id}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-sm min-w-0 truncate">
                    {linkable.has(id) ? (
                      <Link
                        href={`/players/${id}/`}
                        className="text-ink hover:text-coral transition-colors"
                        prefetch={false}
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="text-ink">{name}</span>
                    )}
                  </span>
                  <span className="text-sm tabular font-semibold text-ink shrink-0">{n}</span>
                </div>
                <div
                  className="h-1.5 rounded-full bg-coral/70"
                  style={{ width: `${Math.max(10, (n / busiest) * 100)}%` }}
                  aria-hidden
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Rate({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number | null;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[0.58rem] uppercase tracking-[0.14em] text-ink-muted leading-none mb-1.5">
        {label}
      </div>
      <div
        className={cn(
          "tabular leading-none",
          emphasis ? "text-2xl font-semibold text-ink" : "text-lg text-ink-soft",
        )}
      >
        {pct0(value)}
      </div>
    </div>
  );
}
