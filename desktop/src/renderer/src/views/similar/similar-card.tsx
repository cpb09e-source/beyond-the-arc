import { Camera } from "lucide-react";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { CardFrame, type CardFormat } from "~/snapshot/snapshot-cards";
import { SnapshotSheet } from "~/snapshot/snapshot-sheet";
import { usePersisted } from "~/ui/persisted";

/**
 * A snapshot of Find Similar: the chosen team or player and its closest ten or
 * fifteen, laid out to be posted.
 *
 * THE SAME SHEET AS EVERY OTHER CARD (~/snapshot/snapshot-sheet.tsx): Wide or
 * Square, Copy image or Save PNG, captured from the window's own pixels. Wide
 * sets the list in two columns under the chosen one, Square in one, and the rows
 * share whatever height the card has, so ten breathe and fifteen still fit.
 */

export type SimilarCardEntry = { key: string; mark: (size: number) => ReactNode; name: string; sub: string; score: number; alike: string };

export type SimilarCardData = {
  kind: "team" | "player";
  /** "Teams like Houston 2025-26": the sheet's title and the file's name. */
  title: string;
  mark: (size: number) => ReactNode;
  name: string;
  facts: string;
  profile: string;
  scope: string;
  pool: string;
  /** The closest fifteen, best first. */
  entries: SimilarCardEntry[];
};

type Count = 10 | 15;
const isCount = (v: unknown): v is Count => v === 10 || v === 15;

const EYEBROW = "text-[15px] font-semibold uppercase tracking-[0.14em] text-ink-muted";

export function SimilarCard({ data, count, format, onReady }: { data: SimilarCardData; count: Count; format: CardFormat; onReady: (ready: boolean) => void }) {
  // Everything is in hand already; the sheet waits on the crests and photos itself.
  useEffect(() => onReady(true), [onReady]);
  const square = format === "square";
  const entries = data.entries.slice(0, count);
  const perColumn = square ? entries.length : Math.ceil(entries.length / 2);
  const compact = entries.length > 10;
  const size = compact
    ? { rank: 17, mark: 34, name: 21, sub: 15.5, score: 28 }
    : { rank: 20, mark: 44, name: 26, sub: 18, score: 36 };

  return (
    <CardFrame format={format} foot="Find Similar · 100 is an identical profile · btacbb.xyz">
      <div className="flex items-center gap-6">
        <div className="shrink-0">{data.mark(square ? 104 : 84)}</div>
        <div className="min-w-0 flex-1">
          <div className={EYEBROW}>{data.kind === "team" ? "Teams like" : "Players like"}</div>
          <h1 className={`mt-1 truncate font-semibold leading-[1.04] tracking-[-0.03em] ${square ? "text-[58px]" : "text-[50px]"}`}>{data.name}</h1>
          <p className="mt-2 truncate text-[21px] text-ink-muted">{data.facts}</p>
        </div>
        <div className="shrink-0 self-start pt-1 text-right">
          <div className={EYEBROW}>Matched on</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] text-accent">{data.profile}</div>
          <div className="mt-2 text-[18px] text-ink-muted">
            {data.scope} · {data.pool}
          </div>
        </div>
      </div>
      <ol
        className={`grid min-h-0 flex-1 gap-x-12 ${square ? "mt-9" : "mt-6"}`}
        style={{
          gridTemplateRows: `repeat(${perColumn}, minmax(0, 1fr))`,
          gridTemplateColumns: square ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
          gridAutoFlow: "column",
        }}
      >
        {entries.map((e, i) => (
          <li
            key={e.key}
            data-card-row=""
            className="grid min-h-0 items-center gap-x-4 border-t border-hairline"
            style={{ gridTemplateColumns: `${size.rank + 14}px ${size.mark}px minmax(0, 1fr) auto` }}
          >
            <span className="text-right text-ink-muted tabular" style={{ fontSize: size.rank }}>
              {i + 1}
            </span>
            <span className="grid place-items-center">{e.mark(size.mark)}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold leading-tight" style={{ fontSize: size.name }}>
                {e.name}
              </span>
              <span className="block truncate leading-tight text-ink-muted" style={{ fontSize: size.sub }}>
                {square ? `${e.sub} · alike in ${e.alike}` : e.sub}
              </span>
            </span>
            <span className="font-semibold leading-none tracking-[-0.02em] tabular" style={{ fontSize: size.score }}>
              {e.score}
            </span>
          </li>
        ))}
      </ol>
    </CardFrame>
  );
}

function CountToggle({ count, setCount }: { count: Count; setCount: Dispatch<SetStateAction<Count>> }) {
  return (
    <div role="radiogroup" aria-label="How many matches" className="flex h-[28px] items-center rounded-md border border-hairline bg-paper p-0.5 text-[12.5px]">
      {([10, 15] as const).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={count === n}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCount(n)}
          className={`h-full rounded-[4px] px-2.5 transition-colors ${count === n ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          Top {n}
        </button>
      ))}
    </div>
  );
}

/** Snapshot, beside Save and Download: the card, in the sheet every card uses. */
export function SimilarSnapshotButton({ data }: { data: SimilarCardData | null }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = usePersisted<Count>("bta.similar.snapCount", 10, isCount);
  return (
    <>
      <button
        type="button"
        disabled={!data || data.entries.length === 0}
        title="A card of the closest matches, to copy or save as an image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-card px-2 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-50"
      >
        <Camera size={13} strokeWidth={2} />
        Snapshot
      </button>
      {open && data && (
        <SnapshotSheet
          card={{
            title: data.title,
            file: data.title,
            render: (format, onReady) => <SimilarCard data={data} count={count} format={format} onReady={onReady} />,
            options: <CountToggle count={count} setCount={setCount} />,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
