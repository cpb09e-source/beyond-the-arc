import {
  AppWindow,
  ArrowUpRight,
  BookUser,
  CalendarDays,
  Calculator,
  Camera,
  ChartScatter,
  ClipboardCopy,
  Columns2,
  ExternalLink,
  Eye,
  GitCompareArrows,
  Link2,
  ListFilter,
  Shield,
  Star,
  StarOff,
  Swords,
  Table2,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { confDisplay } from "@/lib/conf-display";
import { SEASON_CEIL } from "@/lib/seasons";
import { teamSlug } from "@/lib/team-slug";
import { overrideTeam } from "@/lib/win-calc";
import { coachSeasons, teamHistory } from "~/data/team-history";
import type { PaletteItem } from "~/palette/command-palette";
import type { CompareItem } from "~/shell/compare";
import type { Shell } from "~/shell/shell-context";
import { profileViewFor, sameRecord, type RecordRef } from "~/shell/views";
import { Kbd } from "~/ui/kbd";
import type { MenuEntry, MenuItem } from "~/ui/menu";
import { logoIdOf } from "~/ui/logo-id";
import { scopedQuery } from "~/ui/scoped-query";
import type { ToastInput } from "~/ui/toast";
import { loadTeamNames, sideOf } from "~/views/scoreboard/board-model";
import { DEFAULT_CALC, serializeCalc } from "~/views/win-calc/calc-state";
import { copyStats } from "./copy-stats";
import { coachObj, objTitle, objYear, recordOf, siteUrl, type Obj } from "./object";

/**
 * Everything that can be done with an object, in one list.
 *
 * ONE LIST, EVERY SURFACE. Ctrl K's actions for the page in front, a
 * right-click on a row, a Peek's buttons, a record page's header and its ⋯
 * menu, the details rail, the row keys (C, F) and the shortcuts sheet all read
 * ACTIONS. An action added here appears in all of them, under the same words,
 * with the same icon and the same key; a surface only decides how much room it
 * has. Before this, each surface built its own list and they drifted apart.
 *
 * ONLY WHAT EXISTS. An action appears when it can be done: Compare for teams
 * and players, a coach only when the history names one for that season, Find
 * Similar not at all until it is built.
 *
 * TWO WAYS TO SAY EACH ONE. In a menu about Michigan, "Add to compare" is
 * enough; in Ctrl K, where nothing else names Michigan, the same action reads
 * "Compare Michigan".
 */

export type How = { newTab: boolean; side?: boolean };
export type Place = { viewId: string; year: number; query: string; record?: RecordRef };

/** What the app lends its actions. Built once per render of the workbench (see app.tsx). */
export type ActionEnv = {
  openRecord: Shell["openRecord"];
  openView: Shell["openView"];
  showInExplorer: Shell["showInExplorer"];
  /** A log row's game, found on its night's slate, or the fallback when the slate lacks it. */
  openGame: (row: { date: string; team: string; opp: string }, how: How, fallback: () => void) => void;
  addToCompare: (item: CompareItem) => void;
  isFavorite: (place: Place) => boolean;
  toggleFavorite: (place: Place, label: string) => void;
  /** Writes the clipboard and says so with `done`. */
  copyText: (text: string, done: string) => void;
  toast: (t: ToastInput) => void;
  /** Opens the snapshot sheet for a team, player, coach or game (~/snapshot/snapshot-sheet.tsx). */
  snapshot: (o: Obj) => void;
  /** The tab in front: an action about the page already open says less. */
  here: { viewId: string; year: number; query: string; record?: RecordRef };
};

/** What a surface can do beyond the app's own actions: a table can Peek its row. */
export type Local = { peek?: () => void };

export type ActionGroup = "open" | "collect" | "goto" | "related" | "filter" | "share";

export type ActionDef = {
  id: string;
  group: ActionGroup;
  icon: LucideIcon;
  /** Set when the icon follows state: a star that is already starred. */
  iconFor?: (o: Obj, env: ActionEnv) => LucideIcon;
  /** In a menu about the object. */
  label: (o: Obj, env: ActionEnv) => string;
  /** In Ctrl K, where nothing else names the object. */
  phrase: (o: Obj, env: ActionEnv) => string;
  /** On a record page's header, where room is short. */
  short?: string;
  /** Its keyboard shortcut, as written on the key caps. */
  hint?: string;
  /** Quiet words at the end of the row for a related object: "Coach". */
  aside?: string;
  /** A single key on a focused table row. */
  rowKey?: string;
  keywords?: string[];
  when: (o: Obj, env: ActionEnv, local: Local) => boolean;
  run: (o: Obj, env: ActionEnv, how: How, local: Local) => void;
};

export const GROUP_HEADING: Record<ActionGroup, string> = {
  open: "Open",
  collect: "Keep",
  goto: "Go to",
  related: "Related",
  filter: "Filter",
  share: "Share",
};

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The page already in front, in the season it is showing. */
export function isHere(o: Obj, env: ActionEnv): boolean {
  const record = recordOf(o);
  if (!record || !sameRecord(record, env.here.record) || env.here.viewId !== profileViewFor(record.kind)) return false;
  const year = objYear(o);
  return o.kind === "coach" || o.kind === "game" || year === env.here.year;
}

/** Where a favorite of this object points: its page, in its season. */
export function placeOf(o: Obj, env: ActionEnv): Place | null {
  const record = recordOf(o);
  return record ? { viewId: profileViewFor(record.kind), year: objYear(o) ?? env.here.year, query: "", record } : null;
}

function open(o: Obj, env: ActionEnv, how: How): void {
  const year = objYear(o) ?? undefined;
  if (o.kind === "log-game") {
    env.openGame({ date: o.date, team: o.team, opp: o.opp }, how, () =>
      env.openRecord(o.player ? { kind: "player", ...o.player } : { kind: "team", name: o.team, logoId: o.teamLogoId }, { ...how, year: o.year }),
    );
    return;
  }
  if (o.kind === "conference") {
    env.openView("team-explorer", { ...how, year: o.year, query: scopedQuery("conf", o.label) });
    return;
  }
  const record = recordOf(o);
  if (record) env.openRecord(record, { newTab: how.newTab, side: how.side, year });
}

/** The school an object belongs to, when it has one. */
function schoolOf(o: Obj): { name: string; logoId: number | null; year: number } | null {
  if (o.kind === "player" && o.team) return { name: o.team, logoId: o.teamLogoId ?? logoIdOf(o.team), year: o.year };
  if (o.kind === "coach" && o.team) return { name: o.team, logoId: logoIdOf(o.team), year: SEASON_CEIL };
  if (o.kind === "log-game") return { name: o.team, logoId: o.teamLogoId, year: o.year };
  return null;
}

/** Who coached the object's team that season, from the site's coach history. */
function coachOf(o: Obj): string | null {
  const team = o.kind === "team" ? o.name : o.kind === "player" ? o.team : null;
  const year = objYear(o);
  if (!team || year == null) return null;
  return teamHistory(team).find((h) => h.year === year)?.coach ?? null;
}

const confOf = (o: Obj): string | null =>
  o.kind === "conference" ? o.label : (o.kind === "team" || o.kind === "player") && o.conf ? confDisplay(o.conf) || o.conf : null;

/** A game record's side, in our spelling: its crest and page need our name, not CBBD's. */
function openSide(o: Extract<Obj, { kind: "game" }>, cbbd: string, env: ActionEnv, how: How): void {
  void loadTeamNames().then((names) => {
    const s = sideOf(names, cbbd);
    if (s.ours) env.openRecord({ kind: "team", name: s.ours, logoId: s.logoId }, { ...how, year: o.season });
    else env.toast({ title: `${cbbd} has no team page`, body: "The app keeps pages for Division I teams only." });
  });
}

export const ACTIONS: ActionDef[] = [
  {
    id: "open",
    group: "open",
    icon: ArrowUpRight,
    label: () => "Open",
    phrase: (o) => `Open ${objTitle(o)}`,
    hint: "Enter",
    when: (o, env) => !isHere(o, env),
    run: (o, env, how) => open(o, env, how),
  },
  {
    id: "open-tab",
    group: "open",
    icon: AppWindow,
    label: () => "Open in new tab",
    phrase: (o) => `Open ${objTitle(o)} in a new tab`,
    hint: "Ctrl Enter",
    when: (o, env) => !isHere(o, env),
    run: (o, env) => open(o, env, { newTab: true }),
  },
  {
    id: "open-side",
    group: "open",
    icon: Columns2,
    label: () => "Open beside",
    phrase: (o) => `Open ${objTitle(o)} beside this tab`,
    short: "Beside",
    hint: "Shift Enter",
    keywords: ["split", "side"],
    when: (o, env) => !isHere(o, env),
    run: (o, env) => open(o, env, { newTab: false, side: true }),
  },
  {
    id: "peek",
    group: "open",
    icon: Eye,
    label: () => "Peek",
    phrase: (o) => `Peek at ${objTitle(o)}`,
    hint: "Space",
    when: (_o, _env, local) => !!local.peek,
    run: (_o, _env, _how, local) => local.peek?.(),
  },

  {
    id: "compare",
    group: "collect",
    icon: GitCompareArrows,
    label: () => "Add to compare",
    phrase: (o) => `Compare ${objTitle(o)}`,
    short: "Compare",
    hint: "C",
    rowKey: "c",
    keywords: ["compare", "tray", "side by side", "versus"],
    when: (o) => o.kind === "team" || o.kind === "player",
    run: (o, env) => {
      if (o.kind === "team") env.addToCompare({ kind: "team", name: o.name, logoId: o.logoId, year: o.year });
      else if (o.kind === "player") env.addToCompare({ kind: "player", bartId: o.bartId, name: o.name, hasPhoto: o.hasPhoto, year: o.year });
    },
  },
  {
    id: "favorite",
    group: "collect",
    icon: Star,
    iconFor: (o, env) => (isStarred(o, env) ? StarOff : Star),
    label: (o, env) => (isStarred(o, env) ? "Remove from favorites" : "Add to favorites"),
    phrase: (o, env) => (isStarred(o, env) ? `Remove ${objTitle(o)} from favorites` : `Add ${objTitle(o)} to favorites`),
    hint: "F",
    rowKey: "f",
    keywords: ["favorite", "star", "bookmark", "save"],
    when: (o) => recordOf(o) != null,
    run: (o, env) => {
      const place = placeOf(o, env);
      if (place) env.toggleFavorite(place, objTitle(o));
    },
  },

  {
    id: "explorer",
    group: "goto",
    icon: Table2,
    iconFor: (o) => (o.kind === "player" ? UsersRound : Table2),
    label: (o) => (o.kind === "player" ? "Player Explorer" : "Team Explorer"),
    phrase: (o) => `Show ${objTitle(o)} in the ${o.kind === "player" ? "Player" : "Team"} Explorer`,
    keywords: ["explorer", "table", "row"],
    when: (o, env) =>
      (o.kind === "team" && env.here.viewId !== "team-explorer") || (o.kind === "player" && env.here.viewId !== "player-explorer"),
    run: (o, env, how) => {
      if (o.kind === "team") env.showInExplorer({ kind: "team", name: o.name, year: o.year }, how.newTab);
      else if (o.kind === "player") env.showInExplorer({ kind: "player", bartId: o.bartId, name: o.name, year: o.year }, how.newTab);
    },
  },
  {
    id: "scatter",
    group: "goto",
    icon: ChartScatter,
    label: () => "Team Scatter",
    phrase: (o) => (o.kind === "conference" ? `${o.label} on Team Scatter` : `Show ${objTitle(o)} on Team Scatter`),
    keywords: ["scatter", "chart", "plot", "contender", "trapezoid"],
    when: (o, env) => (o.kind === "team" || o.kind === "conference") && env.here.viewId !== "team-scatter",
    run: (o, env, how) => {
      if (o.kind === "team") env.openView("team-scatter", { ...how, year: o.year, query: `team=${encodeURIComponent(o.name)}` });
      else if (o.kind === "conference") env.openView("team-scatter", { ...how, year: o.year, query: `field=${encodeURIComponent(`conf:${o.conf}`)}` });
    },
  },
  {
    id: "game-log",
    group: "goto",
    icon: CalendarDays,
    label: () => "Game log",
    phrase: (o) => `${possessive(objTitle(o))} game log`,
    keywords: ["games", "log", "schedule", "results"],
    when: (o) => o.kind === "team" || o.kind === "player",
    run: (o, env, how) => {
      if (o.kind === "team") env.openView("team-game-log", { ...how, year: o.year, query: scopedQuery("team", o.name) });
      else if (o.kind === "player") env.openView("player-game-log", { ...how, year: o.year, query: scopedQuery("player", o.name) });
    },
  },
  {
    id: "matchup",
    group: "goto",
    icon: Swords,
    label: (o) => (o.kind === "log-game" ? "Predict this matchup" : "Predict a game"),
    phrase: (o) => (o.kind === "log-game" ? `Predict ${o.team} vs ${o.opp}` : `Predict a ${objTitle(o)} game`),
    short: "Matchup",
    keywords: ["matchup", "predict", "odds", "versus", "vs"],
    when: (o) => o.kind === "team" || (o.kind === "log-game" && !o.player),
    run: (o, env, how) => {
      if (o.kind === "team") env.openView("matchup", { ...how, query: `a=${teamSlug(o.name)}` });
      else if (o.kind === "log-game") env.openView("matchup", { ...how, query: `a=${teamSlug(o.team)}&b=${teamSlug(o.opp)}` });
    },
  },
  {
    id: "win-calc",
    group: "goto",
    icon: Calculator,
    label: () => "Win Calculator",
    phrase: (o) => (o.kind === "coach" ? `Every game ${o.name} coached, in the Win Calculator` : `Every ${objTitle(o)} game, in the Win Calculator`),
    short: "Win Calculator",
    keywords: ["win calculator", "games", "how often"],
    when: (o) => o.kind === "team" || o.kind === "coach",
    run: (o, env, how) => {
      if (o.kind === "team") {
        env.openView("win-calc", { ...how, query: serializeCalc({ ...DEFAULT_CALC, teams: [overrideTeam(o.name)], years: [o.year] }) });
      } else if (o.kind === "coach") {
        env.openView("win-calc", { ...how, query: serializeCalc({ ...DEFAULT_CALC, coaches: [o.name], years: coachSeasons(o.name) }) });
      }
    },
  },

  {
    id: "team",
    group: "related",
    icon: Shield,
    label: (o) => schoolOf(o)?.name ?? "",
    phrase: (o) => `Open ${schoolOf(o)?.name ?? ""}`,
    aside: "Team",
    when: (o) => schoolOf(o) != null,
    run: (o, env, how) => {
      const s = schoolOf(o);
      if (s) env.openRecord({ kind: "team", name: s.name, logoId: s.logoId }, { ...how, year: s.year });
    },
  },
  {
    id: "opponent",
    group: "related",
    icon: Shield,
    label: (o) => (o.kind === "log-game" ? o.opp : ""),
    phrase: (o) => (o.kind === "log-game" ? `Open ${o.opp}` : ""),
    aside: "Opponent",
    when: (o) => o.kind === "log-game",
    run: (o, env, how) => {
      if (o.kind === "log-game") env.openRecord({ kind: "team", name: o.opp, logoId: o.oppLogoId }, { ...how, year: o.year });
    },
  },
  {
    id: "player",
    group: "related",
    icon: UserRound,
    label: (o) => (o.kind === "log-game" ? (o.player?.name ?? "") : ""),
    phrase: (o) => (o.kind === "log-game" ? `Open ${o.player?.name ?? ""}` : ""),
    aside: "Player",
    when: (o) => o.kind === "log-game" && !!o.player,
    run: (o, env, how) => {
      if (o.kind === "log-game" && o.player) env.openRecord({ kind: "player", ...o.player }, { ...how, year: o.year });
    },
  },
  {
    id: "coach",
    group: "related",
    icon: BookUser,
    label: (o) => coachOf(o) ?? "",
    phrase: (o) => `Open ${coachOf(o) ?? ""}`,
    aside: "Coach",
    when: (o) => coachOf(o) != null,
    run: (o, env, how) => {
      const coach = coachOf(o);
      const team = o.kind === "team" ? o.name : o.kind === "player" ? (o.team ?? null) : null;
      if (coach) env.openRecord(recordOf(coachObj(coach, team))!, how);
    },
  },
  {
    id: "away",
    group: "related",
    icon: Shield,
    label: (o) => (o.kind === "game" ? o.away : ""),
    phrase: (o) => (o.kind === "game" ? `Open ${o.away}` : ""),
    aside: "Away",
    when: (o) => o.kind === "game",
    run: (o, env, how) => {
      if (o.kind === "game") openSide(o, o.away, env, how);
    },
  },
  {
    id: "home",
    group: "related",
    icon: Shield,
    label: (o) => (o.kind === "game" ? o.home : ""),
    phrase: (o) => (o.kind === "game" ? `Open ${o.home}` : ""),
    aside: "Home",
    when: (o) => o.kind === "game",
    run: (o, env, how) => {
      if (o.kind === "game") openSide(o, o.home, env, how);
    },
  },

  {
    id: "filter-conf-teams",
    group: "filter",
    icon: ListFilter,
    label: (o) => `${confOf(o)} teams`,
    phrase: (o) => `${confOf(o)} teams, in the Team Explorer`,
    keywords: ["conference", "filter"],
    when: (o, env) => (o.kind === "team" || o.kind === "conference") && confOf(o) != null && !(env.here.viewId === "team-explorer" && o.kind === "team" && env.here.query === scopedQuery("conf", confOf(o)!)),
    run: (o, env, how) => env.openView("team-explorer", { ...how, year: objYear(o) ?? undefined, query: scopedQuery("conf", confOf(o)!) }),
  },
  {
    id: "filter-conf-players",
    group: "filter",
    icon: ListFilter,
    label: (o) => `${confOf(o)} players`,
    phrase: (o) => `${confOf(o)} players, in the Player Explorer`,
    keywords: ["conference", "filter"],
    when: (o) => (o.kind === "player" || o.kind === "conference") && confOf(o) != null,
    run: (o, env, how) => env.openView("player-explorer", { ...how, year: objYear(o) ?? undefined, query: scopedQuery("conf", confOf(o)!) }),
  },
  {
    id: "filter-opponents",
    group: "filter",
    icon: ListFilter,
    label: (o) => `${possessive(objTitle(o))} opponents`,
    phrase: (o) => `${possessive(objTitle(o))} opponents, in the Team Explorer`,
    keywords: ["opponents", "schedule", "played", "filter"],
    when: (o) => o.kind === "team",
    run: (o, env, how) => {
      if (o.kind === "team") env.openView("team-explorer", { ...how, year: o.year, query: scopedQuery("opponents", o.name) });
    },
  },
  {
    id: "filter-team-players",
    group: "filter",
    icon: ListFilter,
    label: (o) => `${o.kind === "team" ? o.name : o.kind === "player" ? o.team : ""} players`,
    phrase: (o) => `${o.kind === "team" ? o.name : o.kind === "player" ? o.team : ""} players, in the Player Explorer`,
    keywords: ["roster", "players", "filter"],
    when: (o) => o.kind === "team" || (o.kind === "player" && !!o.team),
    run: (o, env, how) => {
      const team = o.kind === "team" ? o.name : o.kind === "player" ? o.team : null;
      if (team) env.openView("player-explorer", { ...how, year: objYear(o) ?? undefined, query: scopedQuery("team", team) });
    },
  },

  {
    id: "snapshot",
    group: "share",
    icon: Camera,
    label: () => "Snapshot card",
    phrase: (o) => `Make a snapshot card of ${objTitle(o)}`,
    short: "Snapshot",
    keywords: ["snapshot", "image", "picture", "card", "share", "post", "png", "screenshot"],
    when: (o) => o.kind === "team" || o.kind === "player" || o.kind === "coach" || o.kind === "game",
    run: (o, env) => env.snapshot(o),
  },
  {
    id: "copy-stats",
    group: "share",
    icon: ClipboardCopy,
    label: (o) => (o.kind === "log-game" ? "Copy the line" : "Copy stats"),
    phrase: (o) => (o.kind === "log-game" ? `Copy the line for ${objTitle(o)}` : `Copy ${possessive(objTitle(o))} stats`),
    keywords: ["copy", "stats", "numbers", "clipboard", "text"],
    when: (o) => o.kind === "team" || o.kind === "player" || o.kind === "coach" || o.kind === "log-game",
    run: (o, env) => {
      void copyStats(o).then(
        (text) => env.copyText(text, o.kind === "log-game" ? "Line copied" : "Stats copied"),
        () => env.toast({ title: "The stats could not be copied", body: "That season did not load." }),
      );
    },
  },
  {
    id: "copy-link",
    group: "share",
    icon: Link2,
    label: () => "Copy link",
    phrase: (o) => `Copy the link to ${objTitle(o)}`,
    keywords: ["link", "url", "share", "website"],
    when: (o) => siteUrl(o) != null,
    run: (o, env) => env.copyText(siteUrl(o)!, "Link copied"),
  },
  {
    id: "open-site",
    group: "share",
    icon: ExternalLink,
    label: () => "Open on btacbb.xyz",
    phrase: (o) => `Open ${objTitle(o)} on btacbb.xyz`,
    keywords: ["website", "browser", "site"],
    when: (o) => siteUrl(o) != null,
    run: (o) => void window.open(siteUrl(o)!),
  },
];

function isStarred(o: Obj, env: ActionEnv): boolean {
  const place = placeOf(o, env);
  return !!place && env.isFavorite(place);
}

export const actionById = (id: string): ActionDef | undefined => ACTIONS.find((a) => a.id === id);

export function actionsFor(o: Obj, env: ActionEnv, local: Local = {}): ActionDef[] {
  return ACTIONS.filter((a) => a.when(o, env, local));
}

/** Run one action by id, if it applies to this object here. */
export function runAction(id: string, o: Obj, env: ActionEnv, how: How = { newTab: false }, local: Local = {}): boolean {
  const a = actionById(id);
  if (!a || !a.when(o, env, local)) return false;
  a.run(o, env, how, local);
  return true;
}

export const iconOf = (a: ActionDef, o: Obj, env: ActionEnv): LucideIcon => a.iconFor?.(o, env) ?? a.icon;

function entryOf(a: ActionDef, o: Obj, env: ActionEnv, local: Local): MenuItem {
  const Icon = iconOf(a, o, env);
  return {
    kind: "item",
    id: a.id,
    label: a.label(o, env),
    icon: <Icon size={14} strokeWidth={2} />,
    hint: a.hint ? <Kbd>{a.hint}</Kbd> : a.aside ? <span>{a.aside}</span> : undefined,
    onSelect: () => a.run(o, env, { newTab: false }, local),
  };
}

/**
 * The menu for one object: how to open it, what to keep it in, and the rest
 * folded to the side (Go to ›, Filter ›, Share ›) so the first level stays a
 * dozen rows. Related objects stay on the first level: they are the quickest
 * way from a row to the next thing.
 */
export function menuFor(o: Obj, env: ActionEnv, local: Local = {}): MenuEntry[] {
  const list = actionsFor(o, env, local);
  const of = (g: ActionGroup) => list.filter((a) => a.group === g).map((a) => entryOf(a, o, env, local));
  const blocks: MenuEntry[][] = [];
  const folded = (g: ActionGroup, entries: MenuItem[], icon: ReactIcon): MenuEntry[] =>
    entries.length > 1 ? [{ kind: "item", id: `sub:${g}`, label: GROUP_HEADING[g], icon, submenu: entries }] : entries;

  const opens = of("open");
  if (opens.length) blocks.push(opens);
  const keeps = of("collect");
  if (keeps.length) blocks.push(keeps);
  const nav = [
    ...folded("goto", of("goto"), <ArrowUpRight size={14} strokeWidth={2} />),
    ...folded("filter", of("filter"), <ListFilter size={14} strokeWidth={2} />),
    ...of("related"),
  ];
  if (nav.length) blocks.push(nav);
  const share = of("share");
  // Making something to share stays on the first level; the links fold under Share.
  const quick = new Set(["snapshot", "copy-stats"]);
  const copy = share.filter((e) => quick.has(e.id));
  const links = share.filter((e) => !quick.has(e.id));
  const shareBlock = [...copy, ...folded("share", links, <Link2 size={14} strokeWidth={2} />)];
  if (shareBlock.length) blocks.push(shareBlock);

  return blocks.flatMap((b, i) => (i === 0 ? b : [{ kind: "separator", id: `sep:${i}` } as MenuEntry, ...b]));
}

type ReactIcon = MenuItem["icon"];

/** Actions that open the object, or keep the page in front, say nothing about the page in front. */
const NOT_FOR_HERE = new Set(["open", "open-tab", "open-side", "peek", "favorite"]);

/**
 * The object's actions as Ctrl K rows.
 *
 * "context": the page in front, mixed into the palette's Actions, each phrased
 * with the object's name. "drill": one result's own list after Tab, headed by
 * group, where the name is already on screen.
 */
export function paletteItemsFor(o: Obj, env: ActionEnv, mode: "context" | "drill"): PaletteItem[] {
  const list = actionsFor(o, env).filter((a) => mode === "drill" || !(NOT_FOR_HERE.has(a.id) && isHere(o, env)));
  return list.map((a, i) => {
    const Icon = iconOf(a, o, env);
    return {
      id: `${mode}:${a.id}`,
      group: mode === "drill" ? `act:${a.group}` : "actions",
      title: mode === "drill" ? a.label(o, env) : a.phrase(o, env),
      subtitle: mode === "drill" ? a.aside : undefined,
      keywords: [...(a.keywords ?? []), GROUP_HEADING[a.group]],
      // Context actions sit above views and objects that merely share a word; a drilled list keeps its order.
      weight: mode === "context" ? 350 : 100 - i,
      leading: <Icon size={15} strokeWidth={2} />,
      trailing: mode === "drill" && a.hint && a.group === "open" ? <Kbd>{a.hint}</Kbd> : undefined,
      // On Michigan's page, Tab on "Compare Michigan" still opens everything Michigan can do.
      object: mode === "context" ? o : undefined,
      run: (how) => a.run(o, env, how, {}),
    };
  });
}
