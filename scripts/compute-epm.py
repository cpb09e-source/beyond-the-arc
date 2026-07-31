"""
compute-epm.py — BTA EPM: ridge-regression RAPM over CBBD stints, with an
optional Bayesian box-score prior (D&3-style architecture).

Model
-----
Every valid stint yields two weighted observations (one per offense):
    y = 100 * pts / poss          (offensive efficiency of that possession block)
    X = +1 for each of the 5 offensive players' OFF coefficients
        +1 for each of the 5 defensive players' DEF coefficients
        +1 home-court indicator (when the offense is the home side)
Coefficients are per-100-possession impacts relative to league average:
    OFF EPM  = off coefficient
    DEF EPM  = -def coefficient          (positive = good defense)
    EPM      = OFF EPM + DEF EPM
Ridge (L2) regularization shrinks low-minute players toward 0 — or toward their
box prior when --priors is given (we then fit deviations from the prior, which
is exactly "SPM prior in a RAPM regression" a la EPM/BPR).

Luck adjustment (on by default; --no-luck to disable)
----------------------------------------------------
`pts` is restated at each shooting team's OWN season three-point and free-throw
rates before the fit sees it:

    adjusted = pts - 3 * (3PM - 3PA * team3P%) - (FTM - FTA * teamFT%)

Deviation from a team's own season rate is luck; the rate itself is skill, so a
40% shooting team keeps the credit and only the wobble around 40% comes out.
The property that makes this safe to run through a regression: because the rate
is the team's own ratio, each team's adjusted points sum EXACTLY to its actual
points over the season. Nothing is created or destroyed at the team level — the
adjustment only moves points between that team's own stints, which is precisely
where a player's RAPM coefficient is estimated from.

Solve: weighted sparse lsqr with damping sqrt(lambda). ~7k players x 2 coefs on
a full season (~600k obs) runs in seconds.

Usage
-----
  python scripts/compute-epm.py --season 2026 [--lam 2500] [--priors file.csv]
  Output: data/cbbd/<season>/epm.csv  (playerId, name, team, poss, offEpm, defEpm, epm)
"""

import argparse
import gzip
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import lsqr

ROOT = Path(__file__).resolve().parent.parent
MIN_POSS_STINT = 0.5   # drop degenerate fragments
MIN_POSS_PLAYER = 50   # below this a player's RAPM is ~all prior; still reported


def load(season: int):
    d = ROOT / "data" / "cbbd" / str(season)
    stints = pd.read_csv(d / "stints.csv.gz")
    players = pd.read_csv(d / "players.csv.gz")
    stints = stints[stints["valid"] == 1].copy()
    return stints, players, d


SHOT_COLS = ("fg3aHome", "fg3mHome", "fg3aAway", "fg3mAway",
             "ftaHome", "ftmHome", "ftaAway", "ftmAway")
MIN_ATT_FOR_TEAM_RATE = 100   # below this a team's own rate is itself noise


def luck_adjust(stints: pd.DataFrame, players: pd.DataFrame):
    """Restate ptsHome/ptsAway at each shooting team's own season 3P%/FT%.

    Returns (stints, applied). Silently no-ops on stint files built before the
    shot-detail columns existed, so an old season still fits (unadjusted)
    rather than crashing.

    Two details keep the adjustment exactly points-neutral per team, which is
    the whole reason it is safe to push through a ridge fit:

    1. Rates are accumulated over the SAME rows the design matrix will use
       (poss >= MIN_POSS_STINT, per side). Deriving them from all valid stints
       instead let ~5k adjusted points pile up in sub-half-possession fragments
       that add_obs then discards — a made-3-plus-offensive-rebound fragment can
       carry points with a possession count at or below zero.
    2. A team under MIN_ATT_FOR_TEAM_RATE is left ALONE rather than adjusted to
       the league rate. Most of those are non-D-I opponents with a handful of
       attempts; pricing their shooting at the league rate hands a bad team
       points it never scored. No own rate, no adjustment.
    """
    if not set(SHOT_COLS).issubset(stints.columns):
        print("  luck: stints lack shot detail — fitting on raw points "
              "(rebuild with cbbd-build-stints.mjs to enable)")
        return stints, False

    # Side -> team. players.csv.gz records the first team each id was seen with,
    # which is stable within a season; the five share it.
    id2team = dict(zip(players["id"].astype(str), players["team"]))
    homeT = stints["home5"].astype(str).str.split(";").str[0].map(id2team)
    awayT = stints["away5"].astype(str).str.split(";").str[0].map(id2team)
    useH = stints["possHome"] >= MIN_POSS_STINT
    useA = stints["possAway"] >= MIN_POSS_STINT

    z = lambda s, m: s.where(m, 0.0)
    acc = pd.DataFrame({
        "team": pd.concat([homeT, awayT], ignore_index=True),
        "a3": pd.concat([z(stints.fg3aHome, useH), z(stints.fg3aAway, useA)], ignore_index=True),
        "m3": pd.concat([z(stints.fg3mHome, useH), z(stints.fg3mAway, useA)], ignore_index=True),
        "fa": pd.concat([z(stints.ftaHome, useH), z(stints.ftaAway, useA)], ignore_index=True),
        "fm": pd.concat([z(stints.ftmHome, useH), z(stints.ftmAway, useA)], ignore_index=True),
    }).groupby("team").sum()

    lg3 = acc.m3.sum() / acc.a3.sum() if acc.a3.sum() else 0.338
    lgft = acc.fm.sum() / acc.fa.sum() if acc.fa.sum() else 0.72
    # NaN for a thin team -> the term below fills to 0 -> untouched.
    rate3 = (acc.m3 / acc.a3).where(acc.a3 >= MIN_ATT_FOR_TEAM_RATE)
    rateft = (acc.fm / acc.fa).where(acc.fa >= MIN_ATT_FOR_TEAM_RATE)

    for side, T in (("Home", homeT), ("Away", awayT)):
        r3, rft = T.map(rate3), T.map(rateft)
        luck3 = (3.0 * (stints[f"fg3m{side}"] - stints[f"fg3a{side}"] * r3)).fillna(0.0)
        luckft = (stints[f"ftm{side}"] - stints[f"fta{side}"] * rft).fillna(0.0)
        stints[f"pts{side}"] = stints[f"pts{side}"] - luck3 - luckft
    kept = int(rate3.notna().sum())
    print(f"  luck: baseline 3P% {lg3*100:.1f}, FT% {lgft*100:.1f} — "
          f"{kept:,} of {len(acc):,} teams have their own rate")
    return stints, True


def build_design(stints: pd.DataFrame):
    """Two observations per stint -> sparse X, y, weights, and player index."""
    # Collect the player universe from the lineups themselves.
    ids = set()
    for col in ("home5", "away5"):
        for five in stints[col]:
            ids.update(int(x) for x in str(five).split(";") if x)
    pidx = {pid: i for i, pid in enumerate(sorted(ids))}
    n_p = len(pidx)

    rows, cols, vals = [], [], []
    y, w = [], []
    r = 0

    def add_obs(off_five, def_five, pts, poss, is_home_off):
        nonlocal r
        if poss < MIN_POSS_STINT:
            return
        for pid in off_five:
            rows.append(r); cols.append(pidx[pid]); vals.append(1.0)            # OFF block
        for pid in def_five:
            rows.append(r); cols.append(n_p + pidx[pid]); vals.append(1.0)      # DEF block
        if is_home_off:
            rows.append(r); cols.append(2 * n_p); vals.append(1.0)              # HCA
        y.append(100.0 * pts / poss)
        w.append(poss)
        r += 1

    for t in stints.itertuples(index=False):
        h5 = [int(x) for x in str(t.home5).split(";")]
        a5 = [int(x) for x in str(t.away5).split(";")]
        add_obs(h5, a5, t.ptsHome, t.possHome, True)
        add_obs(a5, h5, t.ptsAway, t.possAway, False)

    X = sparse.csr_matrix((vals, (rows, cols)), shape=(r, 2 * n_p + 1))
    return X, np.asarray(y), np.asarray(w), pidx


def solve(X, y, w, lam: float, prior: np.ndarray | None = None):
    """Weighted ridge via damped LSQR. If prior is given, fit deviations."""
    mu = np.average(y, weights=w)                  # league-average efficiency
    resid = y - mu
    if prior is not None:
        resid = resid - X @ prior                  # explain what the prior can't
    sw = np.sqrt(w)
    Xw = sparse.diags(sw) @ X
    yw = resid * sw
    beta = lsqr(Xw, yw, damp=np.sqrt(lam))[0]
    if prior is not None:
        beta = beta + prior
    return beta, mu


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    # TUNED, finally. This was 12000, set by hand, with the docstring still
    # admitting it "needs full-season tune". scripts/tune-epm-lambda.py picks it
    # properly now — 5-fold cross-validation over held-out GAMES (not stints:
    # two stints from one game share a lineup, a venue and an opponent, so
    # splitting inside a game leaks). Held-out weighted R2:
    #
    #     lambda      50      150     500     1500    4000    12000   30000
    #     2026     .01381   .02035  .02328  .02148  .01806  .01357  .01046
    #     2025     .01322   .02027  .02403  .02247  .01886  .01419  .01106
    #
    # (Those figures predate the prior fix; re-run the tuner after changing the
    # prior. The shape is what matters and it is stable: a broad peak in the
    # low thousands, with 12000 far out on the over-shrunk shoulder.)
    #
    # The absolute R2 looks tiny because a single stint is a handful of
    # possessions and largely unpredictable; what matters is the ordering.
    #
    # SHIPPING 4000, ABOVE THE HELD-OUT PEAK, ON PURPOSE. The tuner also reports
    # split-half player reliability — fit odd games and even games separately,
    # then correlate the two sets of player coefficients:
    #
    #     lambda        500    1500    4000   12000
    #     split-half   .501    .753    .906    .979
    #
    # At 1500 a quarter of the ranking is fold-dependent noise, and it shows:
    # Devin McGlockton came out ahead of Cooper Flagg in 2024-25. At 4000 Flagg
    # is first, which is also what the voters said. The cost is 5% of held-out
    # R2.
    #
    # Held-out prediction keeps favouring a looser fit because five teammates
    # share every possession: a loose fit scores well by getting the LINEUP
    # right while the split of credit inside it stays arbitrary. A leaderboard
    # needs the split, so reliability gets a vote. (Reliability alone would run
    # to infinity — at huge lambda both halves collapse onto the same prior and
    # agree about the prior, not the player.)
    #
    # NOT tuned on team reconstruction (summing a team's players back to its net
    # rating), even though that is a tempting external yardstick: it improves
    # monotonically as lambda falls, because at lambda -> 0 the regression
    # reproduces stint outcomes by construction. It measures how much shrinkage
    # was applied, not how much of it was correct.
    ap.add_argument("--lam", type=float, default=4000.0)
    ap.add_argument("--priors", type=str, default=None,
                    help="CSV with playerId,priorOff,priorDef (per-100 vs avg)")
    ap.add_argument("--out", type=str, default="epm.csv",
                    help="output filename inside data/cbbd/<season>/ (default epm.csv)")
    ap.add_argument("--no-luck", dest="luck", action="store_false",
                    help="fit on raw points instead of luck-adjusted points")
    args = ap.parse_args()

    stints, players, outdir = load(args.season)
    print(f"EPM fit — season {args.season}: {len(stints):,} valid stints")

    if args.luck:
        stints, _ = luck_adjust(stints, players)

    X, y, w, pidx = build_design(stints)
    n_p = len(pidx)
    print(f"  design: {X.shape[0]:,} obs x {X.shape[1]:,} cols ({n_p:,} players)")

    prior = None
    if args.priors:
        pr = pd.read_csv(args.priors)
        prior = np.zeros(2 * n_p + 1)
        hit = 0
        for t in pr.itertuples(index=False):
            i = pidx.get(int(t.playerId))
            if i is None:
                continue
            prior[i] = t.priorOff
            prior[n_p + i] = -t.priorDef   # DEF stored as "good=positive"; coef is pts allowed
            hit += 1
        print(f"  priors: {hit:,}/{len(pr):,} matched")

    beta, mu = solve(X, y, w, args.lam, prior)
    print(f"  league avg efficiency: {mu:.1f} | HCA: {beta[-1]:+.2f} pts/100")

    # Possessions played per player (sum of stint poss where on floor).
    poss = np.zeros(n_p)
    for t in stints.itertuples(index=False):
        both = (t.possHome or 0) + (t.possAway or 0)
        for col in (t.home5, t.away5):
            for x in str(col).split(";"):
                poss[pidx[int(x)]] += both / 2.0

    meta = players.set_index("id")
    rows = []
    for pid, i in pidx.items():
        off = beta[i]
        dEf = -beta[n_p + i]
        m = meta.loc[pid] if pid in meta.index else None
        rows.append({
            "playerId": pid,
            "name": m["name"] if m is not None else "",
            "team": m["team"] if m is not None else "",
            "poss": round(float(poss[i]), 1),
            "offEpm": round(float(off), 2),
            "defEpm": round(float(dEf), 2),
            "epm": round(float(off + dEf), 2),
        })
    df = pd.DataFrame(rows).sort_values("epm", ascending=False)
    out = outdir / args.out
    df.to_csv(out, index=False)
    qual = df[df["poss"] >= MIN_POSS_PLAYER]
    print(f"  wrote {out} ({len(df):,} players)")
    print("\n  top 12 (>=%d poss):" % MIN_POSS_PLAYER)
    print(qual.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
