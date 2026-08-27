import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import { TeamLogo } from "@/components/team-logo";
import { PercentileChip } from "@/components/percentile-chip";
import { PREVIEW_SEASON_LABEL, PREVIEW_SEASON_YEAR } from "@/components/teams/team-page-view";

/**
 * Returning minutes for the upcoming season.
 *
 * WHY THIS IS NOT A VIEW ON THE TEAM EXPLORER, which is where every other
 * column set lives. The explorer's season window stops at the last completed
 * season, and raising it would expose the upcoming one across all ~129 stats —
 * of which exactly three can exist before a game has been played. A reader who
 * picked 2026-27 there would get a table of dashes and conclude the site was
 * broken. So the three real figures get their own page instead of one real
 * column and a hundred and twenty-six empty ones.
 *
 * THE OTHER FOUR CONTINUITY FIGURES ARE ABSENT, NOT MISSING. Continuity %,
 * Returner Rotation % and both current-minute totals all need minutes from a
 * season nobody has played. They appear on /?view=continuity for every season
 * that HAS been played.
 *
 * UNCONFIRMED ROSTERS ARE SEPARATED, NOT DROPPED. See the note in
 * scripts/build-preseason-continuity.mjs: the preview roster is a live
 * offseason worklist, and on a few dozen teams the status field still says
 * every player is returning (nobody graduated) or that none is. Those are
 * impossible rather than unusual, so they sit in their own section below the
 * ranked table — ranking them would put wrong teams at the very top and bottom
 * of the sort, and hiding them would make the page quietly incomplete. The
 * build script explains each of the four checks and why a percentage threshold
 * could not have replaced them.
 */

export const metadata = {
  title: `${PREVIEW_SEASON_LABEL} Returning Minutes — Every Team`,
  description:
    `How much of last season's rotation is back for ${PREVIEW_SEASON_LABEL}. Returning minutes percentage for all 365 Division I teams, from projected rosters.`,
  alternates: { canonical: "/preview/continuity/" },
};

type Row = {
  conf: string | null;
  ret_prior_min: number;
  prior_team_min: number;
  ret_min_pct: number;
  departed_min: number;
  returners: number;
  roster_size: number;
  transfers_in: number;
  newcomers: number;
  confirmed: boolean;
  reasons: string[];
};

type Doc = {
  season: number;
  label: string;
  prior_season: number;
  built_from: Record<string, string | null>;
  teams: Record<string, Row>;
};

function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) => v.toLocaleString("en-US");

export default async function PreseasonContinuityPage() {
  const raw = await fs.readFile(
    path.join(process.cwd(), "public/data/preseason-continuity.json"),
    "utf8",
  );
  const doc = JSON.parse(raw) as Doc;

  const all = Object.entries(doc.teams).map(([name, r]) => ({ name, ...r }));
  const ranked = all.filter((t) => t.confirmed).sort((a, b) => b.ret_min_pct - a.ret_min_pct);
  const pending = all.filter((t) => !t.confirmed).sort((a, b) => a.name.localeCompare(b.name));

  // Percentile within the CONFIRMED cohort only — a chip ranking a team against
  // rows we already know are wrong would be wrong itself.
  const sorted = ranked.map((t) => t.ret_min_pct).sort((a, b) => a - b);
  const pctOf = (v: number) => {
    let lo = 0;
    while (lo < sorted.length && sorted[lo]! < v) lo++;
    return Math.round((lo / Math.max(1, sorted.length - 1)) * 100);
  };

  const priorLabel = `${doc.prior_season - 1}-${String(doc.prior_season).slice(2)}`;

  const mean = ranked.length
    ? ranked.reduce((a, t) => a + t.ret_min_pct, 0) / ranked.length
    : 0;

  return (
    <div className="mx-auto max-w-[76rem] px-5 sm:px-6 lg:px-10 py-10 lg:py-14">
      <header className="mb-7">
        <span className="text-xs uppercase tracking-widest text-coral font-medium">
          {doc.label} · Season preview
        </span>
        <h1 className="font-display text-3xl sm:text-4xl text-ink mt-2">Returning minutes</h1>
        <p className="mt-3 max-w-2xl text-ink-soft leading-relaxed">
          How much of last season&rsquo;s rotation is back. Every figure is a{" "}
          {priorLabel}{" "}minute total measured against next season&rsquo;s projected roster, so
          it is knowable before a game is played &mdash; unlike the rest of the continuity
          family, which needs minutes nobody has played yet.
        </p>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-7 gap-y-2 border-t border-hairline pt-4">
          <div>
            <div className="font-display text-2xl text-ink tabular">{pct1(mean)}</div>
            <div className="text-[0.68rem] uppercase tracking-widest text-ink-muted mt-0.5">
              D-I average
            </div>
          </div>
          <div>
            <div className="font-display text-2xl text-ink tabular">{ranked.length}</div>
            <div className="text-[0.68rem] uppercase tracking-widest text-ink-muted mt-0.5">
              Rosters confirmed
            </div>
          </div>
          {pending.length > 0 && (
            <div>
              <div className="font-display text-2xl text-ink-muted tabular">{pending.length}</div>
              <div className="text-[0.68rem] uppercase tracking-widest text-ink-muted mt-0.5">
                Still being confirmed
              </div>
            </div>
          )}
          <Link
            href="/?view=continuity"
            className="ml-auto text-sm text-coral hover:underline whitespace-nowrap"
            prefetch={false}
          >
            Full continuity table, played seasons &rarr;
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-paper-deep">
              <th className="px-2 py-2.5 text-center text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium w-12">
                #
              </th>
              <th className="px-3 py-2.5 text-left text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium">
                Team
              </th>
              <th className="px-3 py-2.5 text-left text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium hidden sm:table-cell">
                Conf
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium">
                Returning
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium hidden md:table-cell">
                Ret Min
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium hidden md:table-cell">
                Departed
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium hidden lg:table-cell">
                Prior Min
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium">
                Back
              </th>
              <th className="px-3 py-2.5 text-right text-[0.66rem] uppercase tracking-widest text-ink-muted font-medium hidden sm:table-cell">
                In
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => (
              <tr
                key={t.name}
                className={i % 2 === 0 ? "bg-paper border-t border-hairline" : "bg-card border-t border-hairline"}
              >
                <td className="px-2 py-1.5 text-center tabular text-xs text-ink-muted">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Link
                    href={`/teams/${slugFor(t.name)}/${PREVIEW_SEASON_YEAR}/`}
                    className="group inline-flex items-center gap-2 hover:text-coral transition-colors"
                    prefetch={false}
                  >
                    <TeamLogo name={t.name} size={20} />
                    <span className="font-medium text-ink group-hover:text-coral">{t.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-ink-muted text-xs hidden sm:table-cell">{t.conf ?? "—"}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    <span className="font-semibold text-ink tabular">{pct1(t.ret_min_pct)}</span>
                    <PercentileChip pct={pctOf(t.ret_min_pct)} />
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink-soft hidden md:table-cell">
                  {num(t.ret_prior_min)}
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink-muted hidden md:table-cell">
                  {num(t.departed_min)}
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink-muted hidden lg:table-cell">
                  {num(t.prior_team_min)}
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink-soft">{t.returners}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-muted hidden sm:table-cell">
                  {t.transfers_in + t.newcomers}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl text-ink">Rosters still being confirmed</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted leading-relaxed">
            On these {pending.length} teams the projected roster still says something that
            never happens: every senior back, or every minute returning, or nobody signed.
            The departures have not been entered yet. They sit here rather than in the
            ranking above, because an unfinished roster sorts straight to the top. Hover a
            name to see which check it failed.
          </p>
          <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1">
            {pending.map((t) => (
              <li key={t.name}>
                <Link
                  href={`/teams/${slugFor(t.name)}/${PREVIEW_SEASON_YEAR}/`}
                  // The reason is the tooltip rather than visible text: it is
                  // what a person fixing the roster needs, and it would double
                  // the height of a four-column list for everyone else.
                  title={t.reasons.join(" · ")}
                  className="group inline-flex items-center gap-2 py-1 text-sm text-ink-soft hover:text-coral transition-colors"
                  prefetch={false}
                >
                  <TeamLogo name={t.name} size={18} />
                  <span className="truncate">{t.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 pt-4 border-t border-hairline text-xs text-ink-muted leading-relaxed max-w-2xl">
        A returner is a player on this team last season and on it again next season; an
        incoming transfer is not continuity, however many minutes he played elsewhere.
        &ldquo;Back&rdquo; counts returning players, &ldquo;In&rdquo; counts transfers and
        newcomers together. Projected rosters last updated{" "}
        {doc.built_from.manual_transfers_at?.slice(0, 10) ?? "recently"}.
      </p>
    </div>
  );
}
