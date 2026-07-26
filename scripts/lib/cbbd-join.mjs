/**
 * Shared join primitives for matching our game logs against CBBD box data.
 *
 * WHY THIS MODULE EXISTS: export-game-box-json.mjs and
 * export-game-players-json.mjs join the same logs to the same provider using
 * the same (ET date | normalized team) key. When the player export re-derived
 * its own normalizer instead of reusing this one — no alias map, slightly
 * different stripping — it joined 92.5% of 2026 where the team export joined
 * 100%, and the 900-row gap looked like missing upstream data rather than a
 * local bug. One definition, imported by both, makes that failure impossible.
 *
 * The alias map is read from src/lib/quad.ts at run time so the app and the
 * export pipeline can never disagree about which log name maps to which
 * provider name.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function loadAliases() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/quad.ts"), "utf8");
  const block = src.match(/TEAM_RATING_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("Could not parse TEAM_RATING_ALIASES from src/lib/quad.ts");
  const out = {};
  for (const m of block[1].matchAll(/"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2];
  return out;
}

export const ALIASES = loadAliases();

/** Lowercase, de-accent, "St."→"state", drop a lone "U", collapse punctuation. */
export const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state").replace(/\bu\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

/** Our log's team name → the key CBBD rows normalize to. */
export const teamKey = (logName) => norm(ALIASES[logName] ?? logName);

/**
 * Games are keyed on their EASTERN calendar date. A 10pm PT tip is already
 * "tomorrow" in UTC, so normalizing on UTC would put the two sources on
 * different days for every late West-coast game.
 */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export const etDate = (iso) => ET.format(new Date(iso));
export const shiftDate = (ymd, days) =>
  new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

/** "12345-1" → "12345" — the numeric prefix both perspectives of a game share. */
export const gameKey = (id) => String(id ?? "").split("-")[0] ?? "";

/**
 * Build the two lookup maps every CBBD join needs from a list of box rows:
 * an exact (ET date | team) index, and a (team | opponent) fallback for the
 * rare game whose date is off by more than a day.
 */
export function buildIndexes(boxRows) {
  const byDateTeam = new Map();
  const byMatchup = new Map();
  for (const r of boxRows) {
    if (!r.startDate || !r.team) continue;
    const d = etDate(r.startDate);
    const tk = norm(r.team);
    const k = `${d}|${tk}`;
    if (!byDateTeam.has(k)) byDateTeam.set(k, r);
    const mk = `${tk}|${norm(r.opponent)}`;
    const arr = byMatchup.get(mk);
    if (arr) arr.push(r);
    else byMatchup.set(mk, [r]);
  }
  return { byDateTeam, byMatchup };
}

/**
 * Resolve one game-log row to its CBBD box row: exact ET date, then ±1 day,
 * then the same two teams within a week. Returns null when nothing matches.
 */
export function findBoxRow(g, { byDateTeam, byMatchup }) {
  const tk = teamKey(g.team_name);
  let hit = byDateTeam.get(`${g.game_date}|${tk}`);
  if (hit) return hit;
  for (const off of [-1, 1]) {
    hit = byDateTeam.get(`${shiftDate(g.game_date, off)}|${tk}`);
    if (hit) return hit;
  }
  if (g.opp_team_market) {
    const cands = byMatchup.get(`${tk}|${teamKey(g.opp_team_market)}`);
    if (cands?.length) {
      let best = null, bestGap = Infinity;
      for (const c of cands) {
        const gap = Math.abs(new Date(etDate(c.startDate)) - new Date(g.game_date)) / 86400000;
        if (gap < bestGap) { bestGap = gap; best = c; }
      }
      if (best && bestGap <= 7) return best;
    }
  }
  return null;
}
