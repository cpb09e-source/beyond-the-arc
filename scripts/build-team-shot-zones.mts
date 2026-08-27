/**
 * build-team-shot-zones.mts — per-team-season shooting accuracy by shot zone,
 * from shot COORDINATES.
 *
 *   public/data/team-shot-zones.json  →  { "<team>|<year>": {...} }
 *
 * WHY THIS EXISTS ALONGSIDE shot-distribution.json. That file answers "what
 * share of this team's attempts came from the rim / mid-range / three", and it
 * is built from the play-by-play `shotInfo.range` flag, which distinguishes
 * exactly those three bands and nothing finer. The glossary also asks for
 * accuracy inside those bands, and for CORNER threes separately from
 * above-the-break ones — and a corner three and a wing three are the same
 * `range` value. Only the (x, y) tells them apart.
 *
 * So this walks the per-player shot archive, which does carry coordinates, and
 * folds each shot into the same thirteen zones the shot chart uses via the
 * shared `zoneOf` — one geometry, so a team's corner-three rate here can never
 * disagree with the chart a reader clicks into.
 *
 * COVERAGE IS 2022-2026, and that is a hard floor rather than a gap to fill in
 * later: the coordinate archive starts at 2022. Every column this produces is
 * null before then, deliberately, in the same way the fast-break totals are —
 * an absent number is honest, an inferred one is not.
 *
 * ATTRIBUTION IS PER PLAYER-SEASON, not per shot. The shot files carry no team,
 * so each player's season is credited to the team players-explorer says they
 * played for that year. A mid-season transfer is therefore credited wholly to
 * one side. That is rare enough not to move a team rate materially, and the
 * alternative — joining every shot to a game and every game to a roster — costs
 * a great deal for a correction most teams would not notice.
 *
 * MINIMUM ATTEMPTS PER ZONE. A team-season with nine corner threes has a corner
 * accuracy of whatever those nine did, which is not a rate. Below the floor the
 * cell is null rather than noisy.
 *
 * Reads only committed data — safe during the freeze.
 *
 *   npx tsx scripts/build-team-shot-zones.mts
 */
import fs from "node:fs";
import path from "node:path";

import { zoneOf, type ZoneId } from "../src/lib/shot-zones.ts";

const ROOT = path.resolve("public/data");
const SHOTS = path.join(ROOT, "shots");
const OUT = path.join(ROOT, "team-shot-zones.json");

/** Tuple positions in the shot files, matching build-shot-zone-baselines.mts. */
const CX = 0, CY = 1, MADE = 2, IS3 = 4;

/** First season with shot coordinates. */
const SEASONS = [2022, 2023, 2024, 2025, 2026];

/** Attempts a team-season needs in a zone group before its rate is reported. */
const MIN_ATT = 25;

type Tally = { made: number; att: number };
const blankTally = (): Tally => ({ made: 0, att: 0 });

/** The zone groups the glossary names, mapped onto the chart's thirteen. */
const GROUPS: Record<string, ZoneId[]> = {
  rim: ["close_l", "close_m", "close_r"],
  mid: ["mid_corner_l", "mid_wing_l", "mid_mid", "mid_wing_r", "mid_corner_r"],
  corner3: ["3_corner_l", "3_corner_r"],
  atb3: ["3_wing_l", "3_mid", "3_wing_r"],
};
const GROUP_OF = new Map<ZoneId, string>();
for (const [g, ids] of Object.entries(GROUPS)) for (const id of ids) GROUP_OF.set(id, g);

// ---- bart_player_id -> team name, per season -------------------------------
// players-explorer is the positional-array export; the field order is published
// in its own builder, so the two are read by name rather than by index here.
const teamBySeason = new Map<number, Map<number, string>>();
for (const year of SEASONS) {
  const fp = path.join(ROOT, "players-explorer", `${year}.json`);
  const m = new Map<number, string>();
  if (fs.existsSync(fp)) {
    const doc = JSON.parse(fs.readFileSync(fp, "utf8")) as { fields: string[]; rows: unknown[][] };
    const idIdx = doc.fields.indexOf("bart_player_id");
    const teamIdx = doc.fields.indexOf("team_name");
    if (idIdx < 0 || teamIdx < 0) {
      throw new Error(`players-explorer/${year}.json is missing bart_player_id or team`);
    }
    for (const row of doc.rows) {
      const id = row[idIdx] as number | null;
      const team = row[teamIdx] as string | null;
      if (typeof id === "number" && typeof team === "string") m.set(id, team);
    }
  }
  teamBySeason.set(year, m);
  console.log(`${year}: ${m.size} players mapped to a team`);
}

// ---- walk the shot archive -------------------------------------------------
/** "<team>|<year>" -> group -> tally */
const totals = new Map<string, Record<string, Tally>>();
let files = 0, shots = 0, unattributed = 0;

for (const f of fs.readdirSync(SHOTS)) {
  if (!f.endsWith(".json")) continue;
  files++;
  let doc: { bart_player_id: number; seasons: Record<string, number[][]> };
  try {
    doc = JSON.parse(fs.readFileSync(path.join(SHOTS, f), "utf8"));
  } catch {
    continue;
  }
  for (const [yearStr, list] of Object.entries(doc.seasons ?? {})) {
    const year = Number(yearStr);
    const team = teamBySeason.get(year)?.get(doc.bart_player_id);
    if (!team) { unattributed += list.length; continue; }
    const key = `${team}|${year}`;
    let acc = totals.get(key);
    if (!acc) {
      acc = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, blankTally()]));
      totals.set(key, acc);
    }
    for (const s of list) {
      const zone = zoneOf(s[CX]!, s[CY]!, s[IS3] === 1);
      const g = GROUP_OF.get(zone);
      if (!g) continue;
      shots++;
      acc[g]!.att++;
      if (s[MADE] === 1) acc[g]!.made++;
    }
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (t: Tally) => (t.att >= MIN_ATT ? r3(t.made / t.att) : null);

const out: Record<string, Record<string, number | null>> = {};
for (const [key, acc] of totals) {
  const threes = acc.corner3!.att + acc.atb3!.att;
  out[key] = {
    rim_fg_pct: pct(acc.rim!),
    mid_fg_pct: pct(acc.mid!),
    corner3_fg_pct: pct(acc.corner3!),
    atb3_fg_pct: pct(acc.atb3!),
    // Share of a team's THREES taken from the corner — the shape of the
    // three-point diet rather than its accuracy, and the one number that says
    // whether an offence is generating catch-and-shoot corner looks or settling
    // for wing pull-ups.
    corner3_share: threes >= MIN_ATT ? r3(acc.corner3!.att / threes) : null,
  };
}

fs.writeFileSync(OUT, JSON.stringify(out));
const size = fs.statSync(OUT).size;
console.log(
  `\n✓ ${OUT}\n  ${files.toLocaleString()} shot files, ${shots.toLocaleString()} shots placed, ` +
  `${unattributed.toLocaleString()} unattributed\n  ${Object.keys(out).length} team-seasons, ${(size / 1024).toFixed(0)} KB`,
);
