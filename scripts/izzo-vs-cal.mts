import { loadAllCoachProfiles } from "../src/lib/coaches.ts";

const ps = await loadAllCoachProfiles();

for (const name of ["Izzo", "Calipari"]) {
  const p = ps.find((x) => x.name.includes(name))!;
  console.log(`\n=== ${p.name} (${p.seasons_count}y, composite ${p.composite_score}) ===`);
  const trips = p.by_year.filter((s) => s.round != null);
  console.log(`  NCAA tournament trips in window: ${trips.length}`);
  console.log(`  Final Fours: ${p.by_year.filter((s) => ["Final Four","Runner-up","Champion"].includes(s.round ?? "")).length}`);
  console.log(`  S16+ trips: ${p.by_year.filter((s) => ["Sweet 16","Elite Eight","Final Four","Runner-up","Champion"].includes(s.round ?? "")).length}`);
  console.log(`  Reg-season conf champs: ${p.by_year.filter((s) => s.reg_season_conf_champ).length}`);
  console.log(`  R1 exits (any seed): ${p.by_year.filter((s) => s.round === "R64").length}`);
  console.log(`  Missed tournament seasons: ${p.by_year.filter((s) => s.round == null).length}`);
  console.log(`  Year-by-year:`);
  for (const s of [...p.by_year].sort((a, b) => a.year - b.year)) {
    console.log(`    ${s.year}  ${s.team.padEnd(13)} ${(s.conference ?? "").padEnd(8)} ${(s.wins + "-" + s.losses).padEnd(6)} seed=${s.seed ?? "-"}  round=${s.round ?? "—"}${s.reg_season_conf_champ ? "  [REG-CHAMP]" : ""}`);
  }
}
