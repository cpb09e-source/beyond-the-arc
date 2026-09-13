import { Table2, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { TeamsView } from "~/views/teams/teams-view";

/**
 * Every view the app has, in sidebar order.
 *
 * THE SITE'S NAMES, grouped the way the site's own navigation groups them. A
 * reader who knows "Team Game Log Explorer" from btacbb.xyz should find it here
 * under the same words, in the same family.
 *
 * A view appears here when it is built, and not before. A sidebar full of
 * entries that open "coming soon" is a roadmap, not an app.
 */

export type ViewProps = {
  year: number;
  setYear: (y: number) => void;
  query: string;
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
];

export const viewById = (id: string | null | undefined): ViewDef => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;
