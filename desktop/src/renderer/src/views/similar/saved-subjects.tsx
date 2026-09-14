import { Bookmark, BookmarkMinus, BookmarkPlus, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { savedKey, toggleSaved, useSavedSubjects, type SavedSubject, type SubjectRef } from "~/similar/saved-similar";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { Popover } from "~/ui/popover";
import { SearchList, type ListItem } from "~/ui/search-list";

/**
 * Save, beside Download: the teams and players a reader keeps coming back to.
 *
 * ONE BUTTON, ONE LIST. The top row saves the team or player on screen, or takes
 * it out; below it is every one saved, teams and players together, newest first
 * and searchable. Picking one runs Find Similar on it again.
 */
export function SavedSubjectsButton({ current, onPick }: { current: SubjectRef | null; onPick: (s: SavedSubject) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const saved = useSavedSubjects();
  const isSaved = current != null && saved.some((s) => savedKey(s) === savedKey(current));
  const currentLabel = current ? `${current.name} ${seasonLabel(current.year)}` : "";

  const items = useMemo<ListItem[]>(
    () =>
      saved.map((s) => ({
        key: savedKey(s),
        label: `${s.name} ${seasonLabel(s.year)}`,
        leading:
          s.kind === "team" ? (
            <TeamLogo id={s.logoId} name={s.name} size={18} />
          ) : (
            <PlayerPhoto bartId={s.bartId} hasPhoto={s.hasPhoto} name={s.name} size={18} />
          ),
        meta: s.kind === "team" ? "Team" : s.team,
        keywords: `${s.kind === "team" ? "team" : `player ${s.team}`} ${seasonLabel(s.year)}`,
      })),
    [saved],
  );

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={isSaved}
        title={isSaved ? `${currentLabel} is saved. Open the saved list.` : "Save this team or player, and run any saved one again"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors ${
          isSaved
            ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)] text-ink"
            : "border-hairline bg-card text-ink-soft hover:border-ink-muted hover:text-ink"
        }`}
      >
        <Bookmark size={13} strokeWidth={2} className={isSaved ? "fill-current text-accent" : ""} />
        {isSaved ? "Saved" : "Save"}
        {saved.length > 0 && <span className="text-ink-muted tabular">{saved.length}</span>}
        <ChevronDown size={13} strokeWidth={2} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={320} align="right" label="Saved">
          {current && (
            <div className="border-b border-hairline p-1">
              <button
                type="button"
                data-save-toggle=""
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleSaved(current)}
                className="flex h-[32px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-ink transition-colors hover:bg-[var(--row-hover)]"
              >
                {isSaved ? <BookmarkMinus size={14} strokeWidth={2} className="text-ink-muted" /> : <BookmarkPlus size={14} strokeWidth={2} className="text-accent" />}
                <span className="min-w-0 flex-1 truncate">{isSaved ? `Remove ${currentLabel}` : `Save ${currentLabel}`}</span>
              </button>
            </div>
          )}
          {items.length > 0 ? (
            <SearchList
              items={items}
              label="Saved teams and players"
              placeholder="Search saved"
              onPick={(key) => {
                const s = saved.find((x) => savedKey(x) === key);
                setOpen(false);
                if (s) onPick(s);
              }}
              onClose={() => setOpen(false)}
            />
          ) : (
            <p className="px-3 py-3 text-[12.5px] leading-relaxed text-ink-muted">
              Nothing saved yet. Save a team or player here, and its matches are one pick away next time.
            </p>
          )}
        </Popover>
      )}
    </>
  );
}
