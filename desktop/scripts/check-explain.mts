/**
 * Checks the explain engine against real seasons: every explanation's parts
 * plus its schedule line must add up to its gap, the raw ratings must equal the
 * Stat Lens's pooled ones, and the count group must stay small.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/check-explain.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { T } from "@/lib/team-game-index";
import type { TeamGame } from "~/data/team-game-model";
import { explain, gameShares, rawFigure, sideOf, type Measure } from "~/explain/explain-model";
import { TEAM_LENS } from "~/lens/lens-stats";

const DATA = resolve(import.meta.dirname, "../../public/data");

type Pack = { fields: string[]; teams: { names: string[] }; opps: string[]; rows: number[][] };

function load(year: number): TeamGame[] {
  const pack = JSON.parse(readFileSync(`${DATA}/team-game-index/${year}.json`, "utf8")) as Pack;
  const index = new Map(pack.teams.names.map((n, i) => [n, i]));
  const on = new Map<string, number[]>();
  for (const r of pack.rows) on.set(`${r[T.t]}|${r[T.d]}`, r);
  return pack.rows.map((r) => {
    const team = pack.teams.names[r[T.t]!]!;
    const opp = pack.opps[r[T.o]!]!;
    return { row: r, team, opp, oppRow: on.get(`${index.get(opp) ?? -1}|${r[T.d]}`) ?? null } as unknown as TeamGame;
  });
}

function adjusted(year: number): Map<string, { o: number | null; d: number | null; net: number | null }> {
  const rows = JSON.parse(readFileSync(`${DATA}/teams-by-year/${year}.json`, "utf8")) as Array<{ name: string; team_season_stats?: Record<string, number> }>;
  return new Map(rows.map((r) => [r.name, { o: r.team_season_stats?.a_ortg ?? null, d: r.team_season_stats?.a_drtg ?? null, net: r.team_season_stats?.a_net ?? null }]));
}

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${what}`);
  }
};

for (const year of [2026, 2019, 2014]) {
  const games = load(year);
  const adj = adjusted(year);
  const byTeam = new Map<string, TeamGame[]>();
  for (const g of games) (byTeam.get(g.team) ?? byTeam.set(g.team, []).get(g.team)!).push(g);
  const names = [...byTeam.keys()];
  let worstSum = 0;
  let worstCount = 0;
  let pairs = 0;
  for (let i = 0; i < names.length; i += 7) {
    const a = names[i]!;
    const b = names[(i * 13 + 5) % names.length]!;
    if (a === b) continue;
    const x = sideOf(byTeam.get(a)!, adj.get(a) ?? null);
    const y = sideOf(byTeam.get(b)!, adj.get(b) ?? null);
    for (const m of ["net", "offense", "defense"] as Measure[]) {
      const e = explain(x, y, m);
      check(e != null, `${year} ${a} vs ${b} ${m}: no explanation`);
      if (!e) continue;
      const sum = e.parts.reduce((n, p) => n + p.total, 0) + (e.schedule ?? 0);
      worstSum = Math.max(worstSum, Math.abs(sum - e.gap));
      const count = e.parts.find((p) => p.key === "count")!;
      worstCount = Math.max(worstCount, Math.abs(count.total));
    }
    pairs += 1;
    // Raw figures equal the Stat Lens's pooled ones.
    const ts = byTeam.get(a)!;
    check(Math.abs(x.raw.o! - TEAM_LENS.ortg!.pool(ts)!) < 1e-9, `${year} ${a} raw O vs lens`);
    check(Math.abs(x.raw.d! - TEAM_LENS.drtg!.pool(ts)!) < 1e-9, `${year} ${a} raw D vs lens`);
    // A window's game shares add up to its distance from the baseline.
    const last10 = ts.slice(-10);
    const s10 = sideOf(last10);
    const base = x.raw.net!;
    const total = gameShares(last10, base, "net").reduce((n, s) => n + s.share, 0);
    check(Math.abs(total - (rawFigure(s10, "net")! - base)) < 1e-9, `${year} ${a} game shares`);
  }
  check(worstSum < 1e-9, `${year} parts do not add up: worst ${worstSum}`);
  console.log(`${year}: ${pairs} pairs, worst |parts − gap| ${worstSum.toExponential(1)}, largest count part ${worstCount.toFixed(2)}`);
}

// One worked example to read.
{
  const games = load(2026);
  const adj = adjusted(2026);
  const pick = (n: string) => games.filter((g) => g.team === n);
  const x = sideOf(pick("Duke"), adj.get("Duke")!);
  const y = sideOf(pick("Auburn"), adj.get("Auburn")!);
  const e = explain(x, y, "net")!;
  console.log(`Duke ${e.x.toFixed(1)} vs Auburn ${e.y.toFixed(1)}: gap ${e.gap.toFixed(2)}`);
  for (const p of e.parts) console.log(`  ${p.key.padEnd(11)} off ${p.offense.toFixed(2).padStart(6)} def ${p.defense.toFixed(2).padStart(6)} total ${p.total.toFixed(2).padStart(6)}`);
  console.log(`  schedule    ${e.schedule!.toFixed(2)}`);
  console.log(`  efgd lens (exact) ${TEAM_LENS.efgd!.pool(pick("Duke"))!.toFixed(4)}  tovd ${TEAM_LENS.tovd!.pool(pick("Duke"))!.toFixed(4)}  orebpd ${TEAM_LENS.orebpd!.pool(pick("Duke"))!.toFixed(2)}`);
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
