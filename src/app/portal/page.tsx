import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PortalClient, type PortalEntry } from "@/components/portal/portal-client";
import type { TransferClassRow } from "@/components/portal/transfer-classes";
import { PageHeading } from "@/components/page-heading";

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

// `epm`, `pvs` and the EPM-based `stars` are baked into portal.json by
// scripts/rescore-portal.mjs — the file is the single source, so nothing is
// joined at render and the table can't disagree with the class sidebars.
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
      {/* 108rem — same shell as the team explorer, per Colin. The extra width
          all lands on the centre transfers table (the sidebars are fixed). */}
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
        <PageHeading
          label="Transfer portal"
          sub="Every logged move, rated on what the player actually produced — and the class ledger each one adds to."
        />
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
