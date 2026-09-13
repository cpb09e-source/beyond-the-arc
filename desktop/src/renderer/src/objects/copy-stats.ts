import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { loadCoachBook } from "~/data/coach-model";
import { loadPlayerSeason } from "~/data/player-model";
import { shapeSeason, type Season } from "~/data/team-model";
import { loadOnce } from "~/data/use-corpus";
import { num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { playerStat } from "~/views/players/player-columns";
import { objTitle, siteUrl, type Obj } from "./object";

/**
 * An object's numbers as a few lines of text, for a message, a post or a note.
 *
 * THE NUMBERS THE APP SHOWS, in the order it shows them: a team's six highlight
 * stats with their percentiles, a player's, a coach's career. Each line ends in
 * the page's link, so whoever reads it can check it.
 *
 * READ FROM THE SAME CACHE the views use, under the same keys, so copying from a
 * table that is already open costs nothing.
 */

const ordinal = (n: number): string => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const stat = (label: string, value: string, pct?: number | null) =>
  `${label} ${value}${pct != null ? ` (${ordinal(Math.round(pct))} pct)` : ""}`;

async function teamLines(o: Extract<Obj, { kind: "team" }>): Promise<string[]> {
  const season = await loadOnce<Season>(`teams|${o.year}`, async () => {
    const { json, source } = await window.bta.data("teams", o.year);
    return { value: shapeSeason(o.year, JSON.parse(json) as StaticTeamSeasonRow[]), source };
  });
  const t = season.teams.find((x) => x.name === o.name);
  if (!t) return [`${o.name} · ${seasonLabel(o.year)}`];
  return [
    `${t.name} · ${seasonLabel(o.year)} · ${t.confLabel}`,
    [`${t.wins}–${t.losses}`, t.btaRank != null ? `BTA #${t.btaRank}` : null].filter(Boolean).join(" · "),
    [stat("Adj O", num1(t.adjO), t.pct.a_ortg), stat("Adj D", num1(t.adjD), t.pct.a_drtg), stat("Net", signed1(t.adjNet), t.pct.a_net)].join(" · "),
    [stat("Tempo", num1(t.tempo)), stat("eFG%", pct1(t.efg), t.pct.cbb_efg), stat("SOS", num1(t.sos), t.pct.adj_sos)].join(" · "),
  ];
}

async function playerLines(o: Extract<Obj, { kind: "player" }>): Promise<string[]> {
  const season = await loadOnce(`player-season|${o.year}`, () => loadPlayerSeason(o.year));
  const p = season.roster.find((x) => x.bartId === o.bartId);
  if (!p) return [`${o.name} · ${seasonLabel(o.year)}`];
  const keys = ["epm", season.hasEwins ? "ewins" : "usg_pct", "ppg", "rpg", "apg", "ts_pct"];
  const parts = keys.flatMap((key) => {
    const st = playerStat(key);
    return st ? [stat(st.label, st.format(p.s[st.field] as number | null), st.pctKey ? (p.pct[st.pctKey] ?? null) : null)] : [];
  });
  return [
    `${p.name} · ${p.team} · ${seasonLabel(o.year)}`,
    [p.cls, p.position, p.height].filter(Boolean).join(" · "),
    parts.slice(0, 3).join(" · "),
    parts.slice(3).join(" · "),
  ].filter(Boolean);
}

async function coachLines(o: Extract<Obj, { kind: "coach" }>): Promise<string[]> {
  const book = await loadCoachBook();
  const r = book.rows.find((x) => x.slug === o.slug);
  if (!r) return [o.name];
  const rank = book.compositeRank.get(r.slug);
  return [
    [r.name, r.current_team].filter(Boolean).join(" · "),
    `${r.career_wins}–${r.career_losses} since 2012-13${r.career_win_pct != null ? ` (${(r.career_win_pct * 100).toFixed(1)}%)` : ""} · ${r.seasons_count} ${r.seasons_count === 1 ? "season" : "seasons"}`,
    `${r.ncaa_appearances} NCAA ${r.ncaa_appearances === 1 ? "tournament" : "tournaments"}${r.ncaa_appearances > 0 ? `, ${r.tourney_wins}–${r.tourney_losses}` : ""}${r.final_fours > 0 ? ` · ${r.final_fours} Final ${r.final_fours === 1 ? "Four" : "Fours"}` : ""}`,
    rank != null ? `Composite résumé #${rank} of ${book.rows.length} coaches` : "",
  ].filter(Boolean);
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

export async function copyStats(o: Obj): Promise<string> {
  let lines: string[];
  switch (o.kind) {
    case "team":
      lines = await teamLines(o);
      break;
    case "player":
      lines = await playerLines(o);
      break;
    case "coach":
      lines = await coachLines(o);
      break;
    case "log-game":
      lines = [o.summary ?? objTitle(o), LONG_DATE.format(new Date(`${o.date}T12:00:00Z`))];
      break;
    default:
      lines = [objTitle(o)];
  }
  const url = siteUrl(o);
  return [...lines, ...(url ? [url] : [])].join("\n");
}
