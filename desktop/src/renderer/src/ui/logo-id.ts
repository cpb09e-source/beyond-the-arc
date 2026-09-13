import cbbTeams from "@/data/cbb-team-ids.json";
import { normTeamName } from "@/lib/scatter-team";

const IDS = cbbTeams as Record<string, { id?: number }>;

/**
 * A matchup team's crest. The pack names teams the way the site's pages do, and
 * the crest file is keyed on that name normalized, as the Team Scatter joins it.
 */
export const logoIdOf = (name: string): number | null => IDS[normTeamName(name)]?.id ?? null;
