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
    # Default tuned for the SPM-prior workflow (D&3-style): higher lambda pulls
    # RAPM toward the box prior, taming thin-off-court/collinear starters while
    # keeping true stars' RAPM signal. Always run with --priors.
    ap.add_argument("--lam", type=float, default=12000.0)
    ap.add_argument("--priors", type=str, default=None,
                    help="CSV with playerId,priorOff,priorDef (per-100 vs avg)")
    args = ap.parse_args()

    stints, players, outdir = load(args.season)
    print(f"EPM fit — season {args.season}: {len(stints):,} valid stints")

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
    out = outdir / "epm.csv"
    df.to_csv(out, index=False)
    qual = df[df["poss"] >= MIN_POSS_PLAYER]
    print(f"  wrote {out} ({len(df):,} players)")
    print("\n  top 12 (>=%d poss):" % MIN_POSS_PLAYER)
    print(qual.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
