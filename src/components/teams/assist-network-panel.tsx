import type { AssistNetwork } from "@/lib/static-data";
import { uniqueNames } from "@/lib/player-name";
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
 * DRAWN AS A FLOW, NOT A RANKED LIST. The list this replaces was sorted pairs,
 * which answers "what is the single biggest connection" and nothing else. The
 * question people actually have about an offense is whether it runs through one
 * man or spreads, and that is a shape: creators on the left sized by assists
 * given, finishers on the right sized by assisted makes, ribbons for the
 * traffic. Duke's is one fat band fanning out of Cameron Boozer; Houston's is
 * two of comparable size.
 *
 * THE SECOND HALF IS STILL THE INTERESTING HALF. Assisted rate is taken over a
 * player's MAKES, split by range, and that split is what separates roles: a
 * center finishing lobs runs ~65% assisted at the rim, a guard who gets there
 * himself runs under 20%. Threes sit at 75–95% for nearly everyone, so the rim
 * column is where the information is — which is why it is the one shown.
 *
 * NO LINKS, DELIBERATELY. Not every bart id on a connection has a player page
 * — walk-ons and deep-bench names resolve to an id without one — and a roster
 * table two panels down already links everyone who has one. A list where a
 * third of the names are dead links is worse than a list of plain names.
 */

const pct0 = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/**
 * The top four creators get a color; everyone else is gray.
 *
 * Twelve distinct hues would be a legend nobody reads. Four says the thing the
 * chart is for — this is who makes the offense go — and leaves the rest as
 * texture. All four are site tokens rather than fixed hex, so they follow the
 * theme; a hardcoded palette tuned on warm paper goes muddy on #1C1C1C.
 */
const HUES = ["var(--coral)", "var(--good)", "var(--gold)", "var(--court)"] as const;
const REST_HUE = "var(--ink-muted)";

/** Nodes per side before the labels stop having room to sit beside each other. */
const MAX_NODES = 8;

export function AssistNetworkPanel({
  network,
  max = 14,
}: {
  network: AssistNetwork;
  /** Connections drawn before the flow stops being readable. */
  max?: number;
}) {
  const { names, players } = network;
  if (!network.edges.length) return null;

  const label = uniqueNames(names).surname;

  // TAKE CONNECTIONS UNTIL A SIDE IS FULL, not a fixed count. Fourteen edges
  // between fourteen different pairs would leave every node a few pixels tall
  // with its name overlapping its neighbour's. Stopping on node count instead
  // means a hub team shows more connections than a democratic one, which is
  // the correct behaviour: the hub's edges land on fewer people.
  const edges: AssistNetwork["edges"] = [];
  const pSeen = new Set<number>(), sSeen = new Set<number>();
  for (const e of network.edges) {
    if (edges.length >= max) break;
    const nextP = pSeen.has(e[0]) ? pSeen.size : pSeen.size + 1;
    const nextS = sSeen.has(e[1]) ? sSeen.size : sSeen.size + 1;
    if (nextP > MAX_NODES || nextS > MAX_NODES) continue;
    pSeen.add(e[0]); sSeen.add(e[1]);
    edges.push(e);
  }

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
      <p className="text-xs text-ink-muted mb-4 max-w-[52ch]">
        The connections that produced baskets. Only made shots carry an assist,
        so this is what went in — not everything that was created.
      </p>

      <Flow edges={edges} names={names} label={label} />

      {roles.length > 0 && (
        <div className="border-t border-hairline pt-4 mt-5">
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

function Flow({
  edges, names, label,
}: {
  edges: AssistNetwork["edges"];
  names: Record<string, string>;
  label: Record<string, string>;
}) {
  const W = 360, H = 300, TOP = 10, GAP = 5, NODE_W = 7;
  const LEFT_X = 104, RIGHT_X = 248;

  const pTot = new Map<number, number>(), sTot = new Map<number, number>();
  for (const [p, s, c] of edges) {
    pTot.set(p, (pTot.get(p) ?? 0) + c);
    sTot.set(s, (sTot.get(s) ?? 0) + c);
  }
  const pIds = [...pTot.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const sIds = [...sTot.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const sum = [...pTot.values()].reduce((a, b) => a + b, 0);
  if (!sum) return null;

  // Each side fills the full height; the two sides usually have different node
  // counts, so their gaps differ and the ribbons taper a little between them.
  // That is fine — a band's width is read at its ends, against the node it
  // belongs to, and both ends are drawn on their own side's scale.
  const lay = (ids: number[], tot: Map<number, number>) => {
    const usable = H - TOP * 2 - GAP * Math.max(0, ids.length - 1);
    const out = new Map<number, { y: number; h: number }>();
    let y = TOP;
    for (const id of ids) {
      const h = (tot.get(id)! / sum) * usable;
      out.set(id, { y, h });
      y += h + GAP;
    }
    return { out, usable };
  };
  const L = lay(pIds, pTot), R = lay(sIds, sTot);

  const hue = (p: number) => {
    const i = pIds.indexOf(p);
    return i >= 0 && i < HUES.length ? HUES[i]! : REST_HUE;
  };

  // Ribbons stack in node order on both ends rather than meeting at row
  // centers, which is the whole reason fourteen of them do not become a knot.
  const curP = new Map(pIds.map((i) => [i, L.out.get(i)!.y]));
  const curS = new Map(sIds.map((i) => [i, R.out.get(i)!.y]));
  const maxEdge = Math.max(...edges.map((e) => e[2]));
  const ribbons = [...edges]
    .sort((a, b) => pIds.indexOf(a[0]) - pIds.indexOf(b[0]) || sIds.indexOf(a[1]) - sIds.indexOf(b[1]))
    .map(([p, s, c, rim, mid, three]) => {
      const hL = (c / sum) * L.usable, hR = (c / sum) * R.usable;
      const a0 = curP.get(p)!, b0 = curS.get(s)!;
      curP.set(p, a0 + hL); curS.set(s, b0 + hR);
      const x1 = LEFT_X + NODE_W, x2 = RIGHT_X, cx = (x1 + x2) / 2;
      return {
        key: `${p}>${s}`, c, hue: hue(p),
        title: `${names[p] ?? "—"} → ${names[s] ?? "—"}: ${c} assisted baskets`
          + ` (${rim} at the rim · ${mid} mid-range · ${three} from three)`,
        d: `M ${x1} ${a0} C ${cx} ${a0}, ${cx} ${b0}, ${x2} ${b0}`
          + ` L ${x2} ${b0 + hR} C ${cx} ${b0 + hR}, ${cx} ${a0 + hL}, ${x1} ${a0 + hL} Z`,
      };
    });

  return (
    <div>
      <div className="flex justify-between text-[0.55rem] uppercase tracking-[0.16em] text-ink-muted mb-1">
        <span>Created by</span>
        <span>Finished by</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Assists from each creator to each finisher, band thickness by volume"
      >
        {ribbons.map((r) => (
          <path key={r.key} d={r.d} fill={r.hue} fillOpacity={0.16 + 0.42 * (r.c / maxEdge)}>
            <title>{r.title}</title>
          </path>
        ))}

        {pIds.map((id) => {
          const g = L.out.get(id)!;
          return (
            <g key={`p${id}`}>
              <rect x={LEFT_X} y={g.y} width={NODE_W} height={g.h} rx={2} fill={hue(id)} fillOpacity={0.85} />
              <text x={LEFT_X - 7} y={g.y + g.h / 2 + (g.h >= 15 ? -1 : 3)} textAnchor="end"
                fontSize={8.5} fill="var(--ink)">
                {label[id] ?? names[id] ?? "—"}
              </text>
              {/* The second line only fits on a node tall enough to hold two.
                  Below that it would sit on the next player's name. */}
              {g.h >= 15 && (
                <text x={LEFT_X - 7} y={g.y + g.h / 2 + 8} textAnchor="end" fontSize={7}
                  fill="var(--ink-muted)" className="tabular">
                  {pTot.get(id)} ast
                </text>
              )}
            </g>
          );
        })}

        {sIds.map((id) => {
          const g = R.out.get(id)!;
          return (
            <g key={`s${id}`}>
              <rect x={RIGHT_X} y={g.y} width={NODE_W} height={g.h} rx={2}
                fill="var(--ink-soft)" fillOpacity={0.55} />
              <text x={RIGHT_X + NODE_W + 7} y={g.y + g.h / 2 + (g.h >= 15 ? -1 : 3)}
                fontSize={8.5} fill="var(--ink)">
                {label[id] ?? names[id] ?? "—"}
              </text>
              {g.h >= 15 && (
                <text x={RIGHT_X + NODE_W + 7} y={g.y + g.h / 2 + 8} fontSize={7}
                  fill="var(--ink-muted)" className="tabular">
                  {sTot.get(id)} made
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="text-[0.6rem] text-ink-muted mt-1.5 leading-snug">
        The team&apos;s {edges.length} biggest connections. Left column is assists given,
        right is assisted makes received; band thickness is the volume between the two.
        Hover a band for its rim, mid-range and three-point split.
      </p>
    </div>
  );
}
