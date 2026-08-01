#!/usr/bin/env python3
"""Box-EPM: a box-score estimate of EPM, calibrated to our own ridge-RAPM EPM.

We regress real EPM's offensive and defensive components onto box-score features
on the seasons where a real fit exists, then apply the learned coefficients to
every season 2008-2026. Off and Def are fit separately and EPM = Off + Def is
derived, so the three reconcile exactly (as they do in the real EPM data).

v2 calibration (kills the low-minute fluke leaderboard):
  - train only on QUALIFIED player-seasons (min_pg / games gate) so labels aren't
    dominated by noisy low-possession RAPM;
  - possession-WEIGHTED ridge (a 2000-poss season constrains the fit more than a
    150-poss one);
  - WINSORIZE per-40 rate features (a 5-minute cameo can't post 32 pts/40 and
    rocket up the board).

No sklearn dependency — ridge is closed-form on standardized features.

  in:  scripts/box-epm-features.csv   (from build-box-epm-features.mjs)
  out: scripts/box-epm-pred.csv       (year, bart_player_id, box_off/def/epm)
"""
import os

import numpy as np
import pandas as pd
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Feature columns are READ FROM THE CSV HEADER rather than restated here. The
# builder emits year,bart_player_id,name,team,<features...>,epm,off,def,poss, so
# the features are everything between. Hardcoding them meant the two files could
# silently disagree the moment one gained a column.
# The CBBD-sourced half of the feature set. Present from 2022 (where CBBD's
# per-game box archive begins) and absent before, which is why main() fits a
# separate Bart-only model for the older seasons.
CBBD_ONLY = [
    "opp", "ortg_opp_delta", "drtg_opp_delta", "usg_opp_delta",
    "c_ortg", "c_drtg", "c_usg", "c_efg", "c_ts", "c_ftr", "c_orb", "c_ato",
    "fouls40", "gs40", "gs40_sd", "start_pct",
    "dunk_rate", "layup_rate", "tip_rate", "rim_rate", "mid_rate", "tp_rate",
    "rim_pct", "mid_pct",
    "unassisted", "unassisted_rim", "unassisted_jump", "jump_share",
]


def feature_columns(df):
    cols = list(df.columns)
    return cols[cols.index("team") + 1:cols.index("epm")]
# Era-normalized features arrive from build-box-epm-features.mjs already z-scored
# within each season; clip extreme z (low-sample flukes) at +/-5 SD.
ERA_FEATURES = [
    "usg", "to_rate", "porpag", "ts", "efg", "ftr", "tpar",
    "pts40", "ast40", "reb40", "orb40", "drb40", "stl40", "blk40", "blk_pct", "stl_pct",
]
# Training-eligibility gate — a season must clear this to inform the coefficients.
TRAIN_MIN_PG, TRAIN_MIN_GP = 10.0, 13

# --- team-strength damping -------------------------------------------------
# team_adj_net is the one feature that is not about the player. Left at its
# fitted weight it made EPM largely a readout of who you play for: among
# low-usage 10-20 mpg role players, EPM correlated with team rating at r=0.84,
# worth 0.086 EPM per point of team net. A Michigan rotation player banked
# +3.2 EPM before doing anything individually, which is why the 7th-9th men on
# a great team outranked 20-point scorers on ordinary ones.
#
# Set to 0: the prior no longer hands out team credit at all.
#
# Playing for a good team still matters, and still shows up — but it now comes
# only from the RAPM stage, where it is EARNED rather than assumed. Teammates
# share the floor, good players do make good teams, and the regression sees
# that in the actual on-court results. Adding a second, assumed helping on top
# of it in the prior was double-counting, and it was the larger of the two.
#
# Applied AFTER the fit rather than by removing the column, so the other
# coefficients are still estimated with team context held out of them. The
# features are standardized on the training rows, so the training mean of this
# column is 0 and zeroing its coefficient leaves overall calibration intact.
#
# Cost, stated plainly: DEF train R2 against the RAPM labels falls from 0.55 to
# 0.18. That is the honest number — box-score defence barely predicts defensive
# RAPM once you stop letting it read the team's rating off the scoreboard, and
# the old fit was mostly team quality wearing a disguise.
TEAM_FEATURE = "team_adj_net"
#
# Measured on 2026, EPM gained per point of team adjusted net rating among
# 13-20 mpg role players, and what an elite (+37.5) team is therefore worth:
#     damp 1.00 (as shipped before)   0.086   +3.21 EPM
#     damp 0.35                       0.065   +2.42
#     damp 0.20                       0.055   +2.08
#     damp 0.00 (here)                0.043   +1.62
#
# +1.62 for an elite team is the floor, and it is not zero — that residue is
# the RAPM stage seeing team strength in the results themselves. Which is the
# point: team still counts, it is just no longer granted in advance.
TEAM_DAMP = float(os.environ.get("BTA_TEAM_DAMP", "0.00"))

def r2(y, yhat, w=None):
    if w is None:
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
    else:
        ybar = float(np.sum(w * y) / np.sum(w))
        ss_res = float(np.sum(w * (y - yhat) ** 2))
        ss_tot = float(np.sum(w * (y - ybar) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

def ridge_fit(X, y, lam, w):
    """Weighted closed-form ridge on standardized X (intercept via y-centering)."""
    ybar = np.sum(w * y) / np.sum(w)
    yc = y - ybar
    P = X.shape[1]
    Xw = X * w[:, None]
    A = X.T @ Xw + lam * np.eye(P)
    b = X.T @ (w * yc)
    return np.linalg.solve(A, b), ybar

def cv_r2(X, y, w, lam, folds=5, seed=17):
    # Folds are RANDOM over player-seasons, and teammates therefore land on both
    # sides of one. That is a real leak — five players who shared a floor share
    # a team-season, and ridge-RAPM cannot fully separate them, so their labels
    # carry a common team-level error. Measured in tune-box-epm-lambda.py it is
    # worth 0.002 of R2, and folding by team-season instead re-picks lambda onto
    # a different rung of a flat curve, moving every published number for no
    # accuracy. Left alone deliberately; change it in the same pass as a real
    # metric change, not on its own.
    #
    # That script also answers the question this fold split was suspected of
    # causing: no, the prior is not compressed (calibration slope 0.99-1.01 at
    # every lambda from 0.1 to 10000). The compression that stops rosters adding
    # up to their teams is in the CALIBRATION TARGET — see its header.
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(y))
    parts = np.array_split(idx, folds)
    scores = []
    for k in range(folds):
        te = parts[k]
        tr = np.concatenate([parts[j] for j in range(folds) if j != k])
        coef, ybar = ridge_fit(X[tr], y[tr], lam, w[tr])
        scores.append(r2(y[te], X[te] @ coef + ybar, w[te]))
    return float(np.mean(scores))

def main():
    df = pd.read_csv(HERE / "box-epm-features.csv")
    FEATURES = feature_columns(df)
    print(f"features: {len(FEATURES)}")

    # Clip extreme within-season z-scores (small-sample flukes) consistently.
    for col in ERA_FEATURES:
        df[col] = df[col].clip(lower=-5, upper=5)

    # CBBD per-game rates are raw, not z-scored, so clip them at their own
    # robust bounds instead: median +/- 6 IQR keeps a cameo's 300 ORtg from
    # dragging a coefficient.
    for col in FEATURES:
        if col in ERA_FEATURES or df[col].dtype.kind not in "fi":
            continue
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        if iqr > 0:
            df[col] = df[col].clip(q1 - 6 * iqr, q3 + 6 * iqr)

    labeled = df["off"].notna() & df["def"].notna()
    train = labeled & (df["min_pg"] >= TRAIN_MIN_PG) & (df["poss"].fillna(0) > 0)
    print(f"loaded {len(df)} rows | {int(labeled.sum())} labeled | {int(train.sum())} train-eligible "
          f"(min_pg>={TRAIN_MIN_PG})")

    # ── TWO MODELS, not one ────────────────────────────────────────────────
    #
    # The CBBD half of the feature set (opponent context, per-game efficiency,
    # shot diet, self-creation) only exists from 2022, where CBBD's per-game box
    # archive starts. Every LABELED row is 2022+, so a single model would
    # standardize those columns on modern rows and then hand a mean-imputed
    # modern profile to every pre-2022 player — silently rewriting fifteen years
    # of history as "league average at everything we cannot see."
    #
    # So: fit the full model for the seasons that have the data, and fit a
    # second model on Bart's columns alone for the seasons that do not. Each
    # season is scored by the model that actually saw its inputs, and the output
    # carries a `rich` flag saying which one produced it.
    LEGACY = [c for c in FEATURES if c not in CBBD_ONLY]
    has_rich = df[CBBD_ONLY[0]].notna()
    print(f"  rich-feature coverage: {int(has_rich.sum()):,}/{len(df):,} rows "
          f"({int((has_rich & train).sum()):,}/{int(train.sum()):,} of training)")

    w = np.sqrt(np.clip(df.loc[train, "poss"].to_numpy(dtype=float), 1, 2000))
    lam_grid = [1, 5, 10, 30, 100, 300, 1000]

    def fit_set(cols, label):
        """Standardize on training rows, fit off/def, return predictions for all."""
        # At damp 0 the column is REMOVED rather than zeroed after fitting, and
        # the difference is not cosmetic.
        #
        # Zeroing afterwards was correct while team_adj_net was the only
        # team-shaped feature. It no longer is: `opp` (strength of schedule)
        # arrived with the CBBD block and correlates 0.446 with it, so ridge
        # splits the credit between the two — and deleting team_adj_net's share
        # afterwards deleted part of the SCHEDULE adjustment with it, while
        # leaving every other coefficient estimated conditional on a team term
        # that no longer existed.
        #
        # Measured on the prior's conference gap (high-major minus everyone
        # else), against the +1.31 that prior-free RAPM independently produces:
        #
        #     damped after the fit   -0.066   <- backwards; mid-majors rated higher
        #     dropped before the fit +1.388   <- matches RAPM
        #
        # That backwards gap is what put mid-major stat-stuffers near the top of
        # the board and pushed them HIGHER as lambda rose, since higher lambda
        # leans harder on the prior.
        if TEAM_DAMP == 0.0 and TEAM_FEATURE in cols:
            cols = [c for c in cols if c != TEAM_FEATURE]
        Xtr_raw = df.loc[train, cols]
        mu = Xtr_raw.mean()
        sd = Xtr_raw.std(ddof=0).replace(0, 1.0)
        design = lambda frame: ((frame[cols].fillna(mu) - mu) / sd).to_numpy(dtype=float)
        Xtr, Xall = design(df.loc[train]), design(df)
        ti = cols.index(TEAM_FEATURE) if TEAM_FEATURE in cols else None
        out = {}
        for target in ("off", "def"):
            y = df.loc[train, target].to_numpy(dtype=float)
            best = max(lam_grid, key=lambda L: cv_r2(Xtr, y, w, L))
            coef, ybar = ridge_fit(Xtr, y, best, w)
            raw_team = coef[ti] if ti is not None else 0.0
            if ti is not None:
                coef[ti] *= TEAM_DAMP
            out[target] = Xall @ coef + ybar
            # R2 is reported for the DAMPED model — the one that actually ships.
            # It will read lower than the undamped fit, and should: the labels
            # are RAPM, which carries the same team signal we are deliberately
            # turning down, so a better fit here would mean a worse metric.
            print(f"  {label:6s} {target.upper():3s}  lambda={best:<5} "
                  f"train_R2={r2(y, Xtr @ coef + ybar, w):.3f}  cv_R2={cv_r2(Xtr, y, w, best):.3f}"
                  f"  team {'dropped' if ti is None else f'{raw_team:+.3f} -> {coef[ti]:+.3f}'}")
        return out

    rich = fit_set(FEATURES, "rich")
    lean = fit_set(LEGACY, "lean")

    pick = has_rich.to_numpy()
    off_hat = np.where(pick, rich["off"], lean["off"])
    def_hat = np.where(pick, rich["def"], lean["def"])
    epm_hat = off_hat + def_hat

    tr = train.to_numpy()
    real_epm = df.loc[train, "epm"].to_numpy(dtype=float)
    print(f"  EPM  (derived Off+Def)  train_R2 vs real={r2(real_epm, epm_hat[tr], w):.3f}")

    out = pd.DataFrame({
        "year": df["year"], "bart_player_id": df["bart_player_id"],
        "min_pg": np.round(df["min_pg"], 1),
        "rich": pick.astype(int),
        "box_off": np.round(off_hat, 2), "box_def": np.round(def_hat, 2),
        "box_epm": np.round(epm_hat, 2),
        # Both models are emitted for every row, not just the one that was
        # picked. Keeping the Bart-only estimate alongside is what makes it
        # possible to ask later whether the CBBD half is carrying real signal
        # or just noise it happens to share with the same-season labels.
        "box_epm_lean": np.round(lean["off"] + lean["def"], 2),
        "box_epm_rich": np.round(rich["off"] + rich["def"], 2),
    })
    dst = HERE / "box-epm-pred.csv"
    out.to_csv(dst, index=False)
    print(f"wrote {len(out)} predictions -> {dst}")

    # Smell test: top-15 among QUALIFIED player-seasons (starter minutes), which
    # is what the leaderboard actually surfaces.
    qual = df["min_pg"] >= 24
    show = df.loc[qual, ["year", "name", "team", "min_pg"]].copy()
    show["box_epm"] = np.round(epm_hat[qual.to_numpy()], 2)
    print("\nTop 15 Box-EPM (min_pg>=24):")
    for _, r in show.sort_values("box_epm", ascending=False).head(15).iterrows():
        print(f"  {r['box_epm']:+5.1f}  {r['name']} ({r['team']}, {int(r['year'])})")

if __name__ == "__main__":
    main()
