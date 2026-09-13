import { useState } from "react";
import { Popover } from "~/ui/popover";

const NO_ANCHOR = { current: null };

/**
 * One line of text to name something: a workspace, for now.
 *
 * SMALL, AND WHERE THE EYE ALREADY IS: a panel near the top of the window with
 * the name selected, Enter to keep it, Esc to leave it. Not a modal dialog; a
 * click anywhere else simply leaves it.
 */
export function NamePrompt({
  title,
  initial,
  confirm,
  onDone,
  onClose,
}: {
  title: string;
  initial: string;
  confirm: string;
  onDone: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ok = value.trim().length > 0;
  return (
    <Popover anchor={NO_ANCHOR} onClose={onClose} width={300} label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onDone(value.trim());
          onClose();
        }}
        className="p-3"
      >
        <label htmlFor="name-prompt" className="block text-[12px] font-medium text-ink-soft">
          {title}
        </label>
        <input
          id="name-prompt"
          autoFocus
          value={value}
          maxLength={40}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              // Submitted from the key itself rather than left to the form.
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="mt-1.5 h-[30px] w-full rounded-md border border-hairline bg-paper px-2 text-[13px] text-ink outline-none transition-colors focus:border-accent"
        />
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            className="h-[26px] rounded-md px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ok}
            className="h-[26px] rounded-md bg-accent px-2.5 text-[12.5px] font-medium text-white transition-[filter] enabled:hover:brightness-110 disabled:opacity-40"
          >
            {confirm}
          </button>
        </div>
      </form>
    </Popover>
  );
}
