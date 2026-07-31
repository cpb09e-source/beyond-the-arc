import { STYLE_DIMENSIONS, type CoachStyle } from "@/lib/coaches";
import { cn } from "@/lib/utils";

/**
 * Style fingerprint — what kind of basketball a coach's teams played, against
 * every other coach in the window.
 *
 * The rest of the profile answers "how good?". Nothing on it answered "what
 * kind?", even though the nine rates behind that question were already joined
 * per season to power the explorer's filters.
 *
 * THE ENCODING IS THE DESIGN DECISION. Raw values cannot carry this: the middle
 * 90% of coaches sit inside about seven possessions of pace, so 68.4 means
 * nothing to a reader. Only the rank against the field does. Bars therefore run
 * from the centre — left of the median or right of it, by percentile — which
 * makes "extreme in both directions" (Bennett: slowest tempo, best defence)
 * read instantly, and makes the majority look boringly central, which is true.
 *
 * NOT A RADAR, despite the name. Radar area scales with the square of the
 * values, so it overstates every difference, and the shape depends entirely on
 * an axis order that has no meaning. Bars are honest about a nine-way
 * comparison in a way a polygon is not.
 *
 * NOT COLOURED BY THE GOOD/BAD RAMP either. Playing fast is not an
 * achievement. Style is descriptive, so it gets one neutral accent; the two
 * dimensions where lower genuinely is better say so in words instead.
 */

type Season = { year: number; team: string; style?: CoachStyle | null };

export function CoachStylePanel({
  styleAvg,
  stylePct,
  seasons,
  leagueAvg,
  coachName,
}: {
  styleAvg: CoachStyle | null | undefined;
  stylePct: CoachStyle | null | undefined;
  seasons: Season[];
  /** D-I mean per season, so a flat line can be told from a coach standing still. */
  leagueAvg: Map<number, CoachStyle>;
  coachName: string;
}) {
  // 30 of 804 coaches have no style at all — too few joined team-seasons.
  // They get nothing rather than a panel of dashes.
  if (!styleAvg || !stylePct || typeof styleAvg.pace !== "number") return null;

  const headline = describeStyle(styleAvg, stylePct);

  // Every season in range, oldest first, INCLUDING the ones with no style —
  // they are the gaps the sparkline has to break at. Filtering them out first
  // (which this did originally) closes the gap silently and draws a straight
  // line through a season we do not hold: Bennett's 2021 vanished and his line
  // ran unbroken from 2020 to 2022. Only the empty ends are trimmed, since
  // leading and trailing blanks are dead space rather than missing data.
  const ordered = [...seasons].sort((a, b) => a.year - b.year);
  const firstIdx = ordered.findIndex((s) => s.style);
  const lastIdx = ordered.length - 1 - [...ordered].reverse().findIndex((s) => s.style);
  const withStyle = firstIdx < 0 ? [] : ordered.slice(firstIdx, lastIdx + 1);

  return (
    <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mt-10">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight">Play style</h2>
        <span className="text-[0.6rem] uppercase tracking-[0.18em] text-ink-muted font-semibold">
          career average vs all coaches
        </span>
      </div>
      {headline && <p className="text-base text-ink-soft mb-6 max-w-3xl">{headline}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
        {(["Offense", "Defense"] as const).map((group) => (
          <div key={group}>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-3 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />
              {group}
            </div>
            <ul className="space-y-2.5">
              {STYLE_DIMENSIONS.filter((d) => d.group === group).map((d) => (
                <StyleRow
                  key={d.key}
                  label={d.label}
                  unit={d.unit}
                  value={styleAvg[d.key]}
                  pct={stylePct[d.key]}
                  series={withStyle.map((s) => ({
                    year: s.year,
                    v: s.style?.[d.key] ?? null,
                    league: leagueAvg.get(s.year)?.[d.key] ?? null,
                  }))}
                  coachName={coachName}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-5 text-xs text-ink-muted leading-relaxed max-w-3xl">
        Each coach&rsquo;s teams, averaged over the seasons we can join to a team-season (86% of
        them), and ranked against every coach with at least four such seasons — one year is a
        team, not a style. The bar runs from the median coach toward whichever end this one sits
        at, so length reads as how unusual rather than how much. The line at the right is that
        stat season by season, against the dashed D-I average for the same year; it breaks where
        a season is missing rather than guessing across it. Tempo is raw possessions rather than
        adjusted, so a coach in a slow league reads slower than he coaches.
      </p>
    </section>
  );
}

/**
 * One dimension: label, value, a centred deviation bar, and the career line.
 *
 * The bar is anchored at the 50th percentile and grows toward whichever end
 * the coach sits at, so length reads as "how unusual" rather than "how much".
 */
function StyleRow({
  label, unit, value, pct, series, coachName,
}: {
  label: string;
  unit: "" | "%";
  value: number | null;
  pct: number | null;
  series: Array<{ year: number; v: number | null; league: number | null }>;
  coachName: string;
}) {
  if (typeof value !== "number" || typeof pct !== "number") {
    return (
      <li className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-sm text-ink-soft">{label}</span>
        <span className="text-sm text-ink-muted/60">no data</span>
      </li>
    );
  }

  const dev = pct - 50;                        // -50 … +50
  const width = `${Math.abs(dev)}%`;           // half-track share
  const rightward = dev >= 0;
  const extreme = Math.abs(dev) >= 35;

  return (
    <li className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-ink-soft">{label}</span>

      {/* Rank bar and career line sit in separate columns. Overlaying the line
          behind the bar buried the one thing it was there to show — that it is
          a time series — and left the bar looking like it had a tail. */}
      <span className="relative flex-1 h-4 min-w-0">
        {/* Centre line = the median coach. */}
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink/20" />
        <span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 h-2.5 rounded-sm",
            extreme ? "bg-coral" : "bg-coral/45",
          )}
          style={rightward ? { left: "50%", width } : { right: "50%", width }}
        />
      </span>

      <span className="w-16 shrink-0 text-right text-sm font-semibold text-ink tabular">
        {value.toFixed(1)}{unit}
      </span>
      <span className="w-9 shrink-0 text-right text-[0.68rem] text-ink-muted tabular">
        {Math.round(pct)}
        <span className="text-[0.55rem] align-super">{ordinal(Math.round(pct))}</span>
      </span>
      <span className="w-24 h-6 shrink-0 hidden sm:block">
        <StyleSparkline series={series} label={label} coachName={coachName} />
      </span>
    </li>
  );
}

/**
 * The career line, drawn behind the bar.
 *
 * Coverage is 86%, so a coach can be missing a season mid-career (Bennett has
 * no 2013 or 2021). The path BREAKS at those years rather than interpolating
 * across them — a straight line through a season we do not hold would be an
 * invention, and it would land right where a reader looks for a trend.
 */
function StyleSparkline({
  series, label, coachName,
}: {
  series: Array<{ year: number; v: number | null; league: number | null }>;
  label: string;
  coachName: string;
}) {
  const vals = series.map((s) => s.v).filter((v): v is number => typeof v === "number");
  const leagues = series.map((s) => s.league).filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return null;

  const all = [...vals, ...leagues];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  // Inset on both axes. Without the horizontal pad the final point lands on
  // x=100 and the endpoint dot is half outside the box.
  const W = 100, H = 28, PAD = 3, PAD_X = 2.5;
  const x = (i: number) =>
    series.length === 1 ? W / 2 : PAD_X + (i / (series.length - 1)) * (W - PAD_X * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  // Split into unbroken runs so gaps stay gaps.
  const runs: string[] = [];
  let cur: string[] = [];
  series.forEach((s, i) => {
    if (typeof s.v === "number") cur.push(`${cur.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`);
    else if (cur.length > 0) { runs.push(cur.join(" ")); cur = []; }
  });
  if (cur.length > 0) runs.push(cur.join(" "));

  const leagueRuns: string[] = [];
  cur = [];
  series.forEach((s, i) => {
    if (typeof s.league === "number") cur.push(`${cur.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.league).toFixed(1)}`);
    else if (cur.length > 0) { leagueRuns.push(cur.join(" ")); cur = []; }
  });
  if (cur.length > 0) leagueRuns.push(cur.join(" "));

  const first = series.find((s) => typeof s.v === "number");
  const lastIdx = series.length - 1 - [...series].reverse().findIndex((s) => typeof s.v === "number");
  const last = lastIdx >= 0 ? series[lastIdx] : undefined;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-full overflow-visible"
      role="img"
      aria-label={
        first && last
          ? `${coachName} ${label} by season: ${first.v?.toFixed(1)} in ${first.year} to ${last.v?.toFixed(1)} in ${last.year}`
          : `${coachName} ${label} by season`
      }
    >
      {leagueRuns.map((d, i) => (
        <path key={`l${i}`} d={d} fill="none" stroke="currentColor" strokeWidth={1}
              className="text-ink/25" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      ))}
      {runs.map((d, i) => (
        <path key={`c${i}`} d={d} fill="none" stroke="currentColor" strokeWidth={1.5}
              className="text-coral" vectorEffect="non-scaling-stroke" />
      ))}
      {/* Anchor the most recent season. A broken line in a strip this size can
          read as a rendering glitch; a dot on the last point says the line
          ended there on purpose. */}
      {lastIdx >= 0 && typeof series[lastIdx]!.v === "number" && (
        <circle cx={x(lastIdx)} cy={y(series[lastIdx]!.v!)} r={1.6}
                className="fill-coral" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/**
 * Name the style from its two or three most extreme dimensions.
 *
 * The headline the panel is built around: a reader should learn what a coach
 * is before reading a single number. Only genuine outliers qualify — a coach
 * inside the middle 40% of every dimension gets no sentence, because "average
 * at everything" is the honest answer for most of the field.
 */
function describeStyle(avg: CoachStyle, pct: CoachStyle): string | null {
  const scored = STYLE_DIMENSIONS
    .map((d) => ({ d, p: pct[d.key] }))
    .filter((e): e is { d: (typeof STYLE_DIMENSIONS)[number]; p: number } => typeof e.p === "number")
    .map((e) => ({ ...e, dev: Math.abs(e.p - 50) }))
    .filter((e) => e.dev >= 30)
    .sort((a, b) => b.dev - a.dev)
    .slice(0, 3);

  if (scored.length === 0) return null;
  void avg;

  // A genuine outlier gets its own opening sentence, named by the stat rather
  // than the behaviour: "Lowest tempo in the field." Trying to fold that into
  // the list produced "plays slow as much as anyone in the field, contests
  // everything as much as anyone in the field and ...", which is unreadable —
  // the superlative has to be said once, not attached to every clause.
  // Only the actual extreme earns the superlative — rank 1 or rank 774 on that
  // dimension, nothing weaker. At the 5% threshold this started with, six of
  // the fifteen coaches I checked were each billed as having the lowest
  // opponent shooting allowed in the field, which is five too many.
  const top = scored[0]!;
  const lead = top.dev >= 49.99
    ? `${top.p >= 50 ? "Highest" : "Lowest"} ${top.d.noun} in the field.`
    : null;

  const rest = (lead ? scored.slice(1) : scored).map(({ d, p }) => (p >= 50 ? d.high : d.low));
  if (rest.length === 0) return lead;

  const listed = rest.length === 1
    ? rest[0]!
    : `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`;
  const tail = listed.charAt(0).toUpperCase() + listed.slice(1) + ".";

  return lead ? `${lead} ${tail}` : tail;
}

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
