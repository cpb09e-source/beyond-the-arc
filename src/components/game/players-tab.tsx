"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { loadPhotoIndex, lookupId, type PhotoIndex } from "@/lib/player-photo-index";
import type { GameLinks, SideLinks } from "@/lib/game-team-links";
import type { BoxPlayer, GameBundle, GameSide, Play, TeamStats } from "./types";

/**
 * Full player box, both sides.
 *
 * MIN / PTS / REB / AST is the table everyone has. The two columns after it are
 * the ones that say whether the points were worth what they cost: usage (the
 * share of his team's possessions a player finished) and true shooting (points
 * per possession spent). A 24-point night on 21 shots and a 24-point night on
 * 12 read identically in the first four columns.
 *
 * PLUS-MINUS IS COMPUTED, NOT COPIED. CBBD reports a `netRating`, which is a
 * margin per 100 possessions — a different quantity from the plus-minus a box
 * score means, and printing a rating under a "+/-" heading would misstate the
 * units by a factor of about four. The real figure is derived from the
 * play-by-play instead: every scoring play carries the ten athletes on the
 * floor, so each basket is credited to the five who were actually out there.
 */

type SortKey = "min" | "pts" | "reb" | "ast" | "ts" | "usg" | "pm";

/**
 * athleteId → plus-minus, in HOME terms (home margin gained while on court).
 * The away side negates it.
 *
 * Returns an empty map when the feed carries no on-floor data, which is how
 * the column knows to render an em dash rather than a wrong zero.
 */
function plusMinus(plays: Play[]): Map<number, number> {
  const out = new Map<number, number>();
  let prevH = 0, prevA = 0;
  for (const p of plays) {
    if (!p.sc) continue;
    const swing = (p.hs - prevH) - (p.as - prevA);
    prevH = p.hs; prevA = p.as;
    if (!p.on?.length || swing === 0) continue;
    for (const id of p.on) out.set(id, (out.get(id) ?? 0) + swing);
  }
  return out;
}

export function PlayersTab({ b, hc, ac, links }: {
  b: GameBundle; hc: string; ac: string;
  /**
   * Team and coach links, resolved at build time by the game page. Absent on
   * the live /game route, where the box simply renders unlinked — the same
   * degradation useGameLinks() uses when a slug map has not loaded.
   */
  links?: GameLinks;
}) {
  const pm = useMemo(() => plusMinus(b.plays), [b.plays]);
  const hasPm = pm.size > 0;

  /**
   * Box-score names → our player ids, so a name can link to its profile.
   *
   * The box comes from CBBD, which keys athletes on its own id; /players/ URLs
   * use bart ids, and names are the only field the two worlds share. The index
   * excludes anyone ambiguous within a season, so a lookup either resolves to
   * the right player or to nothing — see src/lib/player-photo-index.ts. The
   * overview tab already loads the same file, and the module-level cache means
   * both panels share one fetch.
   */
  const [photos, setPhotos] = useState<PhotoIndex>({});
  useEffect(() => {
    let live = true;
    void loadPhotoIndex(b.game.season).then((i) => { if (live) setPhotos(i); });
    return () => { live = false; };
  }, [b.game.season]);

  return (
    <div className="space-y-6">
      <TeamBox side={b.game.away} players={b.players.away} stats={b.teamStats.away}
        color={ac} pm={pm} pmSign={-1} hasPm={hasPm} photos={photos} links={links?.away} />
      <TeamBox side={b.game.home} players={b.players.home} stats={b.teamStats.home}
        color={hc} pm={pm} pmSign={1} hasPm={hasPm} photos={photos} links={links?.home} />
    </div>
  );
}

function TeamBox({
  side, players, stats, color, pm, pmSign, hasPm, photos, links,
}: {
  side: GameSide; players: BoxPlayer[]; stats: TeamStats | null; color: string;
  pm: Map<number, number>; pmSign: 1 | -1; hasPm: boolean;
  photos: PhotoIndex; links?: SideLinks;
}) {
  const [sort, setSort] = useState<SortKey>("min");

  // A player who appeared but was never on the floor for a scoring play really
  // is 0, so a missing id is only unknown when the whole feed is missing.
  const pmOf = (p: BoxPlayer): number | null =>
    !hasPm ? null : (pm.get(p.athleteId) ?? 0) * pmSign;

  const val = (p: BoxPlayer, k: SortKey): number => {
    switch (k) {
      case "min": return p.minutes ?? -1;
      case "pts": return p.points ?? -1;
      case "reb": return p.rebounds.total ?? -1;
      case "ast": return p.assists ?? -1;
      case "ts": return p.trueShootingPct ?? -1;
      case "usg": return p.usage ?? -1;
      case "pm": return pmOf(p) ?? -999;
    }
  };
  const rows = [...players].sort((a, c) => val(c, sort) - val(a, sort));

  return (
    /*
      FULL BLEED ON A PHONE. The page shell is px-5 and the card adds its own
      rounded border, so a 16-column table was scrolling inside roughly 350px
      of a 390px screen while 40px of paper sat either side of it doing
      nothing. Cancelling the shell's padding hands that back: the table is
      the widest thing on the page and the only one that wants the glass.

      The card returns at sm, where the page is wide enough that an
      edge-to-edge table would read as a layout that had come apart.
    */
    <section className="-mx-5 sm:mx-0 rounded-none sm:rounded-xl border-y sm:border border-hairline bg-card overflow-hidden">
      {/*
        The team's shooting line used to sit beside the name — FG, 3P, FT and
        possessions. It is gone because the table under it already carries
        every one of those numbers on its own Team row, so the header was
        restating the footer in smaller type. The coach is there instead:
        something the box score does NOT otherwise say, and a way into the
        coach's own page.
      */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-hairline" style={{ background: `${color}12` }}>
        <TeamLogo name={side.team} size={22} />
        <h2 className="font-display text-lg text-ink">
          {links?.teamHref ? (
            <Link href={links.teamHref} className="hover:text-coral transition-colors" prefetch={false}>
              {side.team}
            </Link>
          ) : (
            side.team
          )}
        </h2>
        {links?.coach && (
          <Link
            href={links.coach.href}
            className="text-[0.68rem] text-ink-muted hover:text-coral transition-colors truncate hidden sm:inline"
            prefetch={false}
          >
            {links.coach.name}
          </Link>
        )}
        {/* Ink, not team color — matches the line score in the header above. */}
        <span className={cn("ml-auto font-display text-2xl tabular", side.winner === false ? "text-ink-muted" : "text-ink")}>
          {side.points ?? "—"}
        </span>
      </div>

      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-[0.74rem] tabular min-w-[32rem] sm:min-w-[44rem]">
          <thead>
            <tr className="text-[0.52rem] uppercase tracking-[0.08em] text-ink-muted border-b border-hairline">
              <th className="text-left font-bold px-2 sm:px-3 py-2 sticky left-0 bg-card">Player</th>
              <Th k="min" sort={sort} on={setSort}>Min</Th>
              <Th k="pts" sort={sort} on={setSort}>Pts</Th>
              <th className="text-right font-bold px-1.5 sm:px-2">FG</th>
              <th className="text-right font-bold px-1.5 sm:px-2">3P</th>
              <th className="text-right font-bold px-1.5 sm:px-2">FT</th>
              <Th k="reb" sort={sort} on={setSort}>Reb</Th>
              <th className="text-right font-bold px-1.5 sm:px-2">Off</th>
              <Th k="ast" sort={sort} on={setSort}>Ast</Th>
              <th className="text-right font-bold px-1.5 sm:px-2">TO</th>
              <th className="text-right font-bold px-1.5 sm:px-2">Stl</th>
              <th className="text-right font-bold px-1.5 sm:px-2">Blk</th>
              <th className="text-right font-bold px-1.5 sm:px-2">PF</th>
              <Th k="usg" sort={sort} on={setSort} className="hidden sm:table-cell">Usg%</Th>
              <Th k="ts" sort={sort} on={setSort} className="hidden sm:table-cell">TS%</Th>
              <Th k="pm" sort={sort} on={setSort}>+/&minus;</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.athleteId} className="border-b border-hairline/60 last:border-b-0 hover:bg-paper-deep/40">
                <td className="px-2 sm:px-3 py-1.5 whitespace-nowrap sticky left-0 bg-card">
                  <PlayerName name={p.name} starter={p.starter} id={lookupId(photos, p.name)} />
                  {p.position && <span className="text-ink-muted/70 ml-1.5 text-[0.58rem]">{p.position}</span>}
                  {p.ejected && <span className="ml-1.5 text-[0.55rem] uppercase tracking-wider font-bold text-bad">ej</span>}
                </td>
                <Td v={p.minutes} muted />
                <Td v={p.points} strong />
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{p.fieldGoals.made}-{p.fieldGoals.attempted}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{p.threePointFieldGoals.made}-{p.threePointFieldGoals.attempted}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{p.freeThrows.made}-{p.freeThrows.attempted}</td>
                <Td v={p.rebounds.total} strong />
                <Td v={p.rebounds.offensive} muted />
                <Td v={p.assists} strong />
                <Td v={p.turnovers} />
                <Td v={p.steals} />
                <Td v={p.blocks} />
                <Td v={p.fouls} muted />
                <td className="text-right px-1.5 sm:px-2 text-ink-soft hidden sm:table-cell">{p.usage === null ? "—" : `${num(p.usage)}%`}</td>
                <Td v={p.trueShootingPct} round className="hidden sm:table-cell" />
                <PlusMinus v={pmOf(p)} />
              </tr>
            ))}
          </tbody>
          {stats && (
            <tfoot>
              <tr className="border-t-2 border-ink/15 text-[0.72rem]">
                <td className="px-2 sm:px-3 py-2 font-semibold text-ink sticky left-0 bg-card">Team</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted">{sumOf(players, (p) => p.minutes)}</td>
                <td className="text-right px-1.5 sm:px-2 font-semibold text-ink">{stats.points.total}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.fieldGoals.made}-{stats.fieldGoals.attempted}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.threePointFieldGoals.made}-{stats.threePointFieldGoals.attempted}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.freeThrows.made}-{stats.freeThrows.attempted}</td>
                <td className="text-right px-1.5 sm:px-2 font-semibold text-ink">{stats.rebounds.total}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted">{stats.rebounds.offensive}</td>
                <td className="text-right px-1.5 sm:px-2 font-semibold text-ink">{stats.assists}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.turnovers.total}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.steals}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-soft">{stats.blocks}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted">{stats.fouls.total}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted hidden sm:table-cell">—</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted hidden sm:table-cell">{num(stats.trueShooting)}</td>
                <td className="text-right px-1.5 sm:px-2 text-ink-muted">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

/**
 * A player's name, linked to their profile when we can identify them.
 *
 * `id` is null for anyone the photo index could not resolve — a name that is
 * ambiguous within the season, or a player with no page here at all. Those
 * render exactly as before, as text. The index never guesses, so a link on
 * this table is either the right player or absent.
 */
function PlayerName({ name, starter, id }: { name: string; starter: boolean; id: number | null }) {
  const tone = starter ? "text-ink font-medium" : "text-ink-soft";
  if (id === null) return <span className={tone}>{name}</span>;
  return (
    <Link href={`/players/${id}/`} className={cn(tone, "hover:text-coral transition-colors")} prefetch={false}>
      {name}
    </Link>
  );
}

function Th({ k, sort, on, className, children }: {
  k: SortKey; sort: SortKey; on: (k: SortKey) => void; className?: string; children: React.ReactNode;
}) {
  return (
    <th className={cn("text-right font-bold px-1.5 sm:px-2", className)}>
      <button type="button" onClick={() => on(k)}
        className={cn("uppercase tracking-[0.08em] hover:text-coral transition-colors", sort === k && "text-coral")}>
        {children}
      </button>
    </th>
  );
}

function Td({ v, strong, muted, round, className }: {
  v: number | null; strong?: boolean; muted?: boolean; round?: boolean; className?: string;
}) {
  return (
    <td className={cn("text-right px-1.5 sm:px-2", strong ? "font-semibold text-ink" : muted ? "text-ink-muted" : "text-ink-soft", className)}>
      {round ? num(v) : v ?? "—"}
    </td>
  );
}

/** Zero is neither good nor bad; coloring it green would read as a positive. */
function PlusMinus({ v }: { v: number | null }) {
  return (
    <td className="text-right px-1.5 sm:px-2 font-semibold"
      style={{ color: v === null || v === 0 ? "var(--ink-muted)" : v > 0 ? "var(--good)" : "var(--bad)" }}>
      {v === null ? "—" : v > 0 ? `+${v}` : String(v)}
    </td>
  );
}

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "—";
}

function sumOf(players: BoxPlayer[], pick: (p: BoxPlayer) => number | null): number {
  return players.reduce((s, p) => s + (pick(p) ?? 0), 0);
}
