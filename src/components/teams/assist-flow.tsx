"use client";

import { useMemo, useState } from "react";
import type { AssistNetwork } from "@/lib/static-data";
import { uniqueNames } from "@/lib/player-name";

/**
 * The assist flow: creators on the left, finishers on the right, ribbons for
 * the traffic — and the only interactive part of the panel.
 *
 * WHY THIS IS A SEPARATE CLIENT COMPONENT. The panel around it is static —
 * a heading, a paragraph and a list — and shipping all of that to the browser
 * to get a hover state on fourteen paths is a bad trade. Only the chart is
 * client; the rest of the panel renders on the server as it did before.
 *
 * TWO LEVELS OF INTERACTION, deliberately:
 *   - HOVER is a preview. Everything else fades, the readout fills in, and it
 *     all comes back the moment the pointer leaves.
 *   - CLICK pins it. On a phone there is no hover at all, so without a pinned
 *     state the whole thing would be decoration on half the traffic to this
 *     page. A pinned selection also survives moving the pointer to read the
 *     numbers, which is the actual complaint people have with hover-only charts.
 *
 * The readout holds its height whether or not anything is selected. It sits
 * directly under the chart, and letting it collapse would bounce the roster
 * table below every time the pointer crossed a ribbon.
 */

const HUES = ["var(--coral)", "var(--good)", "var(--gold)", "var(--court)"] as const;
const REST_HUE = "var(--ink-muted)";

/** Nodes per side before the labels stop having room to sit beside each other. */
const MAX_NODES = 8;

type Sel = { kind: "edge"; id: string } | { kind: "node"; side: "p" | "s"; id: number } | null;

export function AssistFlow({
  network,
  max = 14,
}: {
  network: AssistNetwork;
  /** Connections drawn before the flow stops being readable. */
  max?: number;
}) {
  const [hover, setHover] = useState<Sel>(null);
  const [pin, setPin] = useState<Sel>(null);
  const active = pin ?? hover;

  const { names } = network;
  const label = useMemo(() => uniqueNames(names).surname, [names]);

  const geo = useMemo(() => build(network, max, label), [network, max, label]);
  if (!geo) return null;

  const { W, H, LEFT_X, RIGHT_X, NODE_W, ribbons, pNodes, sNodes, edgeCount } = geo;

  const sameSel = (a: Sel, b: Sel) =>
    !!a && !!b && a.kind === b.kind &&
    (a.kind === "edge" ? a.id === (b as { id: string }).id
      : a.id === (b as { id: number; side: string }).id && a.side === (b as { side: string }).side);

  const toggle = (s: Sel) => setPin((cur) => (sameSel(cur, s) ? null : s));

  const litEdge = (r: (typeof ribbons)[number]) => {
    if (!active) return true;
    if (active.kind === "edge") return r.key === active.id;
    return active.side === "p" ? r.p === active.id : r.s === active.id;
  };
  const litNode = (side: "p" | "s", id: number) => {
    if (!active) return true;
    if (active.kind === "edge") {
      const r = ribbons.find((x) => x.key === active.id);
      return !!r && (side === "p" ? r.p === id : r.s === id);
    }
    return active.side === side && active.id === id;
  };

  const readout = describe(active, ribbons, pNodes, sNodes, label, names, network.players);
  const selfMade = mostSelfMade(network, label);

  return (
    <div>
      <div className="flex justify-between text-[0.55rem] uppercase tracking-[0.16em] text-ink-muted mb-1">
        <span>Created by</span>
        <span>Finished by</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-manipulation"
        role="img"
        aria-label="Assists from each creator to each finisher, band thickness by volume"
        onPointerLeave={() => setHover(null)}
      >
        {/* Background catcher, so clicking off a ribbon clears a pinned one. */}
        <rect width={W} height={H} fill="transparent" onClick={() => setPin(null)} />

        {ribbons.map((r) => {
          const lit = litEdge(r);
          const sel: Sel = { kind: "edge", id: r.key };
          return (
            <path
              key={r.key}
              d={r.d}
              fill={r.hue}
              fillOpacity={lit ? r.opacity : 0.05}
              stroke={pin?.kind === "edge" && pin.id === r.key ? r.hue : "none"}
              strokeWidth={0.8}
              strokeOpacity={0.9}
              className="cursor-pointer motion-safe:transition-[fill-opacity] motion-safe:duration-150"
              onPointerEnter={() => setHover(sel)}
              onClick={(e) => { e.stopPropagation(); toggle(sel); }}
            >
              <title>{r.title}</title>
            </path>
          );
        })}

        {pNodes.map((n) => (
          <Node key={`p${n.id}`} n={n} side="p" x={LEFT_X} w={NODE_W} anchor="end"
            tx={LEFT_X - 7} lit={litNode("p", n.id)} pinned={pin?.kind === "node" && pin.side === "p" && pin.id === n.id}
            unit="ast" label={label[String(n.id)] ?? names[n.id] ?? "—"}
            onEnter={() => setHover({ kind: "node", side: "p", id: n.id })}
            onClick={() => toggle({ kind: "node", side: "p", id: n.id })} />
        ))}

        {sNodes.map((n) => (
          <Node key={`s${n.id}`} n={n} side="s" x={RIGHT_X} w={NODE_W} anchor="start"
            tx={RIGHT_X + NODE_W + 7} lit={litNode("s", n.id)} pinned={pin?.kind === "node" && pin.side === "s" && pin.id === n.id}
            unit="made" label={label[String(n.id)] ?? names[n.id] ?? "—"}
            onEnter={() => setHover({ kind: "node", side: "s", id: n.id })}
            onClick={() => toggle({ kind: "node", side: "s", id: n.id })} />
        ))}
      </svg>

      {/* Fixed height: this sits above the roster table, and a readout that
          collapsed would bounce the page every time the pointer crossed a band. */}
      <div className="mt-2 min-h-[2.6rem] rounded-md border border-hairline bg-paper-deep/30 px-2.5 py-1.5">
        {readout ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: readout.hue }} aria-hidden />
              <span className="text-[0.72rem] text-ink truncate">{readout.title}</span>
              <span className="text-[0.72rem] tabular font-semibold text-ink ml-auto shrink-0">{readout.total}</span>
            </div>
            <div className="text-[0.6rem] text-ink-muted mt-0.5 truncate">
              {readout.detail}
              {pin && <span className="text-ink-soft"> · click again to release</span>}
            </div>
          </>
        ) : (
          <div className="text-[0.62rem] text-ink-muted leading-snug">
            {/* THE RESTING STATE CARRIES THE HEADLINE. The self-made rates used
                to be a six-row list under the chart; folded into hover they
                would be reachable only one player at a time, and the one thing
                that list actually said — who on this team creates his own —
                would be gone. So the readout says it while nothing is selected,
                and the per-player rate is on every node. */}
            {selfMade && (
              <span className="text-ink-soft">
                {selfMade.name} is the least-assisted finisher — {selfMade.pct} of rim makes unassisted.{" "}
              </span>
            )}
            <span className="hidden sm:inline">Hover</span>
            <span className="sm:hidden">Tap</span> a band or a name for the detail; click to keep it.
            {" "}({edgeCount} biggest connections shown.)
          </div>
        )}
      </div>
    </div>
  );
}

function Node({
  n, x, w, anchor, tx, lit, pinned, unit, label, onEnter, onClick,
}: {
  n: { id: number; y: number; h: number; total: number; hue: string };
  side: "p" | "s"; x: number; w: number; anchor: "start" | "end"; tx: number;
  lit: boolean; pinned: boolean; unit: string; label: string;
  onEnter: () => void; onClick: () => void;
}) {
  return (
    <g
      className="cursor-pointer motion-safe:transition-opacity motion-safe:duration-150"
      opacity={lit ? 1 : 0.25}
      onPointerEnter={onEnter}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* An invisible slab widens the target — a 7px bar is a hard thing to
          hit with a finger, and this is the primary control on a phone. */}
      <rect x={anchor === "end" ? x - 70 : x} y={n.y - 2} width={70 + w} height={n.h + 4} fill="transparent" />
      <rect x={x} y={n.y} width={w} height={n.h} rx={2} fill={n.hue}
        fillOpacity={pinned ? 1 : 0.85} stroke={pinned ? n.hue : "none"} strokeWidth={1.5} />
      <text x={tx} y={n.y + n.h / 2 + (n.h >= 15 ? -1 : 3)} textAnchor={anchor}
        fontSize={8.5} fill="var(--ink)" fontWeight={pinned ? 600 : 400}>
        {label}
      </text>
      {/* The second line only fits on a node tall enough to hold two. Below
          that it would sit on the next player's name. */}
      {n.h >= 15 && (
        <text x={tx} y={n.y + n.h / 2 + 8} textAnchor={anchor} fontSize={7}
          fill="var(--ink-muted)" className="tabular">
          {n.total} {unit}
        </text>
      )}
    </g>
  );
}

/* ------------------------------- geometry -------------------------------- */

function build(network: AssistNetwork, max: number, label: Record<string, string>) {
  const W = 360, H = 300, TOP = 10, GAP = 5, NODE_W = 7;
  const LEFT_X = 104, RIGHT_X = 248;

  // TAKE CONNECTIONS UNTIL A SIDE IS FULL, not a fixed count. Fourteen edges
  // between fourteen different pairs would leave every node a few pixels tall
  // with its name overlapping its neighbour's. Stopping on node count instead
  // means a hub team shows more connections than a democratic one, which is
  // correct: the hub's edges land on fewer people.
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
  if (!edges.length) return null;

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
  // A band's width is read at its ends, against the node it belongs to, and
  // both ends are drawn on their own side's scale.
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
        key: `${p}>${s}`, p, s, c, rim, mid, three,
        hue: hue(p),
        opacity: 0.16 + 0.42 * (c / maxEdge),
        title: `${network.names[p] ?? "—"} → ${network.names[s] ?? "—"}: ${c} assisted baskets`
          + ` (${rim} at the rim · ${mid} mid-range · ${three} from three)`,
        pairLabel: `${label[String(p)] ?? "—"} → ${label[String(s)] ?? "—"}`,
        d: `M ${x1} ${a0} C ${cx} ${a0}, ${cx} ${b0}, ${x2} ${b0}`
          + ` L ${x2} ${b0 + hR} C ${cx} ${b0 + hR}, ${cx} ${a0 + hL}, ${x1} ${a0 + hL} Z`,
      };
    });

  const pNodes = pIds.map((id) => ({ id, ...L.out.get(id)!, total: pTot.get(id)!, hue: hue(id) }));
  const sNodes = sIds.map((id) => ({ id, ...R.out.get(id)!, total: sTot.get(id)!, hue: "var(--ink-soft)" }));

  return { W, H, LEFT_X, RIGHT_X, NODE_W, ribbons, pNodes, sNodes, edgeCount: edges.length };
}

type Ribbon = NonNullable<ReturnType<typeof build>>["ribbons"][number];
type NodeGeo = { id: number; total: number; hue: string };

/**
 * The team's most self-made finisher, for the readout's resting state.
 *
 * Rim makes, not all makes, because that is where the number separates roles:
 * threes are 75-95% assisted for nearly everyone and tell you nothing, while a
 * centre finishing lobs runs ~65% at the rim against under 20% for a guard who
 * gets there himself. The 40-make floor is the same one the old list used — a
 * 4-for-6 season is noise, not a role.
 */
function mostSelfMade(network: AssistNetwork, label: Record<string, string>) {
  const best = Object.entries(network.players)
    .filter(([, p]) => p.fgm >= 40 && p.rim_ast_rate != null)
    .sort((a, b) => (a[1].rim_ast_rate ?? 0) - (b[1].rim_ast_rate ?? 0))[0];
  if (!best) return null;
  return {
    name: label[best[0]] ?? network.names[best[0]] ?? "—",
    pct: `${Math.round((1 - (best[1].rim_ast_rate ?? 0)) * 100)}%`,
  };
}

/** "61% of rim makes unassisted", or null when the sample is too thin to say. */
function selfMadeLine(players: AssistNetwork["players"], id: number): string | null {
  const p = players[id];
  if (!p || p.fgm < 40 || p.rim_ast_rate == null) return null;
  return `${Math.round((1 - p.rim_ast_rate) * 100)}% of rim makes unassisted`;
}

function describe(
  active: Sel,
  ribbons: Ribbon[],
  pNodes: NodeGeo[],
  sNodes: NodeGeo[],
  label: Record<string, string>,
  names: Record<string, string>,
  players: AssistNetwork["players"],
): { hue: string; title: string; total: string; detail: string } | null {
  if (!active) return null;

  if (active.kind === "edge") {
    const r = ribbons.find((x) => x.key === active.id);
    if (!r) return null;
    return {
      hue: r.hue,
      title: r.pairLabel,
      total: `${r.c}`,
      detail: `${r.rim} at the rim · ${r.mid} mid-range · ${r.three} from three`,
    };
  }

  const n = (active.side === "p" ? pNodes : sNodes).find((x) => x.id === active.id);
  if (!n) return null;
  const partners = ribbons.filter((r) => (active.side === "p" ? r.p : r.s) === active.id).length;
  const who = `${partners} teammate${partners === 1 ? "" : "s"} shown`;
  const self = selfMadeLine(players, active.id);
  return {
    hue: n.hue,
    title: label[String(active.id)] ?? names[active.id] ?? "—",
    total: `${n.total}`,
    detail: (active.side === "p" ? `assists to ${who}` : `assisted makes, from ${who}`)
      + (self ? ` · ${self}` : ""),
  };
}
