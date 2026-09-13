import { useState } from "react";
import { BASIS_OPTIONS, SPLIT_OPTIONS, type Basis, type PlayerSplits } from "@/components/players/player-splits";
import type { Shooting } from "@/components/players/player-shot-impact";
import { CARDS, VIEW_OPTIONS, fmt, read, type Ctx, type View } from "@/lib/player-stat-cards";
import { playerViewByKey } from "@/lib/player-views";
import type { Player, PlayerSeason } from "~/data/player-model";
import { useLoaded } from "~/data/use-corpus";
import { playerLens } from "~/lens/stat-lens";
import { Picker } from "~/shell/picker";
import { seasonLabel } from "~/ui/format";
import { StatCard, StatCardGrid, StatCardRow, StatCardsHeader, StatCardsNote } from "~/ui/stat-cards";
import { playerStat } from "~/views/players/player-columns";

/**
 * A player's numbers as the site's Player Overview draws them: cards grouped by
 * the question they answer, each row a value and its percentile, sliced by the
 * site's eight splits and read per game or per 40 minutes.
 *
 * THE CARDS ARE THE SITE'S (src/lib/player-stat-cards.ts), and so is the split
 * file, one per player. A season with no split file (2020-21 has no game logs,
 * and a player under the cohort floor has none) falls back to the Player
 * Explorer's own bands and percentiles, in the same cards.
 */

type ViewKey = View | "everything";

const VIEW_KEY = "bta.player.statsView";
const OVERVIEW_BANDS = playerViewByKey("overview").bands;
const SPLIT_PICKS = SPLIT_OPTIONS.map((s) => ({ key: s.key, label: s.label }));

/** Everything unless the reader picked otherwise: the whole panel is what this page is for. */
function readView(): ViewKey {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEW_OPTIONS.some((o) => o.key === v) ? (v as ViewKey) : "everything";
  } catch {
    return "everything";
  }
}

export function PlayerStats({ year, player, season }: { year: number; player: Player; season: PlayerSeason }) {
  const bartId = player.bartId;
  const [splitsState] = useLoaded<PlayerSplits | null>(`player-splits|${bartId ?? "none"}`, async () => {
    if (bartId == null) return { value: null, source: "memory" };
    const { json, source } = await window.bta.data("player-splits", year, String(bartId));
    return { value: JSON.parse(json) as PlayerSplits | null, source };
  });
  const [shootingState] = useLoaded<Record<string, Shooting>>(`player-shooting-map|${year}`, async () => {
    const { json, source } = await window.bta.data("player-shooting", year);
    const file = JSON.parse(json) as { players?: Record<string, Shooting> } | null;
    return { value: file?.players ?? {}, source };
  });
  const [view, setView] = useState<ViewKey>(readView);
  const [split, setSplit] = useState("full");
  const [basis, setBasis] = useState<Basis>("g");

  const shooting = bartId != null && shootingState.status === "ready" ? (shootingState.value[String(bartId)] ?? null) : null;
  const lensSubject = bartId != null ? { kind: "player" as const, bartId, name: player.name, hasPhoto: player.hasPhoto, year } : null;
  const pickView = (key: string) => {
    setView(key as ViewKey);
    try {
      localStorage.setItem(VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  if (splitsState.status === "loading") return <p className="text-[13px] text-ink-muted">Loading the stat cards…</p>;

  const splitSeason = splitsState.status === "ready" ? (splitsState.value?.seasons?.[String(year)] ?? null) : null;
  if (!splitSeason) return <BandCards player={player} season={season} shooting={shooting} />;

  // Only the splits he has games in: a player who never lost gets no Losses.
  const available = SPLIT_PICKS.filter((s) => (splitSeason.splits[s.key]?.n ?? 0) > 0);
  const active = splitSeason.splits[split] ? split : "full";
  const ctx: Ctx = { season: splitSeason, split: active, basis };
  const n = splitSeason.splits[active]?.n ?? 0;
  const suffix = basis === "f" ? "/40" : "/G";
  // Zones are not split, and they answer a scoring question.
  const dietShown = active === "full" && (view === "overview" || view === "scoring" || view === "everything");

  return (
    <section>
      <StatCardsHeader title="Stats" meta={`${n} game${n === 1 ? "" : "s"} in this split`}>
        <Picker label="View" value={view} options={VIEW_OPTIONS} onChange={pickView} />
        <Picker label="Split" value={active} options={available} onChange={setSplit} />
        <Picker label="Basis" value={basis} options={BASIS_OPTIONS} onChange={(k) => setBasis(k as Basis)} />
      </StatCardsHeader>
      <StatCardGrid>
        {CARDS.filter((c) => view === "everything" || c.views.includes(view)).map((card) => (
          <StatCard key={card.title} title={card.title}>
            {card.stats.map((d) => {
              const cell = read(ctx, d);
              const label = d.block === "g" ? `${d.label} ${suffix}` : d.label;
              const value = fmt(cell?.[0] ?? null, d.fmt);
              // The lens is the whole season per game, so it repeats the card's number only when the card shows that too.
              const same = active === "full" && (d.block !== "g" || basis === "g");
              return (
                <StatCardRow
                  key={d.key}
                  caps
                  label={label}
                  info={d.info}
                  value={value}
                  lens={lensSubject ? playerLens(d.key, lensSubject, same ? { label, value } : undefined) : null}
                  pct={cell?.[1] ?? null}
                  sub={d.block === "impact" && active !== "full" ? "full season" : undefined}
                />
              );
            })}
          </StatCard>
        ))}
        {shooting && dietShown && <ShotDiet s={shooting} />}
      </StatCardGrid>
      <StatCardsNote>
        Chips are percentiles within the split, against {splitSeason.cohort ? `${splitSeason.cohort.toLocaleString()} ` : ""}players at the same
        position. A split under four games shows values without them. EPM, eWins, On/Off and HKM% come from the whole season and do not
        split.
      </StatCardsNote>
    </section>
  );
}

const f1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** Where his shots come from and how often they go in, full season. */
function ShotDiet({ s }: { s: Shooting }) {
  const zones = [
    { key: "Rim", pct: s.rim_pct, rate: s.rim_rate, ptile: s.rim_ptile },
    { key: "Mid", pct: s.mid_pct, rate: s.mid_rate, ptile: s.mid_ptile },
    { key: "3PT", pct: s.tp_pct, rate: s.tp_rate, ptile: s.tp_ptile },
  ].filter((z) => z.pct != null || z.rate != null);
  if (zones.length === 0 && s.asst == null) return null;
  return (
    <StatCard title="Shot Diet">
      {zones.map((z) => (
        <StatCardRow
          key={z.key}
          caps
          label={z.key}
          value={z.pct == null ? "—" : `${f1(z.pct)}%`}
          pct={z.ptile ?? null}
          sub={z.rate == null ? undefined : `${f1(z.rate)}% of shots`}
        />
      ))}
      {/* No chip: how often a player is assisted describes a role, not a grade. */}
      {s.asst != null && <StatCardRow caps label="Assisted" value={`${f1(s.asst)}%`} pct={null} sub="lower = self-created" />}
    </StatCard>
  );
}

/** A season with no split file: the explorer's bands, full season, in the same cards. */
function BandCards({ player, season, shooting }: { player: Player; season: PlayerSeason; shooting: Shooting | null }) {
  const bartId = player.bartId;
  return (
    <section>
      <StatCardsHeader title="Stats" meta={`${seasonLabel(season.year)}, full season`} />
      <StatCardGrid>
        {OVERVIEW_BANDS.map((band) => (
          <StatCard key={band.label} title={band.label}>
            {band.keys.map((key) => {
              const st = playerStat(key);
              if (!st || (key === "ewins" && !season.hasEwins)) return null;
              return (
                <StatCardRow
                  key={key}
                  caps
                  label={st.label}
                  info={st.desc}
                  value={st.format(player.s[st.field] as number | null)}
                  lens={
                    bartId != null
                      ? playerLens(
                          key,
                          { kind: "player", bartId, name: player.name, hasPhoto: player.hasPhoto, year: season.year },
                          { label: st.label, value: st.format(player.s[st.field] as number | null) },
                        )
                      : null
                  }
                  pct={st.pctKey ? (player.pct[st.pctKey] ?? null) : null}
                />
              );
            })}
          </StatCard>
        ))}
        {shooting && <ShotDiet s={shooting} />}
      </StatCardGrid>
      <StatCardsNote>
        No split file for this season, so these are the Player Explorer&apos;s full-season numbers, ranked among the season&apos;s players.
        {season.estimated ? " EPM is estimated from the box score." : ""}
      </StatCardsNote>
    </section>
  );
}
