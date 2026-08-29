import { Suspense } from "react";
import { ConferencesClient } from "@/components/conferences/conferences-client";
import { PageHeading } from "@/components/page-heading";

/**
 * Conference Power Rankings.
 *
 * NOTHING IS PASSED FROM THE SERVER. The whole table is one 105 KB file that
 * covers every season, so the page prerenders as a shell and the client fetches
 * it once — rather than serialising a season into the RSC payload the way the
 * team explorer has to, where a season is 1.3 MB and there are twelve of them.
 */
export const metadata = {
  title: "Conference Power Rankings — Beyond the Arc",
  description:
    "Every conference, every season, ranked by the strength of its teams with the bottom two dropped.",
};

export default function ConferencesPage() {
  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
      {/* NO SUBTITLE. It said what the table's own note row says, one
          scroll higher and in more words. */}
      <PageHeading label="Conference power rankings" />
      {/* ConferencesClient reads useSearchParams for its season, conference and
          view selection. Static export requires that hook to sit inside a
          Suspense boundary or the build fails on a CSR bailout. */}
      <Suspense fallback={<div className="text-ink-muted text-sm">Loading conferences…</div>}>
        <ConferencesClient />
      </Suspense>
    </section>
  );
}
