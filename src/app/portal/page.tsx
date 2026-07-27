import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PortalClient, type PortalEntry } from "@/components/portal/portal-client";
import type { TransferClassRow } from "@/components/portal/transfer-classes";

type PortalFile = {
  competition_id: number;
  generated_at: string;
  entries: Array<Omit<PortalEntry, "epm"> & { bta_portg?: number | null }>;
  transfer_classes?: {
    top_overall: TransferClassRow[];
    worst_power: TransferClassRow[];
    by_school?: Record<string, TransferClassRow>;
  };
};

async function loadPortal(): Promise<PortalFile | null> {
  try {
    const text = await fs.readFile(path.resolve("public/data/portal.json"), "utf8");
    return JSON.parse(text) as PortalFile;
  } catch {
    return null;
  }
}

// EPM for a season, real play-by-play fit first (epm-<year>.json) with the
// box-score estimate filling gaps — the same precedence as readImpactForYear
// and compute-player-ranks, so the portal can't quote a different EPM than the
// player's own page.
async function loadEpmForYear(year: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const read = async (file: string, fillOnly: boolean) => {
    try {
      const j = JSON.parse(await fs.readFile(path.resolve(`public/data/${file}`), "utf8")) as {
        players: Record<string, { epm: number | null }>;
      };
      for (const [id, v] of Object.entries(j.players ?? {})) {
        if (typeof v?.epm !== "number" || !Number.isFinite(v.epm)) continue;
        const key = Number(id);
        if (fillOnly && out.has(key)) continue;
        out.set(key, v.epm);
      }
    } catch { /* season file absent — fine */ }
  };
  await read(`epm-${year}.json`, false);
  await read(`box-epm-${year}.json`, true);
  return out;
}

export default async function PortalPage() {
  const data = await loadPortal();

  // Join EPM onto the entries by (last_year, bart id). Transfers overwhelmingly
  // share one last_year, so this is usually a single pair of file reads.
  let entries: PortalEntry[] = [];
  if (data) {
    const years = [...new Set(data.entries.map((e) => e.last_year).filter((y): y is number => y != null))];
    const epmByYear = new Map<number, Map<number, number>>();
    for (const y of years) epmByYear.set(y, await loadEpmForYear(y));
    entries = data.entries.map((e) => ({
      ...e,
      epm: (e.last_year != null && e.bart_player_id != null
        ? epmByYear.get(e.last_year)?.get(e.bart_player_id)
        : undefined) ?? null,
    }));
  }

  return (
    <>
      {/* 108rem — same shell as the team explorer, per Colin. The extra width
          all lands on the centre transfers table (the sidebars are fixed). */}
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
        {data === null ? (
          <div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">
            <p>Portal data isn&apos;t exported yet.</p>
            <p className="mt-2 text-xs">
              Run <code className="bg-paper-deep px-1 rounded">npm run export:data</code> to populate it.
            </p>
          </div>
        ) : (
          <Suspense fallback={<div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">Loading portal…</div>}>
            <PortalClient
              entries={entries}
              generatedAt={data.generated_at}
              transferClasses={data.transfer_classes}
            />
          </Suspense>
        )}
      </section>
    </>
  );
}
