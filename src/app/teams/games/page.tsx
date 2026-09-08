import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { TeamGamesClient } from "@/components/games/team-games-client";
import { PageHeading } from "@/components/page-heading";
import { TablePreview } from "@/components/table-preview";
import { FREE_LIMITS } from "@/lib/access";
import {
  T,
  TEAM_GAME_SEASONS,
  fmtTeamGameDate,
  fmtTeamGameValue,
  teamGameStat,
  type TeamGamePack,
} from "@/lib/team-game-index";

/**
 * Team Game Log Explorer.
 *
 * The player Game Log's twin, one level up. Nothing is passed from the server:
 * the client fetches /data/team-game-index/<year>.json on demand, one season
 * at a time, and keeps what it has.
 *
 * A STATIC SEGMENT UNDER /teams, which does not collide with the team pages —
 * those live at /teams/[slug]/[year], two segments deep, so nothing dynamic
 * matches a single "games" segment.
 *
 * Corpus: scripts/build-team-game-index.mjs.
 */
export const metadata = {
  title: "Team Game Log Explorer — Beyond the Arc",
  description:
    "Every team-game since 2014. Find the best single-game team performances in college basketball by any stat, filter or combination.",
};

/** The season and sort the client opens on. */
const PREVIEW_YEAR = TEAM_GAME_SEASONS[0]!;
const PREVIEW_SORT = "net";

/**
 * The top rows of the default table, rendered on the server.
 *
 * WHY: TeamGamesClient reads useSearchParams, so a static export prerenders
 * this boundary's FALLBACK and nothing else. That fallback was the words
 * "Loading team games…" in a div — two `<tr>` on the whole page, which is what
 * a crawler indexed and what a reader stared at while 11,500 rows arrived.
 *
 * IT USES THE LIBRARY'S OWN GETTERS rather than reimplementing the math.
 * `teamGameStat("net").get` is the same function the client sorts on, so the
 * order here cannot drift from the order that replaces it. Values go through
 * `fmtTeamGameValue` for the same reason.
 *
 * FIVE ROWS, NOT TWENTY-FIVE, and that is a paywall constraint rather than a
 * design one. The game logs are gated: an anonymous reader sees
 * FREE_LIMITS.previewRows of them. Prerendering more would bake paid rows into
 * static HTML that anyone — Google included — can read without signing in.
 */
async function buildPreview() {
  let raw: Omit<TeamGamePack, "epochMs">;
  try {
    raw = JSON.parse(
      await fs.readFile(
        path.resolve("public/data/team-game-index", `${PREVIEW_YEAR}.json`),
        "utf8",
      ),
    ) as Omit<TeamGamePack, "epochMs">;
  } catch {
    return null;
  }
  if (!raw?.rows?.length) return null;

  const pack: TeamGamePack = { ...raw, epochMs: Date.parse(raw.epoch) };
  const stat = teamGameStat(PREVIEW_SORT);
  if (!stat) return null;

  const top = pack.rows
    .map((r) => ({ r, v: stat.get(r) }))
    .filter((x): x is { r: number[]; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v)
    .slice(0, FREE_LIMITS.previewRows);
  if (top.length === 0) return null;

  const col = (key: string, label: string) => {
    const s = teamGameStat(key)!;
    return { label, values: top.map(({ r }) => fmtTeamGameValue(s.get(r), s.fmt)) };
  };

  return {
    nameHeader: "Team",
    rows: top.map(({ r }) => {
      const team = pack.teams.names[r[T.t]!] ?? "";
      return {
        name: team,
        team,
        meta: `vs ${pack.opps[r[T.o]!] ?? "?"} · ${fmtTeamGameDate(pack, r)}`,
      };
    }),
    columns: [
      col("net", "NET"),
      col("pts", "PTS"),
      col("pa", "OPP"),
      col("ortg", "ORtg"),
      col("drtg", "DRtg"),
      col("pace", "PACE"),
    ],
    caption: `Top ${top.length} team-games of ${PREVIEW_YEAR - 1}-${String(PREVIEW_YEAR).slice(-2)} by net rating. The full table — every season, every stat, every filter — loads here.`,
  };
}

export default async function TeamGameLogPage() {
  const preview = await buildPreview();

  return (
    <section className="mx-auto max-w-[var(--page-max)] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
      <PageHeading label="Team game log explorer" />
      {/* THE FALLBACK IS THE PRERENDERED PAGE. TeamGamesClient reads
          useSearchParams for its whole state, which a static export requires to
          sit inside a Suspense boundary — so this fallback is the only HTML
          this page has until hydration. */}
      <Suspense
        fallback={
          preview
            ? <TablePreview {...preview} />
            : <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading team games…</div>
        }
      >
        <TeamGamesClient />
      </Suspense>
    </section>
  );
}
