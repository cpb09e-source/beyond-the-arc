"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";

// Compact-keyed entries from /data/search-index.json (kept short to shrink the
// wire payload — see scripts/build-search-index.mjs for the writer).
type TeamEntry = { t: "t"; n: string; s: string; c: string | null };
type CoachEntry = { t: "c"; n: string; s: string; tm: string; a: 0 | 1 };
type PlayerEntry = { t: "p"; n: string; b: number; tm: string; y: number };
type Entry = TeamEntry | CoachEntry | PlayerEntry;

function urlFor(e: Entry): string {
  if (e.t === "t") return `/teams/${e.s}/`;
  if (e.t === "c") return `/coaches/${e.s}/`;
  return `/players/${e.b}/`;
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

/**
 * Navbar search — renders both the trigger button (styled to match the
 * existing navbar slot) and the modal. ⌘K / Ctrl+K toggles open. Lazy-loads
 * the ~420 KB search index on first open and caches it for the session.
 */
export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Reset query + cursor when closed.
  useEffect(() => {
    if (!open) { setQuery(""); setActiveIdx(0); }
    else requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Lock scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Lazy-load index on first open.
  useEffect(() => {
    if (!open || index || loadErr) return;
    fetch("/data/search-index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((arr: Entry[]) => setIndex(arr))
      .catch((e) => setLoadErr(e.message));
  }, [open, index, loadErr]);

  const { teams, coaches, players } = useMemo(() => {
    if (!index) return { teams: [] as TeamEntry[], coaches: [] as CoachEntry[], players: [] as PlayerEntry[] };
    const q = query.trim().toLowerCase();
    if (!q) return { teams: [], coaches: [], players: [] };
    const teams: TeamEntry[] = [];
    const coaches: CoachEntry[] = [];
    const players: PlayerEntry[] = [];
    for (const e of index) {
      if (!e.n.toLowerCase().includes(q)) continue;
      if (e.t === "t" && teams.length < 6) teams.push(e);
      else if (e.t === "c" && coaches.length < 8) coaches.push(e);
      else if (e.t === "p" && players.length < 12) players.push(e);
      if (teams.length >= 6 && coaches.length >= 8 && players.length >= 12) break;
    }
    return { teams, coaches, players };
  }, [index, query]);

  const flat: Entry[] = useMemo(() => [...teams, ...coaches, ...players], [teams, coaches, players]);

  // Clamp active index when results shrink.
  useEffect(() => {
    setActiveIdx((i) => Math.max(0, Math.min(i, flat.length - 1)));
  }, [flat.length]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const pick = flat[activeIdx];
      if (pick) { router.push(urlFor(pick)); setOpen(false); }
    }
  }

  function pick(e: Entry) {
    router.push(urlFor(e));
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        className="hidden md:inline-flex items-center gap-2 text-xs uppercase tracking-widest text-coral hover:text-coral-soft hover:border-coral/40 font-medium border border-hairline rounded px-3 py-1.5 transition-colors"
      >
        <kbd className="hidden lg:inline-flex items-center gap-1 text-[0.65rem] text-ink-muted font-mono normal-case">
          <span>⌘</span><span>K</span>
        </kbd>
        Search
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal
          aria-label="Search teams and players"
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/15 backdrop-blur-sm p-4 pt-[10vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card border border-hairline rounded-lg shadow-xl w-full max-w-xl max-h-[75vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-hairline">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
                onKeyDown={onKeyDown}
                placeholder="Search teams, coaches, and players…"
                className="w-full h-14 px-5 text-base bg-transparent text-ink placeholder:text-ink-muted focus:outline-none"
              />
            </div>

            <div ref={listRef} className="overflow-y-auto flex-1">
              {loadErr ? (
                <div className="px-5 py-10 text-center text-ink-muted text-sm">
                  Couldn&apos;t load search index: {loadErr}
                </div>
              ) : !index ? (
                <div className="px-5 py-10 text-center text-ink-muted text-sm">Loading…</div>
              ) : !query.trim() ? (
                <div className="px-5 py-10 text-center text-ink-muted text-sm">
                  Type to search teams, coaches, and players.
                </div>
              ) : flat.length === 0 ? (
                <div className="px-5 py-10 text-center text-ink-muted text-sm">No matches for &ldquo;{query}&rdquo;</div>
              ) : (
                <>
                  {teams.length > 0 && (
                    <GroupLabel>Teams</GroupLabel>
                  )}
                  {teams.map((e) => {
                    const isActive = flat[activeIdx] === e;
                    return (
                      <Row key={`t-${e.s}`} active={isActive} onClick={() => pick(e)}>
                        <TeamLogo name={e.n} size={20} />
                        <span className="text-ink font-medium">{e.n}</span>
                        {e.c && <span className="text-ink-muted text-xs ml-auto">{e.c}</span>}
                      </Row>
                    );
                  })}

                  {coaches.length > 0 && (
                    <GroupLabel>Coaches</GroupLabel>
                  )}
                  {coaches.map((e) => {
                    const isActive = flat[activeIdx] === e;
                    return (
                      <Row key={`c-${e.s}`} active={isActive} onClick={() => pick(e)}>
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-paper-deep text-[0.55rem] uppercase tracking-widest font-medium text-ink-muted">
                          {initials(e.n)}
                        </span>
                        <span className="text-ink font-medium">{e.n}</span>
                        <span className="text-ink-muted text-xs ml-auto tabular flex items-center gap-1.5">
                          {e.a === 1 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral" aria-label="Active" />}
                          {e.tm}
                        </span>
                      </Row>
                    );
                  })}

                  {players.length > 0 && (
                    <GroupLabel>Players</GroupLabel>
                  )}
                  {players.map((e) => {
                    const isActive = flat[activeIdx] === e;
                    return (
                      <Row key={`p-${e.b}`} active={isActive} onClick={() => pick(e)}>
                        <PlayerPhoto bartPlayerId={e.b} name={e.n} size={24} />
                        <span className="text-ink font-medium">{e.n}</span>
                        <span className="text-ink-muted text-xs ml-auto tabular">
                          {e.tm} · {seasonLabel(e.y)}
                        </span>
                      </Row>
                    );
                  })}
                </>
              )}
            </div>

            <div className="border-t border-hairline px-5 py-2 text-[0.65rem] text-ink-muted flex items-center justify-between">
              <span className="flex items-center gap-3">
                <Hint k="↑↓">navigate</Hint>
                <Hint k="↵">open</Hint>
                <Hint k="Esc">close</Hint>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 border border-hairline rounded font-mono">⌘K</kbd>
                <span>to toggle</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pt-3 pb-1 text-[0.6rem] uppercase tracking-widest text-coral font-medium">
      {children}
    </div>
  );
}
function Row({
  children, active, onClick,
}: {
  children: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-2 flex items-center gap-3 transition-colors ${active ? "bg-paper-deep" : "hover:bg-paper-deep/50"}`}
    >
      {children}
    </button>
  );
}
function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 border border-hairline rounded font-mono">{k}</kbd>
      <span>{children}</span>
    </span>
  );
}
