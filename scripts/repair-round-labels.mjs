#!/usr/bin/env node
/**
 * repair-round-labels.mjs — fix the 2013-15 off-by-one in coach-history.json.
 *
 * THE BUG. `round` records the round a team was eliminated in. For 2013, 2014
 * and 2015 the scrape is off by one for every R64 loser: exactly 32 per year,
 * 96 rows, each labelled "R32" when the team lost its opening game. The
 * bracket in tournament-games.json is complete for those years (63 games,
 * correct shape) and disagrees in precisely those rows, which is how this was
 * found — see scripts/analyze-round-repair.mts for the impact measurement.
 *
 * WHAT IT TOUCHES. `round` is read three times per season by
 * computeCompositeScore, and all three currently let those 96 seasons off:
 * REACH_POINTS[R32] instead of the negative Power R64 value, the -6 top-seed
 * first-round disaster, and the -1 blueblood R1-exit tax. Measured before
 * running: 78 of 804 coaches move, every one of them downward, biggest drop
 * -10.1 (John Thompson), worst top-25 disruption three places (Scott Drew,
 * 13 -> 16). Sweet 16 counts and deeper never look at R32, so appearances,
 * tourney_rank_key and the March column are unaffected.
 *
 * SCOPED TO 2013-2015 DELIBERATELY. Outside those years a games/label
 * disagreement means a game that was never played rather than a mislabel:
 * Oregon 2021 reached the Sweet 16 on VCU's COVID no-contest, so the label is
 * right and the bracket is the thing that is short. Without the scope this
 * would "fix" that row and be wrong.
 *
 * Idempotent: a second run finds nothing to change.
 *
 *   node scripts/repair-round-labels.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const DRY = process.argv.includes("--dry-run");
const HISTORY = path.resolve("src/data/coach-history.json");
const GAMES = path.resolve("src/data/tournament-games.json");
const YEARS = new Set(["2013", "2014", "2015"]);

const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

// Mirrors BART_TO_SR_ALIAS in src/lib/coaches.ts.
const ALIAS = {
  "Connecticut": "UConn", "North Carolina": "UNC", "Pittsburgh": "Pitt", "Mississippi": "Ole Miss",
  "Massachusetts": "UMass", "East Tennessee St.": "ETSU", "N.C. State": "NC State", "McNeese St.": "McNeese",
  "Miami FL": "Miami (FL)", "Miami OH": "Miami (OH)", "Loyola Chicago": "Loyola (IL)",
  "St. John's": "St. John's (NY)", "Charleston": "College of Charleston", "Fairleigh Dickinson": "FDU",
  "Cal Baptist": "California Baptist", "Albany": "Albany (NY)", "Queens": "Queens (NC)",
  "Gardner Webb": "Gardner-Webb", "SIU Edwardsville": "SIU-Edwardsville",
  "Texas A&M Corpus Chris": "Texas A&M-Corpus Christi", "Nebraska Omaha": "Omaha", "Grambling St.": "Grambling",
};

const candidates = (team) => {
  const out = [norm(team)];
  if (ALIAS[team]) out.push(norm(ALIAS[team]));
  if (/\bSt\.$/.test(team)) out.push(norm(team.replace(/\bSt\.$/, "State")));
  return out;
};

const ROUND_WINS = {
  "First Four": 0, "R64": 0, "R32": 1, "Sweet 16": 2,
  "Elite Eight": 3, "Final Four": 4, "Runner-up": 5, "Champion": 6,
};
/** The label for a team that lost after winning `wins` games. */
const WINS_TO_ROUND = ["R64", "R32", "Sweet 16", "Elite Eight", "Final Four", "Runner-up"];

function main() {
  const raw = fs.readFileSync(HISTORY, "utf8");
  const history = JSON.parse(raw);
  const games = JSON.parse(fs.readFileSync(GAMES, "utf8"));

  const byTeamYear = new Map();
  for (const [year, list] of Object.entries(games)) {
    for (const g of list) {
      for (const cell of [g.winner, g.loser]) {
        const k = `${norm(cell.school)}|${year}`;
        if (!byTeamYear.has(k)) byTeamYear.set(k, []);
        byTeamYear.get(k).push(g);
      }
    }
  }

  const repairs = [];
  for (const [team, byYear] of Object.entries(history)) {
    for (const [year, s] of Object.entries(byYear)) {
      if (!s || s.round == null || !YEARS.has(year)) continue;
      let key = null, list = null;
      for (const c of candidates(team)) {
        const hit = byTeamYear.get(`${c}|${year}`);
        if (hit) { key = c; list = hit; break; }
      }
      if (!list) continue;

      let wins = 0;
      let champ = false;
      for (const g of list) {
        if (norm(g.winner.school) === key) {
          wins++;
          if (g.round === "Champion") champ = true;
        }
      }
      if (champ) continue;
      if (wins === ROUND_WINS[s.round]) continue;
      const corrected = WINS_TO_ROUND[wins];
      if (!corrected || corrected === s.round) continue;
      repairs.push({ team, year, from: s.round, to: corrected, coach: s.name, seed: s.seed });
    }
  }

  if (repairs.length === 0) {
    console.log("  nothing to repair — labels already agree with the bracket.");
    return;
  }

  const shapes = {};
  const years = {};
  for (const r of repairs) {
    shapes[`${r.from} -> ${r.to}`] = (shapes[`${r.from} -> ${r.to}`] ?? 0) + 1;
    years[r.year] = (years[r.year] ?? 0) + 1;
  }
  console.log(`  ${repairs.length} coach-seasons to repair`);
  console.table(Object.entries(years).sort().map(([year, n]) => ({ year, n })));
  console.table(Object.entries(shapes).map(([shape, n]) => ({ shape, n })));
  console.log("\n  sample:");
  console.table(repairs.slice(0, 8).map((r) => ({ coach: r.coach, team: r.team, year: r.year, from: r.from, to: r.to, seed: r.seed })));

  if (DRY) {
    console.log("\n  --dry-run: nothing written");
    return;
  }

  for (const r of repairs) history[r.team][r.year].round = r.to;

  // Reproduce the file's existing formatting exactly, so `git diff` shows 96
  // changed round values rather than 1.2 MB of re-punctuated JSON. The file is
  // 2-space indented with CRLF endings and no trailing newline; JSON.stringify
  // emits LF, so the endings have to be put back.
  const indentMatch = raw.match(/^\{\r?\n( +)"/);
  const indent = indentMatch ? indentMatch[1].length : 2;
  const usesCrlf = raw.includes("\r\n");
  let out = JSON.stringify(history, null, indent);
  if (usesCrlf) out = out.replace(/\n/g, "\r\n");
  if (raw.endsWith("\n")) out += usesCrlf ? "\r\n" : "\n";
  fs.writeFileSync(HISTORY, out);
  console.log(`\n  wrote ${path.relative(process.cwd(), HISTORY)} — ${repairs.length} rounds corrected.`);
}

main();
