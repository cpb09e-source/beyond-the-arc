import { Suspense } from "react";
import { CoachesClient } from "@/components/coaches/coaches-client";
import { loadCoachIndex, type CoachIndexRow } from "@/lib/coaches";

export type CoachRow = CoachIndexRow;

async function loadCoaches(): Promise<CoachRow[]> {
  const rows = await loadCoachIndex();
  // Default sort: composite résumé score, descending. Coaches without a
  // composite (rare — only no-data entries) sort last; ties break by last
  // name alphabetical so the order is stable.
  rows.sort((a, b) => {
    const av = a.composite_score ?? -Infinity;
    const bv = b.composite_score ?? -Infinity;
    if (av !== bv) return bv - av;
    const al = (a.name.split(" ").pop() ?? a.name).toLowerCase();
    const bl = (b.name.split(" ").pop() ?? b.name).toLowerCase();
    return al.localeCompare(bl);
  });
  return rows;
}

export default async function CoachesPage() {
  const rows = await loadCoaches();

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-10 pb-6">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
            <span className="h-px w-8 bg-coral" />
            <span>Head coaches · 2012-26</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-8 lg:pt-10 pb-4">
        {rows.length === 0 ? (
          <div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">
            <p>Coach data isn&apos;t snapshotted yet.</p>
            <p className="mt-2 text-xs">
              Run <code className="bg-paper-deep px-1 rounded">npm run snapshot:coaches</code> and{" "}
              <code className="bg-paper-deep px-1 rounded">npm run snapshot:coach-history</code> to populate it.
            </p>
          </div>
        ) : (
          // CoachesClient uses useSearchParams() (for URL-synced filters).
          // Next.js requires that hook to be wrapped in <Suspense> during
          // static export, or the build fails with a CSR-bailout error.
          <Suspense fallback={<div className="text-ink-muted text-sm">Loading coaches…</div>}>
            <CoachesClient rows={rows} />
          </Suspense>
        )}
      </section>
    </>
  );
}
