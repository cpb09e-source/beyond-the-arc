import type { ReactNode } from "react";
import { matchupLedger, type LedgerCorrection, type MatchupPack, type Projection } from "@/lib/matchup";
import { teamShortName } from "@/lib/team-names";

/** Points of margin that fill one side of a correction's track. */
const BAR_CAP = 4;

/**
 * How the number is made: every step of the arithmetic, so it can be argued with.
 *
 * THE WORDS AND FIGURES ARE THE SITE'S (lib/matchup.ts matchupLedger). The app
 * adds one thing a wide window has room for: each correction's size and
 * direction as a bar, drawn toward the team it helps, on the same left-right
 * the card above uses. Nine corrections read at a glance as "mostly the floor"
 * or "mostly the absences" before a single figure is read.
 */
export function Ledger({ p, pack }: { p: Projection; pack: MatchupPack }) {
  const l = matchupLedger(p, pack);
  return (
    <div className="border-b border-hairline">
      {l.steps.map((s, i) => (
        <Step key={s.label} n={i + 1} label={s.label}>
          {s.lines.map((line) => (
            <div key={line.k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-[3px]">
              <span className={`truncate text-[12.5px] ${line.strong ? "font-medium text-ink" : "text-ink-soft"}`}>{line.k}</span>
              <span className={`font-mono text-[12px] tabular ${line.strong ? "font-semibold text-ink" : "text-ink"}`}>{line.v}</span>
            </div>
          ))}
        </Step>
      ))}
      <Step
        n={4}
        label="Matchup corrections"
        aside={
          <>
            <span style={{ color: "var(--ma)" }}>← {teamShortName(p.a.b)}</span>
            <span className="mx-1.5 text-hairline">|</span>
            <span style={{ color: "var(--mb)" }}>{teamShortName(p.b.b)} →</span>
          </>
        }
      >
        {l.corrections.map((c) => (
          <Correction key={c.key} c={c} a={p.a.b} b={p.b.b} />
        ))}
        {l.stretch ? (
          <>
            <Total label="Before the young-ratings stretch" value={l.stretch.before} />
            <Total
              label="Projected margin"
              value={l.stretch.after}
              strong
              flush
              title="Shrunk ratings project too narrow a spread; the stretch fades as games accumulate."
            />
          </>
        ) : (
          <Total label="Projected margin" value={l.sum} strong />
        )}
      </Step>
    </div>
  );
}

function Step({ n, label, aside, children }: { n: number; label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-hairline py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-paper-deep font-mono text-[10.5px] font-medium text-ink-soft">
          {n}
        </span>
        <span className="text-[12px] font-medium text-ink-soft">{label}</span>
        {aside && <span className="ml-auto text-[11.5px] font-medium">{aside}</span>}
      </div>
      <div className="pl-[26px]">{children}</div>
    </div>
  );
}

function Correction({ c, a, b }: { c: LedgerCorrection; a: string; b: string }) {
  const zero = Math.abs(c.value) < 0.005;
  const w = Math.min(50, (Math.abs(c.value) / BAR_CAP) * 50);
  const sign = c.value > 0 ? "+" : c.value < 0 ? "−" : "";
  return (
    <div
      title={zero ? "No effect in this matchup" : `${Math.abs(c.value).toFixed(2)} points toward ${c.value > 0 ? a : b}`}
      className="grid grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-3 py-[3px]"
    >
      <span className={`truncate text-[12.5px] ${zero ? "text-ink-muted" : "text-ink-soft"}`}>{c.label}</span>
      <span aria-hidden className="relative h-[6px] rounded-full bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]">
        <span className="absolute -inset-y-[3px] left-1/2 w-px bg-[color-mix(in_oklab,var(--ink)_26%,transparent)]" />
        {!zero && (
          <span
            className="absolute inset-y-0 rounded-full"
            style={
              c.value > 0
                ? { right: "50%", width: `${w}%`, background: "var(--ma-fill)" }
                : { left: "50%", width: `${w}%`, background: "var(--mb-fill)" }
            }
          />
        )}
      </span>
      <span className={`text-right font-mono text-[12px] tabular ${zero ? "text-ink-muted" : "text-ink"}`}>
        {sign}
        {Math.abs(c.value).toFixed(2)}
      </span>
    </div>
  );
}

function Total({
  label,
  value,
  strong = false,
  flush = false,
  title,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** Directly under another total, without its own rule. */
  flush?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 ${flush ? "py-[3px]" : "mt-1.5 border-t border-hairline pb-[3px] pt-2"} ${title ? "cursor-help" : ""}`}
    >
      <span className={`text-[12.5px] ${strong ? "font-medium text-ink" : "text-ink-soft"}`}>{label}</span>
      <span className={`font-mono text-[12px] tabular ${strong ? "font-semibold text-ink" : "text-ink-soft"}`}>{value}</span>
    </div>
  );
}
