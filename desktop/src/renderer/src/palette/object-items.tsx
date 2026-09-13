import type { SearchData } from "~/data/search-model";
import type { FocusTarget } from "~/shell/views";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import type { PaletteItem } from "./command-palette";
import { prepare } from "./rank";

/** "2026" and "25-26" both name 2025-26: the two ways people write a season. */
const seasonWords = (y: number): string[] => [String(y), `${String(y - 1).slice(2)}-${String(y).slice(2)}`];

/**
 * Every team-season and player-season as a palette row that lands on it.
 *
 * PREPARED HERE, ONCE. Thirty thousand rows folded on every open would be a
 * visible pause on Ctrl K, so the folding happens when the data arrives and
 * the palette reuses it.
 *
 * WEIGHTS DECIDE EQUAL MATCHES, and stay under the gap between match tiers.
 * A school sits above a player who matches the same way, because a short word
 * is far likelier to mean one of 365 schools than one of 30,000 players; among
 * schools the shorter name wins ("mich" is Michigan before Michigan St.). Among
 * players the bigger season wins, measured in minutes actually played, so
 * "flagg" is Cooper Flagg before a namesake with half the floor time.
 */
export function objectItems(data: SearchData, go: (target: FocusTarget) => void): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const t of data.teams) {
    const item: PaletteItem = {
      id: `team:${t.name}:${t.year}`,
      group: "teams",
      title: t.name,
      subtitle: `${t.confLabel} · ${seasonLabel(t.year)}`,
      keywords: [t.conf, t.aliases, ...seasonWords(t.year)],
      collapse: `team:${t.name}`,
      weight: 30 + t.year / 100 - t.name.length / 10,
      leading: <TeamLogo id={t.logoId} name={t.name} size={18} />,
      run: () => go({ kind: "team", name: t.name, year: t.year }),
    };
    item.prepared = prepare(item);
    items.push(item);
  }

  for (const p of data.players) {
    const item: PaletteItem = {
      id: `player:${p.bartId}:${p.year}`,
      group: "players",
      title: p.name,
      subtitle: [p.team, p.cls, seasonLabel(p.year)].filter(Boolean).join(" · "),
      keywords: [p.conf, ...seasonWords(p.year)],
      collapse: `player:${p.bartId}`,
      // Season minutes, games times minutes a game: about 1,200 for a starter.
      weight: 20 + p.year / 100 + ((p.games ?? 0) * (p.minutes ?? 0)) / 1200,
      leading: <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={22} />,
      run: () => go({ kind: "player", bartId: p.bartId, name: p.name, year: p.year }),
    };
    item.prepared = prepare(item);
    items.push(item);
  }

  return items;
}
