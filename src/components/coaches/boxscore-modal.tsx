"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TeamName } from "@/components/team-name";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { dataUrl } from "@/lib/data-url";
import { SeedChip } from "./seed-chip";
import { NbaBadge } from "./nba-badge";

type Draftee = { year: number; pick: number | null; team: string | null; college: string | null };
let DRAFTEES_CACHE: Record<string, Draftee> | null = null;
let DRAFTEES_FETCH: Promise<Record<string, Draftee>> | null = null;
function loadDraftees(): Promise<Record<string, Draftee>> {
  if (DRAFTEES_CACHE) return Promise.resolve(DRAFTEES_CACHE);
  if (DRAFTEES_FETCH) return DRAFTEES_FETCH;
  DRAFTEES_FETCH = fetch("/data/nba-draftees.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { DRAFTEES_CACHE = j; return j; })
    .catch(() => ({}));
  return DRAFTEES_FETCH;
}

// Tournament box-scores are scraped from SR which doesn't carry bart_player_ids.
// To make player names link to profile pages, we resolve names → bartIds via a
// pre-built index. Both helpers are module-scoped so the fetches happen once
// per page session regardless of how many modals open. Keys match the format
// emitted by scripts/emit-tournament-bart-index.mjs and scripts/emit-profileable-ids.mjs.
let BART_INDEX_CACHE: Record<string, number> | null = null;
let BART_INDEX_FETCH: Promise<Record<string, number>> | null = null;
function loadBartIndex(): Promise<Record<string, number>> {
  if (BART_INDEX_CACHE) return Promise.resolve(BART_INDEX_CACHE);
  if (BART_INDEX_FETCH) return BART_INDEX_FETCH;
  BART_INDEX_FETCH = fetch("/data/tournament-bart-index.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { BART_INDEX_CACHE = j; return j; })
    .catch(() => ({}));
  return BART_INDEX_FETCH;
}
let PROFILEABLE_CACHE: Set<number> | null = null;
let PROFILEABLE_FETCH: Promise<Set<number>> | null = null;
function loadProfileableIds(): Promise<Set<number>> {
  if (PROFILEABLE_CACHE) return Promise.resolve(PROFILEABLE_CACHE);
  if (PROFILEABLE_FETCH) return PROFILEABLE_FETCH;
  PROFILEABLE_FETCH = fetch("/data/profileable-ids.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((arr: number[]) => { PROFILEABLE_CACHE = new Set(arr); return PROFILEABLE_CACHE; })
    .catch(() => new Set<number>());
  return PROFILEABLE_FETCH;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    // Strip generational suffixes ("Jr.", "Sr.", "II", "III", "IV") so
    // "Walter Clayton Jr." matches SR's "Walter Clayton".
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}

// Aggressive team-name normalization for the bart-index lookup. Strips ALL
// non-alphanumerics so "St. John's (NY)" and "St John's NY" collapse to the
// same key. Mirrors the normTeam() used in emit-tournament-bart-index.mjs.
function normTeamForIndex(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

type Player = {
  name: string;
  starter: boolean;
  mp: string | null;
  fg: number | null; fga: number | null;
  fg3: number | null; fg3a: number | null;
  ft: number | null; fta: number | null;
  orb: number | null; drb: number | null; trb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null; pts: number | null;
};
type Team = {
  slug: string;
  name: string;
  seed: number | null;
  score: number | null;
  line: number[] | null;
  players: Player[];
};
type BoxScore = {
  year: number;
  round: string;
  date: string | null;
  venue: string | null;
  attendance: string | null;
  teams: Team[];
};

/**
 * Modal showing the full box score for a single NCAA Tournament game.
 *
 * Mirrors the player-game-log modal in style: dim-overlay + centered card,
 * click outside or Esc to close, lazy-fetches the per-game JSON on open.
 *
 * Data lives at /data/tournament-box/<year>/<slug>.json — scraped by
 * scripts/scrape-tournament-boxscores.mjs. Falls back to a friendly
 * "data not loaded yet" message if the file isn't there.
 */
export function BoxscoreModal({
  open,
  onClose,
  year,
  gameSlug,
  sportsRefHref,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  gameSlug: string;
  /** External SR link, shown as a fallback when our local data isn't loaded yet. */
  sportsRefHref: string;
}) {
  const [data, setData] = useState<BoxScore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draftees, setDraftees] = useState<Record<string, Draftee>>({});
  const [bartIndex, setBartIndex] = useState<Record<string, number>>({});
  const [profileableIds, setProfileableIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    setData(null);
    setErr(null);
    let cancelled = false;
    fetch(dataUrl(`/data/tournament-box/${year}/${gameSlug}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: BoxScore) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    loadDraftees().then((d) => { if (!cancelled) setDraftees(d); });
    loadBartIndex().then((idx) => { if (!cancelled) setBartIndex(idx); });
    loadProfileableIds().then((s) => { if (!cancelled) setProfileableIds(s); });
    return () => { cancelled = true; };
  }, [open, year, gameSlug]);

  // Esc closes; scroll lock while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Box score"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[6vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-lg shadow-xl w-full max-w-5xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {err ? (
          <FallbackHeader err={err} sportsRefHref={sportsRefHref} onClose={onClose} />
        ) : !data ? (
          <LoadingHeader onClose={onClose} />
        ) : (
          <Body
            data={data}
            draftees={draftees}
            bartIndex={bartIndex}
            profileableIds={profileableIds}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function LoadingHeader({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <span className="text-sm text-ink-muted">Loading box score…</span>
        <CloseButton onClose={onClose} />
      </div>
      <div className="h-40 flex items-center justify-center text-ink-muted text-sm">…</div>
    </>
  );
}

function FallbackHeader({
  err, sportsRefHref, onClose,
}: { err: string; sportsRefHref: string; onClose: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <span className="text-sm text-ink-soft">Box score not loaded yet</span>
        <CloseButton onClose={onClose} />
      </div>
      <div className="px-6 py-8 text-sm text-ink-muted space-y-3">
        <p>We&apos;re still pulling box scores into the site. Until that pass completes for this game, the full data isn&apos;t in our local cache.</p>
        <p className="text-xs text-ink-muted/80">Error: {err}</p>
        <p>
          <a href={sportsRefHref} target="_blank" rel="noopener noreferrer" className="text-coral hover:underline">
            View full box score on Sports Reference →
          </a>
        </p>
      </div>
    </>
  );
}

function Body({
  data, draftees, bartIndex, profileableIds, onClose,
}: {
  data: BoxScore;
  draftees: Record<string, Draftee>;
  bartIndex: Record<string, number>;
  profileableIds: Set<number>;
  onClose: () => void;
}) {
  const [home, away] = data.teams; // SR returns winner first in our scrape; order doesn't matter for display
  // Sort: visually put the higher-scoring team second (visual rhythm — "vs.")
  // Actually SR's bracket-page order is fine: winner first. Keep that.
  void away;
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-widest text-ink font-bold">
            {seasonLabel(data.year)} · {data.round}
          </span>
          <span className="text-xs text-ink-soft tabular mt-0.5">
            {formatDate(data.date)}{data.venue ? ` · ${data.venue}` : ""}
          </span>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      {/* Score line — team left | scores+halves center | team right */}
      <ScoreLine teams={data.teams} />

      {/* Box score tables — stacked vertically, both teams full-width. */}
      <div className="divide-y divide-hairline max-h-[60vh] overflow-y-auto overscroll-contain">
        {data.teams.map((t) => (
          <div key={t.slug} className="p-4">
            <div className="flex items-center gap-2 px-2 pb-2">
              {t.seed !== null && <SeedChip seed={t.seed} size="sm" />}
              <TeamLogo name={t.name} size={20} />
              <span className="font-medium text-ink text-sm">
                <TeamName name={t.name} /> <span className="text-ink-muted">–</span> {t.score ?? "—"}
              </span>
            </div>
            <div className="overflow-x-auto overscroll-x-contain touch-pan-x">
              <PlayerTable
                players={t.players}
                draftees={draftees}
                teamName={t.name}
                year={data.year}
                bartIndex={bartIndex}
                profileableIds={profileableIds}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {data.attendance && (
        <div className="px-6 py-3 border-t border-hairline text-xs text-ink-muted">
          Attendance: {data.attendance}
        </div>
      )}
    </>
  );
}

/**
 * Score block — three columns: team on the left, big final scores in the
 * middle, team on the right. Beneath the big score, a compact line-score
 * table (logo + 1H + 2H + T) shows the per-half splits.
 */
function ScoreLine({ teams }: { teams: Team[] }) {
  if (teams.length < 2) return null;
  const [a, b] = teams;
  const lineLen = Math.max(a!.line?.length ?? 0, b!.line?.length ?? 0);
  return (
    <div className="px-6 py-5 border-b border-hairline">
      <div className="flex items-center">
        {/* Left team */}
        <TeamHeader team={a!} align="right" />
        {/* Big middle score */}
        <div className="flex items-center gap-3 font-display text-5xl tabular text-ink leading-none mx-6 lg:mx-10 shrink-0">
          <span>{a!.score ?? "—"}</span>
          <span className="text-ink-muted/50">–</span>
          <span>{b!.score ?? "—"}</span>
        </div>
        {/* Right team */}
        <TeamHeader team={b!} align="left" />
      </div>
      {/* Compact line score below */}
      {lineLen > 0 && (
        <div className="flex justify-center mt-4">
          <table className="text-xs tabular">
            <thead>
              <tr className="text-ink-muted">
                <th></th>
                {Array.from({ length: lineLen }).map((_, i) => (
                  <th key={i} className="px-2 text-[0.55rem] uppercase tracking-widest font-medium text-center w-8">
                    {periodLabel(i, lineLen)}
                  </th>
                ))}
                <th className="pl-3 text-[0.55rem] uppercase tracking-widest font-medium text-center w-8">T</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.slug}>
                  <td className="pr-2 py-0.5">
                    <TeamLogo name={t.name} size={18} />
                  </td>
                  {Array.from({ length: lineLen }).map((_, i) => (
                    <td key={i} className="px-2 py-0.5 text-center text-ink-soft">
                      {t.line?.[i] ?? "—"}
                    </td>
                  ))}
                  <td className="pl-3 py-0.5 text-center font-medium text-ink">
                    {t.score ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamHeader({ team, align }: { team: Team; align: "left" | "right" }) {
  const order = align === "right" ? "flex-row" : "flex-row-reverse";
  const textAlign = align === "right" ? "text-right" : "text-left";
  // Align the seed bubble to the edge ADJACENT to the score column (so it
  // sits next to the team name where the "#1 SEED" text used to be, not at
  // the far outside edge of the modal).
  const seedJustify = align === "right" ? "justify-end" : "justify-start";
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-3 ${order}`}>
      <div className={`flex-1 min-w-0 ${textAlign}`}>
        {team.seed !== null && (
          <div className={`flex ${seedJustify} mb-1.5`}>
            <SeedChip seed={team.seed} size="sm" />
          </div>
        )}
        <div className="font-display text-2xl text-ink truncate"><TeamName name={team.name} /></div>
      </div>
      <TeamLogo name={team.name} size={48} />
    </div>
  );
}

function PlayerTable({
  players, draftees, teamName, year, bartIndex, profileableIds,
}: {
  players: Player[];
  draftees: Record<string, Draftee>;
  teamName: string;
  year: number;
  bartIndex: Record<string, number>;
  profileableIds: Set<number>;
}) {
  const normTeam = normTeamForIndex(teamName);
  if (players.length === 0) {
    return <div className="text-xs text-ink-muted px-2 py-6 text-center">No player stats in our cache for this game.</div>;
  }
  // Total minutes — `mp` is a string like "37" or "37:12" from SR. Parse the
  // leading integer; ignore the seconds component for a whole-minute total
  // (matches how Bart/SR display per-team totals).
  const totalMins = players.reduce((sum, p) => {
    if (!p.mp) return sum;
    const m = /^\d+/.exec(p.mp);
    return m ? sum + parseInt(m[0], 10) : sum;
  }, 0);
  // Compute team totals — summed across all players in the table.
  const totals = players.reduce(
    (acc, p) => ({
      fg: acc.fg + (p.fg ?? 0),
      fga: acc.fga + (p.fga ?? 0),
      fg3: acc.fg3 + (p.fg3 ?? 0),
      fg3a: acc.fg3a + (p.fg3a ?? 0),
      ft: acc.ft + (p.ft ?? 0),
      fta: acc.fta + (p.fta ?? 0),
      orb: acc.orb + (p.orb ?? 0),
      trb: acc.trb + (p.trb ?? 0),
      ast: acc.ast + (p.ast ?? 0),
      stl: acc.stl + (p.stl ?? 0),
      blk: acc.blk + (p.blk ?? 0),
      tov: acc.tov + (p.tov ?? 0),
      pf: acc.pf + (p.pf ?? 0),
      pts: acc.pts + (p.pts ?? 0),
    }),
    { fg: 0, fga: 0, fg3: 0, fg3a: 0, ft: 0, fta: 0, orb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pts: 0 },
  );
  function pct(made: number, att: number): string {
    if (att === 0) return "—";
    return `${Math.round((made / att) * 100)}%`;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-ink-muted">
          <Th className="pl-2">Player</Th>
          <Th right>MIN</Th>
          <Th right>PTS</Th>
          <Th right>FG</Th>
          <Th right>3P</Th>
          <Th right>FT</Th>
          <Th right>REB</Th>
          <Th right>AST</Th>
          <Th right>STL</Th>
          <Th right>BLK</Th>
          <Th right>ORB</Th>
          <Th right>TO</Th>
          <Th right className="pr-2">PF</Th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => {
          // Visual divider between starters and bench: render a thin border under
          // the last starter row.
          const isLastStarter = p.starter && (players[i + 1]?.starter === false);
          return (
            <tr
              key={`${p.name}-${i}`}
              className={`tabular hover:bg-paper-deep/50 ${isLastStarter ? "border-b border-hairline/60" : ""} ${p.starter ? "font-medium" : ""}`}
            >
              <td className="py-1 pl-2 text-ink truncate max-w-[20ch]" title={p.name}>
                {(() => {
                  const bartId = bartIndex[`${year}|${normTeam}|${normName(p.name)}`];
                  const clickable = bartId != null && profileableIds.has(bartId);
                  return clickable ? (
                    <Link href={`/players/${bartId}/`} className="hover:text-coral transition-colors">
                      {p.name}
                    </Link>
                  ) : (
                    p.name
                  );
                })()}
                {draftees[normName(p.name)] && (
                  <NbaBadge
                    year={draftees[normName(p.name)]!.year}
                    pick={draftees[normName(p.name)]!.pick}
                    team={draftees[normName(p.name)]!.team}
                  />
                )}
              </td>
              <Td>{p.mp ?? "—"}</Td>
              <Td className="font-medium text-ink">{cell(p.pts)}</Td>
              <Td>{cell(p.fg)}-{cell(p.fga)}</Td>
              <Td>{cell(p.fg3)}-{cell(p.fg3a)}</Td>
              <Td>{cell(p.ft)}-{cell(p.fta)}</Td>
              <Td>{cell(p.trb)}</Td>
              <Td>{cell(p.ast)}</Td>
              <Td>{cell(p.stl)}</Td>
              <Td>{cell(p.blk)}</Td>
              <Td>{cell(p.orb)}</Td>
              <Td>{cell(p.tov)}</Td>
              <Td className="pr-2">{cell(p.pf)}</Td>
            </tr>
          );
        })}
        {/* Team totals — bold; FG/3P/FT show count over % on two lines. */}
        <tr className="tabular border-t border-hairline font-bold text-ink align-top">
          <td className="py-1.5 pl-2 text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Team Totals</td>
          <Td className="text-ink">{totalMins || "—"}</Td>
          <Td className="font-display text-ink">{totals.pts}</Td>
          <td className="text-right py-1 text-ink leading-tight">
            <div>{totals.fg}-{totals.fga}</div>
            <div className="text-[0.65rem] text-ink-muted font-medium">{pct(totals.fg, totals.fga)}</div>
          </td>
          <td className="text-right py-1 text-ink leading-tight">
            <div>{totals.fg3}-{totals.fg3a}</div>
            <div className="text-[0.65rem] text-ink-muted font-medium">{pct(totals.fg3, totals.fg3a)}</div>
          </td>
          <td className="text-right py-1 text-ink leading-tight">
            <div>{totals.ft}-{totals.fta}</div>
            <div className="text-[0.65rem] text-ink-muted font-medium">{pct(totals.ft, totals.fta)}</div>
          </td>
          <Td className="text-ink">{totals.trb}</Td>
          <Td className="text-ink">{totals.ast}</Td>
          <Td className="text-ink">{totals.stl}</Td>
          <Td className="text-ink">{totals.blk}</Td>
          <Td className="text-ink">{totals.orb}</Td>
          <Td className="text-ink">{totals.tov}</Td>
          <Td className="text-ink pr-2">{totals.pf}</Td>
        </tr>
      </tbody>
    </table>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="w-7 h-7 inline-flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-paper-deep transition-colors text-lg"
    >
      ×
    </button>
  );
}

function Th({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={`text-[0.6rem] uppercase tracking-widest font-medium pb-1 ${right ? "text-right" : ""} ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`text-right py-1 text-ink-soft ${className}`}>{children}</td>;
}
function cell(v: number | null): string {
  return v === null ? "—" : String(v);
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function formatDate(iso: string | null): string {
  if (!iso) return "";
  // Parse YYYY-MM-DD without timezone shifts.
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${d}, ${y}`;
}
function periodLabel(i: number, total: number): string {
  // 2 = halves: 1H 2H. 3+ = halves + OT.
  if (total === 2) return i === 0 ? "1H" : "2H";
  if (i === 0) return "1H";
  if (i === 1) return "2H";
  return `OT${total > 3 ? i - 1 : ""}`;
}
