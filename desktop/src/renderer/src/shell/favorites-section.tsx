import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { CoachAvatar } from "~/ui/coach-avatar";
import type { Favorite } from "./favorites";
import { viewById } from "./views";

/**
 * Favorites, at the top of the sidebar, as Linear, Attio and Notion all put
 * them: the places this reader keeps going back to, above the places every
 * reader has.
 *
 * Click goes there (Ctrl-click in a new tab), double-click renames, × removes.
 * The season sits at the end of the row and gives way to × on hover.
 */
export function FavoritesSection({
  favorites,
  currentId,
  folded,
  onToggleFold,
  onOpen,
  onRemove,
  onRename,
}: {
  favorites: Favorite[];
  currentId: string | null;
  folded: boolean;
  onToggleFold: () => void;
  onOpen: (f: Favorite, newTab: boolean) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={!folded}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleFold}
        className="group flex h-[26px] w-full items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink-soft"
      >
        Favorites
        <ChevronDown
          size={12}
          strokeWidth={2.25}
          className={`opacity-0 transition-[opacity,rotate] group-hover:opacity-100 ${folded ? "-rotate-90" : ""}`}
        />
      </button>
      {!folded && (
        <ul className="grid gap-px">
          {favorites.map((f) => {
            const view = viewById(f.viewId);
            const Icon = view.icon;
            const active = f.id === currentId;
            return (
              <li key={f.id} className="group relative">
                {editing === f.id ? (
                  <input
                    autoFocus
                    defaultValue={f.label}
                    aria-label="Favorite name"
                    spellCheck={false}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      onRename(f.id, e.currentTarget.value);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      // Stopped here: Enter also opens the focused row of a table behind the sidebar.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    className="h-[28px] w-full rounded-md border border-accent bg-paper px-2 text-[13px] text-ink outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    title={`${f.label}  ·  ${view.seasonless ? view.label : `${view.label}, ${seasonLabel(f.year)}`}  ·  double-click to rename`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => onOpen(f, e.ctrlKey || e.metaKey)}
                    onAuxClick={(e) => {
                      if (e.button === 1) onOpen(f, true);
                    }}
                    onDoubleClick={() => setEditing(f.id)}
                    className={`flex h-[28px] w-full items-center gap-2.5 rounded-md pl-2 pr-2 text-[13px] transition-colors ${
                      active ? "bg-[var(--nav-active)] font-[520] text-ink" : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                    }`}
                  >
                    <span className="grid w-[15px] shrink-0 place-items-center">
                      {f.record?.kind === "team" ? (
                        <TeamLogo id={f.record.logoId} name={f.record.name} size={15} />
                      ) : f.record?.kind === "player" ? (
                        <PlayerPhoto bartId={f.record.bartId} hasPhoto={f.record.hasPhoto} name={f.record.name} size={16} />
                      ) : f.record?.kind === "coach" ? (
                        <CoachAvatar name={f.record.name} team={f.record.team} size={16} />
                      ) : f.record?.kind === "game" ? (
                        <span className="flex items-center">
                          <TeamLogo id={f.record.awayLogo} name={f.record.away} size={12} />
                          <span className="-ml-1">
                            <TeamLogo id={f.record.homeLogo} name={f.record.home} size={12} />
                          </span>
                        </span>
                      ) : (
                        <Icon size={15} strokeWidth={2} className={active ? "text-ink-soft" : "text-ink-muted"} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{f.label}</span>
                    {!view.seasonless && (
                      <span className="shrink-0 text-[11px] text-ink-muted tabular transition-opacity group-hover:opacity-0">
                        {seasonLabel(f.year).slice(2)}
                      </span>
                    )}
                  </button>
                )}
                {editing !== f.id && (
                  <button
                    type="button"
                    aria-label={`Remove ${f.label} from favorites`}
                    title="Remove from favorites"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onRemove(f.id)}
                    className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X size={12} strokeWidth={2.25} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
