"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TeamName } from "@/components/team-name";
import { NbaBadge } from "@/components/coaches/nba-badge";
import { loadNbaDraftees, normNbaName, type NbaDraftee } from "@/lib/nba-draftees";
import type { GameLog } from "@/lib/static-data";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { cn } from "@/lib/utils";

// Lazy-loaded set of bart_player_ids that have a profile page. Fetched once
// per page session from /data/profileable-ids.json (~103 KB). We resolve the
// fetch promise eagerly on first modal open so the box score's player names
// link out instead of showing as plain text. See scripts/emit-profileable-ids.mjs.
let _profileableIdsPromise: Promise<Set<number>> | null = null;
function loadProfileableIds(): Promise<Set<number>> {
  if (_profileableIdsPromise) return _profileableIdsPromise;
  _profileableIdsPromise = fetch("/data/profileable-ids.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((arr: number[]) => new Set(arr))
    .catch(() => new Set<number>());
  return _profileableIdsPromise;
}

// Name+team+year → bart_id fallback lookup. Needed because cbb_-keyed players
// (RJ Barrett, Vernon Carey Jr., Hamidou Diallo, etc. — players whose CBB
// rows didn't auto-join to a Bart profile) have `bart_id: null` in the box-
// score row, but a Bart profile DOES exist for many of them. Resolving by
// name lets us link them through. Source: scripts/emit-tournament-bart-index.mjs.
let _bartIndexPromise: Promise<Record<string, number>> | null = null;
function loadBartIndex(): Promise<Record<string, number>> {
  if (_bartIndexPromise) return _bartIndexPromise;
  _bartIndexPromise = fetch("/data/tournament-bart-index.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return _bartIndexPromise;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}

function normTeamForIndex(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Modal for a single game from the schedule ticker. Mirrors the coaches'
 * BoxscoreModal: dim overlay, centered card, header with date eyebrow,
 * team-flanked score line, per-player box-score tables for both teams.
 *
 * Data path: `/data/team-games/<year>/<cbba_game_id>.json` (built by
 * `scripts/build-team-game-boxscores.mjs` from per-player game logs). Falls
 * back to a lightweight summary view if the file isn't on disk for that game.
 */

type PlayerRow = {
  name: string;
  bart_id: number | null;
  is_starter: boolean;
  mins: number | null;
  pts: number | null;
  fgm: number | null; fga: number | null;
  fgm3: number | null; fga3: number | null;
  ftm: number | null; fta: number | null;
  reb: number | null; orb: number | null; drb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null;
};
type TeamBox = {
  name: string;
  score: number;
  players: PlayerRow[];
  totals: Record<string, number>;
};
type BoxScore = {
  cbba_game_id: number;
  year: number;
  game_date: string;
  is_neutral: boolean | null;
  teams: TeamBox[];
};

// Parse the leading numeric prefix from game-logs cbba_game_id strings
// (which look like "2829159-103757-game-true"). Returns null if unparseable.
function extractCbbaId(id: string | null | undefined): number | null {
  if (!id) return null;
  const m = /^(\d+)/.exec(String(id));
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function ScheduleGameModal({
  game,
  teamName,
  onClose,
}: {
  game: GameLog;
  teamName: string;
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  const [data, setData] = useState<BoxScore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileableIds, setProfileableIds] = useState<Set<number>>(() => new Set());
  const [draftees, setDraftees] = useState<Record<string, NbaDraftee>>({});
  const [bartIndex, setBartIndex] = useState<Record<string, number>>({});

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lazy-load the profileable-IDs set on first open; the module-level cache
  // means subsequent modals resolve instantly.
  useEffect(() => {
    let cancelled = false;
    loadProfileableIds().then((s) => { if (!cancelled) setProfileableIds(s); });
    loadNbaDraftees().then((d) => { if (!cancelled) setDraftees(d); });
    loadBartIndex().then((idx) => { if (!cancelled) setBartIndex(idx); });
    return () => { cancelled = true; };
  }, []);

  // Lazy-fetch the per-game box score on open.
  useEffect(() => {
    const cbba = extractCbbaId(game.cbba_game_id);
    const yearMatch = game.game_date?.match(/^(\d{4})-/);
    const dateYear = yearMatch ? parseInt(yearMatch[1]!, 10) : null;
    // Schedule files in `game-logs-by-year/<year>.json` use the **season**
    // year (e.g. 2026 for the 25-26 season). The team-games files are keyed
    // by season year as well. But game_date carries the calendar year — for
    // games in Nov/Dec, that's season-year - 1. We need to try both.
    if (!cbba || !dateYear) {
      setErr("Missing game id");
      return;
    }
    let cancelled = false;
    // Try the calendar year first, then fall back to next year (for the
    // November/December half of the season).
    const candidates = [dateYear, dateYear + 1];
    (async () => {
      for (const y of candidates) {
        try {
          const r = await fetch(`/data/team-games/${y}/${cbba}.json`);
          if (!r.ok) continue;
          const j: BoxScore = await r.json();
          if (!cancelled) setData(j);
          return;
        } catch {}
      }
      if (!cancelled) setErr("Box score not available for this game");
    })();
    return () => { cancelled = true; };
  }, [game.cbba_game_id, game.game_date]);

  const venue = game.is_neutral ? "Neutral" : game.is_home ? "Home" : "Away";
  const dateStr = fmtDate(game.game_date);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`Game vs ${game.opp_team_market ?? "TBD"}`}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[6vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-lg shadow-xl w-full max-w-5xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-widest text-ink font-bold">
              {seasonLabelForDate(game.game_date)} · {venue}
            </span>
            <span className="text-xs text-ink-soft mt-0.5">{dateStr}</span>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        {!data && !err && <LoadingBody />}
        {err && <FallbackBody game={game} teamName={teamName} message={err} />}
        {data && <FullBody data={data} ourTeam={teamName} won={game.won} profileableIds={profileableIds} draftees={draftees} bartIndex={bartIndex} />}
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="h-48 flex items-center justify-center text-ink-muted text-sm">
      Loading box score…
    </div>
  );
}

function FallbackBody({
  game, teamName, message,
}: {
  game: GameLog; teamName: string; message: string;
}) {
  return (
    <>
      <div className="px-6 py-5 border-b border-hairline">
        <div className="flex items-center">
          <TeamHeader name={teamName} align="right" />
          <div className="flex items-center gap-3 font-display text-5xl tabular text-ink leading-none mx-6 lg:mx-10 shrink-0">
            <span>{game.pts_scored ?? "—"}</span>
            <span className="text-ink-muted/50">–</span>
            <span>{game.pts_against ?? "—"}</span>
          </div>
          <TeamHeader name={game.opp_team_market ?? "TBD"} align="left" />
        </div>
      </div>
      <div className="px-6 py-6 text-sm text-ink-muted text-center">
        {message}
      </div>
    </>
  );
}

function FullBody({
  data, ourTeam, won, profileableIds, draftees, bartIndex,
}: {
  data: BoxScore;
  ourTeam: string;
  won: boolean | null;
  profileableIds: Set<number>;
  draftees: Record<string, NbaDraftee>;
  bartIndex: Record<string, number>;
}) {
  // Order teams: our team on the LEFT, opp on the RIGHT.
  const teams = [...data.teams];
  teams.sort((a) => (a.name === ourTeam ? -1 : 1));
  const [us, them] = teams;
  if (!us || !them) {
    return <div className="px-6 py-6 text-sm text-ink-muted">Incomplete box-score data.</div>;
  }
  return (
    <>
      {/* Score line */}
      <div className="px-6 py-5 border-b border-hairline">
        <div className="flex items-center">
          <TeamHeader name={us.name} align="right" />
          <div className="flex items-center gap-3 font-display text-5xl tabular text-ink leading-none mx-6 lg:mx-10 shrink-0">
            <span className={won === false ? "text-ink-muted" : "text-ink"}>{us.score}</span>
            <span className="text-ink-muted/50">–</span>
            <span className={won === true ? "text-ink-muted" : "text-ink"}>{them.score}</span>
          </div>
          <TeamHeader name={them.name} align="left" />
        </div>
        <div className="flex justify-center mt-3">
          <span
            className={cn(
              "inline-flex items-center justify-center text-[0.6rem] uppercase tracking-widest font-bold tabular px-2.5 py-0.5 rounded-sm",
              won === true && "bg-emerald-100 text-emerald-800",
              won === false && "bg-rose-100 text-rose-800",
              won === null && "bg-paper-deep text-ink-muted",
            )}
          >
            {won === true ? "Final · Win" : won === false ? "Final · Loss" : "Final"}
          </span>
        </div>
      </div>

      {/* Both teams' player tables, stacked */}
      <div className="divide-y divide-hairline max-h-[60vh] overflow-y-auto overscroll-contain">
        {teams.map((t) => (
          <div key={t.name} className="p-4">
            <div className="flex items-center gap-2 px-2 pb-2">
              <TeamLogo name={t.name} size={20} />
              <span className="font-medium text-ink text-sm">
                <TeamName name={t.name} /> <span className="text-ink-muted">–</span> {t.score}
              </span>
            </div>
            <PlayerTable team={t} profileableIds={profileableIds} draftees={draftees} bartIndex={bartIndex} year={data.year} />
          </div>
        ))}
      </div>
    </>
  );
}

function TeamHeader({ name, align }: { name: string; align: "left" | "right" }) {
  const order = align === "right" ? "flex-row" : "flex-row-reverse";
  const textAlign = align === "right" ? "text-right" : "text-left";
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-3 ${order}`}>
      <div className={`flex-1 min-w-0 ${textAlign}`}>
        <div className="font-display text-2xl text-ink truncate"><TeamName name={name} /></div>
      </div>
      <TeamLogo name={name} size={48} />
    </div>
  );
}

function PlayerTable({
  team, profileableIds, draftees, bartIndex, year,
}: {
  team: TeamBox;
  profileableIds: Set<number>;
  draftees: Record<string, NbaDraftee>;
  bartIndex: Record<string, number>;
  year: number;
}) {
  const teamKey = normTeamForIndex(team.name);
  const t = team.totals;
  // Sum total minutes across all players. Mins live on each row (not in the
  // builder's `totals` object), so derive on render. Round to whole minutes
  // to match the per-player cell formatting.
  const totalMins = Math.round(
    team.players.reduce((a, p) => a + (p.mins ?? 0), 0),
  );
  function pct(made: number, att: number): string {
    if (att === 0) return "—";
    return `${Math.round((made / att) * 100)}%`;
  }
  return (
    <div className="overflow-x-auto overscroll-x-contain touch-pan-x">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium text-left border-b border-hairline">
            <th className="px-2 py-1.5">Player</th>
            <th className="px-2 py-1.5 text-right">MIN</th>
            <th className="px-2 py-1.5 text-right">PTS</th>
            <th className="px-2 py-1.5 text-right">FG</th>
            <th className="px-2 py-1.5 text-right">3P</th>
            <th className="px-2 py-1.5 text-right">FT</th>
            <th className="px-2 py-1.5 text-right">REB</th>
            <th className="px-2 py-1.5 text-right">AST</th>
            <th className="px-2 py-1.5 text-right">STL</th>
            <th className="px-2 py-1.5 text-right">BLK</th>
            <th className="px-2 py-1.5 text-right">ORB</th>
            <th className="px-2 py-1.5 text-right">TO</th>
            <th className="px-2 py-1.5 text-right">PF</th>
          </tr>
        </thead>
        <tbody>
          {team.players.map((p) => {
            // Resolve bart_id: prefer the row's own bart_id (matched players),
            // fall back to the name+team+year index (for cbb_-keyed players
            // like RJ Barrett who have a Bart profile but didn't auto-join).
            const resolvedBartId =
              p.bart_id ?? bartIndex[`${year}|${teamKey}|${normName(p.name)}`] ?? null;
            const clickable = resolvedBartId != null && profileableIds.has(resolvedBartId);
            const draftee = draftees[normNbaName(p.name)];
            return (
            <tr key={p.bart_id ?? p.name} className="border-b border-hairline/40 last:border-0">
              <td className={cn("px-2 py-1.5 whitespace-nowrap", p.is_starter ? "font-semibold text-ink" : "text-ink-soft")}>
                {clickable ? (
                  <Link href={`/players/${resolvedBartId}/`} className="hover:text-coral transition-colors">
                    {p.name}
                  </Link>
                ) : (
                  p.name
                )}
                {draftee && <NbaBadge year={draftee.year} pick={draftee.pick} team={draftee.team} />}
              </td>
              <td className="px-2 py-1.5 text-right tabular">{p.mins != null ? Math.round(p.mins) : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular font-medium">{p.pts ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.fgm ?? 0}-{p.fga ?? 0}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.fgm3 ?? 0}-{p.fga3 ?? 0}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.ftm ?? 0}-{p.fta ?? 0}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.reb ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.ast ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.stl ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.blk ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.orb ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.tov ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{p.pf ?? "—"}</td>
            </tr>
            );
          })}
          {/* Team totals */}
          <tr className="border-t border-hairline bg-paper-deep/40 font-semibold">
            <td className="px-2 py-1.5 uppercase text-[0.6rem] tracking-widest text-ink">Team totals</td>
            <td className="px-2 py-1.5 text-right tabular">{totalMins || <span className="text-ink-muted">—</span>}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.pts}</td>
            <td className="px-2 py-1.5 text-right tabular">
              <div>{t.fgm}-{t.fga}</div>
              <div className="text-[0.55rem] text-ink-muted font-normal">{pct(t.fgm, t.fga)}</div>
            </td>
            <td className="px-2 py-1.5 text-right tabular">
              <div>{t.fgm3}-{t.fga3}</div>
              <div className="text-[0.55rem] text-ink-muted font-normal">{pct(t.fgm3, t.fga3)}</div>
            </td>
            <td className="px-2 py-1.5 text-right tabular">
              <div>{t.ftm}-{t.fta}</div>
              <div className="text-[0.55rem] text-ink-muted font-normal">{pct(t.ftm, t.fta)}</div>
            </td>
            <td className="px-2 py-1.5 text-right tabular">{t.reb}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.ast}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.stl}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.blk}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.orb}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.tov}</td>
            <td className="px-2 py-1.5 text-right tabular">{t.pf}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="text-ink-muted hover:text-ink transition-colors text-lg w-7 h-7 inline-flex items-center justify-center rounded hover:bg-paper-deep/60"
    >
      ×
    </button>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${d}, ${y}`;
}

function seasonLabelForDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return "";
  const seasonEnd = m >= 11 ? y + 1 : y;
  return `${(seasonEnd - 1).toString().slice(-2)}-${seasonEnd.toString().slice(-2)}`;
}
