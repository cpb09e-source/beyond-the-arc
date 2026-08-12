import Link from "next/link";
import { readAllTeams } from "@/lib/static-data";
import { TeamLogo } from "@/components/team-logo";
import { PREVIEW_SEASON_YEAR, PREVIEW_SEASON_LABEL } from "@/components/teams/team-page-view";
import CONF_2027 from "@/data/conferences-2027.json";

export const metadata = {
  title: `${PREVIEW_SEASON_LABEL} Season Preview — Every Team`,
  description: `Browse ${PREVIEW_SEASON_LABEL} college basketball previews by conference — projected rosters, returners, transfers, and incoming recruits for all 365 Division I teams.`,
  alternates: { canonical: "/preview/" },
};

// Same slug rule the team route uses, so links resolve to the pre-rendered
// /teams/<slug>/<PREVIEW_SEASON_YEAR>/ page.
function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// 2026-27 power conferences — shown first with a subtle coral accent.
const POWER = ["ACC", "Big Ten", "Big 12", "SEC", "Pac-12", "Big East"];
const CONF_MAP = CONF_2027 as Record<string, string>;

export default async function PreviewIndexPage() {
  const all = await readAllTeams();
  const latest = all.reduce((m, t) => Math.max(m, t.year), 0);

  // One row per team active in the most recent completed season (those get a
  // PREVIEW_SEASON_YEAR page), grouped by their 2026-27 conference (Bart's
  // stored conference is the prior alignment; CONF_2027 has the new one).
  const seen = new Set<string>();
  const byConf = new Map<string, Array<{ name: string; slug: string }>>();
  for (const t of all) {
    if (t.year !== latest || seen.has(t.name)) continue;
    seen.add(t.name);
    const conf = CONF_MAP[t.name] ?? t.conference ?? "Other";
    if (!byConf.has(conf)) byConf.set(conf, []);
    byConf.get(conf)!.push({ name: t.name, slug: slugFor(t.name) });
  }

  // Power leagues first (in POWER order), then the rest alphabetically.
  const confs = [...byConf.keys()].sort((a, b) => {
    const pa = POWER.indexOf(a), pb = POWER.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.localeCompare(b);
  });
  for (const list of byConf.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  // px-5 below sm rather than px-6: measured at 414px, exactly one of the 365
  // names ("Texas A&M Corpus Chris…") overflowed its two-column cell, and by
  // 2px. The 8px this returns clears it with room to spare.
  return (
    <div className="mx-auto max-w-[88rem] px-5 sm:px-6 lg:px-10 py-10 lg:py-14">
      <header className="mb-8">
        <span className="text-xs uppercase tracking-widest text-coral font-medium">
          {PREVIEW_SEASON_LABEL} · Season preview
        </span>
      </header>

      <div className="space-y-9">
        {confs.map((conf) => {
          const teams = byConf.get(conf)!;
          const power = POWER.includes(conf);
          return (
            <section key={conf}>
              {/* Power leagues get a short coral rule above the name (editorial
                  treatment) — no card, keeps the page flat. */}
              {power && <div className="h-0.75 w-11 rounded-full bg-coral mb-2.5" />}
              <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-hairline">
                <h2 className="font-display text-2xl text-ink">{conf}</h2>
                <span className="text-xs uppercase tracking-widest text-ink-muted ml-auto">
                  {teams.length} {teams.length === 1 ? "team" : "teams"}
                </span>
              </div>
              {/* Two columns on phones as well. A conference is 10-20 teams and
                  a single column pushed the ACC alone past two screens, so the
                  page read as a scroll rather than a directory. The gutter,
                  logo and row padding all step down below sm to buy the second
                  column its width — at one column the row was mostly empty
                  space to the right of the name anyway. */}
              <ul className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-0.5 sm:gap-y-1">
                {teams.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/teams/${t.slug}/${PREVIEW_SEASON_YEAR}/`}
                      className="group flex items-center gap-2 sm:gap-2.5 py-1.5 px-1.5 sm:px-2 -mx-1.5 sm:-mx-2 rounded-md hover:bg-[var(--accent-tint)] transition-colors" prefetch={false}>
                      {/* 20 rather than 22 at every width: TeamLogo writes its
                          size as an inline style, so a responsive width class
                          here would never win. */}
                      <TeamLogo name={t.name} size={20} className="shrink-0 rounded-[3px]" />
                      <span className="text-[0.8rem] sm:text-sm text-ink group-hover:text-coral transition-colors truncate">
                        {t.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
