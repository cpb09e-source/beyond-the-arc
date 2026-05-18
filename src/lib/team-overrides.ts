/**
 * Display-name overrides applied at export time to both Bart Torvik names and
 * CBB Analytics names so the site is consistent. We keep the canonical Bart
 * name in Supabase + cbb-team-ids.json (so sync scripts still match), but
 * rewrite the name in every JSON the UI reads.
 *
 * Add new entries here when CBB or Bart use a name that doesn't match the
 * canonical display we want.
 */

const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Southern California": "USC",
};

export function overrideTeamName<T extends string | null | undefined>(n: T): T {
  if (typeof n !== "string") return n;
  return (TEAM_NAME_OVERRIDES[n] ?? n) as T;
}
