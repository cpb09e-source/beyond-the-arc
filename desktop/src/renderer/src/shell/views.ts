import type { TableLayout } from "./table-layout";
import {
  ArrowLeftRight,
  BookUser,
  Calculator,
  ClipboardList,
  LayoutGrid,
  CalendarClock,
  CalendarDays,
  ChartScatter,
  History,
  House,
  GitCompareArrows,
  Scale,
  ScanSearch,
  Shield,
  Swords,
  Table2,
  Trophy,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { SEASON_CEIL } from "@/lib/seasons";
import { CoachProfileView } from "~/views/coach-profile/coach-profile-view";
import { CoachesView } from "~/views/coaches/coaches-view";
import { CompareView } from "~/views/compare/compare-view";
import { ConferencesView } from "~/views/conferences/conferences-view";
import { DifferenceView } from "~/views/difference/difference-view";
import { FindSimilarView } from "~/views/similar/similar-view";
import { parseSimilarQuery, similarQuery } from "~/similar/similar-query";
import { MatchupView } from "~/views/matchup/matchup-view";
import { PlayerGamesView } from "~/views/player-games/player-games-view";
import { PortalView } from "~/views/portal/portal-view";
import { PlayerProfileView } from "~/views/player-profile/player-profile-view";
import { PlayersView } from "~/views/players/players-view";
import { TeamGamesView } from "~/views/team-games/team-games-view";
import { TeamProfileView } from "~/views/team-profile/team-profile-view";
import { TeamScatterView } from "~/views/team-scatter/team-scatter-view";
import { GameView } from "~/views/game/game-view";
import { HomeView } from "~/views/home/home-view";
import { ScoreboardView } from "~/views/scoreboard/scoreboard-view";
import { TeamsView } from "~/views/teams/teams-view";
import { WinCalcView } from "~/views/win-calc/calc-view";
import { WhatChangedView } from "~/views/what-changed/what-changed-view";

/**
 * Every view the app has.
 *
 * THE SITE'S NAMES, grouped the way the site's own navigation groups them. A
 * reader who knows "Player Explorer" from btacbb.xyz should find it here under
 * the same words, in the same family.
 *
 * A view appears here when it is built, and not before. A sidebar full of
 * entries that open "coming soon" is a roadmap, not an app.
 *
 * PROFILES ARE VIEWS TOO, about one object instead of a table of them. They
 * open from a row, a Peek or a search result, never from the sidebar, and a tab
 * holding one carries the record it is about.
 */

/** Where "show in explorer" goes: one team or one player's row, in one season. */
export type FocusTarget =
  | { kind: "team"; name: string; year: number }
  | { kind: "player"; bartId: number; name: string; year: number };

/** A target on its way. The nonce makes asking twice land twice. */
export type FocusRequest = FocusTarget & { nonce: number };

/**
 * One object a tab can be about. It carries what the tab strip needs to draw it
 * before the profile has loaded anything: a name, and a crest or a photo.
 */
export type RecordRef =
  | { kind: "team"; name: string; logoId: number | null }
  | { kind: "player"; bartId: number; name: string; hasPhoto: boolean }
  /**
   * One game of one season, by CBBD id. `name` is how its tab reads ("Duke at
   * North Carolina"); `away` and `home` are CBBD's spellings, and both crests
   * ride along so the tab strip can draw them before the box score loads.
   */
  | {
      kind: "game";
      season: number;
      id: number;
      name: string;
      away: string;
      home: string;
      awayLogo: number | null;
      homeLogo: number | null;
    }
  /** A coach, by the site's slug. `team` is the school coached, or last coached, for the mark. */
  | { kind: "coach"; slug: string; name: string; team: string | null };

export type ViewProps = {
  year: number;
  setYear: (y: number) => void;
  query: string;
  setQuery: (q: string) => void;
  /** A pending landing. Each view acts on the kind it shows, in the season named. */
  focus: FocusRequest | null;
  onLanded: (nonce: number) => void;
  /** The object a profile is about. Undefined for every table view. */
  record?: RecordRef;
  /** This tab's table layout: its column view and the stats added as columns (./table-layout.ts). */
  table: TableLayout;
  setTable: (table: TableLayout) => void;
  /** The name this tab, as it stands, is saved under as a favorite, or null. Save view's form names, renames or removes it. */
  savedAs: string | null;
  saveView: (label: string) => void;
  unsaveView: () => void;
};

export type ViewDef = {
  id: string;
  label: string;
  section: "Home" | "Teams" | "Players" | "Games" | "Tools";
  icon: LucideIcon;
  filterPlaceholder: string;
  Component: ComponentType<ViewProps>;
  /** Set on a profile: the kind of record it opens. Profiles stay out of navigation. */
  profile?: RecordRef["kind"];
  /**
   * Set on a view that exists for one season only. A tab holding it takes that
   * season, and the season switcher and [ ] leave it alone.
   */
  season?: number;
  /**
   * Set on a view about no one season (Compare, the Win Calculator), which picks
   * its seasons itself: its tab and its favorites name no season, and Ctrl K
   * does not offer to step one.
   */
  seasonless?: boolean;
  /**
   * Set on a view the sidebar lists more than once, each entry opening it a
   * particular way: Find Similar under Teams opens on teams, under Players on
   * players. `isCurrent` says which entry a tab on the view is.
   */
  nav?: { section: ViewDef["section"]; query: string; isCurrent: (query: string) => boolean }[];
};

/** One row in the sidebar and in the palette's Go to: a view, sometimes opened a particular way. */
export type NavEntry = {
  key: string;
  viewId: string;
  label: string;
  section: ViewDef["section"];
  icon: LucideIcon;
  /** The query this entry opens its view with. Undefined for a view listed once. */
  query?: string;
  isCurrent: (viewId: string, query: string) => boolean;
};

export const VIEWS: ViewDef[] = [
  {
    id: "home",
    label: "Home",
    section: "Home",
    icon: House,
    filterPlaceholder: "",
    Component: HomeView,
    seasonless: true,
  },
  {
    id: "team-explorer",
    label: "Team Explorer",
    section: "Teams",
    icon: Table2,
    filterPlaceholder: "Filter teams",
    Component: TeamsView,
  },
  {
    id: "team-game-log",
    label: "Team Game Log",
    section: "Teams",
    icon: CalendarDays,
    filterPlaceholder: "Filter games",
    Component: TeamGamesView,
  },
  {
    id: "what-changed",
    label: "What Changed",
    section: "Teams",
    icon: History,
    filterPlaceholder: "",
    Component: WhatChangedView,
  },
  {
    id: "team-scatter",
    label: "Team Scatter",
    section: "Teams",
    icon: ChartScatter,
    filterPlaceholder: "",
    Component: TeamScatterView,
  },
  {
    id: "conferences",
    label: "Conference Power Rankings",
    section: "Teams",
    icon: Trophy,
    filterPlaceholder: "Filter conferences",
    Component: ConferencesView,
  },
  {
    id: "coaches",
    label: "Coaches",
    section: "Teams",
    icon: BookUser,
    filterPlaceholder: "Filter coaches",
    Component: CoachesView,
    seasonless: true,
  },
  {
    id: "matchup",
    label: "Matchup Predictor",
    section: "Teams",
    icon: Swords,
    filterPlaceholder: "",
    Component: MatchupView,
    // The site publishes the predictor for its latest completed season only
    // (src/app/matchup/page.tsx).
    season: SEASON_CEIL,
  },
  {
    id: "player-explorer",
    label: "Player Explorer",
    section: "Players",
    icon: UsersRound,
    filterPlaceholder: "Filter players",
    Component: PlayersView,
  },
  {
    id: "player-game-log",
    label: "Player Game Log",
    section: "Players",
    icon: CalendarClock,
    filterPlaceholder: "Filter games",
    Component: PlayerGamesView,
  },
  {
    id: "portal",
    label: "Transfer Portal",
    section: "Players",
    icon: ArrowLeftRight,
    filterPlaceholder: "Filter players or schools",
    Component: PortalView,
    // One file for the cycle that follows the latest completed season.
    season: SEASON_CEIL,
  },
  {
    id: "scoreboard",
    label: "Scoreboard",
    section: "Games",
    icon: LayoutGrid,
    filterPlaceholder: "Filter teams",
    Component: ScoreboardView,
    seasonless: true,
  },
  {
    id: "win-calc",
    seasonless: true,
    label: "Win Calculator",
    section: "Tools",
    icon: Calculator,
    filterPlaceholder: "Filter games",
    Component: WinCalcView,
  },
  {
    id: "compare",
    seasonless: true,
    label: "Compare",
    section: "Tools",
    icon: GitCompareArrows,
    filterPlaceholder: "",
    Component: CompareView,
  },
  {
    id: "difference",
    seasonless: true,
    label: "Difference Explainer",
    section: "Tools",
    icon: Scale,
    filterPlaceholder: "",
    Component: DifferenceView,
  },
  {
    id: "find-similar",
    seasonless: true,
    label: "Find Similar",
    section: "Teams",
    icon: ScanSearch,
    filterPlaceholder: "",
    Component: FindSimilarView,
    // Listed under Teams and under Players, each opening on its own kind.
    nav: [
      { section: "Teams", query: similarQuery({ kind: "team" }), isCurrent: (q) => parseSimilarQuery(q).kind === "team" },
      { section: "Players", query: similarQuery({ kind: "player" }), isCurrent: (q) => parseSimilarQuery(q).kind === "player" },
    ],
  },
  {
    id: "team-profile",
    label: "Team",
    section: "Teams",
    icon: Shield,
    filterPlaceholder: "",
    Component: TeamProfileView,
    profile: "team",
  },
  {
    id: "player-profile",
    label: "Player",
    section: "Players",
    icon: UserRound,
    filterPlaceholder: "",
    Component: PlayerProfileView,
    profile: "player",
  },
  {
    id: "coach-profile",
    label: "Coach",
    section: "Teams",
    icon: BookUser,
    filterPlaceholder: "",
    Component: CoachProfileView,
    profile: "coach",
    seasonless: true,
  },
  {
    id: "game",
    label: "Game",
    section: "Games",
    icon: ClipboardList,
    filterPlaceholder: "",
    Component: GameView,
    profile: "game",
  },
];

/** What the sidebar and the palette's "Go to" list: every view but the profiles. */
export const NAV_VIEWS: ViewDef[] = VIEWS.filter((v) => !v.profile);

/** The rows of the sidebar and the palette's Go to, in order: a view listed twice appears in each of its sections. */
export const NAV_ENTRIES: NavEntry[] = NAV_VIEWS.flatMap((v): NavEntry[] =>
  v.nav
    ? v.nav.map((n) => ({
        key: `${v.id}:${n.section}`,
        viewId: v.id,
        label: v.label,
        section: n.section,
        icon: v.icon,
        query: n.query,
        isCurrent: (viewId, query) => viewId === v.id && n.isCurrent(query),
      }))
    : [{ key: v.id, viewId: v.id, label: v.label, section: v.section, icon: v.icon, isCurrent: (viewId) => viewId === v.id }],
);

export const viewById = (id: string | null | undefined): ViewDef => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;

export const profileViewFor = (kind: RecordRef["kind"]): string =>
  kind === "team" ? "team-profile" : kind === "player" ? "player-profile" : kind === "coach" ? "coach-profile" : "game";

export function isRecordRef(r: unknown): r is RecordRef {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  if (o.kind === "team") return typeof o.name === "string" && (o.logoId === null || typeof o.logoId === "number");
  if (o.kind === "player") {
    return typeof o.bartId === "number" && typeof o.name === "string" && typeof o.hasPhoto === "boolean";
  }
  if (o.kind === "game") {
    return (
      typeof o.season === "number" &&
      typeof o.id === "number" &&
      typeof o.name === "string" &&
      typeof o.away === "string" &&
      typeof o.home === "string" &&
      (o.awayLogo === null || typeof o.awayLogo === "number") &&
      (o.homeLogo === null || typeof o.homeLogo === "number")
    );
  }
  if (o.kind === "coach") {
    return typeof o.slug === "string" && typeof o.name === "string" && (o.team === null || typeof o.team === "string");
  }
  return false;
}

export function sameRecord(a: RecordRef | undefined, b: RecordRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "team" && b.kind === "team") return a.name === b.name;
  if (a.kind === "player" && b.kind === "player") return a.bartId === b.bartId;
  if (a.kind === "game" && b.kind === "game") return a.season === b.season && a.id === b.id;
  if (a.kind === "coach" && b.kind === "coach") return a.slug === b.slug;
  return false;
}
