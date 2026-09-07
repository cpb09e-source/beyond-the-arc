import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { GamesClient } from "@/components/games/games-client";
import { PageHeading } from "@/components/page-heading";
import { TablePreview } from "@/components/table-preview";
import { FREE_LIMITS } from "@/lib/access";
import {
  F,
  GAME_SEASONS,
  fmtGameDate,
  fmtGameValue,
  gameStat,
  type GamePack,
} from "@/lib/game-index";

/**
 * Game Log Explorer.
 *
 * NOTHING IS PASSED FROM THE SERVER, deliberately. A season of player-games is
 * 7 MB — serialising one into the RSC payload the way the team explorer does
 * would put it in the HTML of a page most readers open to look at one season.
 * The client fetches public/data/game-index/<year>.json on demand instead, one
 * season at a time, and keeps what it has fetched.
 *
 * The preview below is the exception that proves it: five rows read at BUILD
 * time from the same file, which costs the page nothing at runtime.
 *
 * The corpus is built by scripts/build-game-index.mjs.
 */
export const metadata = {
  title: "Game Log Explorer — Beyond the Arc",
  description:
    "Every player-game since 2014. Find the best single-game performances in college basketball by any stat, filter or combination.",
};

/** The season and sort the client opens on — Game Score, high to low. */
const PREVIEW_YEAR = GAME_SEASONS[0]!;
const PREVIEW_SORT = "gmsc";

/**
 * The top rows of the default table, rendered on the server.
 *
 * WHY: GamesClient reads useSearchParams, so a static export prerenders this
 * boundary's FALLBACK and nothing else. That fallback was "Loading games…" in
 * a div — two `<tr>` on the whole page, which is what a crawler indexed.
 *
 * IT USES THE LIBRARY'S OWN GETTERS rather than reimplementing Game Score.
 * `gameStat("gmsc").get` is the function the client sorts on, so this order
 * cannot drift from the order that replaces it a second later.
 *
 * FIVE ROWS, and that is the paywall rather than taste. Game logs are gated:
 * an anonymous reader gets FREE_LIMITS.previewRows. Prerendering more would
 * put paid rows in static HTML for anyone, crawler included, to read.
 */
async function buildPreview() {
  let raw: Omit<GamePack, "epochMs">;
  try {
    raw = JSON.parse(
      await fs.readFile(
        path.resolve("public/data/game-index", `${PREVIEW_YEAR}.json`),
        "utf8",
      ),
    ) as Omit<GamePack, "epochMs">;
  } catch {
    return null;
  }
  if (!raw?.rows?.length) return null;

  const pack: GamePack = { ...raw, epochMs: Date.parse(raw.epoch) };
  const stat = gameStat(PREVIEW_SORT);
  if (!stat) return null;

  const top = pack.rows
    .map((r) => ({ r, v: stat.get(r) }))
    .filter((x): x is { r: number[]; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v)
    .slice(0, FREE_LIMITS.previewRows);
  if (top.length === 0) return null;

  const col = (key: string, label: string) => {
    const s = gameStat(key)!;
    return { label, values: top.map(({ r }) => fmtGameValue(s.get(r), s.fmt)) };
  };

  return {
    nameHeader: "Player",
    rows: top.map(({ r }) => {
      const i = r[F.p]!;
      return {
        name: pack.players.names[i] ?? "",
        team: pack.players.teams[i] ?? "",
        meta: `vs ${pack.opps[r[F.o]!] ?? "?"} · ${fmtGameDate(pack, r)}`,
        // Only link where a player page was actually prerendered — `page` is
        // the same flag the live table uses to decide.
        href: pack.players.page[i] ? `/players/${pack.players.ids[i]}` : undefined,
      };
    }),
    columns: [
      col("gmsc", "GmSc"),
      col("min", "MIN"),
      col("pts", "PTS"),
      col("reb", "REB"),
      col("ast", "AST"),
      col("ts", "TS%"),
    ],
    caption: `Top ${top.length} player-games of ${PREVIEW_YEAR - 1}-${String(PREVIEW_YEAR).slice(-2)} by Game Score. The full table — every season, every stat, every filter — loads here.`,
  };
}

export default async function GameLogPage() {
  const preview = await buildPreview();

  return (
    <section className="mx-auto max-w-[var(--page-max)] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
      <PageHeading label="Game log explorer" />
      {/* THE FALLBACK IS THE PRERENDERED PAGE. GamesClient reads
          useSearchParams for its whole state, which a static export requires to
          sit inside a Suspense boundary — so this fallback is the only HTML
          this page has until hydration. */}
      <Suspense
        fallback={
          preview
            ? <TablePreview {...preview} />
            : <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading games…</div>
        }
      >
        <GamesClient />
      </Suspense>
    </section>
  );
}
