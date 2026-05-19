import { loadAllCoachProfiles } from "../src/lib/coaches.ts";

const ps = await loadAllCoachProfiles();
const sorted = ps
  .filter((p) => p.composite_score != null)
  .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));

console.log("TOP 25:");
sorted.slice(0, 25).forEach((p, i) => {
  console.log(
    String(i + 1).padStart(3) +
      ". " +
      p.name.padEnd(25) +
      " " +
      String(p.composite_score).padStart(7) +
      "  " +
      String(p.seasons_count).padStart(2) +
      "y  " +
      (p.current_team ?? ""),
  );
});

for (const name of ["Pitino", "Calipari", "Krzyzewski", "Self", "Few", "Wright"]) {
  const idx = sorted.findIndex((p) => p.name.includes(name));
  if (idx >= 0) {
    const p = sorted[idx]!;
    console.log(
      name.padEnd(12) + "rank " + String(idx + 1).padStart(3) + ": " + p.composite_score + "  (" + p.seasons_count + "y)",
    );
  }
}
