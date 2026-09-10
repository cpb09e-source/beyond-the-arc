import type { AssistNetwork } from "@/lib/static-data";
import { AssistFlow } from "@/components/teams/assist-flow";

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
 * man or spreads, and that is a shape.
 *
 * EVERYTHING IS IN THE CHART NOW. This used to carry a second block under the
 * flow — "Made it themselves", six players by the share of their rim makes that
 * somebody else created. That number is per-player, and the chart is already a
 * set of per-player targets, so it lives on the nodes: hover or tap a name and
 * the readout carries it. The one thing the list said at a glance — who on this
 * team finishes on their own — is what the readout says while nothing is
 * selected, so it is not lost to a hover nobody performs.
 *
 * assist-flow.tsx is therefore the only client component here; this file is a
 * heading and a frame, and stays on the server.
 *
 * NO LINKS, DELIBERATELY. Not every bart id on a connection has a player page
 * — walk-ons and deep-bench names resolve to an id without one — and a roster
 * table two panels down already links everyone who has one. A list where a
 * third of the names are dead links is worse than a list of plain names.
 */
export function AssistNetworkPanel({ network }: { network: AssistNetwork }) {
  if (!network.edges.length) return null;

  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-4 gap-3">
        <h3 className="font-display text-xl text-ink">Assist network</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted whitespace-nowrap">
          {network.games} games
        </span>
      </div>

      <AssistFlow network={network} />
    </div>
  );
}
