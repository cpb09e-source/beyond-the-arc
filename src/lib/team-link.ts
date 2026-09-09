"use client";

import { useEffect, useState } from "react";
import { teamSlug } from "@/lib/team-slug";
import { buildCanonMap, canonicalTeamName } from "@/lib/team-name-match";

/**
 * The link to a team's page, from a CBBD spelling, IN THE BROWSER.
 *
 * WHY A CLIENT VERSION EXISTS AT ALL. src/lib/game-team-links.ts already does
 * this at build time, and that is the right place for anything the server
 * knows — the box score's two teams are resolved there and cost the reader
 * nothing. But the standings arrive with the game BUNDLE, which is fetched
 * after hydration from R2, so the ~36 conference names in it do not exist when
 * the page is prerendered. They can only be resolved here.
 *
 * WHY IT NEEDS NO NEW DATA FILE. /data/team-names.json already ships — it is
 * the 370 current team names, about 8 KB, built by scripts/build-team-names.mjs
 * for the admin transfer form. That is exactly the list required to fold a
 * CBBD name onto ours, so this fetches it rather than adding a fifth artifact
 * to keep in step.
 *
 * The matching rules themselves live in src/lib/team-name-match.ts and are
 * shared with the build-time resolver, so the two cannot disagree about what
 * "UConn" means.
 *
 * ONE FETCH FOR THE PAGE. The promise, not the result, is module-cached, so a
 * standings panel with two conference tables makes one request, and a second
 * panel mounting later makes none.
 */

type NamesFile = { generated_at?: string; teams: Array<{ name: string }> };

let cached: Promise<Map<string, string>> | null = null;

function load(): Promise<Map<string, string>> {
  return (cached ??= fetch("/data/team-names.json")
    .then((r) => (r.ok ? (r.json() as Promise<NamesFile>) : null))
    .then((j) => buildCanonMap((j?.teams ?? []).map((t) => t.name)))
    .catch(() => {
      // Let a later mount retry a genuine network failure rather than caching
      // "no links on this page" for the rest of the session.
      cached = null;
      return new Map<string, string>();
    }));
}

/**
 * Returns `(cbbdTeamName) => href | null`.
 *
 * null means "do not link": the map has not loaded yet, or the name is not a
 * D-I program — a D-II or NAIA opponent, which has no page here. Callers
 * render their plain-text treatment in that case, so the table looks the same
 * before the map lands as it does for a school we do not cover.
 *
 * `season` puts the link on the right year. Standings are the table entering
 * THIS game, so the team-season page for that year necessarily exists.
 */
export function useTeamLinks(season: number | null | undefined): (team: string) => string | null {
  const [canon, setCanon] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let live = true;
    void load().then((m) => { if (live) setCanon(m); });
    return () => { live = false; };
  }, []);

  return (team: string) => {
    if (!canon || typeof season !== "number") return null;
    const name = canonicalTeamName(canon, team);
    return name ? `/teams/${teamSlug(name)}/${season}/` : null;
  };
}
