"use client";

import { useEffect, useState } from "react";

/**
 * What Ask the Calculator is doing while it does it.
 *
 * The parse is one round trip to a model, so there is no progress to measure
 * and none is implied — the rule below is a segment that crosses and restarts,
 * never a bar that fills. What the copy tracks is the order the work really
 * happens in: the model reads the question, then picks the filters. Both stages
 * are real and in that sequence; what we cannot know is when one becomes the
 * other, because the function does not stream. So the beats are driven by
 * elapsed time and worded to describe the job rather than to claim a milestone.
 *
 * Name resolution — matching the coaches and teams the model returned against
 * the real option lists — is deliberately NOT a beat. It happens client-side in
 * well under a millisecond, so a "matching names" frame would be decoration
 * wearing the clothes of a status message.
 *
 * The animation is two rules of CSS in globals.css (`.ask-sweep`), which is the
 * whole point of it: a real parse takes about five seconds and a subscriber on
 * the Season Pass sees this three hundred times a month, so it has to be the
 * kind of thing that never once asks to be looked at.
 */

/** Elapsed-time beats, in ms. The last one whose `at` has passed wins. */
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

export function AskStatus() {
  const [elapsed, setElapsed] = useState(0);

  // One interval for the whole run. The beats are seconds apart, so 250ms is
  // ample — and the sweep itself is a compositor-driven transform that costs
  // nothing to keep running between ticks.
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => window.clearInterval(id);
  }, []);

  let beat = BEATS[0];
  for (const b of BEATS) if (elapsed >= b.at) beat = b;

  return (
    <div className="mt-3" role="status" aria-live="polite">
      {/* overflow-hidden is load-bearing: the segment starts and ends outside
          the track, and without it the animation paints across the panel. */}
      <div className="ask-sweep relative h-0.5 rounded-sm bg-hairline overflow-hidden" aria-hidden="true" />
      <p className="mt-2.5 text-sm text-ink font-medium">{beat.line}</p>
      <p className="text-xs text-ink-muted leading-snug">{beat.sub}</p>
    </div>
  );
}
