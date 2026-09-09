"use client";

import { useEffect, useState } from "react";

/**
 * What Ask the Calculator is doing while it does it.
 *
 * TWO PHASES, ONE LINE. The parse is a round trip to a model; when it lands,
 * the seasons the question named start downloading, and for a question about
 * a coach that is all thirteen of them. This used to unmount the moment the
 * parse returned, so the reader watched a static "Loading game logs…" for
 * the second half of the wait and read it as the page hanging. It now stays
 * up until the last file is in, and says which half it is on.
 *
 * The parse has no progress to measure and none is implied — nothing here
 * fills up. Within the parse the copy tracks the order the work really
 * happens in: the model reads the question, then picks the filters. Both
 * stages are real; what we cannot know is when one becomes the other,
 * because the function does not stream. So the beats are driven by elapsed
 * time and worded to describe the job rather than to claim a milestone.
 *
 * Name resolution — matching the coaches and teams the model returned against
 * the real option lists — is deliberately NOT a beat. It happens client-side
 * in well under a millisecond.
 *
 * The moving parts are CSS in globals.css (`.ask-orb`, and `.ask-dots` in
 * the button that started this): a real parse takes about five seconds and a
 * subscriber on the Season Pass sees this three hundred times a month, so it
 * has to be the kind of thing that never once asks to be looked at.
 */

/** Elapsed-time beats within the parse, in ms. The last one that has passed wins. */
const BEATS: Array<{ at: number; line: string; sub: string }> = [
  {
    at: 0,
    line: "Reading your question",
    sub: "Working out who and what you are asking about",
  },
  {
    at: 2200,
    line: "Choosing the filters",
    sub: "Turning the question into conditions the calculator can run",
  },
  {
    at: 9000,
    line: "Still going",
    sub: "This one is taking longer than usual",
  },
];

export function AskStatus({
  phase,
  seasons,
}: {
  /** Parsing the question, or loading the seasons it asked for. */
  phase: "parsing" | "loading";
  /** How many season files the loading phase is waiting on. */
  seasons: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  // One interval for the whole run. The beats are seconds apart, so 250ms is
  // ample — and the sweep itself is a compositor-driven transform that costs
  // nothing to keep running between ticks.
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => window.clearInterval(id);
  }, []);

  let beat = BEATS[0]!;
  for (const b of BEATS) if (elapsed >= b.at) beat = b;
  if (phase === "loading") {
    beat = {
      at: 0,
      line: "Loading the game logs",
      sub: `${seasons} season${seasons === 1 ? "" : "s"} of games — a few seconds the first time`,
    };
  }

  return (
    <div className="mt-3 flex items-start gap-2.5" role="status" aria-live="polite">
      <span className="ask-orb mt-1.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm text-ink font-medium">{beat.line}</p>
        <p className="text-xs text-ink-muted leading-snug">{beat.sub}</p>
      </div>
    </div>
  );
}
