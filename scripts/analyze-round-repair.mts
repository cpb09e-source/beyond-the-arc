/**
 * analyze-round-repair.mts — measure what repairing the 2013-15 round labels
 * would do to the composite leaderboard. READ-ONLY as far as the repo is
 * concerned: it writes a repaired coach-history.json, scores against it, and
 * restores the original bytes in a finally block.
 *
 * THE BUG. `round` in coach-history.json is the round a team was eliminated
 * in. For 2013, 2014 and 2015 it is off by one for every R64 loser — exactly
 * 32 per year, 96 rows, all labelled "R32". The bracket in
 * tournament-games.json is complete for those years (63 games, correct shape)
 * and disagrees in precisely those rows.
 *
 * WHY IT MATTERS BEYOND THE LABEL. computeCompositeScore reads `round` three
 * times per season, and all three currently let those 96 seasons off:
 *   - REACH_POINTS[R32] instead of REACH_POINTS[R64] (which is negative for
 *     Power-conference teams)
 *   - the −6 "top-seed first-round disaster" for a 1/2/3 seed losing in the
 *     R64, which none of them are currently paying
 *   - the −1 blueblood R1-exit tax
 *
 * So this is not a cosmetic fix; it moves the leaderboard. That is the whole
 * reason for measuring before doing it.
 *
 *   npx tsx scripts/analyze-round-repair.mts
 */
import fs from "node:fs";
import path from "node:path";
import { loadAllCoachProfiles, type CoachProfile } from "../src/lib/coaches.ts";

const HISTORY = path.resolve("src/data/coach-history.json");
const GAMES = path.resolve("src/data/tournament-games.json");

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

const ALIAS: Record<string, string> = {
  "Connecticut": "UConn", "North Carolina": "UNC", "Pittsburgh": "Pitt", "Mississippi": "Ole Miss",
  "Massachusetts": "UMass", "East Tennessee St.": "ETSU", "N.C. State": "NC State", "McNeese St.": "McNeese",
  "Miami FL": "Miami (FL)", "Miami OH": "Miami (OH)", "Loyola Chicago": "Loyola (IL)",
  "St. John's": "St. John's (NY)", "Charleston": "College of Charleston", "Fairleigh Dickinson": "FDU",
  "Cal Baptist": "California Baptist", "Albany": "Albany (NY)", "Queens": "Queens (NC)",
  "Gardner Webb": "Gardner-Webb", "SIU Edwardsville": "SIU-Edwardsville",
  "Texas A&M Corpus Chris": "Texas A&M-Corpus Christi", "Nebraska Omaha": "Omaha", "Grambling St.": "Grambling",
};

type Cell = { school: string };
type Game = { winner: Cell; loser: Cell; round: string };

function candidates(team: string): string[] {
  const out = [norm(team)];
  if (ALIAS[team]) out.push(norm(ALIAS[team]));
  if (/\bSt\.$/.test(team)) out.push(norm(team.replace(/\bSt\.$/, "State")));
  return out;
}

/** Wins the round label implies, mirroring ROUND_WINS_LOOKUP in coaches.ts. */
const ROUND_WINS: Record<string, number> = {
  "First Four": 0, "R64": 0, "R32": 1, "Sweet 16": 2,
  "Elite Eight": 3, "Final Four": 4, "Runner-up": 5, "Champion": 6,
};
/** Inverse: the label that matches a given win count for a team that lost. */
const WINS_TO_ROUND = ["R64", "R32", "Sweet 16", "Elite Eight", "Final Four", "Runner-up"];

function main() {
  const originalBytes = fs.readFileSync(HISTORY);
  const history = JSON.parse(originalBytes.toString("utf8")) as Record<string, Record<string, { name: string; round: string | null; seed: number | null } | null>>;
  const games = JSON.parse(fs.readFileSync(GAMES, "utf8")) as Record<string, Game[]>;

  const byTeamYear = new Map<string, Game[]>();
  for (const [year, list] of Object.entries(games)) {
    for (const g of list) {
      for (const cell of [g.winner, g.loser]) {
        const k = `${norm(cell.school)}|${year}`;
        if (!byTeamYear.has(k)) byTeamYear.set(k, []);
        byTeamYear.get(k)!.push(g);
      }
    }
  }

  // ---- 1. Work out the repair -------------------------------------------
  const repairs: Array<{ team: string; year: string; from: string; to: string; seed: number | null; coach: string }> = [];
  for (const [team, byYear] of Object.entries(history)) {
    for (const [year, s] of Object.entries(byYear)) {
      if (!s || s.round == null) continue;
      let key: string | null = null, list: Game[] | undefined;
      for (const c of candidates(team)) {
        const hit = byTeamYear.get(`${c}|${year}`);
        if (hit) { key = c; list = hit; break; }
      }
      if (!list || !key) continue;
      // Scope to the three years with the systematic off-by-one. Outside them
      // a games/label disagreement means a game that was never played, not a
      // mislabel: Oregon 2021 reached the Sweet 16 on VCU's COVID no-contest,
      // so the label is right and the bracket is the thing that is short.
      if (year !== "2013" && year !== "2014" && year !== "2015") continue;
      let wins = 0;
      for (const g of list) if (norm(g.winner.school) === key) wins++;
      const isChamp = list.some((g) => g.round === "Champion" && norm(g.winner.school) === key);
      if (isChamp) continue;
      if (wins === ROUND_WINS[s.round]) continue;
      const corrected = WINS_TO_ROUND[wins];
      if (!corrected || corrected === s.round) continue;
      repairs.push({ team, year, from: s.round, to: corrected, seed: s.seed, coach: s.name });
    }
  }

  console.log(`\n=== REPAIR SET: ${repairs.length} coach-seasons ===`);
  const byYearCount: Record<string, number> = {};
  const byShape: Record<string, number> = {};
  for (const r of repairs) {
    byYearCount[r.year] = (byYearCount[r.year] ?? 0) + 1;
    byShape[`${r.from} -> ${r.to}`] = (byShape[`${r.from} -> ${r.to}`] ?? 0) + 1;
  }
  console.table(Object.entries(byYearCount).sort().map(([year, n]) => ({ year, n })));
  console.table(Object.entries(byShape).map(([shape, n]) => ({ shape, n })));

  const topSeeds = repairs.filter((r) => r.to === "R64" && r.seed != null && r.seed <= 3);
  console.log(`\nOf these, ${topSeeds.length} are 1/2/3 seeds that would newly owe the -6 top-seed disaster penalty:`);
  console.table(topSeeds.map((r) => ({ coach: r.coach, team: r.team, year: r.year, seed: r.seed })));

  // ---- 2. Score before ---------------------------------------------------
  const before = new Map<string, { name: string; composite: number | null }>();
  const after = new Map<string, number | null>();

  return (async () => {
    const baseProfiles: CoachProfile[] = await loadAllCoachProfiles();
    for (const p of baseProfiles) before.set(p.slug, { name: p.name, composite: p.composite_score ?? null });

    // ---- 3. Apply the repair, rescore, always restore ---------------------
    try {
      for (const r of repairs) history[r.team]![r.year]!.round = r.to;
      fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));
      const fixedProfiles = await loadAllCoachProfiles();
      for (const p of fixedProfiles) after.set(p.slug, p.composite_score ?? null);
    } finally {
      fs.writeFileSync(HISTORY, originalBytes);
      console.log("\n(restored src/data/coach-history.json to its committed bytes)");
    }

    // ---- 4. Diff -----------------------------------------------------------
    const moved: Array<{ name: string; before: number; after: number; delta: number }> = [];
    for (const [slug, b] of before) {
      const a = after.get(slug);
      if (b.composite == null || a == null) continue;
      if (Math.abs(a - b.composite) < 0.05) continue;
      moved.push({ name: b.name, before: b.composite, after: a, delta: Math.round((a - b.composite) * 10) / 10 });
    }
    moved.sort((x, y) => x.delta - y.delta);

    console.log(`\n=== COMPOSITE IMPACT: ${moved.length} of ${before.size} coaches move ===`);
    console.log("\nBiggest drops:");
    console.table(moved.slice(0, 15).map((m) => ({ coach: m.name, before: m.before.toFixed(1), after: m.after.toFixed(1), delta: m.delta })));

    // Rank movement in the top 25.
    const rankOf = (m: Map<string, number | null> | Map<string, { composite: number | null }>, pick: (v: never) => number | null) => {
      const arr = [...m.entries()]
        .map(([slug, v]) => [slug, pick(v as never)] as const)
        .filter((e): e is readonly [string, number] => typeof e[1] === "number")
        .sort((p, q) => q[1] - p[1]);
      return new Map(arr.map(([slug], i) => [slug, i + 1]));
    };
    const rBefore = rankOf(before, (v: { composite: number | null }) => v.composite);
    const rAfter = rankOf(after, (v: number | null) => v);

    const shifts: Array<{ coach: string; rankBefore: number; rankAfter: number; move: number }> = [];
    for (const [slug, rb] of rBefore) {
      const ra = rAfter.get(slug);
      if (ra == null || rb > 25 && ra > 25) continue;
      if (ra === rb) continue;
      shifts.push({ coach: before.get(slug)!.name, rankBefore: rb, rankAfter: ra, move: rb - ra });
    }
    shifts.sort((x, y) => x.rankBefore - y.rankBefore);
    console.log("\nTop-25 rank movement (positive move = climbed):");
    console.table(shifts.slice(0, 25));
  })();
}

await main();
