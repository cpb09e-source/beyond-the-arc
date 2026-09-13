import { CalendarClock, CalendarDays, ChartScatter, Shield, Table2, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { PlayerGamesView } from "~/views/player-games/player-games-view";
import { PlayerProfileView } from "~/views/player-profile/player-profile-view";
import { PlayersView } from "~/views/players/players-view";
import { TeamGamesView } from "~/views/team-games/team-games-view";
import { TeamProfileView } from "~/views/team-profile/team-profile-view";
import { TeamScatterView } from "~/views/team-scatter/team-scatter-view";
import { TeamsView } from "~/views/teams/teams-view";

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
  | { kind: "player"; bartId: number; name: string; hasPhoto: boolean };

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
};

export type ViewDef = {
  id: string;
  label: string;
  section: "Teams" | "Players" | "Tools";
  icon: LucideIcon;
  filterPlaceholder: string;
  Component: ComponentType<ViewProps>;
  /** Set on a profile: the kind of record it opens. Profiles stay out of navigation. */
  profile?: RecordRef["kind"];
};

export const VIEWS: ViewDef[] = [
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
    id: "team-scatter",
    label: "Team Scatter",
    section: "Teams",
    icon: ChartScatter,
    filterPlaceholder: "",
    Component: TeamScatterView,
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
];

/** What the sidebar and the palette's "Go to" list: every view but the profiles. */
export const NAV_VIEWS: ViewDef[] = VIEWS.filter((v) => !v.profile);

export const viewById = (id: string | null | undefined): ViewDef => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;

export const profileViewFor = (kind: RecordRef["kind"]): string => (kind === "team" ? "team-profile" : "player-profile");

export function isRecordRef(r: unknown): r is RecordRef {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  if (o.kind === "team") return typeof o.name === "string" && (o.logoId === null || typeof o.logoId === "number");
  if (o.kind === "player") {
    return typeof o.bartId === "number" && typeof o.name === "string" && typeof o.hasPhoto === "boolean";
  }
  return false;
}

export function sameRecord(a: RecordRef | undefined, b: RecordRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "team" && b.kind === "team") return a.name === b.name;
  if (a.kind === "player" && b.kind === "player") return a.bartId === b.bartId;
  return false;
}
