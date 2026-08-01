#!/usr/bin/env python3
"""tune-box-epm-lambda.py — pick the box prior's ridge penalty without leaking,
and measure how compressed its predictions are.

WRITTEN TO ANSWER ONE QUESTION: a team's players do not add up to the team.
Reconstruct each team from its own roster — every player's EPM weighted by his
share of the team's possessions — and regress the team's actual adjusted net
rating on it. Slope 1 means the roster adds up. We get 1.52 (1.42 / 1.53 / 1.61
by year, r=0.876, n=1,013 team-seasons). The players are collectively about a
third too small.

The standing theory was that the box prior was over-shrunk and that its lambda,
picked on a leaky random fold, was to blame. This script tests that theory. The
theory is WRONG, on two counts.

  1. THE LEAK IS REAL BUT TINY. Rows are player-seasons and are not
     independent: five players who shared a floor share a team-season, and
     ridge-RAPM cannot fully separate teammates, so their labels carry a common
     team-level error. A random split puts teammates on both sides. Closing it
     by folding on team-season moves R2 by 0.002 — 0.4633 -> 0.4614 (OFF),
     0.3945 -> 0.3915 (DEF). Not nothing, not an explanation for 1.52.

     (Not wired into compute-box-epm.py. The lambda curve is FLAT across three
     orders of magnitude, so re-picking on grouped folds lands on a different
     rung of a level ladder — rich OFF 100 -> 300, lean DEF 10 -> 300 — and
     perturbs every published number for no measurable accuracy. Worth doing in
     the same pass as a real metric change; not worth doing alone.)

  2. THE PRIOR IS NOT COMPRESSED AT ALL. Its calibration slope — held-out label
     regressed on held-out prediction — is 0.985 to 1.009 across the ENTIRE
     grid, lambda 0.1 to 10000. It predicts its target on exactly the target's
     scale. The sd ratio of 1.46 is not missing signal, it is the label's noise:
     1/sqrt(R2) = 1/sqrt(0.46) = 1.47, which is what an honest predictor of a
     noisy quantity looks like.

WHERE THE COMPRESSION ACTUALLY LIVES: in the TARGET. epm-cal-<year>.json is a
prior-free RAPM at lambda 4000, shrunk toward ZERO, and it reconstructs teams at
slope 1.93 — worse than the shipped metric's 1.52, which is also why blending
the prior IMPROVES the scale rather than harming it. Ridge is unbiased with
respect to noise in y but inherits shrinkage in y one-for-one, so a prior
calibrated against a compressed target predicts on the compressed scale, and the
RAPM then shrinks toward it. Measured, prior-free RAPM by its own lambda:

    calibration lambda    25     50     75    100    150    200   4000
    team slope 2024     0.91   0.93   0.95   0.97   1.00   1.03   2.18
    team slope 2025     0.99   1.02   1.04   1.07   1.11   1.14
    team slope 2026     0.98   1.01   1.04   1.07   1.11   1.14

So the fix is a calibration target at lambda ~50, not a different prior lambda.
Run end to end it does what the theory predicts: team slope 1.52 -> 0.98 and,
more tellingly, r 0.876 -> 0.964 — a correlation gain no rescaling can produce.

NOT SHIPPED, and the reasons are on the record so nobody re-derives them:
  - The zero point breaks. Unweighted mean is pinned to 0, so the possession-
    weighted mean goes to +5.5 and the median rotation player reads +5.7. EPM
    stops meaning "versus average" until it is re-centred, and whether zero
    should be the average PLAYER or the average POSSESSION is a definitional
    call, not a bug fix.
  - The leaderboard regresses where it matters. 2024-25 comes back with
    Mouhamed Dioubate 2nd and Dylan Cardwell 3rd, ahead of Cooper Flagg at 5th.
    That is the low-minute fluke failure this metric was already fixed for once.
  - Split-half reliability RISES (0.906 -> 0.976), which sounds good and is not
    evidence: reliability rises whenever the fit leans harder on the prior, and
    a wider prior at a fixed lambda does exactly that.
  - Held-out R2 then peaks at lambda 1500 rather than 4000, so the RAPM penalty
    would need re-tuning against the new prior before any of it could ship.
  - eWins comes from epm-extras.csv and would need recomputing alongside.

  Run: python scripts/tune-box-epm-lambda.py [--folds 5] [--seed 17]
"""
import argparse
import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cbe", HERE / "compute-box-epm.py")
cbe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cbe)

LAM_GRID = [0.1, 0.3, 1, 3, 5, 10, 30, 100, 300, 1000, 3000, 10000]


def prepare():
    """Exactly compute-box-epm.py's preprocessing, so the lambda this picks is
    the lambda that model would use. Any divergence here tunes a different
    model than the one that ships."""
    df = pd.read_csv(HERE / "box-epm-features.csv")
    features = cbe.feature_columns(df)
    for col in cbe.ERA_FEATURES:
        df[col] = df[col].clip(lower=-5, upper=5)
    for col in features:
        if col in cbe.ERA_FEATURES or df[col].dtype.kind not in "fi":
            continue
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        if iqr > 0:
            df[col] = df[col].clip(q1 - 6 * iqr, q3 + 6 * iqr)
    labeled = df["off"].notna() & df["def"].notna()
    train = labeled & (df["min_pg"] >= cbe.TRAIN_MIN_PG) & (df["poss"].fillna(0) > 0)
    return df, features, train


def folds_by_group(groups, k, seed):
    """Assign whole groups to folds, largest first into the emptiest fold, so
    the folds stay balanced without a group ever straddling two of them."""
    uniq, counts = np.unique(groups, return_counts=True)
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(uniq))
    uniq, counts = uniq[order], counts[order]
    order = np.argsort(-counts)
    assign, load = {}, np.zeros(k)
    for i in order:
        f = int(np.argmin(load))
        assign[uniq[i]] = f
        load[f] += counts[i]
    return np.array([assign[g] for g in groups])


def evaluate(X, y, w, groups, lam, k, seed):
    """Out-of-sample R2 and calibration slope, both pooled over the held-out
    predictions rather than averaged per fold — a slope is a ratio of moments
    and averaging ratios across folds is not the same number."""
    fold = folds_by_group(groups, k, seed)
    yhat = np.empty_like(y)
    for f in range(k):
        te = fold == f
        tr = ~te
        coef, ybar = cbe.ridge_fit(X[tr], y[tr], lam, w[tr])
        yhat[te] = X[te] @ coef + ybar
    r2 = cbe.r2(y, yhat, w)
    # Weighted least squares of y on yhat. Slope > 1 => yhat is compressed.
    ybar_w = np.sum(w * y) / np.sum(w)
    hbar_w = np.sum(w * yhat) / np.sum(w)
    cov = np.sum(w * (yhat - hbar_w) * (y - ybar_w))
    var = np.sum(w * (yhat - hbar_w) ** 2)
    slope = cov / var if var > 0 else float("nan")
    sd_ratio = np.sqrt(np.sum(w * (y - ybar_w) ** 2) / np.sum(w)) / \
        np.sqrt(var / np.sum(w)) if var > 0 else float("nan")
    return r2, slope, sd_ratio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()

    df, features, train = prepare()
    sub = df.loc[train]
    w = np.sqrt(np.clip(sub["poss"].to_numpy(dtype=float), 1, 2000))

    # The shipped model drops team_adj_net before fitting when damping is 0;
    # tuning with it in would pick lambda for a model that is not built.
    cols = list(features)
    if cbe.TEAM_DAMP == 0.0 and cbe.TEAM_FEATURE in cols:
        cols = [c for c in cols if c != cbe.TEAM_FEATURE]

    mu = sub[cols].mean()
    sd = sub[cols].std(ddof=0).replace(0, 1.0)
    X = ((sub[cols].fillna(mu) - mu) / sd).to_numpy(dtype=float)

    team_season = (sub["year"].astype(str) + "|" + sub["team"].astype(str)).to_numpy()
    player_row = np.arange(len(sub))

    print(f"train rows: {len(sub):,}   features: {len(cols)}   "
          f"team-seasons: {len(np.unique(team_season)):,}")

    for target in ("off", "def"):
        y = sub[target].to_numpy(dtype=float)
        print(f"\n== {target.upper()} ==")
        print(f"{'lambda':>8}  {'R2 random':>10}  {'R2 by team':>11}  {'slope':>7}  {'sd ratio':>9}")
        best_r2, best_lam = -9e9, None
        for lam in LAM_GRID:
            r2_rand, _, _ = evaluate(X, y, w, player_row, lam, args.folds, args.seed)
            r2_grp, slope, sdr = evaluate(X, y, w, team_season, lam, args.folds, args.seed)
            if r2_grp > best_r2:
                best_r2, best_lam = r2_grp, lam
            print(f"{lam:>8}  {r2_rand:>10.4f}  {r2_grp:>11.4f}  {slope:>7.3f}  {sdr:>9.3f}")
        print(f"  best by grouped R2: lambda={best_lam}  R2={best_r2:.4f}")


if __name__ == "__main__":
    main()
