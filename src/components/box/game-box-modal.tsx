"use client";

/**
 * Shared box-score pieces: the two-team colour split, the percentage ring, the
 * comparison bar, and the player tables.
 *
 * THE MODAL THAT USED TO LIVE HERE IS GONE. Every surface that showed a game
 * opened it in a modal — the Win Calculator's results, the team-page schedule
 * ticker, the "find a game" panel, the coach pages. Each of those now links to
 * that game's own page at /games/<season>/<id>-<away>-vs-<home>/, which has
 * the same box score plus play-by-play, four factors, form and standings, at a
 * URL that can be shared, bookmarked and indexed. A modal could be none of
 * those things, and ~74,000 game pages that nothing linked to would have been
 * invisible to a search engine.
 *
 * What remains is the presentation these surfaces still share with the game
 * page itself, so there is still exactly one way the site draws a box score.
 */

import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { getTeamColors } from "@/lib/team-colors";

export type BoxPlayer = {
  id: number | null;
  name: string;
  pos: string | null;
  starter: boolean;
  min: number | null;
  pts: number | null;
  fgm: number | null; fga: number | null;
  fg3m: number | null; fg3a: number | null;
  ftm: number | null; fta: number | null;
  oreb: number | null; reb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null;
  usage: number | null; ts: number | null;
  ortg: number | null; drtg: number | null;
};
export type BoxTeam = { team: string; logName: string; players: BoxPlayer[] };
export type GamePlayersFile = { teams: BoxTeam[] };

/**
 * Fallback side colors, used when a team has no palette entry. Real team
 * colors come from getTeamColors() — the same source the team pages use — so
 * a Michigan/UCLA box reads maize vs blue rather than generic coral vs steel.
 */
const SIDE_A = "var(--coral)";
const SIDE_B = "#3e7cb1";

/**
 * Neutral second-side colors, spread around the hue wheel. Reached only when
 * NO combination of the two teams' own palettes is distinguishable, which is
 * now rare — see sideColors().
 */
const FALLBACK_HUES: string[] = ["#c8553d", "#2d8a8a", "#c98a2d", "#6b5ca5", "#4a7c59", SIDE_B];

/**
 * Two visually distinguishable colors for one matchup, keeping BOTH teams in
 * their own palette wherever that is possible.
 *
 * Blue-on-blue is the norm in this sport, not the exception: Duke/North
 * Carolina, Kansas/Kentucky, Michigan/UCLA and Gonzaga/Saint Mary's all
 * resolve to two blues. The old rule handed the second team a neutral fallback
 * hue as soon as the primaries clashed, which is why a Duke bar came out
 * brick-red — a color Duke has never worn.
 *
 * Most of those clashes have a better answer inside the two palettes. Carolina
 * pairs a very dark navy primary with sky blue; against Duke's royal blue the
 * navy is unreadable but the sky blue is unmistakable, and both teams stay in
 * their own colors. So the pairs are tried in preference order — both
 * primaries, then one side's secondary, then the other's — and only a matchup
 * with no workable combination falls through to a neutral hue.
 */
export function sideColors(teamA: string, teamB: string): [string, string] {
  const a = getTeamColors(teamA);
  const b = getTeamColors(teamB);
  const aP = a?.primary, aS = a?.secondary;
  const bP = b?.primary, bS = b?.secondary;

  const pairs: Array<[string | undefined, string | undefined]> = [
    [aP, bP], [aP, bS], [aS, bP], [aS, bS],
  ];
  for (const [x, y] of pairs) {
    if (!usable(x) || !usable(y)) continue;
    if (!tooClose(x!, y!)) return [x!, y!];
  }

  // No combination of the two palettes works. Keep side A honest and walk the
  // neutral hues for side B rather than making both teams wrong.
  const ca = usable(aP) ? aP! : SIDE_A;
  const cb = FALLBACK_HUES.find((c) => !tooClose(ca, c)) ?? SIDE_B;
  return [ca, cb];
}

/**
 * Can this color carry meaning on the page at all?
 *
 * Rejects the near-whites that half the palettes list as a secondary — white
 * on warm paper is not a color, it is an absence — and anything with no hue
 * to speak of, which would read as a gray bar rather than as a team.
 */
function usable(hex: string | undefined): boolean {
  if (typeof hex !== "string" || hex.length === 0) return false;
  const c = hsl(hex);
  if (!c) return false;
  return c.l <= 0.82 && (c.s >= 0.12 || c.l <= 0.35);
}

/**
 * Are two colors too similar to tell apart across a chart?
 *
 * Compares HUE, not RGB distance. RGB distance passes pairs like Michigan navy
 * (#00274C) against a mid-blue: numerically far apart because one is much
 * darker, but both unmistakably "blue" once they're two bars in the same row.
 * Hue catches that; a low-saturation color (near-black, near-white, gray) has
 * no meaningful hue, so those are compared on lightness instead.
 */
function hsl(h: string): { h: number; s: number; l: number } | null {
  const s = h.replace("#", "");
  if (s.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: ((hue * 60) + 360) % 360, s: sat, l };
}

function tooClose(x: string, y: string): boolean {
  const p = hsl(x), q = hsl(y);
  if (!p || !q) return false;
  const dl = Math.abs(p.l - q.l);
  // Either color effectively grayscale → judge on lightness only.
  if (p.s < 0.15 || q.s < 0.15) return dl < 0.25;
  const dh = Math.min(Math.abs(p.h - q.h), 360 - Math.abs(p.h - q.h));
  // A big lightness gap separates two colors even at the same hue —
  // Carolina sky blue against Duke royal is four degrees apart and nobody has
  // ever confused them. Judging on hue alone was what pushed same-family
  // matchups onto fallback colors neither team wears.
  if (dl >= 0.24) return false;
  return dh < 45;
}

/**
 * Shooting percentage as a ring. The arc is the percentage; the number sits
 * inside it. Null attempts render an empty track rather than a 0% ring, which
 * would read as "shot and missed everything".
 */
export function PctRing({ made, att, color }: { made: number | null; att: number | null; color: string }) {
  const pct = made === null || !att ? null : made / att;
  const SIZE = 58;
  const R = 23;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" className="text-hairline" strokeWidth={4.5} />
        {pct !== null && (
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`}
          />
        )}
      </svg>
      <span className="absolute text-sm font-semibold tabular text-ink">
        {pct === null ? "—" : `${Math.round(pct * 100)}%`}
      </span>
    </span>
  );
}

/**
 * One counting stat as a single proportional bar: each side's share of the
 * combined total. The winning side is called out in its own color — for
 * `lower` stats (turnovers, fouls) that is the SMALLER number.
 */
export function SplitBar({
  label, a, b, lower, major, colorA = SIDE_A, colorB = SIDE_B,
}: {
  label: string; a: number | null; b: number | null; lower?: boolean; major?: boolean;
  colorA?: string; colorB?: string;
}) {
  const av = a ?? 0, bv = b ?? 0;
  const total = av + bv;
  // A 0-0 row would divide by zero; show an even, inert bar instead.
  const aShare = total > 0 ? av / total : 0.5;
  const aWins = a !== null && b !== null && a !== b && (lower ? a < b : a > b);
  const bWins = a !== null && b !== null && a !== b && (lower ? b < a : b > a);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1 min-w-0">
          <span className={`text-sm tabular ${aWins ? "font-semibold" : "text-ink-soft"}`} style={aWins ? { color: colorA } : undefined}>
            {a ?? "—"}
          </span>
          {/* Arrow points at the better side. On `lower` rows (turnovers,
              fouls, DRtg) that is the smaller number, so the arrow — not the
              size of the number — is what tells you who won the row. */}
          {aWins && <span aria-label="better" style={{ color: colorA }} className="text-[0.6rem] leading-none">◀</span>}
        </span>
        <span className={`text-xs text-center ${major ? "text-ink font-medium" : "text-ink-muted"}`}>{label}</span>
        <span className="flex items-center gap-1 min-w-0">
          {bWins && <span aria-label="better" style={{ color: colorB }} className="text-[0.6rem] leading-none">▶</span>}
          <span className={`text-sm tabular ${bWins ? "font-semibold" : "text-ink-soft"}`} style={bWins ? { color: colorB } : undefined}>
            {b ?? "—"}
          </span>
        </span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-hairline">
        <div
          className="transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: `${aShare * 100}%`, background: "var(--fill-a)", opacity: aWins ? 1 : 0.5 }}
        />
        <div
          className="flex-1 transition-[width] duration-500"
          style={{ background: "var(--fill-b)", opacity: bWins ? 1 : 0.5 }}
        />
      </div>
    </div>
  );
}

type SortKey = "min" | "pts" | "reb" | "ast" | "stl" | "blk" | "pf" | "tov" | "oreb" | "dreb" | "fga" | "fg3a" | "fta";

/**
 * Both line-ups, with a team selector and sortable columns. Defaults to
 * points descending, which is how anyone scanning a box score starts.
 */
export function PlayerBoxPanel({ file }: { file: GamePlayersFile }) {
  const teams = file.teams;
  // null = show both, otherwise the index of the single team shown.
  const [only, setOnly] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("pts");
  const [desc, setDesc] = useState(true);

  const shown = only === null ? teams : [teams[only]!];

  return (
    <div>
      {teams.length > 1 && (
        <div className="flex items-center gap-1 mb-3 p-1 rounded-lg bg-paper-deep border border-hairline">
          {[0, null, 1].map((sel, i) => {
            const active = only === sel;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setOnly(sel)}
                aria-pressed={active}
                className={`flex-1 py-1.5 rounded-md inline-flex items-center justify-center gap-1.5 text-sm transition-colors ${
                  active ? "bg-card shadow-sm text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {sel === null ? (
                  <>
                    <TeamLogo name={teams[0]!.logName || teams[0]!.team} size={18} />
                    <span className="text-ink-muted">+</span>
                    <TeamLogo name={teams[1]!.logName || teams[1]!.team} size={18} />
                  </>
                ) : (
                  <>
                    <TeamLogo name={teams[sel]!.logName || teams[sel]!.team} size={18} />
                    <span className="hidden sm:inline truncate">{teams[sel]!.team}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {shown.map((t) => (
          <PlayerBoxTable
            key={t.team}
            team={t}
            sort={sort}
            desc={desc}
            onSort={(k) => {
              if (k === sort) setDesc((d) => !d);
              else { setSort(k); setDesc(true); }
            }}
          />
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-coral" aria-hidden />
        Starters
      </p>
    </div>
  );
}

/** One team's line-up. Players who didn't play are listed beneath the table. */
export function PlayerBoxTable({
  team, sort, desc, onSort,
}: {
  team: BoxTeam;
  sort: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
}) {
  const dreb = (p: BoxPlayer) => (p.reb === null || p.oreb === null ? null : p.reb - p.oreb);
  const valueOf = (p: BoxPlayer, k: SortKey): number => {
    if (k === "dreb") return dreb(p) ?? -1;
    return (p[k] as number | null) ?? -1;
  };

  const played = team.players.filter((p) => (p.min ?? 0) > 0);
  const dnp = team.players.filter((p) => (p.min ?? 0) <= 0);
  const rows = [...played].sort((a, b) => {
    const d = valueOf(b, sort) - valueOf(a, sort);
    return desc ? d : -d;
  });

  const COLS: Array<{ k: SortKey; label: string }> = [
    { k: "min", label: "MIN" },
    { k: "pts", label: "PTS" },
    { k: "reb", label: "REB" },
    { k: "ast", label: "AST" },
    { k: "stl", label: "STL" },
    { k: "blk", label: "BLK" },
    { k: "pf", label: "PF" },
    { k: "tov", label: "TOV" },
    { k: "oreb", label: "OREB" },
    { k: "dreb", label: "DREB" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <TeamLogo name={team.logName || team.team} size={20} />
        <span className="text-xs uppercase tracking-widest text-ink font-bold">{team.team}</span>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline text-left">
            <tr>
              <Th>Player</Th>
              {COLS.map((c) => (
                <th key={c.k} className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onSort(c.k)}
                    className={`text-xs uppercase tracking-widest font-medium transition-colors ${
                      sort === c.k ? "text-coral" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {c.label}
                    {sort === c.k && <span aria-hidden>{desc ? " ▾" : " ▴"}</span>}
                  </button>
                </th>
              ))}
              <Th align="right">FG</Th>
              <Th align="right">3PT</Th>
              <Th align="right">FT</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id ?? p.name} className="border-b border-hairline/60 hover:bg-paper-deep/40 transition-colors">
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.starter ? "bg-coral" : "bg-transparent"}`}
                      aria-label={p.starter ? "Starter" : undefined}
                    />
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.pos && <span className="text-xs text-ink-muted">{p.pos}</span>}
                  </span>
                </Td>
                {COLS.map((c) => {
                  const v = c.k === "dreb" ? dreb(p) : (p[c.k] as number | null);
                  return (
                    <Td key={c.k} align="right" className={`tabular ${c.k === "pts" ? "font-semibold text-ink" : "text-ink-soft"}`}>
                      {v ?? "—"}
                    </Td>
                  );
                })}
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.fgm === null ? "—" : `${p.fgm}/${p.fga}`}</Td>
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.fg3m === null ? "—" : `${p.fg3m}/${p.fg3a}`}</Td>
                <Td align="right" className="tabular text-ink-soft whitespace-nowrap">{p.ftm === null ? "—" : `${p.ftm}/${p.fta}`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dnp.length > 0 && (
        <p className="mt-1.5 px-1 text-xs text-ink-muted">
          <span className="uppercase tracking-wide font-medium">DNP</span> {dnp.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}


// ISO "YYYY-MM-DD" → "MM/DD/YY". String-based to avoid timezone shifts.
export function fmtGameDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
}

/**
 * NCAA/NIT seed. Only ~1% of rows carry one, and that's the point — a game
 * with no seed simply renders nothing rather than a placeholder.
 */
/**
 * AP rank AS OF THE GAME, not end of season — so a December upset shows the
 * number the loser actually carried that night. ~7% of rows have one (25
 * ranked teams out of ~364); the rest render nothing.
 */
export function RankBadge({ rank }: { rank: number }) {
  return (
    <span title={`AP No. ${rank} at the time of this game`} className="text-[11px] font-bold text-coral tabular">
      #{rank}
    </span>
  );
}

export function SeedBadge({ seed }: { seed: number }) {
  return (
    <span
      title={`No. ${seed} seed`}
      className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-sm bg-ink/10 text-ink-soft text-[10px] font-bold tabular leading-none"
    >
      {seed}
    </span>
  );
}

export function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
export function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}

