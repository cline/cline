---
description: Calibrate differentiable HBV-light or train NeuralHydrology LSTM models via AI-Hydro. Full parameter reference and performance metrics.
---

# Modelling Tools

Tools for hydrological model calibration and result retrieval.

---

## `train_hydro_model`

Train a hydrological model for streamflow prediction.

**Requires:** `delineate_watershed` and `fetch_forcing_data` to have been called first.
For LSTM (`framework="neuralhydrology"`), `fetch_streamflow_data` is also required.
For HBV, streamflow is fetched automatically from CAMELS for the 671 CONUS CAMELS gauges.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | str | — | Research session identifier |
| `framework` | str | `"hbv"` | `"hbv"` (differentiable HBV-light) or `"neuralhydrology"` (LSTM) |
| `model` | str | `"cudalstm"` | NeuralHydrology only: `"cudalstm"`, `"ealstm"`, `"transformer"` |
| `train_start` | str | `"2000-10-01"` | Training period start (YYYY-MM-DD) |
| `train_end` | str | `"2007-09-30"` | Training period end |
| `val_start` | str | `"2000-10-01"` | Validation period start |
| `val_end` | str | `"2005-09-30"` | Validation period end |
| `test_start` | str | `"2007-10-01"` | Test period start |
| `test_end` | str | `"2010-09-30"` | Test period end |
| `epochs` | int | `500` | Training epochs per restart |
| `n_restarts` | int | `3` | HBV only: number of random restarts; best is kept |
| `hidden_size` | int | `64` | LSTM hidden state size |
| `learning_rate` | float | `0.05` | Optimizer learning rate |

---

### HBV-light (Differentiable)

A differentiable implementation of the HBV-light conceptual rainfall-runoff model in PyTorch. Parameters are calibrated via gradient descent (Adam optimiser) rather than traditional Monte Carlo or SCE-UA methods.

**Model structure:**

```
Precipitation (P)
    → Snow routine (TT, CFMAX, CFR, CWH)
    → Soil moisture routine (FC, LP, BETA)
    → Response routine (K0, K1, K2, UZL, PERC)
    → Routing (MAXBAS)
    → Simulated discharge (Q_sim)
```

**Typical performance (CAMELS-US):**

| Metric | Median | Top quartile |
|--------|--------|-------------|
| NSE | 0.68 | > 0.78 |
| KGE | 0.71 | > 0.80 |

**Advantages over traditional calibration:**
- Gradient-based — faster convergence than Monte Carlo
- Differentiable — can be embedded in larger ML pipelines
- PyTorch — runs on GPU if available

---

### LSTM (NeuralHydrology)

A Long Short-Term Memory network trained via the [NeuralHydrology](https://neuralhydrology.readthedocs.io/) framework. Requires more data (~10+ years) and compute than HBV-light but captures complex non-linear rainfall-runoff dynamics.

**Architecture:** Single-layer LSTM with static attribute embedding (CAMELS catchment attributes used as static inputs for the 671 CAMELS-US gauges).

!!! warning "Data requirement"
    LSTM training requires `fetch_streamflow_data` to have been called. For the 671 CAMELS-US gauges, CAMELS static attributes are used automatically. Use HBV-light for non-CAMELS gauges or short-record basins.

---

## `get_model_results`

Retrieve cached model performance metrics and parameter sets.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |

**Returns:**

| Field | Description |
|-------|-------------|
| `nse_train` / `nse_val` | Nash-Sutcliffe Efficiency |
| `kge_train` / `kge_val` | Kling-Gupta Efficiency |
| `rmse_train` / `rmse_val` | Root Mean Square Error (m³/s) |
| `parameters` | Calibrated parameter set (HBV) or architecture (LSTM) |
| `trained_at` | Timestamp |
| `train_period` / `val_period` | Date ranges used |

**Example:**
```
What were the model results for session piscataquis-2020?
```

```
Compare model performance across all sessions in my project.
```
