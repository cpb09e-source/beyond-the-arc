/**
 * Find Similar's tab query, so an action can open it without importing the page.
 *
 *   k=team&y=2026&t=Houston&on=style&in=others
 *   k=player&y=2026&p=77123&n=Cooper%20Flagg
 *
 * A player is named by bart id, which does not change when a name is spelled
 * two ways; the name rides along for the tab's title before the season loads.
 */

export type SimilarKind = "team" | "player";
/** Every season, only other seasons (history), or only the subject's own. */
export type SimilarScope = "all" | "others" | "same";

export type SimilarQuery = {
  kind: SimilarKind;
  year: number | null;
  team: string | null;
  player: number | null;
  name: string | null;
  on: string;
  scope: SimilarScope;
};

const SCOPES: SimilarScope[] = ["all", "others", "same"];

export function similarQuery(q: Partial<SimilarQuery> & { kind: SimilarKind }): string {
  const s = new URLSearchParams();
  s.set("k", q.kind);
  if (q.year) s.set("y", String(q.year));
  if (q.kind === "team" && q.team) s.set("t", q.team);
  if (q.kind === "player" && q.player != null) s.set("p", String(q.player));
  if (q.kind === "player" && q.name) s.set("n", q.name);
  if (q.on && q.on !== "overall") s.set("on", q.on);
  if (q.scope && q.scope !== "all") s.set("in", q.scope);
  return s.toString();
}

export function parseSimilarQuery(query: string): SimilarQuery {
  const s = new URLSearchParams(query);
  const year = Number(s.get("y"));
  const player = Number(s.get("p"));
  const scope = s.get("in") as SimilarScope | null;
  return {
    kind: s.get("k") === "player" ? "player" : "team",
    year: Number.isInteger(year) && year > 2000 ? year : null,
    team: s.get("t") || null,
    player: Number.isInteger(player) && player > 0 ? player : null,
    name: s.get("n") || null,
    on: s.get("on") || "overall",
    scope: scope && SCOPES.includes(scope) ? scope : "all",
  };
}
