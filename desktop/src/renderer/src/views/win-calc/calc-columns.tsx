import { FLAG_KEYS } from "@/lib/condition-stats";
import { confDisplay } from "@/lib/conf-display";
import type { GameLog } from "@/lib/game-filters";
import { isSeed } from "@/lib/scoreboard-core";
import { formatStat, statLabel } from "@/lib/win-calc";
import type { Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { TeamLogo } from "~/ui/logo";
import { coachLookup, crestOf, fmtValue, gamePct, shortDate } from "./calc-model";

/**
 * The matching games: who, where, the result, then one column per condition.
 *
 * CONDITIONS ARE COLUMNS in the order of their chips, each over its percentile
 * among every game of that season, so "3P% 45.8" says at once whether 45.8 was
 * a hot night or an ordinary one.
 *
 * CONFERENCE AND COACH APPEAR WHEN THE QUESTION NARROWS ON THEM, as on the site:
 * otherwise they are context nobody asked for. Quad is always here, because
 * it is the calculator's own idea of how hard a game was.
 */

export const ROW_H = 42;

const num = (g: GameLog, key: string): number | null => {
  const v = g[key];
  return typeof v === "number" ? v : null;
};

function Tag({ children, accent = false, title }: { children: string; accent?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`shrink-0 whitespace-nowrap rounded-[4px] border px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] ${
        accent
          ? "border-[color-mix(in_oklab,var(--accent)_40%,transparent)] text-accent"
          : "border-hairline text-ink-muted"
      }`}
    >
      {children}
    </span>
  );
}

/** CBBD sends 99 for a team with no seed; only 1 to 16 is one. */
const seedOf = (g: GameLog, key: "seed" | "opp_seed"): number | null => {
  const v = num(g, key);
  return isSeed(v) ? v : null;
};

/** NCAA rounds the way a bracket prints them. */
const NCAA_ROUND: Record<string, string> = {
  "First Four": "First Four",
  "1st Round": "R64",
  "2nd Round": "R32",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite 8",
  "Final Four": "Final Four",
  Championship: "Title game",
  "National Championship": "Title game",
};

/**
 * Which postseason a game was, as a tag: the NCAA round in the accent, any other
 * event (NIT, CBI, CIT) quietly by name. Conference tournaments carry a round
 * too, but on thousands of rows a tag would be noise; the Peek names them.
 */
export function postseasonTag(g: GameLog): { text: string; title: string; accent: boolean } | null {
  const round = typeof g.round === "string" && g.round ? g.round : null;
  const event = typeof g.tourney_name === "string" && g.tourney_name ? g.tourney_name : null;
  if (num(g, "tourney") === 1) {
    return { text: (round && NCAA_ROUND[round]) || "NCAA", title: `NCAA tournament${round ? `, ${round}` : ""}`, accent: true };
  }
  if (num(g, "postseason") === 1) {
    return { text: event ?? "Postseason", title: `${event ?? "Postseason"}${round ? `, ${round}` : ""}`, accent: false };
  }
  return null;
}

function Rank({ rank }: { rank: number | null }) {
  if (rank == null || rank <= 0) return null;
  return <span className="shrink-0 text-[10.5px] font-medium text-ink-muted tabular">{rank}</span>;
}

export function calcColumns(cols: string[], show: { conf: boolean; coach: boolean }): Column<GameLog>[] {
  const identity: Column<GameLog>[] = [
    {
      key: "pos", label: "#", title: "Place in the current sort", width: 58, align: "right", first: 1, pin: true,
      cell: (_g, i) => <span className="text-ink-muted tabular">{(i + 1).toLocaleString()}</span>,
    },
    {
      key: "team", label: "Team", width: 200, align: "left", first: 1, pin: true,
      sortValue: (g) => g.team_name,
      cell: (g) => (
        <span className="flex min-w-0 items-center gap-2">
          <TeamLogo id={crestOf(g.team_name)} name={g.team_name} size={20} />
          <Rank rank={num(g, "ap_rank")} />
          <span className="truncate font-medium text-ink">{g.team_name}</span>
          {seedOf(g, "seed") != null && <Tag>{`${seedOf(g, "seed")} seed`}</Tag>}
        </span>
      ),
    },
    {
      key: "result", label: "Result", title: "Wins first, then by margin", width: 118, align: "left", first: -1,
      sortValue: (g) => (g.won ? 1000 : 0) + (g.pts_diff ?? 0),
      cell: (g) => (
        <span className="flex items-baseline gap-2 whitespace-nowrap tabular">
          <span className={`w-3 font-semibold ${g.won ? "text-good" : "text-bad"}`}>{g.won ? "W" : "L"}</span>
          <span className="text-ink">
            {g.pts_scored ?? "—"}–{g.pts_against ?? "—"}
          </span>
          {(num(g, "ot_pts") ?? 0) > 0 && <span className="text-[10.5px] text-ink-muted">OT</span>}
        </span>
      ),
    },
    {
      key: "site", label: "Site", title: "Home (vs), away (@) or a neutral floor (N)", width: 50, align: "center", first: -1,
      sortValue: (g) => (g.is_neutral ? 1 : g.is_home ? 2 : 0),
      cell: (g) => <span className="text-ink-muted">{g.is_neutral ? "N" : g.is_home ? "vs" : "@"}</span>,
    },
    {
      key: "opp", label: "Opponent", width: 312, align: "left", first: 1,
      sortValue: (g) => g.opp_team_market ?? "",
      cell: (g) => {
        const post = postseasonTag(g);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo id={crestOf(g.opp_team_market)} name={g.opp_team_market ?? "?"} size={18} />
            <Rank rank={num(g, "opp_ap_rank")} />
            <span className="truncate text-ink-soft">{g.opp_team_market ?? "—"}</span>
            {seedOf(g, "opp_seed") != null && <Tag>{`${seedOf(g, "opp_seed")} seed`}</Tag>}
            {post ? (
              <Tag accent={post.accent} title={post.title}>
                {post.text}
              </Tag>
            ) : g.non_d1 ? (
              <Tag>Non-D-I</Tag>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "quad", label: "Quad", title: "The opponent's quadrant: their rank by adjusted net rating, against the NCAA's thresholds for this venue", width: 56, align: "center", first: 1,
      sortValue: (g) => g.quad ?? 4,
      cell: (g) => <span className="text-ink-soft tabular">{g.quad ? `Q${g.quad}` : "—"}</span>,
    },
    {
      key: "date", label: "Date", width: 112, align: "right", first: -1,
      sortValue: (g) => g.game_date,
      cell: (g) => <span className="whitespace-nowrap text-ink-soft">{shortDate(g.game_date)}</span>,
    },
  ];

  if (show.conf) {
    identity.push({
      key: "conf", label: "Conf", width: 96, align: "left", first: 1,
      sortValue: (g) => (g.team_conference ? confDisplay(g.team_conference) : null),
      cell: (g) => <span className="truncate text-ink-soft">{g.team_conference ? confDisplay(g.team_conference) : "—"}</span>,
    });
  }
  if (show.coach) {
    const { coachByTeamYear } = coachLookup();
    identity.push({
      key: "coach", label: "Coach", width: 150, align: "left", first: 1,
      sortValue: (g) => coachByTeamYear[g.team_name]?.[g.year] ?? null,
      cell: (g) => <span className="truncate text-ink-soft">{coachByTeamYear[g.team_name]?.[g.year] ?? "—"}</span>,
    });
  }

  const conditions: Column<GameLog>[] = cols.map((key) => {
    const label = statLabel(key);
    return {
      key: `stat:${key}`,
      label,
      title: label,
      // Wide enough for the band caption over a lone column.
      width: Math.max(108, Math.min(136, label.length * 8 + 30)),
      align: "right",
      first: -1,
      band: "Conditions",
      bandAccent: true,
      sortValue: (g) => num(g, key),
      cell: (g) => {
        const v = num(g, key);
        if (FLAG_KEYS.has(key)) return <span className="text-ink-soft">{formatStat(v, key)}</span>;
        const { pct, neutral } = gamePct(g, key);
        return <StatCell value={fmtValue(v, key)} pct={pct} neutral={neutral} strong />;
      },
    };
  });

  return [...identity, ...conditions];
}
