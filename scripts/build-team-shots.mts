/**
 * Team shot locations, both ends of the floor.
 *
 *   public/data/team-shots/<season>/<team-slug>.json
 *     { team, season, off: [ [cx, cy, m, t, p3, w, loc, a], … ], def: [ … ] }
 *
 * The row tuple is byte-identical to scripts/build-player-shots.mjs, so the
 * client can hold one decoder. See that file's header for the field meanings;
 * the only difference is whose perspective `w` and `loc` are written from.
 *
 * OFF is shots this team took. DEF is shots taken AGAINST it — the same plays,
 * filed under the other team. Nothing is recomputed for the defensive copy: a
 * shot is one event and both teams were there for it.
 *
 * `w` and `loc` ARE ALWAYS THE SUBJECT TEAM'S. On a defensive row that means
 * "did the team whose file this is win", not the shooter's result, so
 * "shots allowed in wins" filters the way a reader expects. Writing the
 * shooter's perspective into both copies would make the same filter mean
 * opposite things on the two halves of one page.
 *
 * WHY THIS DOES NOT REUSE THE PLAYER FILES. Those are keyed by bart player id
 * and reachable only through a name join, which drops every shooter the index
 * cannot resolve — a real loss at team level, where the question is "where does
 * this team shoot from" and a missing shooter is a hole in the answer. A team
 * needs no name join at all: the play already carries teamId. Coverage is
 * therefore strictly better here than in the per-player files.
 *
 * DEFENSE NEEDS THE OPPONENT, and CBBD does not put it on the play. Game logs
 * carry one row per team per game keyed `${gameId}-${teamId}`, so grouping them
 * by the game half of that key yields both participants, and the opponent is
 * whichever is not the shooter.
 *
 * ELIGIBILITY IS BOTH SIDES. A shot only counts if BOTH teams have a log row
 * for that game — the same rule every other team surface uses. It matters more
 * here: a D-I team playing a D-II opponent has a log, the opponent does not,
 * and filing those shots as defense against a team that has no page would
 * inflate one side of the chart with games the other side cannot see.
 *
 * Usage: npx tsx scripts/build-team-shots.mts [--season 2026]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { teamSlug } from "@/lib/team-slug";

const ROOT = process.cwd();
const OUT_ROOT = path.join(ROOT, "public/data/team-shots");
const SEASONS = [2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP: Record<string, { name: string }> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"),
);

const SHOT_TYPE: Record<string, number> = { JumpShot: 0, LayUpShot: 1, DunkShot: 2, TipShot: 3 };

type Row = [number, number, number, number, number, number, number, number];
type Log = { won: boolean | null; is_home: boolean; is_neutral: boolean };

/**
 * Fold a full-court location onto one half court. Lifted verbatim from
 * build-player-shots.mjs — the two files must agree on orientation or a team's
 * chart and its own players' charts would mirror each other.
 */
function fold(x: number, y: number): [number, number] {
  const cx = x <= 470 ? y : 500 - y;
  const cy = x <= 470 ? x : 940 - x;
  return [Math.round(cx), Math.round(cy)];
}

function run(season: number) {
  const logFile = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  const playDir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(logFile) || !fs.existsSync(playDir)) {
    console.log(`${season}: skipped (missing logs or plays)`);
    return 0;
  }

  // `${gameId}-${teamId}` → log, and gameId → the two teamIds in it.
  const logs = new Map<string, Log>();
  const gameTeams = new Map<string, string[]>();
  for (const g of JSON.parse(fs.readFileSync(logFile, "utf8")) as Array<Log & { game_id: string }>) {
    logs.set(g.game_id, g);
    const cut = g.game_id.lastIndexOf("-");
    const gid = g.game_id.slice(0, cut), tid = g.game_id.slice(cut + 1);
    const arr = gameTeams.get(gid);
    if (arr) { if (!arr.includes(tid)) arr.push(tid); } else gameTeams.set(gid, [tid]);
  }

  // team name → { off, def }
  const byTeam = new Map<string, { off: Row[]; def: Row[] }>();
  const bucket = (name: string) => {
    let b = byTeam.get(name);
    if (!b) { b = { off: [], def: [] }; byTeam.set(name, b); }
    return b;
  };

  const files = fs.readdirSync(playDir).filter((n) => /^plays-\d{8}\.json\.gz$/.test(n)).sort();
  const seenPlay = new Set<string>();
  let kept = 0, noLoc = 0, noGame = 0, noOpp = 0, dupes = 0, unknownTeam = 0;

  for (const f of files) {
    const plays = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(playDir, f))).toString());
    for (const p of plays) {
      const si = p.shotInfo;
      if (!si || si.range === "free_throw") continue;
      // CBBD serves the same play under multiple date files near ET midnight.
      if (p.id != null) {
        if (seenPlay.has(String(p.id))) { dupes++; continue; }
        seenPlay.add(String(p.id));
      }

      const shooterTeam = TEAM_MAP[String(p.teamId)];
      if (!shooterTeam) { unknownTeam++; continue; }

      const gid = String(p.gameId), tid = String(p.teamId);
      const offLog = logs.get(`${gid}-${tid}`);
      if (!offLog) { noGame++; continue; }

      const pair = gameTeams.get(gid) ?? [];
      const oppTid = pair.find((t) => t !== tid);
      const oppTeam = oppTid ? TEAM_MAP[oppTid] : undefined;
      const defLog = oppTid ? logs.get(`${gid}-${oppTid}`) : undefined;
      if (!oppTeam || !defLog) { noOpp++; continue; }

      const l = si.location;
      if (!l || typeof l.x !== "number" || typeof l.y !== "number") { noLoc++; continue; }
      if (l.x < 0 || l.x > 940 || l.y < 0 || l.y > 500) { noLoc++; continue; }

      const [cx, cy] = fold(l.x, l.y);
      const made = si.made ? 1 : 0;
      const type = SHOT_TYPE[p.playType] ?? 0;
      const is3 = p.scoreValue === 3 || si.range === "three_pointer" ? 1 : 0;
      const assisted = si.made && si.assisted ? 1 : 0;
      const venue = (g: Log) => (g.is_neutral ? 2 : g.is_home ? 0 : 1);
      const wl = (g: Log) => (g.won === true ? 1 : g.won === false ? 0 : -1);

      bucket(shooterTeam.name).off.push([cx, cy, made, type, is3, wl(offLog), venue(offLog), assisted]);
      bucket(oppTeam.name).def.push([cx, cy, made, type, is3, wl(defLog), venue(defLog), assisted]);
      kept++;
    }
  }

  const outDir = path.join(OUT_ROOT, String(season));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0, bytes = 0;
  for (const [name, b] of byTeam) {
    if (!b.off.length && !b.def.length) continue;
    const json = JSON.stringify({ team: name, season, off: b.off, def: b.def });
    fs.writeFileSync(path.join(outDir, `${teamSlug(name)}.json`), json);
    written++; bytes += json.length;
  }

  console.log(
    `${season}: ${kept.toLocaleString()} shots → ${written} teams, ${(bytes / 1e6).toFixed(1)} MB  ` +
    `(${noLoc.toLocaleString()} no/junk location, ${noGame.toLocaleString()} shooter game not eligible, ` +
    `${noOpp.toLocaleString()} opponent not eligible, ${dupes.toLocaleString()} duplicate plays` +
    (unknownTeam ? `, ${unknownTeam.toLocaleString()} unmapped teams` : "") + ")",
  );

  /**
   * ORIENTATION CHECK. A mis-folded coordinate or a unit change upstream draws
   * a plausible-looking but wrong chart, and nothing downstream would notice.
   * Threes must sit beyond ~20 ft of the rim (the NCAA line is 22.15), so a
   * meaningful share under that is the signal.
   */
  let three = 0, under20 = 0;
  for (const b of byTeam.values()) {
    for (const r of b.off) {
      if (r[4] !== 1) continue;
      three++;
      if (Math.hypot(r[0] - 250, r[1] - 52.5) / 10 < 20) under20++;
    }
  }
  const badPct = three ? (100 * under20) / three : 0;
  console.log(`        3PT sanity: ${badPct.toFixed(2)}% of threes inside 20 ft (want < 5%)`);
  if (badPct > 5) {
    console.error(`✗ ${season}: threes are landing inside the arc — the fold is wrong.`);
    process.exitCode = 1;
  }

  // Offense and defense are the same events filed twice, so the totals must
  // match exactly. They cannot drift unless the eligibility rule above does.
  let offTot = 0, defTot = 0;
  for (const b of byTeam.values()) { offTot += b.off.length; defTot += b.def.length; }
  if (offTot !== defTot) {
    console.error(`✗ ${season}: off ${offTot} != def ${defTot} — a shot was filed on one side only.`);
    process.exitCode = 1;
  }
  return written;
}

const seasons = oneSeason ? [oneSeason] : SEASONS;
let total = 0;
for (const s of seasons) total += run(s);
console.log(`\n${total} team-season files written to public/data/team-shots/`);
