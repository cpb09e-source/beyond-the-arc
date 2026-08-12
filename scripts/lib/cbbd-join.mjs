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

/* ------------------------------------------------------------------ *
 * PERSON names.
 *
 * `norm` above is the TEAM normalizer and must not be used on people:
 * it rewrites "st." to "state" and drops a lone "u", so "Enel St. Bernard"
 * becomes "enel state bernard". That happens to be harmless while both
 * sides mangle identically, but "Kevo St.Hilaire" and "Kevo St. Hilaire"
 * do not mangle identically, and nothing about `norm` was designed for
 * the two ways a person's name actually varies between providers:
 *
 *   SUFFIXES.  Bart and CBBD disagree constantly about whether to carry
 *   one — "Horace Simmons Jr." vs "Horace Simmons", and the reverse,
 *   "Lateef Patrick" vs "Lateef Patrick Jr". Bart's feed also emits the
 *   lowercase-L homoglyph for Roman numerals: Ace Glass (Washington St.,
 *   2026) is "Ace Glass lll" there and "Ace Glass" at CBBD, which is the
 *   bug that sent this whole module looking.
 *
 *   SPLIT INITIALS.  `norm` collapses punctuation to spaces, so
 *   "J.J. Starling" becomes "j j starling" while "JJ Starling" becomes
 *   "jj starling" and the two never meet.
 *
 * Measured on 2026: 207 of 5,031 CBBD players failed the exact join.
 * Suffix stripping alone recovers 62 of them, suffix + glued initials 75.
 * The residual 132 are mostly sub-40-minute walk-ons and genuine
 * nickname spellings ("Spudd Webb"), which no normalizer should try to
 * guess at.
 * ------------------------------------------------------------------ */

/**
 * Suffix tokens, matched only at the END of a name.
 *
 * End-anchored on purpose. A bare \b(v)\b would eat the middle initial in
 * "Robert V Smith"; a suffix only means a suffix in final position. Applied
 * repeatedly so "Jr II" unwinds fully.
 */
const SUFFIX_END = /\s+(jr|sr|ii|iii|iv|vi|v|lll|ll)$/;

/**
 * Join key for a person's name. Lowercase, de-accent, punctuation to
 * spaces, drop trailing suffixes, then glue single-letter runs so split
 * initials meet their unsplit twin.
 */
export const playerKey = (s) => {
  let t = (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  let prev;
  do { prev = t; t = t.replace(SUFFIX_END, ""); } while (t !== prev);
  // "p j haggerty" → "pj haggerty". Lookahead keeps a trailing lone letter
  // (a middle initial at the end of a name) from being glued onto a surname.
  t = t.replace(/\b([a-z])\s+([a-z])\b(?=\s)/g, "$1$2");
  return t.replace(/\s+/g, " ").trim();
};

/**
 * Build the two-tier player index every Bart↔CBBD join needs.
 *
 * `exact` is the historical key and always wins, so a fix here can never
 * re-point a match that already worked. `fuzzy` is consulted only on a
 * miss, and only when it names exactly one player — a stripped key that
 * two teammates share (a father-son suffix pair, "Thomas Batties II" and
 * "Thomas Batties III") is ambiguous and must stay unmatched rather than
 * be guessed. Measured 0 such collisions in 2026, which is a reason to
 * keep the guard cheap, not a reason to drop it.
 *
 * `rows` is Bart's players-by-year entries; `teamOf` pulls the team name.
 */
export function buildPlayerIndex(rows) {
  const exact = new Map();
  const fuzzy = new Map();
  for (const p of rows) {
    if (p.bart_player_id == null || !p.name) continue;
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    if (!team?.name) continue;
    const tk = norm(team.name);
    exact.set(`${tk}|${norm(p.name)}`, p.bart_player_id);
    const fk = `${tk}|${playerKey(p.name)}`;
    const seen = fuzzy.get(fk);
    if (seen === undefined) fuzzy.set(fk, p.bart_player_id);
    else if (seen !== p.bart_player_id) fuzzy.set(fk, null); // ambiguous — never match
  }
  return { exact, fuzzy };
}

/** Resolve a provider (team, player) pair to a bart id, or null. */
export function resolvePlayer(idx, normTeamName, playerName) {
  const hit = idx.exact.get(`${normTeamName}|${norm(playerName)}`);
  if (hit != null) return hit;
  return idx.fuzzy.get(`${normTeamName}|${playerKey(playerName)}`) ?? null;
}

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
