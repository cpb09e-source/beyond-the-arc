/**
 * build-search-index.mjs — reads existing public/data JSONs and writes a slim
 * search index for the navbar ⌘K dialog. Standalone so it can run without
 * touching Supabase. The same logic also runs inside export-static-data.mts
 * as part of the normal build pipeline.
 *
 * Output:  public/data/search-index.json
 *   [
 *     { t: "t", n: "Duke", s: "duke", c: "ACC" },
 *     { t: "p", n: "Cooper Flagg", b: 127998, tm: "Duke", y: 2025 },
 *     ...
 *   ]
 *
 * Compact field names to keep the file small over the wire.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("public/data");
const OUT = path.join(ROOT, "search-index.json");

function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- TEAMS (one entry per unique team name; use latest season's conference) ----
const teamsAll = JSON.parse(fs.readFileSync(path.join(ROOT, "teams-all.json"), "utf8"));
const byName = new Map();
for (const t of teamsAll) {
  const cur = byName.get(t.name);
  if (!cur || t.year > cur.year) byName.set(t.name, { name: t.name, year: t.year, conf: t.conference });
}
const teamEntries = [...byName.values()]
  .map((t) => ({ t: "t", n: t.name, s: slug(t.name), c: t.conference ?? null }))
  .sort((a, b) => a.n.localeCompare(b.n));

// ---- PLAYERS (one entry per bart_player_id; use latest season's team/year) ----
const yearFiles = fs.readdirSync(path.join(ROOT, "players-by-year")).filter((f) => f.endsWith(".json"));
const latestByBart = new Map();
for (const f of yearFiles) {
  const year = Number(f.replace(".json", ""));
  if (!Number.isFinite(year)) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(ROOT, "players-by-year", f), "utf8"));
  for (const p of arr) {
    if (!p.bart_player_id) continue;
    const cur = latestByBart.get(p.bart_player_id);
    if (cur && cur.year >= year) continue;
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    latestByBart.set(p.bart_player_id, {
      name: p.name,
      year,
      team: team?.name ?? "—",
      bartId: p.bart_player_id,
    });
  }
}
const playerEntries = [...latestByBart.values()]
  .map((p) => ({ t: "p", n: p.name, b: p.bartId, tm: p.team, y: p.year }))
  .sort((a, b) => a.n.localeCompare(b.n));

const all = [...teamEntries, ...playerEntries];
fs.writeFileSync(OUT, JSON.stringify(all));
const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT}`);
console.log(`  ${teamEntries.length.toLocaleString()} teams + ${playerEntries.length.toLocaleString()} players = ${all.length.toLocaleString()} entries`);
console.log(`  file size: ${sizeKb} KB`);
