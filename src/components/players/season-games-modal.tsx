"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";

type SortKey = "date" | "pir" | "pts" | "fg" | "fg3" | "ft" | "reb" | "ast" | "tov" | "stl" | "blk";

type GameRow = {
  year: number;
  game_date: string | null;
  cbba_game_id: number;
  opp_team_market: string | null;
  is_home: boolean | null;
  is_neutral: boolean | null;
  won: boolean | null;
  is_starter: boolean | null;
  mins: number | null;
  pts_scored: number | null;
  fgm: number | null; fga: number | null;
  fgm3: number | null; fga3: number | null;
  ftm: number | null; fta: number | null;
  reb: number | null; orb: number | null; drb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null;
};

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

// Full EuroLeague PIR — now that we have per-game TOV, no more "minus turnovers".
function pir(g: GameRow): number | null {
  const pts = g.pts_scored ?? 0;
  const reb = g.reb ?? 0;
  const ast = g.ast ?? 0;
  const stl = g.stl ?? 0;
  const blk = g.blk ?? 0;
  const fgm = g.fgm ?? 0, fga = g.fga ?? 0;
  const ftm = g.ftm ?? 0, fta = g.fta ?? 0;
  const tov = g.tov ?? 0;
  // If we have literally none of the box-score fields, treat as missing
  if (g.pts_scored === null && g.reb === null && g.fga === null && g.fta === null) return null;
  return (pts + reb + ast + stl + blk) - ((fga - fgm) + (fta - ftm) + tov);
}

/**
 * Modal showing a single player's per-game box scores for one season.
 * Fetches the player's full game log on open and filters client-side.
 */
export function SeasonGamesModal({
  bartPlayerId,
  playerName,
  teamName,
  year,
  onClose,
}: {
  bartPlayerId: number;
  playerName: string;
  teamName: string;
  year: number;
  onClose: () => void;
}) {
  const [allGames, setAllGames] = useState<GameRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let cancelled = false;
    fetch(`/data/player-games/${bartPlayerId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body: { games: GameRow[] }) => {
        if (cancelled) return;
        setAllGames(body.games);
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [bartPlayerId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const games = useMemo(() => {
    if (!allGames) return null;
    const filtered = allGames.filter((g) => g.year === year);
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (g: GameRow): number | string | null => {
      switch (sortBy) {
        case "date": return g.game_date ?? "";
        case "pir":  return pir(g);
        case "pts":  return g.pts_scored;
        case "fg":   return g.fgm;
        case "fg3":  return g.fgm3;
        case "ft":   return g.ftm;
        case "reb":  return g.reb;
        case "ast":  return g.ast;
        case "tov":  return g.tov;
        case "stl":  return g.stl;
        case "blk":  return g.blk;
      }
    };
    filtered.sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return filtered;
  }, [allGames, year, sortBy, sortDir]);

  function toggleSort(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(k);
      setSortDir(defaultDir);
    }
  }

  const tally = useMemo(() => {
    if (!games) return null;
    const w = games.filter((g) => g.won === true).length;
    const l = games.filter((g) => g.won === false).length;
    return { w, l, total: games.length };
  }, [games]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`${playerName} ${seasonLabel(year)} game log`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-3">
            <TeamLogo name={teamName} size={28} />
            <div>
              <div className="font-display text-xl text-ink leading-tight">{playerName}</div>
              <div className="text-xs text-ink-muted">
                {teamName} · {seasonLabel(year)}
                {tally ? ` · ${tally.total} games${tally.w + tally.l > 0 ? ` (${tally.w}-${tally.l})` : ""}` : ""}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-coral text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="overflow-auto">
          {err === "HTTP 404" ? (
            <div className="px-5 py-12 text-center text-ink-muted">
              No per-game box scores synced for this player yet.
            </div>
          ) : err ? (
            <div className="px-5 py-12 text-center text-ink-muted">
              Couldn&apos;t load games: {err}
            </div>
          ) : !games ? (
            <div className="px-5 py-12 text-center text-ink-muted">Loading…</div>
          ) : games.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted">
              No games for {playerName} in {seasonLabel(year)}.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-hairline text-left sticky top-0 bg-card z-10">
                <tr>
                  <ThSort label="Date" active={sortBy==="date"} dir={sortDir} onClick={() => toggleSort("date","asc")} />
                  <Th>Opponent</Th>
                  <Th>Result</Th>
                  <ThSort align="right" label="PIR" active={sortBy==="pir"}  dir={sortDir} onClick={() => toggleSort("pir","desc")} />
                  <ThSort align="right" label="PTS" active={sortBy==="pts"}  dir={sortDir} onClick={() => toggleSort("pts","desc")} />
                  <ThSort align="right" label="FG"  active={sortBy==="fg"}   dir={sortDir} onClick={() => toggleSort("fg","desc")} />
                  <ThSort align="right" label="3PT" active={sortBy==="fg3"}  dir={sortDir} onClick={() => toggleSort("fg3","desc")} />
                  <ThSort align="right" label="FT"  active={sortBy==="ft"}   dir={sortDir} onClick={() => toggleSort("ft","desc")} />
                  <ThSort align="right" label="REB" active={sortBy==="reb"}  dir={sortDir} onClick={() => toggleSort("reb","desc")} />
                  <ThSort align="right" label="AST" active={sortBy==="ast"}  dir={sortDir} onClick={() => toggleSort("ast","desc")} />
                  <ThSort align="right" label="TO"  active={sortBy==="tov"}  dir={sortDir} onClick={() => toggleSort("tov","asc")} />
                  <ThSort align="right" label="STL" active={sortBy==="stl"}  dir={sortDir} onClick={() => toggleSort("stl","desc")} />
                  <ThSort align="right" label="BLK" active={sortBy==="blk"}  dir={sortDir} onClick={() => toggleSort("blk","desc")} />
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const venue = g.is_neutral ? "N" : g.is_home ? "vs" : "@";
                  const p = pir(g);
                  return (
                    <tr key={g.cbba_game_id} className="border-b border-hairline/60 hover:bg-paper-deep/30">
                      <Td className="text-ink-muted tabular whitespace-nowrap">{g.game_date ?? "—"}</Td>
                      <Td>
                        {g.opp_team_market ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-ink-muted text-xs w-5 inline-block">{venue}</span>
                            <TeamLogo name={g.opp_team_market} size={18} />
                            <span className="text-ink-soft whitespace-nowrap">{g.opp_team_market}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className={g.won === true ? "text-coral font-medium" : g.won === false ? "text-ink-muted" : "text-ink-muted"}>
                        {g.won === null ? "—" : g.won ? "W" : "L"}
                      </Td>
                      <Td align="right" className="tabular font-medium">{p === null ? "—" : p.toFixed(0)}</Td>
                      <Td align="right" className="tabular">{nz(g.pts_scored)}</Td>
                      <Td align="right" className="tabular whitespace-nowrap">{makeAtt(g.fgm, g.fga)}</Td>
                      <Td align="right" className="tabular whitespace-nowrap">{makeAtt(g.fgm3, g.fga3)}</Td>
                      <Td align="right" className="tabular whitespace-nowrap">{makeAtt(g.ftm, g.fta)}</Td>
                      <Td align="right" className="tabular">{nz(g.reb)}</Td>
                      <Td align="right" className="tabular">{nz(g.ast)}</Td>
                      <Td align="right" className="tabular">{nz(g.tov)}</Td>
                      <Td align="right" className="tabular">{nz(g.stl)}</Td>
                      <Td align="right" className="tabular">{nz(g.blk)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-hairline text-[0.65rem] text-ink-muted">
          Box scores from CBB Analytics. PIR = (PTS + REB + AST + STL + BLK) &minus; ((FGA &minus; FGM) + (FTA &minus; FTM) + TOV).
        </div>
      </div>
    </div>
  );
}

function nz(v: number | null): string {
  return v === null || v === undefined ? "—" : String(v);
}
function makeAtt(m: number | null, a: number | null): string {
  if (m === null || a === null) return "—";
  return `${m}-${a}`;
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function ThSort({
  label, active, dir, onClick, align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 text-xs uppercase tracking-widest font-medium select-none cursor-pointer hover:bg-paper-deep/60 transition-colors ${align === "right" ? "text-right" : ""} ${active ? "text-ink" : "text-ink-muted"}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end w-full" : ""}`}>
        <span>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
