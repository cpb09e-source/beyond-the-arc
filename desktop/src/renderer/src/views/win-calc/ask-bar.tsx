import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ParsedCondition, ParsedQuery, ResolvedQuery } from "@/lib/query-parse";
import { CALC_STAT_KEYS, mergeParsedQuery, resolveCalcQuery, statLabel } from "@/lib/win-calc";
import { Kbd } from "~/ui/kbd";
import { coachLookup, knownNames, type CalcSeasons } from "./calc-model";
import { withIds, type CalcState } from "./calc-state";

/**
 * Ask the Win Calculator, in plain English.
 *
 * THE QUESTION BECOMES THE FILTERS, and the answer follows. The site's parser
 * reads the question (through the main process, which never holds a model key)
 * and the site's own rules place it: names resolved against real teams and
 * coaches, every season unless one is named, and a question with a new subject
 * starting over. What was understood stays on screen beside the chips it
 * produced, with anything it could not place, so a wrong reading is visible
 * before anyone trusts the number.
 *
 * THE WAIT HAS TWO HALVES and the line says which: the parse, then the seasons
 * the question reaches.
 */

const BEATS: Array<{ at: number; line: string; sub: string }> = [
  { at: 0, line: "Reading your question", sub: "Working out who and what you are asking about" },
  { at: 2200, line: "Choosing the filters", sub: "Turning the question into conditions the calculator can run" },
  { at: 9000, line: "Still going", sub: "This one is taking longer than usual" },
];

/** Stat keys longest first, so "fg3_pct_def" is named before "fg3_pct" can claim part of it. */
const KEYS_LONGEST = [...CALC_STAT_KEYS].sort((a, b) => b.length - a.length);

/** The parser names stats by their keys ("fbpts_diff"); a reader knows them by their labels. */
function humanize(text: string): string {
  let out = text;
  for (const key of KEYS_LONGEST) {
    if (out.includes(key)) out = out.replace(new RegExp(`\\b${key}\\b`, "g"), statLabel(key));
  }
  return out;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The parser's reply, trusted only as far as its shape checks out. */
function asParsed(body: unknown): ParsedQuery {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const venue = b.venue === "home" || b.venue === "away" || b.venue === "neutral" ? b.venue : "all";
  return {
    analysis: typeof b.analysis === "string" ? b.analysis : "",
    coaches: strings(b.coaches),
    teams: strings(b.teams),
    opponents: strings(b.opponents),
    conferences: strings(b.conferences),
    seasons: Array.isArray(b.seasons) ? b.seasons.filter((n): n is number => Number.isInteger(n)) : [],
    venue,
    quads: Array.isArray(b.quads) ? b.quads.filter((n): n is number => n === 1 || n === 2 || n === 3 || n === 4) : [],
    conditions: Array.isArray(b.conditions)
      ? b.conditions.filter(
          (c): c is ParsedCondition =>
            !!c &&
            typeof c === "object" &&
            typeof (c as ParsedCondition).stat === "string" &&
            ["gt", "gte", "lt", "lte", "eq"].includes((c as ParsedCondition).op) &&
            Number.isFinite((c as ParsedCondition).value),
        )
      : [],
    notes: strings(b.notes),
  };
}

export function AskBar({
  update,
  seasons,
  inputRef,
  pending,
  onPendingTaken,
}: {
  update: (fn: (s: CalcState) => CalcState) => void;
  seasons: CalcSeasons;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** A question handed over in the tab's query (asked from Ctrl K), to ask once. */
  pending?: string | null;
  onPendingTaken?: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "parsing" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ResolvedQuery | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (phase !== "parsing") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // The second half of the wait ends when the last season the question reached is in.
  useEffect(() => {
    if (phase === "loading" && seasons.complete) setPhase("idle");
  }, [phase, seasons.complete]);

  const ask = async (question?: string) => {
    const q = (question ?? text).trim();
    if (q.length < 3 || phase === "parsing") return;
    setPhase("parsing");
    setError(null);
    setAnswer(null);
    const t = Date.now();
    setStarted(t);
    setNow(t);

    const reply = await window.bta.calc.parse(q);
    if (reply.status !== 200) {
      const message = (reply.body as { error?: unknown } | null)?.error;
      setError(typeof message === "string" ? message : `The question parser answered ${reply.status}.`);
      setPhase("idle");
      return;
    }

    const names = knownNames();
    const resolved = resolveCalcQuery(asParsed(reply.body), {
      coaches: coachLookup().allCoaches,
      teams: names.teams,
      opponents: names.opponents,
    });
    update((s) => {
      const next = mergeParsedQuery(resolved, s, () => 0);
      return { ...s, ...next, rows: withIds(next.rows) };
    });
    setAnswer(resolved);
    setPhase("loading");
  };

  // A question asked from Ctrl K arrives in the query: shown in the box, asked,
  // and taken out of the query so a reload or a favorite does not ask it again.
  // The ref keeps a development double-mount from asking twice.
  const taken = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || taken.current === pending) return;
    taken.current = pending;
    setText(pending);
    onPendingTaken?.();
    void ask(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const busy = phase === "parsing" || (phase === "loading" && !seasons.complete);
  let beat = BEATS[0]!;
  for (const b of BEATS) if (now - started >= b.at) beat = b;
  const status =
    phase === "parsing"
      ? beat
      : phase === "loading" && !seasons.complete
        ? { line: "Loading the game logs", sub: `${seasons.ready} of ${seasons.total} ${seasons.total === 1 ? "season" : "seasons"}` }
        : null;

  return (
    <div className="shrink-0 px-5 pb-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex h-[38px] items-center gap-2.5 rounded-lg border border-hairline bg-card pl-3 pr-1.5 transition-colors focus-within:border-accent"
      >
        <Sparkles size={15} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter asks from the key itself; an IME still composing keeps its Enter.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              void ask();
              return;
            }
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (text) setText("");
            else e.currentTarget.blur();
          }}
          maxLength={500}
          spellCheck={false}
          aria-label="Ask the Win Calculator"
          placeholder="Ask in plain English: Duke games where they made more threes and won the turnover battle"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
        />
        {busy ? (
          <span className="ask-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        ) : text.trim().length >= 3 ? (
          <button
            type="submit"
            className="h-[26px] shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            Ask
          </button>
        ) : (
          <span className="shrink-0 pr-1">
            <Kbd>Enter</Kbd>
          </span>
        )}
      </form>

      {status && (
        <p role="status" aria-live="polite" className="mt-2 flex min-w-0 items-center gap-2 text-[12px]">
          <span className="ask-orb shrink-0" aria-hidden />
          <span className="shrink-0 text-ink">{status.line}</span>
          <span className="truncate text-ink-muted">{status.sub}</span>
        </p>
      )}
      {!status && error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
      {!status && !error && answer && (
        <div className="mt-2 flex items-start gap-2.5 text-[12.5px] leading-snug">
          <span className="mt-px shrink-0 rounded-[4px] bg-[var(--accent-wash)] px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">
            Understood
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-ink-soft">{humanize(answer.analysis)}</p>
            {answer.notes.length > 0 && (
              <p className="text-ink-muted">
                Judgment call{answer.notes.length > 1 ? "s" : ""}: {answer.notes.map(humanize).join(" · ")}
              </p>
            )}
            {answer.unresolved.length > 0 && (
              <p className="text-bad">
                Couldn&rsquo;t match {answer.unresolved.join(", ")}. Set {answer.unresolved.length > 1 ? "those" : "that"} with a filter.
              </p>
            )}
            {answer.conditions.length === 0 && (
              <p className="text-bad">
                No statistical condition was picked up, so this is the overall record. Add one below, or ask something like
                &ldquo;games where they shot over 40% from three&rdquo;.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Hide what was understood"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAnswer(null)}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            <X size={12} strokeWidth={2.25} />
          </button>
        </div>
      )}
    </div>
  );
}
