import { CalendarDays, Table2, UsersRound, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { PlayersView } from "~/views/players/players-view";
import { TeamGamesView } from "~/views/team-games/team-games-view";
import { TeamsView } from "~/views/teams/teams-view";

/**
 * Every view the app has, in sidebar order.
 *
 * THE SITE'S NAMES, grouped the way the site's own navigation groups them. A
 * reader who knows "Player Explorer" from btacbb.xyz should find it here under
 * the same words, in the same family.
 *
 * A view appears here when it is built, and not before. A sidebar full of
 * entries that open "coming soon" is a roadmap, not an app.
 */

/** Where a Ctrl K result goes: one team or one player, in one season. */
export type FocusTarget =
  | { kind: "team"; name: string; year: number }
  | { kind: "player"; bartId: number; name: string; year: number };

/** A target on its way. The nonce makes asking twice land twice. */
export type FocusRequest = FocusTarget & { nonce: number };

export type ViewProps = {
  year: number;
  setYear: (y: number) => void;
  query: string;
  /** A pending landing. Each view acts on the kind it shows, in the season named. */
  focus: FocusRequest | null;
  onLanded: (nonce: number) => void;
};

export type ViewDef = {
  id: string;
  label: string;
  section: "Teams" | "Players" | "Tools";
  icon: LucideIcon;
  filterPlaceholder: string;
  Component: ComponentType<ViewProps>;
};

export const VIEWS: ViewDef[] = [
  {
    id: "team-explorer",
    label: "Team Explorer",
    section: "Teams",
    icon: Table2,
    filterPlaceholder: "Filter teams or conferences",
    Component: TeamsView,
  },
  {
    id: "team-game-log",
    label: "Team Game Log",
    section: "Teams",
    icon: CalendarDays,
    filterPlaceholder: "Filter teams, opponents or conferences",
    Component: TeamGamesView,
  },
  {
    id: "player-explorer",
    label: "Player Explorer",
    section: "Players",
    icon: UsersRound,
    filterPlaceholder: "Filter players, teams, classes or hometowns",
    Component: PlayersView,
  },
];

export const viewById = (id: string | null | undefined): ViewDef => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;
