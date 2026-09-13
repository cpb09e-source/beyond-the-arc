import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { confDisplay } from "@/lib/conf-display";
import type { MatchupTeam } from "@/lib/matchup";
import { TeamLogo } from "~/ui/logo";
import { matchesQuery } from "~/ui/text";
import { logoIdOf } from "~/ui/logo-id";

const WIDTH = 348;

/**
 * The team's name, which is also the control that changes it.
 *
 * DIRECT, NOT A FORM FIELD ABOVE THE CARD. The name sits where the answer is, so
 * changing the team happens where the reader is already looking, the way a
 * Linear issue's title is its own editor. The crest beside it opens the team.
 *
 * THE LIST OPENS IN A PORTAL. The card clips its own overflow (the seam leans
 * past its edge), and a list drawn inside it would be clipped with it.
 */
export function TeamPicker({
  label,
  hotkey,
  team,
  other,
  teams,
  open,
  onOpenChange,
  onPick,
  align,
}: {
  label: string;
  hotkey: string;
  team: MatchupTeam;
  other: MatchupTeam;
  /** Every team, in picker order: strongest conference first. */
  teams: MatchupTeam[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (slug: string) => void;
  align: "left" | "right";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}, ${team.b}`}
        title={`Change the ${label.toLowerCase()}  ·  ${hotkey}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpenChange(!open)}
        className={`group -mx-1.5 flex min-w-0 max-w-[calc(100%+12px)] items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] ${
          open ? "bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]" : ""
        }`}
      >
        <span className="truncate text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink">{team.b}</span>
        <ChevronDown
          size={17}
          strokeWidth={2}
          className={`shrink-0 text-ink-muted transition-transform group-hover:text-ink-soft ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <PickerList
          anchor={triggerRef}
          align={align}
          label={label}
          team={team}
          other={other}
          teams={teams}
          onPick={onPick}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );
}

function PickerList({
  anchor,
  align,
  label,
  team,
  other,
  teams,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  align: "left" | "right";
  label: string;
  team: MatchupTeam;
  other: MatchupTeam;
  teams: MatchupTeam[];
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(team.s);
  // Placed once, from the name it hangs under. The trigger is on screen when it
  // opens, and anything that would move it (a scroll, a resize) closes the list.
  const [pos] = useState(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return { top: 120, left: 120 };
    const left = align === "right" ? r.right - WIDTH : r.left;
    return { top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8)) };
  });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
    document.getElementById(`${id}-${team.s}`)?.scrollIntoView({ block: "center" });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onScroll = (e: Event) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close.current();
    };
    const onResize = () => close.current();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // Mount only: the list opens on the team it was opened from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => teams.filter((t) => matchesQuery(query, t.b, t.n, confDisplay(t.c), t.s)),
    [teams, query],
  );
  // Typing moves the highlight to the first match; arrowing moves it from there.
  const current = filtered.some((t) => t.s === active) ? active : (filtered[0]?.s ?? null);

  const choose = (slug: string) => {
    onPick(slug);
    close.current();
  };

  const move = (to: number) => {
    const t = filtered[Math.max(0, Math.min(filtered.length - 1, to))];
    if (!t) return;
    setActive(t.s);
    document.getElementById(`${id}-${t.s}`)?.scrollIntoView({ block: "nearest" });
  };

  const rows: ReactNode[] = [];
  let conf: string | null | undefined;
  for (const t of filtered) {
    if (t.c !== conf || rows.length === 0) {
      conf = t.c;
      rows.push(
        <div
          key={`h:${t.c ?? "none"}`}
          role="presentation"
          className="sticky top-0 z-10 bg-card px-2 pb-1 pt-2 text-[11px] font-medium text-ink-muted"
        >
          {confDisplay(t.c) || "Independent"}
        </div>,
      );
    }
    const on = t.s === current;
    rows.push(
      <div
        key={t.s}
        id={`${id}-${t.s}`}
        role="option"
        aria-selected={t.s === team.s}
        onMouseMove={() => t.s !== active && setActive(t.s)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(t.s)}
        className={`flex h-[32px] cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] ${
          on ? "bg-[var(--menu-active)] text-ink" : "text-ink-soft"
        }`}
      >
        <TeamLogo id={logoIdOf(t.b)} name={t.b} size={18} />
        <span className="min-w-0 flex-1 truncate">{t.b}</span>
        {t.s === other.s && <span className="shrink-0 text-[11px] text-ink-muted">Swaps sides</span>}
        <span className="shrink-0 text-[11.5px] text-ink-muted tabular">
          {t.br != null ? `#${t.br} · ` : ""}
          {t.w}–{t.l}
        </span>
        <span className="flex w-3.5 shrink-0 justify-center">
          {t.s === team.s && <Check size={13} strokeWidth={2.25} className="text-accent" />}
        </span>
      </div>,
    );
  }

  return createPortal(
    <div
      ref={boxRef}
      className="menu-in fixed z-50 flex max-h-[min(480px,70vh)] flex-col overflow-hidden rounded-lg border border-hairline bg-card"
      style={{ top: pos.top, left: pos.left, width: WIDTH, boxShadow: "var(--overlay-shadow)" }}
    >
      <label className="flex h-[40px] shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Search size={14} strokeWidth={2} className="shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const i = filtered.findIndex((t) => t.s === current);
            if (e.key === "ArrowDown") move(i + 1);
            else if (e.key === "ArrowUp") move(i - 1);
            else if (e.key === "PageDown") move(i + 8);
            else if (e.key === "PageUp") move(i - 8);
            else if (e.key === "Enter") {
              if (current) choose(current);
            } else if (e.key === "Escape") {
              if (query) setQuery("");
              else close.current();
            } else if (e.key === "Tab") close.current();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={current ? `${id}-${current}` : undefined}
          aria-label={`Find the ${label.toLowerCase()}`}
          placeholder={`Find the ${label.toLowerCase()}`}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
        />
        <span className="shrink-0 text-[11px] text-ink-muted tabular">{filtered.length}</span>
      </label>
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1"
      >
        {filtered.length > 0 ? (
          rows
        ) : (
          <p className="px-3 py-6 text-center text-[12.5px] text-ink-muted">No team matches &ldquo;{query.trim()}&rdquo;.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
