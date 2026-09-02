import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PlayersClient } from "@/components/players/players-client";
import { PageHeading } from "@/components/page-heading";
import { TablePreview } from "@/components/table-preview";
import { DEFAULT_PLAYER_SPEC } from "@/lib/players";

/** The season the preview renders — the explorer's own default. */
const PREVIEW_YEAR = DEFAULT_PLAYER_SPEC.years[0]!;

type ExplorerFile = { fields: string[]; rows: unknown[][] };
type EpmFile = { players: Record<string, { ewins?: number | null }> };

/**
 * The top rows of the default table, computed on the server.
 *
 * REPRODUCES THE CLIENT'S DEFAULT EXACTLY, or it is worse than nothing: same
 * season, same 10-game minimum, same eWins sort. A preview that ranked players
 * differently from the table replacing it would put one order in front of a
 * crawler and another in front of the reader a second later.
 *
 * eWins lives in epm-<year>.json rather than the explorer payload, so this
 * joins the two on bart id — 281 KB read once at build time, not shipped.
 */
async function buildPreview() {
  const read = async <T,>(rel: string): Promise<T | null> => {
    try {
      return JSON.parse(await fs.readFile(path.resolve("public/data", rel), "utf8")) as T;
    } catch {
      return null;
    }
  };

  const payload = await read<ExplorerFile>(`players-explorer/${PREVIEW_YEAR}.json`);
  if (!payload?.rows?.length) return null;
  const epm = await read<EpmFile>(`epm-${PREVIEW_YEAR}.json`);
  const at = Object.fromEntries(payload.fields.map((f, i) => [f, i]));
  const num = (r: unknown[], f: string): number | null => {
    const v = r[at[f]!];
    return typeof v === "number" ? v : null;
  };
  const str = (r: unknown[], f: string): string => {
    const v = r[at[f]!];
    return typeof v === "string" ? v : "";
  };

  const scored = payload.rows
    .filter((r) => (num(r, "games") ?? 0) >= DEFAULT_PLAYER_SPEC.minGames)
    .map((r) => {
      const bart = num(r, "bart_player_id");
      return {
        row: r,
        ewins: (bart !== null ? epm?.players?.[String(bart)]?.ewins : null) ?? null,
      };
    })
    .filter((x) => x.ewins !== null)
    .sort((a, b) => (b.ewins ?? 0) - (a.ewins ?? 0))
    .slice(0, 25);

  // Every season before EWINS_FIRST_YEAR sorts on EPM instead, and a season
  // with no fit at all would leave this empty — in which case the fallback
  // stays a plain loading line rather than an arbitrary 25 players.
  if (scored.length === 0) return null;

  const fmt1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
  const pct1 = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  return {
    nameHeader: "Player",
    rows: scored.map(({ row }) => ({
      name: str(row, "name"),
      team: str(row, "team_name"),
      meta: str(row, "class") || undefined,
      href: row[at.has_page!] === true && num(row, "bart_player_id") !== null
        ? `/players/${num(row, "bart_player_id")}`
        : undefined,
    })),
    columns: [
      { label: "eWins", values: scored.map((x) => fmt1(x.ewins)) },
      { label: "MPG", values: scored.map((x) => fmt1(num(x.row, "min_pg"))) },
      { label: "PPG", values: scored.map((x) => fmt1(num(x.row, "pts_pg"))) },
      { label: "RPG", values: scored.map((x) => fmt1(num(x.row, "reb_pg"))) },
      { label: "APG", values: scored.map((x) => fmt1(num(x.row, "ast_pg"))) },
      { label: "TS%", values: scored.map((x) => pct1(num(x.row, "ts_pct"))) },
    ],
    caption: "Top 25 by eWins. The full table, with every column and filter, loads here.",
  };
}

export default async function PlayersOverviewPage() {
  // Conferences-per-year is small (~100 strings) — bake into the static HTML.
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  const preview = await buildPreview();

  return (
    <>
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-3 pb-8 lg:pt-9 lg:pb-10">
        <PageHeading
          label="Player ratings"
        />
        {/* THE FALLBACK IS THE PRERENDERED PAGE. PlayersClient reads
            useSearchParams, so on a static export this boundary's fallback is
            the only HTML the page has — it was the words "Loading players",
            which is what a crawler indexed. */}
        <Suspense
          fallback={
            preview
              ? <TablePreview {...preview} />
              : <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading players…</div>
          }
        >
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>
    </>
  );
}
