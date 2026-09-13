import {
  ChevronDown,
  ChevronsUpDown,
  CircleUserRound,
  Download,
  ExternalLink,
  Keyboard,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ThemeMode } from "../../../preload";
import { Kbd } from "~/ui/kbd";
import { Menu, type MenuEntry, type MenuItem } from "~/ui/menu";
import type { Obj } from "~/objects/object";
import { FavoriteDropSlot } from "~/objects/object-surfaces";
import { usePersisted } from "~/ui/persisted";
import { accountInitials, useAccount } from "./account";
import type { Favorite } from "./favorites";
import { FavoritesSection } from "./favorites-section";
import { GetStarted } from "./onboarding";
import { NAV_VIEWS, type ViewDef } from "./views";
import type { Workspaces } from "./workspaces";

/**
 * The sidebar: who you are, how to find anything, and where the views are.
 *
 * DIMMER THAN THE CONTENT, on purpose (Linear's 2026 refresh made the same
 * call): it sits on the chrome ground, its rows are the secondary ink, and only
 * the view in front gets full ink and a quiet fill. The table is what the
 * reader came for.
 *
 * RESIZABLE AND COLLAPSIBLE. Drag the right edge (double-click resets it) or
 * press Ctrl+\ to hide it entirely. Sections fold, and all of it is remembered.
 */

export const SIDEBAR_DEFAULT = 232;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 340;

const item = (e: Omit<MenuItem, "kind">): MenuEntry => ({ kind: "item", ...e });

export function Sidebar({
  width,
  onResize,
  currentViewId,
  onNavigate,
  onOpenSearch,
  onOpenShortcuts,
  theme,
  setTheme,
  favorites,
  currentFavoriteId,
  onOpenFavorite,
  onRemoveFavorite,
  onRenameFavorite,
  workspaces,
  onNewWorkspace,
  onRenameWorkspace,
  onDropFavorite,
}: {
  width: number;
  onResize: (w: number) => void;
  currentViewId: string;
  onNavigate: (viewId: string, newTab: boolean) => void;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  favorites: Favorite[];
  currentFavoriteId: string | null;
  onOpenFavorite: (f: Favorite, newTab: boolean) => void;
  onRemoveFavorite: (id: string) => void;
  onRenameFavorite: (id: string, label: string) => void;
  workspaces: Workspaces;
  onNewWorkspace: () => void;
  onRenameWorkspace: () => void;
  /** Something with a page, dragged onto the sidebar: star it. */
  onDropFavorite?: (o: Obj) => void;
}) {
  const { update, version } = useAccount();
  const [folded, setFolded] = usePersisted<string[]>(
    "bta.sidebar.folded",
    [],
    (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string"),
  );

  const sections: Array<[string, ViewDef[]]> = [];
  for (const v of NAV_VIEWS) {
    const group = sections.find(([s]) => s === v.section);
    if (group) group[1].push(v);
    else sections.push([v.section, [v]]);
  }

  return (
    <nav aria-label="Workspace" className="relative flex min-h-0 shrink-0 flex-col border-r border-hairline bg-chrome" style={{ width }}>
      <div className="px-2 pt-2">
        <WorkspaceButton workspaces={workspaces} onNewWorkspace={onNewWorkspace} onRenameWorkspace={onRenameWorkspace} />
      </div>

      <div className="px-2 pb-1 pt-1.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onOpenSearch}
          className="flex h-[30px] w-full items-center gap-2 rounded-md border border-hairline bg-paper px-2 text-[12.5px] text-ink-muted transition-colors hover:border-[color-mix(in_oklab,var(--ink-muted)_45%,var(--hairline))] hover:text-ink-soft"
        >
          <Search size={14} strokeWidth={2} />
          <span className="flex-1 text-left">Search</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {onDropFavorite && <FavoriteDropSlot onDrop={onDropFavorite} />}
        {favorites.length > 0 && (
          <FavoritesSection
            favorites={favorites}
            currentId={currentFavoriteId}
            folded={folded.includes("Favorites")}
            onToggleFold={() => setFolded((f) => (f.includes("Favorites") ? f.filter((s) => s !== "Favorites") : [...f, "Favorites"]))}
            onOpen={onOpenFavorite}
            onRemove={onRemoveFavorite}
            onRename={onRenameFavorite}
          />
        )}
        {sections.map(([section, views]) => {
          // Home stands alone at the top, with no heading to fold it under.
          const headless = section === "Home";
          const isFolded = !headless && folded.includes(section);
          return (
            <div key={section} className="mb-2">
              {!headless && (
              <button
                type="button"
                aria-expanded={!isFolded}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setFolded((f) => (isFolded ? f.filter((s) => s !== section) : [...f, section]))}
                className="group flex h-[26px] w-full items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink-soft"
              >
                {section}
                <ChevronDown
                  size={12}
                  strokeWidth={2.25}
                  className={`opacity-0 transition-[opacity,rotate] group-hover:opacity-100 ${isFolded ? "-rotate-90" : ""}`}
                />
              </button>
              )}
              {!isFolded && (
                <ul className="grid gap-px">
                  {views.map((v) => {
                    const active = v.id === currentViewId;
                    const Icon = v.icon;
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          aria-current={active ? "page" : undefined}
                          title={`${v.label}  ·  Ctrl-click for a new tab`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={(e) => onNavigate(v.id, e.ctrlKey || e.metaKey)}
                          onAuxClick={(e) => {
                            if (e.button === 1) onNavigate(v.id, true);
                          }}
                          className={`flex h-[28px] w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${
                            active
                              ? "bg-[var(--nav-active)] font-[520] text-ink"
                              : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                          }`}
                        >
                          <Icon size={15} strokeWidth={2} className={active ? "text-ink-soft" : "text-ink-muted"} />
                          <span className="truncate">{v.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <GetStarted theme={theme} setTheme={setTheme} onOpenSearch={onOpenSearch} />

      <div className="border-t border-hairline px-2 pb-2 pt-1.5">
        {update.status === "ready" && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void window.bta.update.install()}
            className="mb-1.5 flex h-[30px] w-full items-center gap-2 rounded-md bg-[var(--accent-wash)] px-2 text-[12.5px] font-medium text-accent transition-[filter] hover:brightness-105"
          >
            <Download size={14} strokeWidth={2} />
            <span className="flex-1 text-left">Restart to update</span>
            <span className="text-[11px] font-normal tabular">{update.version}</span>
          </button>
        )}
        {update.status === "available" && (
          <p className="mb-1.5 px-2 text-[11.5px] text-ink-muted tabular">
            Downloading {update.version} · {update.percent}%
          </p>
        )}
        <div className="flex items-center gap-1">
          <AccountButton theme={theme} setTheme={setTheme} onOpenShortcuts={onOpenShortcuts} version={version} />
          <button
            type="button"
            aria-label="Keyboard shortcuts"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpenShortcuts}
            title="Keyboard shortcuts  ?"
            className="grid size-[30px] shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            <Keyboard size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      <ResizeHandle width={width} onResize={onResize} />
    </nav>
  );
}

/**
 * Top of the sidebar: which set of tabs this is, and the others. The mark and
 * name change when you switch, the way Linear and Notion head their sidebars.
 */
function WorkspaceButton({
  workspaces,
  onNewWorkspace,
  onRenameWorkspace,
}: {
  workspaces: Workspaces;
  onNewWorkspace: () => void;
  onRenameWorkspace: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const entries: MenuEntry[] = [
    { kind: "heading", id: "workspaces", label: "Workspaces" },
    ...workspaces.list.map((w) =>
      item({
        id: `ws-${w.id}`,
        label: w.name,
        icon: <WorkspaceMark name={w.name} size={16} />,
        checked: w.id === workspaces.current.id,
        onSelect: () => workspaces.switchTo(w.id),
      }),
    ),
    { kind: "separator", id: "s0" },
    item({ id: "ws-new", label: "New workspace…", icon: <Plus size={14} />, onSelect: onNewWorkspace }),
    item({ id: "ws-rename", label: `Rename ${workspaces.current.name}…`, icon: <Pencil size={14} />, onSelect: onRenameWorkspace }),
    ...(workspaces.list.length > 1
      ? [
          item({
            id: "ws-delete",
            label: `Delete ${workspaces.current.name}`,
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => workspaces.remove(workspaces.current.id),
          }),
        ]
      : []),
  ];

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[34px] w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-[var(--row-hover)] ${open ? "bg-[var(--row-hover)]" : ""}`}
      >
        <WorkspaceMark name={workspaces.current.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{workspaces.current.name}</span>
        <ChevronDown size={13} strokeWidth={2.25} className="shrink-0 text-ink-muted" />
      </button>
      {open && (
        <Menu
          label="Workspaces"
          entries={entries}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          className="absolute left-0 top-[calc(100%+4px)] w-[268px]"
        />
      )}
    </div>
  );
}

/**
 * Bottom left: who is reading, on what plan, and everything about the account
 * and the app itself (theme, shortcuts, updates, signing in and out). Slack,
 * Discord and Notion's desktop apps keep the person here; the menu opens upward.
 */
function AccountButton({
  theme,
  setTheme,
  onOpenShortcuts,
  version,
}: {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  onOpenShortcuts: () => void;
  version: string | null;
}) {
  const { auth, update } = useAccount();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signedIn = auth.status === "signedIn";
  const email = signedIn ? auth.user.email : null;
  const isAdmin = signedIn && auth.user.role === "admin";
  const name = email ? email.split("@")[0]! : "Not signed in";
  const plan = signedIn ? (isAdmin ? "Administrator" : "Season Pass") : auth.status === "waiting" ? "Signing in…" : "Free seasons only";

  const entries: MenuEntry[] = [
    {
      kind: "custom",
      id: "who",
      node: (
        <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
          <Avatar initials={accountInitials(auth)} size={30} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{email ?? "Not signed in"}</p>
            <p className="text-[11.5px] text-ink-muted">{plan}</p>
          </div>
        </div>
      ),
    },
    { kind: "separator", id: "s0" },
    ...(signedIn
      ? [
          item({
            id: "account",
            label: "Account and billing",
            icon: <CircleUserRound size={14} />,
            hint: <ExternalLink size={12} />,
            onSelect: () => void window.open("https://btacbb.xyz/account/"),
          }),
        ]
      : []),
    ...(isAdmin
      ? [
          item({
            id: "admin",
            label: "Admin dashboard",
            icon: <ShieldCheck size={14} />,
            hint: <ExternalLink size={12} />,
            onSelect: () => void window.open("https://btacbb.xyz/admin/"),
          }),
        ]
      : []),
    ...(signedIn ? [{ kind: "separator", id: "s1" } as MenuEntry] : []),
    { kind: "heading", id: "theme", label: "Theme" },
    item({ id: "theme-system", label: "Match system", icon: <Monitor size={14} />, checked: theme === "system", onSelect: () => setTheme("system") }),
    item({ id: "theme-light", label: "Light", icon: <Sun size={14} />, checked: theme === "light", onSelect: () => setTheme("light") }),
    item({ id: "theme-dark", label: "Dark", icon: <Moon size={14} />, checked: theme === "dark", onSelect: () => setTheme("dark") }),
    { kind: "separator", id: "s2" },
    item({ id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={14} />, hint: <Kbd>?</Kbd>, onSelect: onOpenShortcuts }),
    update.status === "ready"
      ? item({
          id: "update",
          label: `Restart to update to ${update.version}`,
          icon: <Download size={14} />,
          onSelect: () => void window.bta.update.install(),
        })
      : item({
          id: "update",
          label: update.status === "checking" ? "Checking for updates…" : "Check for updates",
          icon: <RefreshCw size={14} />,
          hint: version ? <span className="tabular">v{version}</span> : undefined,
          disabled: update.status === "checking",
          onSelect: () => void window.bta.update.check(),
        }),
    { kind: "separator", id: "s3" },
    signedIn
      ? item({ id: "sign-out", label: "Sign out", icon: <LogOut size={14} />, onSelect: () => void window.bta.auth.signOut() })
      : item({ id: "sign-in", label: "Sign in with browser", icon: <LogIn size={14} />, onSelect: () => void window.bta.auth.signIn() }),
  ];

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[40px] w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-[var(--row-hover)] ${open ? "bg-[var(--row-hover)]" : ""}`}
      >
        <Avatar initials={accountInitials(auth)} size={26} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-medium text-ink">{name}</span>
          <span className={`block truncate text-[11px] ${isAdmin ? "text-accent" : "text-ink-muted"}`}>{plan}</span>
        </span>
        <ChevronsUpDown size={13} strokeWidth={2.25} className="shrink-0 text-ink-muted" />
      </button>
      {open && (
        <Menu
          label="Account"
          entries={entries}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          className="absolute bottom-[calc(100%+6px)] left-0 w-[268px]"
        />
      )}
    </div>
  );
}

function Avatar({ initials, size }: { initials: string; size: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-[var(--accent-wash)] font-semibold text-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** A workspace's mark: its first letter on a square, the shape a workspace wears in Linear and Notion. */
function WorkspaceMark({ name, size }: { name: string; size: number }) {
  const letter = name.trim().charAt(0).toUpperCase() || "W";
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[5px] bg-ink font-semibold text-paper"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {letter}
    </span>
  );
}

function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, width };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    onResize(Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, s.width + e.clientX - s.x))));
  };
  const up = () => {
    start.current = null;
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onResize(SIDEBAR_DEFAULT)}
      className="group absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize"
    >
      <span
        className={`absolute left-[2px] top-0 h-full w-[2px] transition-colors ${
          dragging ? "bg-accent" : "bg-transparent group-hover:bg-[color-mix(in_oklab,var(--accent)_55%,transparent)]"
        }`}
      />
    </div>
  );
}
