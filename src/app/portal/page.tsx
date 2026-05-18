import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PortalClient, type PortalEntry } from "@/components/portal/portal-client";
import type { TransferClassRow } from "@/components/portal/transfer-classes";

type PortalFile = {
  competition_id: number;
  generated_at: string;
  entries: PortalEntry[];
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

export default async function PortalPage() {
  const data = await loadPortal();

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-12 pb-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <span>The transfer portal</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink mb-3">
            Who&apos;s moving where,
            <span className="italic text-coral"> by the numbers.</span>
          </h1>
          <p className="text-base md:text-lg text-ink-soft max-w-2xl">
            Every D-I transfer-portal entry for the current cycle, joined with
            the player&apos;s most recent season production so you can see
            who&apos;s actually moving the needle.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-8 lg:pt-10 pb-4">
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
              entries={data.entries}
              generatedAt={data.generated_at}
              transferClasses={data.transfer_classes}
            />
          </Suspense>
        )}
      </section>
    </>
  );
}
