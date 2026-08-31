import Link from "next/link";
import { Lock } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";

/**
 * What an archive season's team page is, once the archive gate is on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONE GATE ON THE SITE THAT COSTS SUBSCRIBERS SOMETHING, and that
 * is a property of static export rather than a decision anyone liked.
 *
 * Every other product gate hides presentation of data the browser already
 * holds, so a subscriber's browser simply stops hiding it. A team page is
 * different: its numbers are rendered into the HTML at build time, one file
 * for every reader, so "not in the HTML" means not in it for anybody. Half of
 * what it renders — lineup-stats, team-seasons — is build-only input that is
 * stripped from the deploy entirely, so there is no URL a paying reader's
 * browser could fetch it back from either. Serving them the real page needs a
 * team-season endpoint that does not exist yet.
 *
 * So an archive team page is a gate for everyone, and a subscriber is sent to
 * the Team Explorer, which IS fully theirs and holds the same season. That is
 * the honest trade until the endpoint exists; see docs/WIP-handoff.md.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NOT A 404, deliberately. Dropping these from generateStaticParams would have
 * been less work and would have taken ~20,000 indexed URLs down with it, along
 * with every inbound link anyone has ever shared. The page still exists, still
 * says which team and which season it is, and still links onward.
 */
export function ArchiveSeasonGate({
  teamName,
  year,
  seasonLabel,
  conference,
}: {
  teamName: string;
  year: number;
  seasonLabel: string;
  conference?: string | null;
}) {
  return (
    <section className="mx-auto max-w-3xl px-6 lg:px-10 pt-10 pb-20">
      <div className="flex items-center gap-4 mb-6">
        <TeamLogo name={teamName} size={56} />
        <div>
          <h1 className="font-display text-3xl text-ink leading-tight">
            {teamName} <span className="text-ink-muted">{seasonLabel}</span>
          </h1>
          {conference && (
            <p className="text-sm text-ink-muted mt-0.5">{conference}</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-card p-6 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Lock size={14} strokeWidth={2.5} className="text-coral shrink-0" aria-hidden />
          {seasonLabel} is part of the Season Pass.
        </p>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          The current season and the one before it are open to everyone. Earlier
          seasons — every team, every player, every game back to 2013-14 — come
          with a Pass.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-md bg-coral px-3.5 py-2 text-sm font-medium text-white hover:bg-coral-soft transition-colors"
          >
            See plans
          </Link>
          <Link
            href="/account/login"
            className="inline-flex items-center rounded-md px-3 py-2 text-sm text-ink-muted hover:text-coral transition-colors"
          >
            Sign in
          </Link>
          {/* THE SUBSCRIBER'S WAY THROUGH. The explorer holds this same season
              and is gated properly — it fetches through the season function
              with their token — so a Pass holder who lands here is one click
              from the numbers rather than at a dead end. */}
          <Link
            href={`/?ys=${year}&teams=${encodeURIComponent(teamName)}`}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm text-ink-muted hover:text-coral transition-colors"
          >
            Open {seasonLabel} in the Team Explorer →
          </Link>
        </div>
      </div>

      <p className="mt-6 text-sm text-ink-muted">
        Looking for this team now?{" "}
        <Link href={`/?teams=${encodeURIComponent(teamName)}`} className="text-coral hover:underline">
          {teamName} this season
        </Link>
        .
      </p>
    </section>
  );
}
