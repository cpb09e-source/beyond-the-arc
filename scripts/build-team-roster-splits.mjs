#!/usr/bin/env node
/**
 * build-team-roster-splits.mjs — effective height and class-year shares, per
 * team-season.
 *
 *   public/data/team-roster-splits.json  →  { "<team>|<year>": {...} }
 *
 * WEIGHTED BY MINUTES, WHICH IS THE WHOLE POINT. A straight average over the
 * listed roster describes who is on the programme, not who plays: a 7-footer
 * redshirting and a 7-footer starting move a mean height identically, and only
 * one of them is on the floor. Every figure here weights by minutes actually
 * played, so it describes the rotation.
 *
 * MINUTES ARE RECONSTRUCTED as min_pg × games, because players-explorer carries
 * the per-game average and the game count rather than a season total. That
 * product is the season total by definition, and it is the same pair the
 * players grid renders, so a team's numbers here can never disagree with the
 * roster a reader clicks into.
 *
 * CLASS AND HEIGHT ARE BART'S, still. CBBD's /teams/roster does carry height
 * (jersey, position, weight and hometown too) and would remove half of that
 * dependency, but pulling it is a network fetch and the data freeze runs to
 * 2026-10-01. Class it does not carry at all — no endpoint exposes academic
 * year — and deriving it from startSeason/endSeason misfires on exactly the
 * population this site cares about: transfers, redshirts, and the COVID
 * eligibility year. So class stays Bart's by decision, and height stays his
 * until the freeze lifts.
 *
 * ROSTER CONTINUITY IS THE OTHER HALF, and it needs two seasons rather than
 * one, which is why every season is loaded before anything is computed.
 *
 * A RETURNER IS SAME PLAYER, SAME TEAM, CONSECUTIVE SEASONS. A transfer who
 * arrives with 900 minutes elsewhere is not a returner for his new school —
 * "still on this year's roster" means he was on last year's roster of THIS
 * team. Joining on player id alone would credit every high-minute transfer as
 * continuity, which inverts what the metric is for.
 *
 * MINUTES CONTINUITY takes the smaller of each player's two minute SHARES and
 * sums them. Shares, not raw minutes, so a team that played more games last
 * season is not scored as having lost continuity; and the minimum, so a player
 * whose role grew is credited only for the part that carried over. It reaches
 * 100% only when every player holds exactly the same slice of the rotation, and
 * a player present in one season only contributes min(x, 0) = 0. This is the
 * strongest of the three continuity figures precisely because it is about
 * ROLES: keeping twelve bodies and rebuilding the rotation around them scores
 * badly here and well on the two returner shares below.
 *
 * SHARES, NOT TOTALS. CBB Analytics publishes six figures per class — minutes,
 * minutes per game, minutes %, points, points %, points per game — which is
 * twenty-four columns for four classes. Twenty of them are volume restatements
 * of the same fact, and the share is the one that answers the question anybody
 * is actually asking ("how young is this team"). Only the shares are emitted.
 *
 * Reads only committed data — safe during the freeze.
 *
 *   node scripts/build-team-roster-splits.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "public/data/players-explorer");
const OUT = path.join(ROOT, "public/data/team-roster-splits.json");

const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Bart's class notes, folded to the four years. */
const CLASS_OF = { Fr: "fr", So: "so", Jr: "jr", Sr: "sr" };

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** "6-11" → 83. Anything that is not feet-dash-inches is unusable, not zero. */
function heightInches(h) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(h ?? "").trim());
  if (!m) return null;
  const inches = Number(m[1]) * 12 + Number(m[2]);
  // A guard against a mis-parsed or joke listing rather than against real
  // players: D-I has had a 5-2 guard and a 7-7 centre.
  return inches >= 60 && inches <= 95 ? inches : null;
}

const out = {};
let totalTeams = 0;

/**
 * season -> team -> { minutes, byPlayer: Map<bartId, minutes> }
 *
 * Kept for every season up front because continuity compares a season with the
 * one before it, and a season-at-a-time loop cannot see backwards.
 */
const rosters = new Map();

function rosterFor(season, team) {
  let bySeason = rosters.get(season);
  if (!bySeason) { bySeason = new Map(); rosters.set(season, bySeason); }
  let r = bySeason.get(team);
  if (!r) { r = { minutes: 0, byPlayer: new Map() }; bySeason.set(team, r); }
  return r;
}

for (const season of SEASONS) {
  const fp = path.join(SRC, `${season}.json`);
  if (!fs.existsSync(fp)) { console.log(`${season}: no players-explorer file — skipped`); continue; }
  const doc = JSON.parse(fs.readFileSync(fp, "utf8"));
  const ix = (name) => {
    const i = doc.fields.indexOf(name);
    if (i < 0) throw new Error(`players-explorer/${season}.json has no "${name}" field`);
    return i;
  };
  const iTeam = ix("team_name"), iClass = ix("class"), iHeight = ix("height");
  const iGames = ix("games"), iMin = ix("min_pg"), iPts = ix("pts_pg");
  const iId = ix("bart_player_id");

  /** team -> running totals */
  const acc = new Map();
  let noHeight = 0, noClass = 0;

  for (const row of doc.rows) {
    const team = row[iTeam];
    if (typeof team !== "string" || !team) continue;
    const games = Number(row[iGames]) || 0;
    const minutes = (Number(row[iMin]) || 0) * games;
    if (minutes <= 0) continue;
    const points = (Number(row[iPts]) || 0) * games;

    let a = acc.get(team);
    if (!a) {
      a = {
        minutes: 0, points: 0,
        htMinutes: 0, htSum: 0,
        cls: { fr: { m: 0, p: 0 }, so: { m: 0, p: 0 }, jr: { m: 0, p: 0 }, sr: { m: 0, p: 0 } },
      };
      acc.set(team, a);
    }
    a.minutes += minutes;
    a.points += points;

    // Same minutes figure, indexed by player, for next season's continuity.
    const pid = row[iId];
    if (typeof pid === "number") {
      const r = rosterFor(season, team);
      r.minutes += minutes;
      r.byPlayer.set(pid, (r.byPlayer.get(pid) ?? 0) + minutes);
    }

    const inches = heightInches(row[iHeight]);
    if (inches === null) noHeight += 1;
    else {
      // Height carries its OWN minutes denominator. A team with one unlisted
      // player should not have his minutes counted against a height total he
      // never contributed to — that would pull the average toward zero.
      a.htSum += inches * minutes;
      a.htMinutes += minutes;
    }

    const cls = CLASS_OF[String(row[iClass] ?? "").trim()];
    if (!cls) noClass += 1;
    else { a.cls[cls].m += minutes; a.cls[cls].p += points; }
  }

  for (const [team, a] of acc) {
    const share = (x, total) => (total > 0 ? r3(x / total) : null);

    /**
     * Continuity against the previous season, or nulls when there is no
     * previous season on file. Null rather than zero: 2014 is the first year of
     * the archive, and "no prior data" and "lost the entire roster" are
     * different facts that must not render the same.
     */
    const prev = rosters.get(season - 1)?.get(team) ?? null;
    const curr = rosters.get(season)?.get(team) ?? null;
    let cont = null, retPrior = null, priorTeam = null, retCurr = null, currTeam = null;
    if (prev && curr && prev.minutes > 0 && curr.minutes > 0) {
      priorTeam = Math.round(prev.minutes);
      currTeam = Math.round(curr.minutes);
      let contSum = 0, retPriorSum = 0, retCurrSum = 0;
      // Iterating the CURRENT roster is enough for the returner sums, but not
      // for continuity — a player who left contributes min(share, 0) = 0, so he
      // costs continuity by his absence and needs no visit.
      for (const [pid, mins] of curr.byPlayer) {
        const was = prev.byPlayer.get(pid);
        if (was === undefined) continue;
        retPriorSum += was;
        retCurrSum += mins;
        contSum += Math.min(was / prev.minutes, mins / curr.minutes);
      }
      cont = r3(contSum);
      retPrior = Math.round(retPriorSum);
      retCurr = Math.round(retCurrSum);
    }

    out[`${team}|${season}`] = {
      /** min(prior share, current share) per player, summed. 1.0 = identical rotation. */
      cont_pct: cont,
      /** Last season's minutes belonging to players who came back. */
      ret_prior_min: retPrior,
      /** Last season's total team minutes — the denominator for ret_min_pct. */
      prior_team_min: priorTeam,
      ret_min_pct: priorTeam ? r3(retPrior / priorTeam) : null,
      /** This season's minutes played by those returners. */
      ret_curr_min: retCurr,
      curr_team_min: currTeam,
      /** Share of THIS season's minutes played by returners. */
      rrot_pct: currTeam ? r3(retCurr / currTeam) : null,
      eff_height: a.htMinutes > 0 ? r1(a.htSum / a.htMinutes) : null,
      fr_min_pct: share(a.cls.fr.m, a.minutes),
      so_min_pct: share(a.cls.so.m, a.minutes),
      jr_min_pct: share(a.cls.jr.m, a.minutes),
      sr_min_pct: share(a.cls.sr.m, a.minutes),
      fr_pts_pct: share(a.cls.fr.p, a.points),
      so_pts_pct: share(a.cls.so.p, a.points),
      jr_pts_pct: share(a.cls.jr.p, a.points),
      sr_pts_pct: share(a.cls.sr.p, a.points),
    };
  }
  totalTeams += acc.size;
  console.log(
    `${season}: ${String(acc.size).padStart(3)} teams from ${doc.rows.length} players` +
    (noHeight || noClass ? `  (${noHeight} unlisted height, ${noClass} unlisted class)` : ""),
  );
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `\n✓ ${totalTeams} team-seasons → ${path.relative(ROOT, OUT)}  ` +
  `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`,
);
