import { ArrowUpRight, ChevronRight, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { useAccount } from "./account";
import { useIsActive } from "./active";
import { SeasonSwitcher } from "./season-switcher";
import { useShell } from "./shell-context";

/**
 * The top of every view, in one row: where you are, which season, the view's own
 * modes, how much is in it, and the filter.
 *
 * ONE SHAPE FOR ALL OF THEM, so the eye finds the same things in the same place
 * on every table. Compact on purpose, the way Linear and Attio headers are:
 * the table below is the content, and a header that takes a fifth of the
 * window is taking it from the table.
 */
export function ViewHeader({
  kicker,
  title,
  year,
  setYear,
  seasonNote,
  meta,
  controls,
  filter,
}: {
  /** The family the view belongs to, shown as a breadcrumb: Teams, Players. */
  kicker: string;
  title: string;
  year: number;
  /** Absent for a view pinned to one season: the season shows, and does not switch. */
  setYear?: (y: number) => void;
  /** Why the season is fixed, on hover, when it is. */
  seasonNote?: string;
  meta?: ReactNode;
  /** Beside the season: a view's own pickers, in the same row. */
  controls?: ReactNode;
  filter?: { value: string; onChange: (v: string) => void; placeholder: string };
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 px-5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[13px] text-ink-muted">{kicker}</span>
        <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-ink-muted" />
        <h1 className="truncate text-[14px] font-semibold tracking-[-0.005em] text-ink">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {setYear ? (
          <SeasonSwitcher year={year} onChange={setYear} />
        ) : (
          <span
            title={seasonNote}
            className="inline-flex h-[26px] cursor-default items-center rounded-md border border-dashed border-hairline px-2 text-[12.5px] font-medium text-ink-soft tabular"
          >
            {seasonLabel(year)}
          </span>
        )}
        {controls}
      </div>
      <div className="min-w-0 flex-1" />
      {meta != null && <span className="hidden shrink-0 truncate text-[12px] text-ink-muted xl:inline">{meta}</span>}
      {filter && <FilterBox {...filter} />}
    </header>
  );
}

/** The table's filter, where Ctrl+F and / land when this tab is in front. */
function FilterBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { filterRef } = useShell();
  const active = useIsActive();
  return (
    <label className="flex h-[28px] w-[240px] min-w-[150px] shrink items-center gap-1.5 rounded-md border border-hairline bg-card px-2 transition-colors focus-within:border-accent">
      <Search size={13} strokeWidth={2} className="shrink-0 text-ink-muted" />
      <input
        ref={active ? filterRef : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          if (value) onChange("");
          else e.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear filter"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange("")}
          className="grid size-[16px] shrink-0 place-items-center rounded text-ink-muted hover:text-ink"
        >
          <X size={12} strokeWidth={2.25} />
        </button>
      ) : (
        <Kbd>Ctrl F</Kbd>
      )}
    </label>
  );
}

/** Rows shaped like the table's, so the switch from loading to loaded does not jump. */
export function TableSkeleton({ rowHeight, label }: { rowHeight: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="absolute inset-0 overflow-hidden">
      <div className="h-8 border-b border-hairline" />
      {Array.from({ length: 22 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-hairline/50 px-3" style={{ height: rowHeight }}>
          <span className="skeleton h-[8px] w-[22px] rounded" />
          <span className="skeleton h-[18px] w-[18px] rounded" />
          <span className="skeleton h-[8px] rounded" style={{ width: 90 + ((i * 37) % 70) }} />
          <span className="skeleton ml-auto h-[8px] w-[46%] rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * A season that did not open, and the one thing to do about it.
 *
 * GATED SPEAKS TO WHO IS LOOKING. Signed out, the answer is to sign in, with the
 * button right there. Signed in, the account itself does not include the
 * season, and signing in again would not help, so it does not offer to.
 */
export function LoadError({
  year,
  reason,
  message,
  what,
  onRetry,
}: {
  year: number;
  reason: "gated" | "failed";
  message: string;
  what: string;
  onRetry: () => void;
}) {
  const { auth } = useAccount();

  if (reason === "gated") {
    const signedIn = auth.status === "signedIn";
    return (
      <div className="grid h-full place-content-center gap-2.5 px-6 text-center">
        <p className="text-[14px] font-medium text-ink">
          {signedIn
            ? `${what} for ${seasonLabel(year)} are part of the Season Pass.`
            : `Sign in to open ${what.toLowerCase()} for ${seasonLabel(year)}.`}
        </p>
        <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">
          {signedIn
            ? "This account can open 2024-25 and 2025-26. Every other season comes with a Season Pass on btacbb.xyz."
            : "Seasons before 2024-25 open with a Season Pass. Signing in happens in your browser."}
        </p>
        {!signedIn && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void window.bta.auth.signIn()}
            className="mx-auto mt-1.5 inline-flex h-[32px] items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            {auth.status === "waiting" ? "Finish in your browser" : "Sign in with browser"}
            <ArrowUpRight size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-full place-content-center gap-2.5 px-6 text-center">
      <p className="text-[14px] font-medium text-ink">
        {what} for {seasonLabel(year)} did not load.
      </p>
      <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mx-auto mt-1 h-7 rounded-md border border-hairline px-3 text-[12px] text-ink transition-colors hover:border-ink-muted"
      >
        Try again
      </button>
    </div>
  );
}

/** What an empty filter result says, and how to get out of it. */
export function NoMatches({ query, noun }: { query: string; noun: string }) {
  return (
    <p className="px-5 py-10 text-[13px] text-ink-muted">
      No {noun} matches &ldquo;{query.trim()}&rdquo;. <span className="text-ink-soft">Esc</span> clears the filter.
    </p>
  );
}
