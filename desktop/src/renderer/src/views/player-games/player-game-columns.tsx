import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { F, gameStat, type GameStat } from "@/lib/game-index";
import { NO_PCT } from "~/data/midrank-by-value";
import {
  shortDate,
  siteOf,
  statPercentiles,
  statValues,
  wonGame,
  type PlayerGame,
  type PlayerGameSeason,
} from "~/data/player-game-model";
import type { Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";

/**
 * The Player Game Log's columns.
 *
 * Keys, labels, descriptions, getters and directions are the site's GAME_VIEWS
 * and GAME_STATS. The chips are the app's: the site's own game log has none.
 */

/**
 * NO CHIP where most games are a zero. In 2025-26 blocks are zero in 77% of
 * player-games, made threes in 58%, steals in 57%, offensive rebounds in 51%
 * and made free throws in 51%. A midrank puts that zero in the red-to-amber
 * band, so the most common line in the box score would read as a bad night.
 * The same call the site makes for overtime points on the team log.
 */
export const NO_CHIP = new Set(["orb", "stl", "blk", "fg3m", "ftm"]);

/**
 * Neutral chips where more is a bigger role, not a better game: minutes,
 * attempts and usage say how much a player was asked to do.
 */
export const NEUTRAL_CHIP = new Set(["min", "fga", "fg2a", "fg3a", "fta", "usg"]);

const MINUS = "−";

/** A cell's text. The header carries the %, so a percentage cell does not repeat it. */
export function fmtGameStat(st: GameStat, v: number | null): string {
  if (v == null) return "–";
  if (st.fmt === "pct1") return (v * 100).toFixed(1);
  if (st.fmt === "num1") return v < 0 ? `${MINUS}${Math.abs(v).toFixed(1)}` : v.toFixed(1);
  if (st.fmt === "num2") return v.toFixed(2);
  return String(Math.round(v));
}

export function identityColumns(season: PlayerGameSeason): Column<PlayerGame>[] {
  const { players, opps, pack } = season;
  const who = (g: PlayerGame) => players[g.row[F.p]!]!;
  const against = (g: PlayerGame) => opps[g.row[F.o]!]!;
  return [
    {
      key: "pos", label: "#", title: "Place in the current sort", width: 68, align: "right", first: 1, pin: true,
      cell: (_g, i) => <span className="text-ink-muted tabular">{(i + 1).toLocaleString()}</span>,
    },
    {
      key: "player", label: "Player", width: 244, align: "left", first: 1, pin: true,
      sortValue: (g) => who(g).name,
      cell: (g) => {
        const p = who(g);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={22} />
            <span className="truncate font-medium text-ink">{p.name}</span>
            <ClassBadge cls={p.cls} />
            {p.rank > 0 && p.rank <= 100 && (
              <TopHundredPill rank={p.rank} title={`Top 100: #${p.rank} in the country in ${seasonLabel(season.year)}`} />
            )}
          </span>
        );
      },
    },
    {
      key: "team", label: "Team", width: 168, align: "left", first: 1,
      sortValue: (g) => who(g).team,
      cell: (g) => {
        const p = who(g);
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <TeamLogo id={p.teamLogoId} name={p.team} size={16} />
            <span className="truncate text-ink-soft">{p.team}</span>
          </span>
        );
      },
    },
    {
      key: "result", label: "W/L", title: "The team's result", width: 52, align: "center", first: -1,
      sortValue: (g) => (wonGame(g.row) ? 1 : 0),
      cell: (g) =>
        wonGame(g.row) ? <span className="font-semibold text-good">W</span> : <span className="font-semibold text-bad">L</span>,
    },
    {
      key: "site", label: "Site", title: "Home (vs), away (@) or a neutral floor (N)", width: 52, align: "center", first: -1,
      sortValue: (g) => {
        const s = siteOf(g.row);
        return s === "home" ? 2 : s === "neutral" ? 1 : 0;
      },
      cell: (g) => {
        const s = siteOf(g.row);
        return <span className="text-ink-muted">{s === "home" ? "vs" : s === "away" ? "@" : "N"}</span>;
      },
    },
    {
      key: "opp", label: "Opponent", width: 204, align: "left", first: 1,
      sortValue: (g) => against(g).name,
      cell: (g) => {
        const o = against(g);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo id={o.logoId} name={o.name} size={18} />
            <span className="truncate text-ink-soft">{o.name}</span>
          </span>
        );
      },
    },
    {
      key: "date", label: "Date", width: 76, align: "right", first: -1,
      sortValue: (g) => g.row[F.d]!,
      cell: (g) => <span className="text-ink-soft tabular">{shortDate(pack, g.row)}</span>,
    },
  ];
}

export function statColumns(season: PlayerGameSeason, keys: string[]): Column<PlayerGame>[] {
  const out: Column<PlayerGame>[] = [];
  for (const key of keys) {
    const st = gameStat(key);
    if (!st) continue;
    const vals = statValues(season.pack, st);
    const pct = NO_CHIP.has(st.key) ? null : statPercentiles(season.pack, st);
    out.push({
      key: st.key,
      label: st.label,
      title: st.title,
      width: Math.max(58, Math.round(st.label.length * 7.7) + 34),
      align: "right",
      first: st.lowerBetter ? 1 : -1,
      sortValue: (g) => {
        const v = vals[g.idx]!;
        return Number.isNaN(v) ? null : v;
      },
      cell: (g) => {
        const v = vals[g.idx]!;
        const p = pct ? pct[g.idx]! : NO_PCT;
        return (
          <StatCell
            value={fmtGameStat(st, Number.isNaN(v) ? null : v)}
            pct={p === NO_PCT ? null : p}
            strong={st.key === "gmsc"}
            neutral={NEUTRAL_CHIP.has(st.key)}
          />
        );
      },
    });
  }
  return out;
}
