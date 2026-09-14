import { useRef, useState } from "react";
import { printFeature, scoreBreakdown, wholePoints, type Match, type Profile } from "~/similar/similar-model";
import { Popover } from "~/ui/popover";

/**
 * Find Similar's score, taken apart: the 100 a match starts from, and what each
 * stat's distance took off it.
 *
 * EVERY DERIVED NUMBER OPENS. A score that cannot be taken apart asks to be
 * trusted; this one adds up in front of the reader, stat by stat, to the number
 * in the table (scoreBreakdown and wholePoints in ~/similar/similar-model.ts,
 * checked by desktop/scripts/check-similar.mts).
 */

/** The Match cell: the score as a button that opens where its points went. */
export function ScoreButton<R>({ m, profile, chosen, other }: { m: Match<R>; profile: Profile<R>; chosen: string; other: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const score = Math.round(m.score);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`Match ${score}: where the points went`}
        aria-expanded={open}
        title="Where the points went"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="-mx-1 flex items-center justify-end rounded-[5px] px-1 py-0.5 transition-colors hover:bg-[var(--row-hover)]"
      >
        <span className="w-[22px] text-right font-semibold text-ink tabular underline decoration-dotted underline-offset-[3px]">{score}</span>
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={372} align="right" label="Where the points went">
          <ScoreBreakdown m={m} profile={profile} chosen={chosen} other={other} />
        </Popover>
      )}
    </>
  );
}

const HEAD = "truncate text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted";

export function ScoreBreakdown<R>({ m, profile, chosen, other }: { m: Match<R>; profile: Profile<R>; chosen: string; other: string }) {
  const b = scoreBreakdown(m, profile);
  const whole = wholePoints(b.losses, m.score);
  const score = Math.round(m.score);
  const costly = b.losses.map((l, i) => ({ ...l, pts: whole[i]! })).filter((l) => l.pts > 0);
  const cheap = b.losses.length - costly.length;
  return (
    <div className="px-4 pb-3.5 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink">{profile.label} match</span>
        <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink tabular">{score}</span>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-ink-muted">
        Starts at 100. Each stat takes points off for how far apart the two stood, each measured against its own season.
      </p>
      <div role="table" aria-label="Points lost, stat by stat" className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto_34px] items-baseline gap-x-3 gap-y-[5px] text-[12px]">
        <span />
        <span className={HEAD}>{chosen}</span>
        <span className={HEAD}>{other}</span>
        <span className={HEAD}>Pts</span>
        {costly.map((l) => [
          <span key={`${l.part.f.key}:l`} className="truncate text-ink-soft" title={`${l.gap.toFixed(1)} standard deviations apart in their seasons`}>
            {l.part.f.label}
          </span>,
          <span key={`${l.part.f.key}:a`} className="text-right text-ink tabular">
            {printFeature(l.part.f, l.part.subject)}
          </span>,
          <span key={`${l.part.f.key}:b`} className="text-right text-ink tabular">
            {printFeature(l.part.f, l.part.match)}
          </span>,
          <span key={`${l.part.f.key}:p`} data-points={l.pts} className="text-right font-medium text-ink tabular">
            −{l.pts}
          </span>,
        ])}
      </div>
      {cheap > 0 && (
        <p className="mt-1.5 text-[11.5px] text-ink-muted">
          {costly.length === 0 ? "Every stat" : `${cheap} more ${cheap === 1 ? "stat" : "stats"}`} cost less than a point.
        </p>
      )}
      <div className="mt-2 flex items-baseline justify-between border-t border-hairline pt-2 text-[12px] tabular">
        <span className="text-ink-soft">100 − {100 - score}</span>
        <span className="font-semibold text-ink">{score}</span>
      </div>
      {b.missing.length > 0 && (
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
          Left out, with no number on one side: {b.missing.map((f) => f.label).join(", ")}. Compared on {Math.round(b.coverage * 100)}% of the profile.
        </p>
      )}
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">Two unrelated profiles score about 24.</p>
    </div>
  );
}
