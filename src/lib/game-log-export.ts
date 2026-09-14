/**
 * The game logs' downloads: who each row is, and which columns go on a sheet.
 *
 * Moved out of src/components/games/team-games-client.tsx and games-client.tsx,
 * unchanged, so the desktop app writes the same files. A row is one game in its
 * season's pack; the site's hits carry more than that, which these ignore.
 */
import { EXPORT_ORIGIN, type ExportCol, type ExportEntity } from "@/lib/table-export";
import { teamSlug } from "@/lib/team-slug";
import { F, HOME, NEUTRAL, WON, fmtGameDate, gameStat, type GamePack, type GameView } from "@/lib/game-index";
import {
  T,
  HOME as TEAM_HOME,
  NEUTRAL as TEAM_NEUTRAL,
  WON as TEAM_WON,
  fmtTeamGameDate,
  teamGameStat,
  type TeamGamePack,
  type TeamGameView,
} from "@/lib/team-game-index";

const seasonLabel = (y: number) => `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;

export type GameLogHit<P> = { pack: P; row: number[] };

/**
 * A team's games. `fileStem` names the file: the scoped download on a team page
 * is one team's season, so it says so rather than landing as the fourth
 * "team-game-log.xlsx".
 */
export function teamGameExportEntity<H extends GameLogHit<TeamGamePack>>(fileStem: string): ExportEntity<H> {
  return {
    title: "Team Game Log Explorer",
    sheetName: "Team games",
    wideHeader: "Team",
    // The scoped download is one team's season, so it says so in the filename
    // rather than landing in the reader's downloads folder as the fourth
    // "team-game-log.xlsx". The Team and Season columns stay in the sheet even
    // though every row repeats them — a spreadsheet that has left this site
    // cannot rely on the page it came from to say what it is.
    fileStem,
    identity: [
      {
        header: "Team", width: 20, get: (h) => h.pack.teams.names[h.row[T.t]!] ?? "—",
        href: (h) => {
          const t = h.pack.teams.names[h.row[T.t]!];
          return t ? `${EXPORT_ORIGIN}/teams/${teamSlug(t)}/${h.pack.season}/` : null;
        },
      },
      { header: "Conf", get: (h) => h.pack.teams.confs[h.row[T.t]!] ?? "" },
      { header: "Season", get: (h) => seasonLabel(h.pack.season) },
      { header: "Date", get: (h) => fmtTeamGameDate(h.pack, h.row) },
      {
        header: "Opponent", width: 20, get: (h) => h.pack.opps[h.row[T.o]!] ?? "—",
        href: (h) => {
          const o = h.pack.opps[h.row[T.o]!];
          return o ? `${EXPORT_ORIGIN}/teams/${teamSlug(o)}/${h.pack.season}/` : null;
        },
      },
      { header: "Site", get: (h) => (h.row[T.f]! & TEAM_NEUTRAL ? "N" : h.row[T.f]! & TEAM_HOME ? "H" : "A") },
      { header: "Result", get: (h) => (h.row[T.f]! & TEAM_WON ? "W" : "L") },
      { header: "Score", get: (h) => `${h.row[T.pts]}-${h.row[T.pa]}` },
    ],
    num: (h, key) => teamGameStat(key)?.get(h.row) ?? null,
    pctOf: () => null,
  };
}

/** Export columns for ANY team game log view, with the reader's pins leading. */
export function teamGameExportCols(v: TeamGameView, pinned: readonly string[]): ExportCol[] {
  const toCol = (s: NonNullable<ReturnType<typeof teamGameStat>>, band: string): ExportCol => ({
    label: s.label, total: s.key, pct: "",
    fmt: s.fmt === "pct1" ? "pct1" : s.fmt === "int" ? "int" : "num1",
    band,
  });
  const yours = pinned
    .filter((k) => !v.keys.includes(k))
    .map((k) => teamGameStat(k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => toCol(x, "Your columns"));
  const own = v.keys.map((k) => teamGameStat(k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => toCol(x, v.label));
  return [...yours, ...own];
}

export function playerGameExportEntity<H extends GameLogHit<GamePack>>(): ExportEntity<H> {
  return {
    title: "Game Log Explorer",
    sheetName: "Games",
    wideHeader: "Player",
    fileStem: "game-log",
    identity: [
      {
        header: "Player", width: 22, get: (h) => h.pack.players.names[h.row[F.p]!] ?? "—",
        // Same `page` flag the on-screen row checks before it renders a link.
        // Not every player in this corpus has a page built, and a link to one
        // that does not exist is worse than a plain name.
        href: (h) => (h.pack.players.page[h.row[F.p]!] === 1
          ? `${EXPORT_ORIGIN}/players/${h.pack.players.ids[h.row[F.p]!]}/`
          : null),
      },
      {
        header: "Team", width: 18, get: (h) => h.pack.players.teams[h.row[F.p]!] ?? "—",
        href: (h) => {
          const t = h.pack.players.teams[h.row[F.p]!];
          return t ? `${EXPORT_ORIGIN}/teams/${teamSlug(t)}/${h.pack.season}/` : null;
        },
      },
      { header: "Conf", get: (h) => h.pack.players.confs[h.row[F.p]!] ?? "" },
      { header: "Class", get: (h) => h.pack.classes[h.pack.players.cls[h.row[F.p]!]!] ?? "" },
      { header: "Season", get: (h) => seasonLabel(h.pack.season) },
      { header: "Date", get: (h) => fmtGameDate(h.pack, h.row) },
      {
        header: "Opponent", width: 18, get: (h) => h.pack.opps[h.row[F.o]!] ?? "—",
        href: (h) => {
          const o = h.pack.opps[h.row[F.o]!];
          return o ? `${EXPORT_ORIGIN}/teams/${teamSlug(o)}/${h.pack.season}/` : null;
        },
      },
      { header: "Site", get: (h) => (h.row[F.f]! & NEUTRAL ? "N" : h.row[F.f]! & HOME ? "H" : "A") },
      { header: "Result", get: (h) => (h.row[F.f]! & WON ? "W" : "L") },
    ],
    num: (h, key) => gameStat(key)?.get(h.row) ?? null,
    // No percentiles on this page: a single game's rank among a hundred
    // thousand others is not a number anyone reads, and an empty column would
    // read as data we failed to compute.
    pctOf: () => null,
  };
}

/** Export columns for ANY player game log view, with the reader's pins leading each sheet. */
export function playerGameExportCols(v: GameView, pinned: readonly string[]): ExportCol[] {
  const toCol = (s: NonNullable<ReturnType<typeof gameStat>>, band: string): ExportCol => ({
    label: s.label,
    total: s.key,
    pct: "",
    fmt: s.fmt === "pct1" ? "pct1" : s.fmt === "int" ? "int" : "num1",
    band,
  });
  const yours = pinned
    .filter((k) => !v.keys.includes(k))
    .map((k) => gameStat(k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => toCol(x, "Your columns"));
  const own = v.keys
    .map((k) => gameStat(k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => toCol(x, v.label));
  return [...yours, ...own];
}
