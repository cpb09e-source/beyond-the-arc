import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import type { CoachSeason, TourneyRound } from "@/lib/coaches";
import { SeasonHeatStrip } from "@/components/coaches/season-heat-strip";
import { TournamentSuccess } from "@/components/coaches/tournament-success";
import { SeasonBySeasonTable } from "@/components/coaches/season-by-season-table";
import {
  loadAllCoachProfiles,
  loadCoachProfile,
  loadTournamentGames,
  buildGamesByTeamYear,
  gamesForTeamYear,
  tournamentWinsRank,
  LATEST_YEAR,
} from "@/lib/coaches";
import { confDisplay } from "@/lib/conf-display";

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  return (pct * 100).toFixed(1) + "%";
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export async function generateStaticParams() {
  const profiles = await loadAllCoachProfiles();
  return profiles.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await loadCoachProfile(slug);
  if (!profile) return { title: "Coach not found" };
  return {
    title: profile.name,
    description: `${profile.name} — ${profile.career_wins}-${profile.career_losses} all-time across ${profile.seasons_count} seasons. ${profile.is_active ? `Currently at ${profile.current_team}.` : "Inactive."}`,
  };
}

export default async function CoachProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const allProfiles = await loadAllCoachProfiles();
  const profile = allProfiles.find((p) => p.slug === slug);
  if (!profile) {
    notFound();
    return null;
  }

  // Tournament games lookup (year, team) → games[].
  const tournamentGames = await loadTournamentGames();
  const gamesLookup = buildGamesByTeamYear(tournamentGames);
  const gamesForSeason = (team: string, year: number) => gamesForTeamYear(gamesLookup, team, year);

  const totalGames = profile.career_wins + profile.career_losses;
  const ncaaAppearances = profile.by_year.filter((s) => s.seed !== null).length;
  const avgWinsPerSeason = profile.seasons_count > 0 ? (profile.career_wins / profile.seasons_count) : 0;
  // 20+ win seasons — the rough threshold for an NCAA-tournament-caliber team in our window.
  const twentyWinSeasons = profile.by_year.filter((s) => (s.wins ?? 0) >= 20).length;
  // Distinct conferences coached in (when known). Sourced from each season's
  // conference field which is only populated for the current year — but still
  // worth showing the current-team's conference at minimum.
  const conferences = Array.from(new Set(profile.by_year.map((s) => s.conference).filter((c): c is string => !!c)));

  // Career rank — where does this coach stand vs all others in our data
  // window? Wins rank uses raw totals; win-% rank requires a minimum sample
  // size (3 seasons) so single-season flukes don't dominate.
  const sortedByWins = [...allProfiles].sort((a, b) => b.career_wins - a.career_wins);
  const winsRank = sortedByWins.findIndex((p) => p.slug === profile.slug) + 1;
  const winsRankTotal = sortedByWins.length;
  const eligibleForPctRank = allProfiles.filter((p) => p.seasons_count >= 3 && p.career_win_pct !== null);
  eligibleForPctRank.sort((a, b) => (b.career_win_pct ?? 0) - (a.career_win_pct ?? 0));
  const pctRank = eligibleForPctRank.findIndex((p) => p.slug === profile.slug) + 1;
  const pctRankTotal = eligibleForPctRank.length;
  const pctRankEligible = profile.seasons_count >= 3 && profile.career_win_pct !== null && pctRank > 0;

  // Tournament-wins rank — only meaningful for coaches with at least one
  // appearance; for everyone else, the Tournament Success section shows
  // "no appearances" so the rank doesn't render either way.
  const tourneyRank = tournamentWinsRank(allProfiles, profile);
  // Ordinal helper.
  const ordinal = (n: number): string => {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  return (
    <>
      {/* HERO */}
      <section className="border-b border-hairline relative overflow-hidden">
        {/* Subtle backdrop: hairline grid that fades down. No gradient text. */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
             style={{ backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <div className="relative mx-auto max-w-[97rem] px-6 lg:px-10 pt-12 pb-12">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <Link href="/coaches/" className="hover:text-ink transition-colors">All head coaches</Link>
            <span className="text-ink-muted">/</span>
            <span className="text-ink-muted">{profile.is_active ? "Active" : "Inactive"}</span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-ink mb-5">
            {profile.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-base md:text-lg">
            {profile.is_active && profile.current_team ? (
              <span className="inline-flex items-center gap-2 text-ink-soft">
                Head coach at{" "}
                <Link href={`/teams/${teamSlug(profile.current_team)}/`} className="inline-flex items-center gap-2 font-medium text-ink hover:text-coral transition-colors">
                  <TeamLogo name={profile.current_team} size={20} />
                  {profile.current_team}
                </Link>
                {profile.current_conference && <span className="text-ink-muted">· {confDisplay(profile.current_conference)}</span>}
              </span>
            ) : (
              <span className="text-ink-soft">
                Last coached at <span className="font-medium text-ink">{profile.current_team ?? "—"}</span>
                {profile.current_year && <span className="text-ink-muted"> · {seasonLabel(profile.current_year)}</span>}
              </span>
            )}
          </div>
          {conferences.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mt-5 text-xs">
              <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mr-1">Conferences</span>
              {conferences.map((c) => (
                <span key={c} className="inline-flex items-center px-2 py-0.5 rounded border border-hairline bg-paper-deep/40 text-ink-soft tabular">
                  {confDisplay(c)}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SEASON HEAT STRIP — career signature at a glance */}
      {profile.by_year.length >= 2 && (
        <section className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-8">
          <SeasonHeatStrip seasons={profile.by_year} />
        </section>
      )}

      {/* STAT TILES */}
      <section className={`mx-auto max-w-[97rem] px-6 lg:px-10 ${profile.by_year.length >= 2 ? "pt-5" : "pt-8"}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
          <StatTile
            label="Career W-L"
            value={`${profile.career_wins}-${profile.career_losses}`}
            sub={`${totalGames} games`}
            rank={winsRank > 0 ? `${ordinal(winsRank)} most wins in our era` : undefined}
          />
          <StatTile
            label="Win %"
            value={fmtPct(profile.career_win_pct)}
            sub={`${avgWinsPerSeason.toFixed(1)} wins / season`}
            tone="coral"
            rank={pctRankEligible ? `${ordinal(pctRank)} of ${pctRankTotal} with 3+ seasons` : undefined}
          />
          <StatTile
            label="Seasons"
            value={String(profile.seasons_count)}
            sub={profile.schools_count === 1 ? `at 1 program` : `across ${profile.schools_count} programs`}
          />
          <StatTile
            label="20+ win seasons"
            value={String(twentyWinSeasons)}
          />
        </div>
      </section>

      {/* CAREER TRAJECTORY — currently hidden; see CareerArcChart import. */}

      {/* PER-SCHOOL BREAKDOWN */}
      {profile.schools.length > 0 && (
        <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mt-6">
          <div className="bg-card border border-hairline rounded-lg overflow-hidden">
            <div className="px-5 lg:px-7 py-4 border-b border-hairline">
              <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1">Program breakdown</div>
              <h2 className="font-display text-2xl text-ink">By the school</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="px-5 lg:px-7 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium">School</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right">Years</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right">Seasons</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right">Record</th>
                  <th className="px-5 lg:px-7 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {profile.schools.map((s) => {
                  const pct = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : null;
                  return (
                    <tr key={s.team} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
                      <td className="px-5 lg:px-7 py-3">
                        <Link href={`/teams/${teamSlug(s.team)}/`} className="inline-flex items-center gap-2.5 group">
                          <TeamLogo name={s.team} size={28} />
                          <span className="font-medium text-ink group-hover:text-coral transition-colors">{s.team}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-soft text-xs whitespace-nowrap">
                        {seasonLabel(s.first_year)} – {profile.is_active && s.team === profile.current_team && s.last_year === LATEST_YEAR ? "present" : seasonLabel(s.last_year)}
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-soft">{s.seasons}</td>
                      <td className="px-3 py-3 text-right tabular text-ink">{s.wins}-{s.losses}</td>
                      <td className="px-5 lg:px-7 py-3 text-right tabular font-medium text-ink">{fmtPct(pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* YEAR-BY-YEAR */}
      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mt-6">
        <div className="bg-card border border-hairline rounded-lg overflow-hidden">
          <div className="px-5 lg:px-7 py-4 border-b border-hairline flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1">Full record</div>
              <h2 className="font-display text-2xl text-ink">Season by season</h2>
            </div>
            <span className="text-xs text-ink-muted">{profile.by_year.length} {profile.by_year.length === 1 ? "season" : "seasons"}</span>
          </div>
          <SeasonBySeasonTable seasons={profile.by_year} />
        </div>
      </section>

      {/* TOURNAMENT SUCCESS — now lives at the end, after Season-by-season. */}
      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mt-6 pb-12">
        <div className="bg-card border border-hairline rounded-lg p-5 lg:p-7">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Tournament success</div>
            {ncaaAppearances > 0 && (
              <div className="text-xs text-ink-muted">{ncaaAppearances} {ncaaAppearances === 1 ? "appearance" : "appearances"}</div>
            )}
          </div>
          <h2 className="font-display text-2xl text-ink mb-5">March Madness</h2>
          <TournamentSuccess
            seasons={profile.by_year}
            gamesByTeamYear={gamesForSeason}
            tourneyWinsRank={tourneyRank.rank > 0 ? `${ordinal(tourneyRank.rank)} of ${tourneyRank.total}` : undefined}
          />
        </div>
        <p className="text-xs text-ink-muted text-right mt-3">Data window: 2012-13 through 2025-26</p>
      </section>
    </>
  );
}

function StatTile({ label, value, sub, rank, tone = "default" }: { label: string; value: string; sub?: string; rank?: string; tone?: "default" | "coral" }) {
  return (
    <div className="bg-card p-5 lg:p-7">
      <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-2">{label}</div>
      <div className={`font-display text-4xl md:text-5xl tabular leading-none ${tone === "coral" ? "text-coral" : "text-ink"}`}>{value}</div>
      {rank && <div className="text-[0.65rem] tabular text-coral font-medium mt-2 uppercase tracking-widest">{rank}</div>}
      {sub && <div className="text-xs text-ink-muted mt-1.5">{sub}</div>}
    </div>
  );
}

