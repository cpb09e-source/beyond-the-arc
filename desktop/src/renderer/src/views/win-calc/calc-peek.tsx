import { PercentileChip } from "@/components/percentile-chip";
import type { Filter, GameLog } from "@/lib/game-filters";
import { labelFor, statLabel } from "@/lib/win-calc";
import { TeamLogo } from "~/ui/logo";
import { Cells, type Read } from "~/ui/peek-cells";
import { coachLookup, crestOf, fmtValue, gamePct, longDate } from "./calc-model";

/**
 * One matching game at a glance: the result, why it is in the answer, and how
 * it was won or lost.
 *
 * THE QUESTION COMES FIRST. Each condition is listed with what this game
 * actually did, so a row that barely cleared "3P% ≥ 40%" reads differently from
 * one that shot 60.
 *
 * Every chip ranks the game among every D-I team-game of its season, the same
 * cohort as the table's condition columns.
 */

const LABEL: Record<string, string> = {
  ortg: "ORtg",
  drtg: "DRtg",
  pace: "Pace",
  opp_rank: "Opp rank",
  fg3_pct: "3P%",
  fg2_pct: "2P%",
  ft_pct: "FT%",
  ts_pct: "TS%",
  h1_margin: "1st half",
  h2_margin: "2nd half",
  largest_lead: "Top lead",
  largest_lead_opp: "Top deficit",
  reb_diff: "Rebounds",
  tov_diff: "Turnovers",
  pitp_diff: "Paint pts",
  fbpts_diff: "Fast break",
  scp_diff: "2nd chance",
  pot_diff: "Pts off TO",
  ast_diff: "Assists",
  fg3_made_diff: "Threes",
};

const FACTORS: Array<[label: string, off: string, def: string]> = [
  ["eFG%", "ff_efg", "ff_efg_def"],
  ["TOV%", "ff_tov", "ff_tov_def"],
  ["ORB%", "ff_orb", "ff_orb_def"],
  ["FT rate", "ff_ftr", "ff_ftr_def"],
];

const num = (g: GameLog, key: string): number | null => {
  const v = g[key];
  return typeof v === "number" ? v : null;
};

export function CalcPeekBody({ game, filters }: { game: GameLog; filters: Filter[] }) {
  const read = (key: string): Read => {
    const v = num(game, key);
    const { pct, neutral } = gamePct(game, key);
    const text = fmtValue(v, key);
    return {
      label: LABEL[key] ?? statLabel(key),
      text: key.endsWith("_margin") && v != null && v > 0 ? `+${text}` : text,
      pct,
      neutral,
    };
  };

  const round = typeof game.round === "string" && game.round ? game.round : null;
  const event = typeof game.tourney_name === "string" && game.tourney_name ? game.tourney_name : null;
  const kind =
    num(game, "tourney") === 1
      ? `NCAA tournament${round ? `, ${round}` : ""}`
      : num(game, "postseason") === 1
        ? `${event ?? "Postseason"}${round ? `, ${round}` : ""}`
        : round
          ? `Conference tournament, ${round}`
          : num(game, "conf_game") === 1
            ? "Conference game"
            : num(game, "conf_game") === 0
              ? "Non-conference"
              : null;
  const coach = coachLookup().coachByTeamYear[game.team_name]?.[game.year] ?? null;
  const context = [longDate(game.game_date), kind, game.is_neutral ? "Neutral floor" : null, game.quad ? `Quad ${game.quad}` : null]
    .filter(Boolean)
    .join(" · ");
  const ap = num(game, "ap_rank");
  const oppAp = num(game, "opp_ap_rank");
  const ot = (num(game, "ot_pts") ?? 0) > 0;

  return (
    <>
      <header className="px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-3">
          <TeamLogo id={crestOf(game.team_name)} name={game.team_name} size={30} />
          <div className="min-w-0 flex-1">
            <h2 className="flex min-w-0 items-baseline gap-1.5 text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {ap != null && <span className="text-[12px] font-medium text-ink-muted tabular">{ap}</span>}
              <span className="truncate">{game.team_name}</span>
            </h2>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-soft">
              <span className="text-ink-muted">{game.is_home || game.is_neutral ? "vs" : "at"}</span>
              <TeamLogo id={crestOf(game.opp_team_market)} name={game.opp_team_market ?? "?"} size={14} />
              {oppAp != null && <span className="text-ink-muted tabular">{oppAp}</span>}
              <span className="truncate">{game.opp_team_market ?? "Unknown opponent"}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[20px] font-semibold leading-none tabular">
              <span className={game.won ? "text-good" : "text-bad"}>{game.won ? "W" : "L"}</span>{" "}
              <span className="text-ink">
                {game.pts_scored ?? "—"}–{game.pts_against ?? "—"}
              </span>
            </div>
            {ot && <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Overtime</div>}
          </div>
        </div>
        <div className="mt-2 truncate text-[12px] text-ink-muted">{context}</div>
        {coach && <div className="mt-0.5 truncate text-[12px] text-ink-muted">Coached by {coach}</div>}
      </header>

      {filters.length > 0 && (
        <section className="border-t border-hairline px-4 py-2.5">
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">The question</h3>
          <ul className="grid gap-[5px]">
            {filters.map((f) => {
              const key = String(f.stat);
              return (
                <li key={f.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-ink-soft">{labelFor(f)}</span>
                  <span className="shrink-0 font-medium text-ink tabular">{fmtValue(num(game, key), key)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Cells title="Efficiency" cells={["ortg", "drtg", "pace", "opp_rank"].map(read)} />

      <section className="border-t border-hairline px-4 py-2.5">
        <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_96px_96px] items-baseline gap-2">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Four factors</h3>
          <span className="text-right text-[10.5px] text-ink-muted">Offense</span>
          <span className="text-right text-[10.5px] text-ink-muted">Defense</span>
        </div>
        <ul className="grid gap-[5px]">
          {FACTORS.map(([label, off, def]) => (
            <li key={label} className="grid grid-cols-[minmax(0,1fr)_96px_96px] items-center gap-2 text-[12.5px]">
              <span className="truncate text-ink-soft">{label}</span>
              <Pair r={read(off)} />
              <Pair r={read(def)} />
            </li>
          ))}
        </ul>
      </section>

      <Cells title="Shooting" cells={["fg3_pct", "fg2_pct", "ft_pct", "ts_pct"].map(read)} />
      <Cells title="Game flow" cells={["h1_margin", "h2_margin", "largest_lead", "largest_lead_opp"].map(read)} />
      <Cells
        title="Against the opponent"
        cells={["reb_diff", "tov_diff", "pitp_diff", "fbpts_diff", "scp_diff", "pot_diff", "ast_diff", "fg3_made_diff"].map(read)}
      />
    </>
  );
}

function Pair({ r }: { r: Read }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="text-ink tabular">{r.text}</span>
      <PercentileChip pct={r.pct} neutral={r.neutral} className="min-w-[30px] text-[11px]" />
    </span>
  );
}
