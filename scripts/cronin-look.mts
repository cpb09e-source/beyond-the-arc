import { loadAllCoachProfiles } from "../src/lib/coaches.ts";

const ps = await loadAllCoachProfiles();
const cronin = ps.find((p) => p.name.includes("Cronin"))!;

console.log(`${cronin.name} — composite ${cronin.composite_score}, seasons ${cronin.seasons_count}`);
console.log(`Career W-L: ${cronin.career_wins}-${cronin.career_losses}, win-pct ${cronin.career_win_pct}`);
console.log();

for (const s of [...cronin.by_year].sort((a, b) => a.year - b.year)) {
  console.log(
    `${s.year}  ${s.team.padEnd(12)} ${(s.conference ?? "").padEnd(8)} ` +
      `${(s.wins + "-" + s.losses).padEnd(6)} seed=${s.seed ?? "-"}  round=${s.round ?? "—"}` +
      `${s.reg_season_conf_champ ? "  [REG-CHAMP]" : ""}`,
  );
}

console.log();
console.log("Career markers:");
console.log("  Tournament trips:", cronin.by_year.filter((s) => s.round != null).length);
console.log("  Misses (incl 2020):", cronin.by_year.filter((s) => s.round == null).length);
console.log("  S16+ trips:", cronin.by_year.filter((s) => ["Sweet 16","Elite Eight","Final Four","Runner-up","Champion"].includes(s.round ?? "")).length);
console.log("  Final Fours:", cronin.by_year.filter((s) => ["Final Four","Runner-up","Champion"].includes(s.round ?? "")).length);
console.log("  Titles:", cronin.by_year.filter((s) => s.round === "Champion").length);
console.log("  Reg-season champs:", cronin.by_year.filter((s) => s.reg_season_conf_champ).length);
console.log("  R1 exits at blueblood:", cronin.by_year.filter((s) => s.round === "R64" && ["Cincinnati","UCLA","Duke","Kansas"].includes(s.team)).length);
