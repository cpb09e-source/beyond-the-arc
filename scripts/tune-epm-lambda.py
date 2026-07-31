#!/usr/bin/env python3
"""tune-epm-lambda.py — pick the RAPM ridge penalty by held-out GAMES.

lambda is the single most consequential number in BTA EPM: it decides how far
every player is pulled toward the box prior. It has never been tuned. The
docstring in compute-epm.py still says "lam default 2500 needs full-season
tune" and the shipped value is 12000, set by hand.

Two tempting criteria are both wrong:

  fit to the RAPM labels     circular; the labels ARE the fit
  team reconstruction        monotone in lambda. At lambda -> 0 the regression
                             reproduces stint outcomes exactly, so a team's
                             players always add up to the team. It measures how
                             much shrinkage was applied, not how much was right.

The honest criterion is out-of-sample prediction of possessions the fit never
saw. Games — not stints — are the fold unit: two stints from the same game
share a lineup, a venue and an opponent, so splitting within a game leaks.

  Run: python scripts/tune-epm-lambda.py --season 2026 [--priors file.csv]
"""
import argparse
import importlib.util
from pathlib import Path

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import lsqr

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ce", HERE / "compute-epm.py")
ce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ce)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--priors", type=str, default=None)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--no-luck", dest="luck", action="store_false")
    args = ap.parse_args()

    stints, players, _ = ce.load(args.season)
    if args.luck:
        stints, _ = ce.luck_adjust(stints, players)
    X, y, w, pidx = ce.build_design(stints)
    n_p = len(pidx)
    print(f"season {args.season}: {X.shape[0]:,} observations, {n_p:,} players")

    # Rebuild the per-observation game id in the SAME order build_design emitted
    # rows, so folds line up with the design matrix.
    games = []
    for t in stints.itertuples(index=False):
        if t.possHome >= ce.MIN_POSS_STINT:
            games.append(t.gameId)
        if t.possAway >= ce.MIN_POSS_STINT:
            games.append(t.gameId)
    games = np.asarray(games)
    assert len(games) == X.shape[0], (len(games), X.shape[0])

    prior = None
    if args.priors:
        import pandas as pd
        pr = pd.read_csv(args.priors)
        prior = np.zeros(2 * n_p + 1)
        for t in pr.itertuples(index=False):
            i = pidx.get(int(t.playerId))
            if i is None:
                continue
            prior[i] = t.priorOff
            prior[n_p + i] = -t.priorDef

    uniq = np.unique(games)
    rng = np.random.default_rng(17)
    assign = dict(zip(uniq, rng.integers(0, args.folds, len(uniq))))
    fold = np.array([assign[g] for g in games])

    # ── split-half PLAYER reliability ──────────────────────────────────────
    #
    # Held-out prediction alone is not enough, and the failure mode is specific.
    # Five teammates share every possession, so a lineup's total is well
    # identified long before any individual's share of it is. A low lambda
    # predicts held-out stints well by leaning on that lineup-level signal while
    # the per-player split remains mostly arbitrary — the fit gets the team
    # right and the credit wrong.
    #
    # So also fit each half of the season separately (odd games vs even games)
    # and correlate the two sets of PLAYER coefficients. That asks the question
    # prediction cannot: if we had run this on different games, would the same
    # players have come out on top?
    #
    # The two curves pull opposite ways — reliability rises with lambda,
    # held-out R2 peaks low — and the usable lambda is where both are decent,
    # not where either is best alone.
    def fit(mask, lam):
        mu = np.average(y[mask], weights=w[mask])
        resid = y[mask] - mu
        if prior is not None:
            resid = resid - X[mask] @ prior
        sw = np.sqrt(w[mask])
        b = lsqr(sparse.diags(sw) @ X[mask], resid * sw, damp=np.sqrt(lam))[0]
        return b + prior if prior is not None else b

    order = {g: i for i, g in enumerate(uniq)}
    half = np.array([order[g] % 2 for g in games])
    # only judge reliability on players with real minutes in BOTH halves
    poss_by = np.zeros(n_p)
    for t in stints.itertuples(index=False):
        both = (t.possHome or 0) + (t.possAway or 0)
        for col in (t.home5, t.away5):
            for x in str(col).split(";"):
                poss_by[pidx[int(x)]] += both / 2.0
    keep = poss_by >= 800

    LAMS = [50, 150, 500, 1500, 4000, 12000, 30000]
    print(f"\nSPLIT-HALF PLAYER RELIABILITY (odd vs even games, "
          f"{int(keep.sum()):,} players with 800+ poss)\n")
    print("   lambda   EPM r    OFF r    DEF r")
    rel = {}
    for lam in LAMS:
        a = fit(half == 0, lam)
        b = fit(half == 1, lam)
        ea, eb = a[:n_p] - a[n_p:2 * n_p], b[:n_p] - b[n_p:2 * n_p]
        rel[lam] = float(np.corrcoef(ea[keep], eb[keep])[0, 1])
        ro = float(np.corrcoef(a[:n_p][keep], b[:n_p][keep])[0, 1])
        rd = float(np.corrcoef(a[n_p:2 * n_p][keep], b[n_p:2 * n_p][keep])[0, 1])
        print(f"   {lam:>6}   {rel[lam]:.4f}   {ro:.4f}   {rd:.4f}")

    print(f"\n{args.folds}-fold by GAME ({len(uniq):,} games)\n")
    print("   lambda   held-out R2   held-out RMSE   (weighted by possessions)")
    best, best_r2 = None, -9e9
    for lam in LAMS:
        r2s, num, den = [], 0.0, 0.0
        for k in range(args.folds):
            te = fold == k
            tr = ~te
            mu = np.average(y[tr], weights=w[tr])
            resid = y[tr] - mu
            if prior is not None:
                resid = resid - X[tr] @ prior
            sw = np.sqrt(w[tr])
            beta = lsqr(sparse.diags(sw) @ X[tr], resid * sw, damp=np.sqrt(lam))[0]
            if prior is not None:
                beta = beta + prior
            pred = X[te] @ beta + mu
            err = y[te] - pred
            ss_res = float(np.sum(w[te] * err ** 2))
            ybar = float(np.sum(w[te] * y[te]) / np.sum(w[te]))
            ss_tot = float(np.sum(w[te] * (y[te] - ybar) ** 2))
            r2s.append(1.0 - ss_res / ss_tot)
            num += ss_res
            den += float(np.sum(w[te]))
        m = float(np.mean(r2s))
        mark = ""
        if m > best_r2:
            best_r2, best, mark = m, lam, "  <-"
        print(f"   {lam:>6}   {m:>11.5f}   {np.sqrt(num/den):>13.4f}{mark}")
    print(f"\nbest lambda = {best}")


if __name__ == "__main__":
    main()
