import { CalendarDays, Sparkles, Swords, UserRound } from "lucide-react";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import { teamSlug } from "@/lib/team-slug";
import type { SearchData } from "~/data/search-model";
import { seasonLabel } from "~/ui/format";
import { normalizeText } from "~/ui/text";
import { isKnownDay, latestDay } from "~/views/scoreboard/board-model";
import { coachLookup } from "~/views/win-calc/calc-model";
import { DEFAULT_CALC, serializeCalc } from "~/views/win-calc/calc-state";
import type { PaletteItem } from "./command-palette";
import { prepare } from "./rank";

/**
 * Ctrl K rows that come from the words typed, and the coaches.
 *
 * WHAT PEOPLE TYPE IS OFTEN NOT A NAME. It is a question ("duke games where they
 * won the turnover battle"), a night ("march 19 2026"), or a matchup ("kansas vs
 * kentucky"). Each of those has a place in the app that answers it, and the
 * palette offers to go there only when the words actually read that way: a date
 * that had games, two schools it can name, a phrase long enough to be asked.
 */

type OpenView = (viewId: string, how: { newTab?: boolean; side?: boolean; query?: string; year?: number }) => void;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NIGHT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A night written the ways people write one: 2026-03-19, 3/19/2026, 3/19/26,
 * march 19 2026, mar 19. Without a year, the most recent such night on or
 * before the latest one the archive holds. Only a night with games counts.
 */
export function parseNight(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let y: number | null = null;
  let m: number;
  let d: number;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) {
    y = Number(r[1]);
    m = Number(r[2]);
    d = Number(r[3]);
  } else if ((r = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    m = Number(r[1]);
    d = Number(r[2]);
    y = r[3] ? (r[3].length === 2 ? 2000 + Number(r[3]) : Number(r[3])) : null;
  } else if ((r = t.match(/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/))) {
    const month = MONTHS.indexOf(r[1]!.slice(0, 3));
    if (month < 0) return null;
    m = month + 1;
    d = Number(r[2]);
    y = r[3] ? Number(r[3]) : null;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y == null) {
    const latest = latestDay();
    const ly = Number(latest.slice(0, 4));
    for (const yy of [ly, ly - 1]) {
      const day = `${yy}-${pad(m)}-${pad(d)}`;
      if (day <= latest && isKnownDay(day)) return day;
    }
    return null;
  }
  const day = `${y}-${pad(m)}-${pad(d)}`;
  return isKnownDay(day) ? day : null;
}

const teamNames = new WeakMap<SearchData, Map<string, string>>();

/** Our name for a school as typed: its name, or one of the site's nicknames for it. */
function resolveSchool(typed: string, data: SearchData): string | null {
  let m = teamNames.get(data);
  if (!m) {
    m = new Map();
    // Newest season last, so a school's current name wins.
    for (const t of [...data.teams].sort((a, b) => a.year - b.year)) {
      m.set(normalizeText(t.name), t.name);
      for (const alias of t.aliases.split(/\s+/).filter(Boolean)) {
        const key = normalizeText(alias);
        if (key.length >= 3 && !m.has(key)) m.set(key, t.name);
      }
    }
    teamNames.set(data, m);
  }
  const key = normalizeText(typed);
  return m.get(key) ?? m.get(key.replace(/\bstate\b/g, "st")) ?? null;
}

/** "kansas vs kentucky", "duke at unc", "gonzaga against saint marys". */
function schoolPair(text: string, data: SearchData | null): [string, string] | null {
  if (!data) return null;
  const parts = text.trim().split(/\s+(?:vs\.?|v\.?|versus|at|against|@)\s+/i);
  if (parts.length !== 2) return null;
  const a = resolveSchool(parts[0]!, data);
  const b = resolveSchool(parts[1]!, data);
  return a && b && a !== b ? [a, b] : null;
}

export function typedItems(
  query: string,
  ctx: { openView: OpenView; search: SearchData | null; current: { viewId: string; query: string } },
): PaletteItem[] {
  const text = query.trim();
  if (!text) return [];
  const out: PaletteItem[] = [];

  const night = parseNight(text);
  if (night) {
    out.push({
      id: `typed:night:${night}`,
      group: "typed",
      title: `Scores from ${NIGHT.format(new Date(`${night}T12:00:00Z`))}`,
      subtitle: "Scoreboard",
      leading: <CalendarDays size={15} strokeWidth={2} />,
      run: (how) => ctx.openView("scoreboard", { query: night === latestDay() ? "" : `d=${night}`, newTab: how.newTab, side: how.side }),
    });
  }

  const pair = schoolPair(text, ctx.search);
  if (pair) {
    out.push({
      id: `typed:matchup:${pair[0]}|${pair[1]}`,
      group: "typed",
      title: `Predict ${pair[0]} vs ${pair[1]}`,
      subtitle: "Matchup Predictor",
      leading: <Swords size={15} strokeWidth={2} />,
      run: (how) => ctx.openView("matchup", { query: `a=${teamSlug(pair[0])}&b=${teamSlug(pair[1])}`, newTab: how.newTab, side: how.side }),
    });
  }

  // Three words or more, and not only a date: something that could be asked.
  if (!night && normalizeText(text).split(" ").length >= 3 && text.length >= 10) {
    // Asked from inside the calculator, the question refines the one on screen.
    const base = ctx.current.viewId === "win-calc" ? ctx.current.query.replace(/(^|&)ask=[^&]*/g, "") : "";
    const ask = `ask=${encodeURIComponent(text.slice(0, 500))}`;
    out.push({
      id: "typed:ask",
      group: "typed",
      title: "Ask the Win Calculator",
      subtitle: `“${text}”`,
      leading: <Sparkles size={15} strokeWidth={2} className="text-accent" />,
      run: (how) => ctx.openView("win-calc", { query: [base, ask].filter(Boolean).join("&"), newTab: how.newTab, side: how.side }),
    });
  }

  return out;
}

/**
 * Every coach in the site's coach history, as a way into their games.
 *
 * INTO THE WIN CALCULATOR for now, narrowed to that coach and the seasons they
 * coached, which answers "how did Bill Self's teams do" in one step. The subtitle
 * names the school a coach was last at, which is how most people place a name.
 */
export function coachItems(openView: OpenView): PaletteItem[] {
  const { coachByTeamYear } = coachLookup();
  const coaches = new Map<string, { years: Set<number>; schools: Set<string>; latest: { team: string; year: number } }>();
  for (const [team, byYear] of Object.entries(coachByTeamYear)) {
    for (const [y, name] of Object.entries(byYear)) {
      const year = Number(y);
      const c = coaches.get(name) ?? { years: new Set<number>(), schools: new Set<string>(), latest: { team, year } };
      c.years.add(year);
      c.schools.add(team);
      if (year > c.latest.year) c.latest = { team, year };
      coaches.set(name, c);
    }
  }

  const items: PaletteItem[] = [];
  for (const [name, c] of coaches) {
    const years = [...c.years].filter((y) => ALL_SEASONS.includes(y)).sort((a, b) => b - a);
    const span =
      years.length === 0 ? "" : years.length === 1 ? seasonLabel(years[0]!) : `${seasonLabel(years[years.length - 1]!)} to ${seasonLabel(years[0]!)}`;
    const item: PaletteItem = {
      id: `coach:${name}`,
      group: "coaches",
      title: name,
      subtitle: [c.latest.team, span].filter(Boolean).join(" · "),
      keywords: ["coach", ...c.schools],
      // Under a school or a player who matches the same way; the most recent coaches first.
      weight: 18 + c.latest.year / 100,
      leading: <UserRound size={15} strokeWidth={2} />,
      trailing: <span className="text-[11.5px]">Win Calculator</span>,
      run: (how) =>
        openView("win-calc", {
          query: serializeCalc({ ...DEFAULT_CALC, years: years.length ? years : [SEASON_CEIL], coaches: [name] }),
          newTab: how.newTab,
          side: how.side,
        }),
    };
    item.prepared = prepare(item);
    items.push(item);
  }
  return items;
}
