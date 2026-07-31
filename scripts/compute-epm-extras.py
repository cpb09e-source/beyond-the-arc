#!/usr/bin/env python3
"""EPM-extras — on/off splits, eWins, and 5-man lineup ratings from the stint
data that already backs EPM.

  on/off : a player's team net rating (pts/100) with them ON the floor minus
           with them OFF (same team's other stints). Raw on-court impact.
  eWins  : wins added vs an average player = (epm/100 * possessions) / PTS_PER_WIN.
  lineups: per 5-man unit, off/def/net rating over a possession floor.

  in:  data/cbbd/<season>/{stints.csv.gz, players.csv.gz, epm.csv}
  out: data/cbbd/<season>/epm-extras.csv      (playerId,name,team,ewins,on_net,off_net,on_off,on_poss)
       data/cbbd/<season>/lineups.json         (top units per team)
  Run: python scripts/compute-epm-extras.py --season 2026
"""
import argparse, csv, gzip, json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
PTS_PER_WIN = 30.0          # approx college points-of-margin per marginal win
LINEUP_MIN_POSS = 40        # unit possession floor for a stable rating

def load_players(d):
    m = {}
    with gzip.open(d / "players.csv.gz", "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m[r["id"]] = {"name": r["name"], "team": r["team"]}
    return m

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    args = ap.parse_args()
    d = ROOT / "data" / "cbbd" / str(args.season)
    players = load_players(d)

    # ---- luck adjustment -------------------------------------------------
    #
    # Raw on/off is mostly noise at the margins because it carries whatever the
    # ball did while a player stood there. The biggest single source is
    # three-point variance — nobody on the floor controls whether an open look
    # goes down — and free throws are a smaller version of the same thing.
    #
    # So each side's points are restated with its OWN season shooting rate:
    #
    #     adjusted = actual - 3 * (3PM - 3PA * team3P%) - (FTM - FTA * teamFT%)
    #
    # Deviation from a team's own season rate is treated as luck; the rate
    # itself is treated as skill. A team that shoots 40% all year keeps the
    # credit — only the game-to-game wobble around 40% comes out. The shooting
    # team's baseline is used on both ends, so a defence is not rewarded for
    # opponents happening to go cold either.
    #
    # This is the "L" in LEBRON (Luck-adjusted player Estimate using a Box prior
    # Regularized ON-off), and the one piece of it we did not already have.
    team_shot = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])  # [3pa,3pm,fta,ftm]

    def team_of(five):
        return players.get(five[0], {}).get("team")

    with gzip.open(d / "stints.csv.gz", "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["valid"] != "1" or "fg3aHome" not in r:
                continue
            h5 = r["home5"].split(";"); a5 = r["away5"].split(";")
            if len(h5) != 5 or len(a5) != 5:
                continue
            for five, a3, m3, fa, fm in (
                (h5, "fg3aHome", "fg3mHome", "ftaHome", "ftmHome"),
                (a5, "fg3aAway", "fg3mAway", "ftaAway", "ftmAway"),
            ):
                t = team_of(five)
                if t is None:
                    continue
                acc = team_shot[t]
                acc[0] += float(r[a3]); acc[1] += float(r[m3])
                acc[2] += float(r[fa]); acc[3] += float(r[fm])

    # Season rates per team, with a league fallback for anyone too thin to trust.
    tot = [sum(v[i] for v in team_shot.values()) for i in range(4)]
    lg3 = tot[1] / tot[0] if tot[0] > 0 else 0.338
    lgft = tot[3] / tot[2] if tot[2] > 0 else 0.72
    # A team with too few attempts to trust its own rate is left ALONE, not
    # repriced at the league rate. Roughly half the "teams" here are non-D-I
    # opponents with a handful of attempts, and charging their shooting at the
    # league average hands a bad team points it never scored — a level shift on
    # every D-I player who happened to face them. No own rate, no adjustment;
    # that also keeps the adjustment exactly points-neutral per team, which is
    # the property that makes it safe. Mirrors luck_adjust in compute-epm.py.
    MIN_ATT = 100
    rate3, rateft = {}, {}
    for t, (a3, m3, fa, fm) in team_shot.items():
        if a3 >= MIN_ATT:
            rate3[t] = m3 / a3
        if fa >= MIN_ATT:
            rateft[t] = fm / fa
    if team_shot:
        print(f"  luck baseline: league 3P% {lg3*100:.1f}, FT% {lgft*100:.1f} — "
              f"{len(rate3)} of {len(team_shot)} teams have their own rate")

    def luck_adj(pts, a3, m3, fa, fm, team):
        """Actual points minus the shooting that beat (or missed) the baseline."""
        r3, rft = rate3.get(team), rateft.get(team)
        if r3 is not None:
            pts -= 3.0 * (m3 - a3 * r3)
        if rft is not None:
            pts -= fm - fa * rft
        return pts

    # per-player on/off accumulators (offense + defense possessions/points)
    # [offPts, offPoss, defPts, defPoss, offPtsAdj, defPtsAdj]
    on = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    off = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    # team -> set of its player ids (from stints)
    team_players = defaultdict(set)
    # lineup accumulators: unit tuple -> [offPts,offPoss,defPts,defPoss]
    units = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])

    with gzip.open(d / "stints.csv.gz", "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["valid"] != "1":
                continue
            h5 = r["home5"].split(";"); a5 = r["away5"].split(";")
            if len(h5) != 5 or len(a5) != 5:
                continue
            ptsH, ptsA = float(r["ptsHome"]), float(r["ptsAway"])
            possH, possA = float(r["possHome"]), float(r["possAway"])
            teamH = players.get(h5[0], {}).get("team")
            teamA = players.get(a5[0], {}).get("team")
            adjH = luck_adj(ptsH, float(r.get("fg3aHome", 0)), float(r.get("fg3mHome", 0)),
                            float(r.get("ftaHome", 0)), float(r.get("ftmHome", 0)), teamH)
            adjA = luck_adj(ptsA, float(r.get("fg3aAway", 0)), float(r.get("fg3mAway", 0)),
                            float(r.get("ftaAway", 0)), float(r.get("ftmAway", 0)), teamA)
            # process each side: (unit, teamOwn, offPts/offPoss = own scoring, defPts/defPoss = opp scoring)
            for unit, teamOwn, oPts, oPoss, dPts, dPoss, oAdj, dAdj in (
                (h5, teamH, ptsH, possH, ptsA, possA, adjH, adjA),
                (a5, teamA, ptsA, possA, ptsH, possH, adjA, adjH),
            ):
                if teamOwn is None:
                    continue
                units[tuple(sorted(unit))][0] += oPts
                units[tuple(sorted(unit))][1] += oPoss
                units[tuple(sorted(unit))][2] += dPts
                units[tuple(sorted(unit))][3] += dPoss
                onset = set(unit)
                for pid in unit:
                    team_players[teamOwn].add(pid)
                    a = on[pid]
                    a[0] += oPts; a[1] += oPoss; a[2] += dPts; a[3] += dPoss
                    a[4] += oAdj; a[5] += dAdj
                # off-court: teammates of teamOwn not in this unit get an off-court stint.
                # We can't know all teammates yet in one pass, so accumulate off-court
                # below in a second pass using team_players.

    # Second pass for OFF-court: re-scan, crediting each team's players NOT in the
    # unit. Cheap re-read; keeps memory flat.
    with gzip.open(d / "stints.csv.gz", "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["valid"] != "1":
                continue
            h5 = r["home5"].split(";"); a5 = r["away5"].split(";")
            if len(h5) != 5 or len(a5) != 5:
                continue
            ptsH, ptsA = float(r["ptsHome"]), float(r["ptsAway"])
            possH, possA = float(r["possHome"]), float(r["possAway"])
            teamH = players.get(h5[0], {}).get("team")
            teamA = players.get(a5[0], {}).get("team")
            adjH = luck_adj(ptsH, float(r.get("fg3aHome", 0)), float(r.get("fg3mHome", 0)),
                            float(r.get("ftaHome", 0)), float(r.get("ftmHome", 0)), teamH)
            adjA = luck_adj(ptsA, float(r.get("fg3aAway", 0)), float(r.get("fg3mAway", 0)),
                            float(r.get("ftaAway", 0)), float(r.get("ftmAway", 0)), teamA)
            for unit, teamOwn, oPts, oPoss, dPts, dPoss, oAdj, dAdj in (
                (h5, teamH, ptsH, possH, ptsA, possA, adjH, adjA),
                (a5, teamA, ptsA, possA, ptsH, possH, adjA, adjH),
            ):
                if teamOwn is None:
                    continue
                onset = set(unit)
                for pid in team_players[teamOwn]:
                    if pid in onset:
                        continue
                    b = off[pid]
                    b[0] += oPts; b[1] += oPoss; b[2] += dPts; b[3] += dPoss
                    b[4] += oAdj; b[5] += dAdj

    # eWins from epm.csv — OPTIONAL.
    #
    # Only eWins needs EPM; on/off and the lineup ratings come entirely from
    # stints.csv.gz. Requiring epm.csv meant a season could not have lineups
    # until the whole ridge-RAPM pipeline had been run for it, which is why 2024
    # had play-by-play and stints on disk but no lineups. When epm.csv is absent
    # the eWins column is left blank and everything else is produced normally.
    ewins = {}
    epm_meta = {}
    epm_path = d / "epm.csv"
    if epm_path.exists():
        with open(epm_path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                pid = r["playerId"]
                poss = float(r["poss"]); epm = float(r["epm"])
                ewins[pid] = round((epm / 100.0) * poss / PTS_PER_WIN, 2)
                epm_meta[pid] = {"name": r["name"], "team": r["team"]}
    else:
        # Plain ASCII: the Windows console codepage mangles an em-dash here.
        print(f"  (no epm.csv for {args.season} - eWins left blank; on/off + lineups unaffected)")

    def net(acc):
        oPts, oPoss, dPts, dPoss = acc[0], acc[1], acc[2], acc[3]
        if oPoss < 1 or dPoss < 1:
            return None
        return 100 * oPts / oPoss - 100 * dPts / dPoss

    def net_adj(acc):
        """Same, on the luck-adjusted points."""
        oPoss, dPoss, oAdj, dAdj = acc[1], acc[3], acc[4], acc[5]
        if oPoss < 1 or dPoss < 1:
            return None
        return 100 * oAdj / oPoss - 100 * dAdj / dPoss

    # write per-player extras
    out = d / "epm-extras.csv"
    rows = 0
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["playerId", "name", "team", "ewins", "on_net", "off_net", "on_off",
                    "on_off_adj", "on_poss"])
        for pid in sorted(set(list(on.keys()) + list(ewins.keys()))):
            meta = players.get(pid) or epm_meta.get(pid) or {"name": "", "team": ""}
            onN = net(on[pid]) if pid in on else None
            offN = net(off[pid]) if pid in off else None
            onoff = round(onN - offN, 1) if onN is not None and offN is not None else ""
            onAdj = net_adj(on[pid]) if pid in on else None
            offAdj = net_adj(off[pid]) if pid in off else None
            onoff_adj = round(onAdj - offAdj, 1) if onAdj is not None and offAdj is not None else ""
            w.writerow([pid, meta["name"], meta["team"], ewins.get(pid, ""),
                        round(onN, 1) if onN is not None else "",
                        round(offN, 1) if offN is not None else "",
                        onoff, onoff_adj, round(on[pid][1], 0) if pid in on else ""])
            rows += 1

    # lineups: top units per team by net over the possession floor
    id2team = {pid: players.get(pid, {}).get("team") for pid in players}
    lineups = []
    for unit, acc in units.items():
        oPts, oPoss, dPts, dPoss = acc
        if oPoss < LINEUP_MIN_POSS:
            continue
        team = id2team.get(unit[0])
        names = [players.get(pid, {}).get("name", pid) for pid in unit]
        lineups.append({
            "team": team, "players": names,
            "poss": round(oPoss, 0),
            "off": round(100 * oPts / oPoss, 1),
            "def": round(100 * dPts / dPoss, 1) if dPoss else None,
            "net": round(net(acc), 1) if net(acc) is not None else None,
        })
    lineups.sort(key=lambda x: (x["net"] is None, -(x["net"] or 0)))
    (d / "lineups.json").write_text(json.dumps({"season": args.season, "lineups": lineups[:1000]}))

    print(f"season {args.season}: {rows} players, {len(lineups)} qualified lineups (>= {LINEUP_MIN_POSS} poss)")
    # smell test — top eWins
    top = sorted(ewins.items(), key=lambda kv: -kv[1])[:8]
    for pid, w in top:
        m = epm_meta.get(pid, {})
        onoff = net(on[pid]) if pid in on and net(on[pid]) is not None else None
        print(f"  {w:5.1f} eWins  {m.get('name','')} ({m.get('team','')})"
              + (f"  on/off {onoff:+.1f}" if onoff is not None else ""))

if __name__ == "__main__":
    main()
