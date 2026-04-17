"""
Differentiable HBV-light
=========================

Pure PyTorch implementation of HBV-light with 12 calibrated parameters.
Multi-restart Adam optimisation with cosine-annealed learning rate.

Typical workflow (called by MCP server):
    train_hbv_light(gauge_id, session, output_dir) → dict with NSE/KGE/RMSE

References
----------
- Lindström et al. (1997). HBV-96 model description.
- Kratzert et al. (2019). Differentiable parameter learning. WRR.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date
from pathlib import Path
from typing import Any

from ai_hydro.modelling.metrics import (
    _compute_metrics,
    _hargreaves_pet,
    _load_forcing_arrays,
    _load_full_data,
    _q_cms_to_mm_day,
    fetch_camels_streamflow,
)

log = logging.getLogger("ai_hydro.modelling")

# HBV-light parameter bounds
_HBV_BOUNDS: dict[str, tuple[float, float]] = {
    "FC":    (50.,   1000.),  # field capacity (mm)
    "beta":  (1.,    6.),     # soil moisture routing exponent
    "LP":    (0.2,   1.0),    # limit for potential ET
    "PERC":  (0.,    10.),    # percolation upper→lower zone (mm/day)
    "UZL":   (0.,    100.),   # upper zone threshold (mm)
    "K0":    (0.05,  0.9),    # fast runoff coefficient
    "K1":    (0.01,  0.5),    # interflow coefficient
    "K2":    (0.001, 0.2),    # baseflow coefficient
    "TT":    (-2.5,  2.5),    # snow/rain threshold temperature (°C)
    "CFMAX": (0.5,   10.),    # degree-day melt factor (mm/°C/day)
    "CFR":   (0.,    0.1),    # refreezing coefficient
    "CWH":   (0.,    0.2),    # water holding capacity of snowpack
}


# ──────────────────────────────────────────────────────────────────────
# HBV simulation kernel
# ──────────────────────────────────────────────────────────────────────

def _hbv_simulate(
    P: "torch.Tensor",
    T: "torch.Tensor",
    PET: "torch.Tensor",
    raw_params: "torch.Tensor",
    warm_up: int = 365,
) -> "torch.Tensor":
    """
    Differentiable HBV-light simulation in pure PyTorch (float64).

    Inputs
    ------
    P, T, PET : 1-D tensors of length T_total (precipitation mm/day,
                mean air temperature °C, potential ET mm/day)
    raw_params : 1-D tensor of length 12 (unbounded; sigmoid-scaled
                 to physical parameter bounds internally)
    warm_up    : days to spin up before recording output

    Returns
    -------
    1-D tensor of simulated streamflow [mm/day], length T_total - warm_up
    """
    import torch

    lo = torch.tensor([v[0] for v in _HBV_BOUNDS.values()], dtype=torch.float64)
    hi = torch.tensor([v[1] for v in _HBV_BOUNDS.values()], dtype=torch.float64)
    p  = lo + (hi - lo) * torch.sigmoid(raw_params)
    FC, beta, LP, PERC, UZL, K0, K1, K2, TT, CFMAX, CFR, CWH = p

    z = torch.zeros(1, dtype=torch.float64)
    SNOWPACK  = z.clone()
    MELTWATER = z.clone()
    SM        = FC * 0.5
    UZ        = z.clone()
    LZ        = z.clone()

    Qs: list["torch.Tensor"] = []
    for t in range(len(P)):
        precip = P[t]; temp = T[t]; pet = PET[t]

        # Snow
        SNOW = torch.where(temp < TT, precip, z)
        MELT = torch.clamp(CFMAX * (temp - TT), z, SNOWPACK + SNOW)
        SNOWPACK = SNOWPACK + SNOW - MELT
        REFREEZE = torch.clamp(CFR * CFMAX * (TT - temp), z, MELTWATER)
        MELTWATER = MELTWATER + MELT - REFREEZE
        LIQUID = torch.clamp(MELTWATER - CWH * SNOWPACK, z, MELTWATER)
        MELTWATER = MELTWATER - LIQUID
        SNOWPACK  = SNOWPACK  + REFREEZE

        # Rain + snowmelt input
        rain = torch.where(temp >= TT, precip, z)
        IN   = rain + LIQUID

        # Soil moisture
        CF   = torch.clamp(SM / FC, z, torch.ones(1, dtype=torch.float64))
        dSM  = IN * (1.0 - CF ** beta)
        SM   = SM + dSM
        Qsf  = IN - dSM   # contribution to runoff

        # ET
        Ep  = pet * torch.clamp(SM / (LP * FC), z, torch.ones(1, dtype=torch.float64))
        SM  = torch.clamp(SM - Ep, z)

        # Upper zone
        UZ  = UZ + Qsf
        Q0  = K0 * torch.clamp(UZ - UZL, z)
        Q1  = K1 * UZ
        UZ  = torch.clamp(UZ - Q0 - Q1 - PERC, z)

        # Lower zone
        LZ  = LZ + PERC
        Q2  = K2 * LZ
        LZ  = torch.clamp(LZ - Q2, z)

        if t >= warm_up:
            Qs.append(Q0 + Q1 + Q2)

    return torch.cat(Qs) if Qs else torch.zeros(0, dtype=torch.float64)


# ──────────────────────────────────────────────────────────────────────
# Training entry point
# ──────────────────────────────────────────────────────────────────────

def train_hbv_light(
    gauge_id: str,
    session: Any,
    output_dir: Path,
    train_start: str = "2000-10-01",
    train_end:   str = "2007-09-30",
    test_start:  str = "2007-10-01",
    test_end:    str = "2010-09-30",
    epochs:      int = 500,
    n_restarts:  int = 3,
    learning_rate: float = 0.05,
    warm_up:     int = 365,
) -> dict:
    """
    Calibrate a differentiable HBV-light model via gradient descent.

    Uses CAMELS streamflow when the gauge is in the 671-station dataset
    (gives 35-year continuous record).  Falls back to session-cached
    USGS streamflow for non-CAMELS gauges.

    Returns
    -------
    dict with nse, kge, rmse, calibrated_params, model_dir
    """
    try:
        import torch
        import numpy as np
    except ImportError as e:
        raise ImportError(f"PyTorch not installed: {e}. Run: pip install torch numpy") from e

    area_km2 = session.watershed["data"]["area_km2"]

    # ── Streamflow: CAMELS first, then session ─────────────────────────
    q_dict = fetch_camels_streamflow(gauge_id, area_km2)
    using_camels = bool(q_dict)

    if not using_camels:
        sf_data = _load_full_data(session, "streamflow", gauge_id)
        sf_idx  = {d[:10]: i for i, d in enumerate(sf_data["dates"])}
        q_dict  = {}
        for d, i in sf_idx.items():
            q_raw = sf_data["q_cms"][i]
            q_mm  = _q_cms_to_mm_day(q_raw, area_km2)
            if q_mm is not None:
                q_dict[d] = q_mm

    log.info("Streamflow: %d days (%s)", len(q_dict), "CAMELS" if using_camels else "USGS session")

    # ── Forcing ────────────────────────────────────────────────────────
    frc_data = _load_full_data(session, "forcing", gauge_id)
    frc_dates, prcp, tmax, tmin, pet_list = _load_forcing_arrays(frc_data)
    frc_date_strs = [d[:10] for d in frc_dates]

    P_all, PET_all, T_all, Q_all = [], [], [], []
    for i, d in enumerate(frc_date_strs):
        P_all.append(max(0.0, prcp[i] if not math.isnan(prcp[i]) else 0.0))
        tx = tmax[i] if not math.isnan(tmax[i]) else 10.0
        tn = tmin[i] if not math.isnan(tmin[i]) else 5.0
        T_all.append((tx + tn) / 2.0)
        p_val = pet_list[i] if not math.isnan(pet_list[i]) else _hargreaves_pet((tx+tn)/2.0, tx, tn)
        PET_all.append(max(0.0, p_val))
        Q_all.append(q_dict.get(d, float("nan")))

    # ── Period split ───────────────────────────────────────────────────
    def _mask(s: str, e: str) -> list[bool]:
        s_d, e_d = date.fromisoformat(s), date.fromisoformat(e)
        return [s_d <= date.fromisoformat(d) <= e_d for d in frc_date_strs]

    def _extract(m: list[bool], *arrs):
        return tuple([v for v, ok in zip(a, m) if ok] for a in arrs)

    tr_m = _mask(train_start, train_end)
    te_m = _mask(test_start,  test_end)
    tr_P, tr_T, tr_ET, tr_Q = _extract(tr_m, P_all, T_all, PET_all, Q_all)
    te_P, te_T, te_ET, te_Q = _extract(te_m, P_all, T_all, PET_all, Q_all)

    log.info("Train: %d days | Test: %d days", len(tr_P), len(te_P))

    def _arr(lst):
        return torch.tensor(lst, dtype=torch.float64)

    P_tr  = _arr(tr_P);  T_tr  = _arr(tr_T);  ET_tr = _arr(tr_ET)
    P_te  = _arr(te_P);  T_te  = _arr(te_T);  ET_te = _arr(te_ET)

    def _nse_loss(pred: "torch.Tensor", obs_list: list) -> "torch.Tensor":
        obs   = _arr(obs_list)
        valid = ~torch.isnan(obs) & ~torch.isnan(pred)
        o = obs[valid]; p = pred[valid]
        if o.numel() < 30:
            return torch.tensor(1.0, dtype=torch.float64, requires_grad=True)
        return ((o - p) ** 2).sum() / (((o - o.mean()) ** 2).sum() + 1e-10)

    # ── Multi-restart optimisation ─────────────────────────────────────
    N_P = len(_HBV_BOUNDS)
    best_global, best_raw = float("inf"), None

    # ── Set up model directory + training log (before training starts) ────
    model_dir = output_dir / f"hbv_{gauge_id}"
    model_dir.mkdir(parents=True, exist_ok=True)
    log_path = model_dir / "training.log"

    per_restart_train_nse: list[float] = []

    log.info("Training HBV-light: %d epochs x %d restarts", epochs, n_restarts)
    with open(log_path, "w", buffering=1) as log_fh:
        log_fh.write(
            f"HBV-light  gauge={gauge_id}  epochs={epochs}  "
            f"restarts={n_restarts}  lr={learning_rate}\n"
            + "-" * 60 + "\n"
        )

        for trial in range(n_restarts):
            raw = torch.nn.Parameter(torch.randn(N_P, dtype=torch.float64) * 0.3)
            opt   = torch.optim.Adam([raw], lr=learning_rate)
            sched = torch.optim.lr_scheduler.CosineAnnealingLR(
                opt, T_max=epochs, eta_min=learning_rate * 0.01
            )
            best_t, best_r = float("inf"), raw.detach().clone()
            for ep in range(epochs):
                opt.zero_grad()
                qp   = _hbv_simulate(P_tr, T_tr, ET_tr, raw, warm_up=warm_up)
                loss = _nse_loss(qp, tr_Q[warm_up:])
                loss.backward()
                torch.nn.utils.clip_grad_norm_([raw], 2.0)
                opt.step(); sched.step()
                lv = float(loss)
                if lv < best_t:
                    best_t = lv
                    best_r = raw.detach().clone()
                # Log every 5 epochs
                if (ep + 1) % 5 == 0 or ep == 0:
                    nse_now = 1.0 - lv
                    log_fh.write(
                        f"[{trial+1}/{n_restarts}] ep {ep+1:4d}/{epochs}"
                        f"  loss={lv:.4f}  NSE={nse_now:+.4f}\n"
                    )

            trial_nse = round(1.0 - best_t, 4)
            per_restart_train_nse.append(trial_nse)
            log_fh.write(
                f"[{trial+1}/{n_restarts}] DONE  best_train_NSE={trial_nse:+.4f}\n\n"
            )
            log.info("Trial %d: best train NSE ~ %.4f", trial + 1, trial_nse)
            if best_t < best_global:
                best_global = best_t
                best_raw    = best_r.clone()

        log_fh.write("Training complete.\n")

    # ── Evaluate on test set ───────────────────────────────────────────
    with torch.no_grad():
        qp_te = _hbv_simulate(P_te, T_te, ET_te, best_raw, warm_up=warm_up)

    obs_te = _arr(te_Q[warm_up:])
    valid  = ~torch.isnan(obs_te) & ~torch.isnan(qp_te)
    o = obs_te[valid].numpy()
    p = qp_te[valid].numpy()

    nse, kge, rmse = _compute_metrics(o, p)

    # ── Save checkpoint ────────────────────────────────────────────────
    checkpoint = {
        "gauge_id":    gauge_id,
        "raw_params":  best_raw.tolist(),
        "train_nse":   float(1 - best_global),
        "test_nse":    nse,
        "train_period": [train_start, train_end],
        "test_period":  [test_start,  test_end],
    }
    (model_dir / "checkpoint.json").write_text(json.dumps(checkpoint, indent=2))

    # Calibrated physical parameters
    lo = torch.tensor([v[0] for v in _HBV_BOUNDS.values()], dtype=torch.float64)
    hi = torch.tensor([v[1] for v in _HBV_BOUNDS.values()], dtype=torch.float64)
    calibrated = (lo + (hi - lo) * torch.sigmoid(best_raw)).tolist()
    cal_params  = {n: round(float(v), 4) for n, v in zip(_HBV_BOUNDS, calibrated)}

    log.info("HBV-light: train_NSE=%.3f  test_NSE=%.3f  test_KGE=%.3f",
             1 - best_global, nse or 0, kge or 0)

    return {
        "framework":             "hbv-light",
        "model_type":            "hbv",
        "model_dir":             str(model_dir),
        "training_log":          str(log_path),
        "data_source":           "CAMELS+GridMET" if using_camels else "USGS+GridMET",
        "device":                "cpu",
        "train_period":          [train_start, train_end],
        "test_period":           [test_start,  test_end],
        "epochs_trained":        epochs * n_restarts,
        "warm_up_days":          warm_up,
        "nse":                   nse,
        "kge":                   kge,
        "rmse":                  rmse,
        "train_nse":             round(float(1 - best_global), 4),
        "per_restart_train_nse": per_restart_train_nse,
        "calibrated_params":     cal_params,
    }
