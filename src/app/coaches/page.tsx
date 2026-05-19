import { CoachesClient } from "@/components/coaches/coaches-client";
import { loadCoachIndex, type CoachIndexRow } from "@/lib/coaches";

export type CoachRow = CoachIndexRow;

async function loadCoaches(): Promise<CoachRow[]> {
  const rows = await loadCoachIndex();
  // Default sort: active first, then alphabetical by last name. Keeps current
  // coaches at the top of the list when the page first loads.
  rows.sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const al = (a.name.split(" ").pop() ?? a.name).toLowerCase();
    const bl = (b.name.split(" ").pop() ?? b.name).toLowerCase();
    return al.localeCompare(bl);
  });
  return rows;
}

export default async function CoachesPage() {
  const rows = await loadCoaches();
  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-12 pb-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <span>Head coaches · 2012-26</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink mb-3">
            Every D-I head coach,
            <span className="italic text-coral"> {activeCount > 0 ? `${activeCount} active` : "active and historical"}</span>.
          </h1>
          <p className="text-base md:text-lg text-ink-soft max-w-2xl">
            All-time records summed across the 2012-13 through 2025-26 seasons.
          </p>
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
          <CoachesClient rows={rows} />
        )}
      </section>
    </>
  );
}
