"""
AI Modelling MCP tools (2 tools).

Train differentiable HBV-light or NeuralHydrology LSTM models
and retrieve cached model performance metrics.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ai_hydro.mcp.app import mcp, Context
from ai_hydro.mcp.helpers import (
    _normalize_session_id,
    _tool_error_to_dict,
)

log = logging.getLogger("ai_hydro.mcp")


@mcp.tool()
async def train_hydro_model(
    session_id: str,
    framework: str = "hbv",
    model: str = "cudalstm",
    train_start: str = "2000-10-01",
    train_end: str = "2007-09-30",
    val_start: str = "2000-10-01",
    val_end: str = "2005-09-30",
    test_start: str = "2007-10-01",
    test_end: str = "2010-09-30",
    epochs: int = 500,
    n_restarts: int = 3,
    hidden_size: int = 64,
    learning_rate: float = 0.05,
    ctx: Context | None = None,
) -> dict:
    """
    Train an AI hydrological model for streamflow prediction.

    Requires the session to have cached: watershed, forcing.
    Streamflow is fetched automatically from CAMELS (35-year record) for
    the 671 CONUS CAMELS gauges (requires session.site_id to be set),
    or from the session streamflow cache otherwise.

    Parameters
    ----------
    session_id : str
        Research session identifier. Must have watershed and forcing cached.
    framework : str
        'hbv'             — differentiable HBV-light (built-in, recommended).
                            Pure PyTorch, no extra install. 12 calibrated
                            parameters. Uses CAMELS streamflow when available.
                            Typical NSE: 0.5-0.8.
        'neuralhydrology' — LSTM/EA-LSTM (pip install neuralhydrology).
                            State-of-the-art data-driven. Needs more data.
    model : str
        neuralhydrology only: 'cudalstm' (default), 'ealstm', 'transformer'.
        Ignored for 'hbv' framework.
    epochs : int
        Training epochs per restart (default 500 for HBV, 30 for LSTM).
    n_restarts : int
        HBV only: number of random restarts; best result is kept (default 3).
    learning_rate : float
        Optimizer learning rate (default 0.05 for HBV, 0.001 for LSTM).

    Returns
    -------
    dict with nse, kge, rmse, model_dir, calibrated_params, and metadata.
    NSE > 0.75 = excellent  |  0.5-0.75 = satisfactory  |  < 0.5 = poor
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)

        # For HBV, only watershed + forcing are strictly required
        # (streamflow is pulled from CAMELS automatically)
        fw = (framework or "hbv").lower().replace("-", "").replace("_", "")
        if fw in ("neuralhydrology", "nh", "lstm"):
            required = ("watershed", "streamflow", "forcing")
        else:
            required = ("watershed", "forcing")

        missing = [s for s in required if getattr(session, s) is None]
        if missing:
            return {
                "error": True,
                "code": "MISSING_PREREQUISITES",
                "message": (
                    f"Cannot train model — missing cached data: {missing}. "
                    "Run these tools first: "
                    + ", ".join({
                        "watershed":  "delineate_watershed",
                        "streamflow": "fetch_streamflow_data",
                        "forcing":    "fetch_forcing_data",
                    }[s] for s in missing)
                ),
            }

        if session.workspace_dir:
            output_dir = Path(session.workspace_dir) / "models"
        else:
            output_dir = Path.home() / ".aihydro" / "models"
        output_dir.mkdir(parents=True, exist_ok=True)

        if ctx:
            await ctx.report_progress(progress=0, total=2)

        # Resolve the USGS gauge ID for CAMELS streamflow fetching —
        # use session.site_id if set (e.g. USGS gauge), fall back to session_id
        # (the underlying functions use this for CAMELS lookup).
        usgs_gauge_id = session.site_id or session_id

        if fw in ("hbv", "hbvlight", "differentiable", "hydrodl2"):
            from ai_hydro.modelling.conceptual.hbv import train_hbv_light
            result = await asyncio.to_thread(
                train_hbv_light,
                gauge_id=usgs_gauge_id,
                session=session,
                output_dir=output_dir,
                train_start=train_start,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                epochs=epochs,
                n_restarts=n_restarts,
                learning_rate=learning_rate,
            )
        elif fw in ("neuralhydrology", "nh", "lstm"):
            from ai_hydro.modelling.neural.lstm import train_neural_hydrology
            result = await asyncio.to_thread(
                train_neural_hydrology,
                gauge_id=usgs_gauge_id,
                session=session,
                output_dir=output_dir,
                model=model,
                train_start=train_start,
                train_end=train_end,
                val_start=val_start,
                val_end=val_end,
                test_start=test_start,
                test_end=test_end,
                epochs=epochs,
                hidden_size=hidden_size,
                learning_rate=learning_rate,
            )
        else:
            return {
                "error": True,
                "code": "UNKNOWN_FRAMEWORK",
                "message": (
                    f"Unknown framework: {framework!r}. "
                    "Use 'hbv' (differentiable HBV-light, recommended) or "
                    "'neuralhydrology' (LSTM, requires pip install neuralhydrology)."
                ),
            }

        if ctx:
            await ctx.report_progress(progress=2, total=2)

        # Cache result in session + add HBV citation
        session.model = result
        from ai_hydro.citations import citation_keys_for_tool
        session.add_citations(citation_keys_for_tool("train_hydro_model"))
        session.save()

        # Add performance summary to response
        nse = result.get("nse")
        rating = (
            "excellent" if nse is not None and nse >= 0.75 else
            "satisfactory" if nse is not None and nse >= 0.50 else
            "poor" if nse is not None else "unknown"
        )
        result["performance_rating"] = rating
        result["_note"] = (
            f"Model trained and saved. NSE={nse:.3f} ({rating}). "
            "Result cached in session slot 'model'. "
            "Re-run with clear_session to try different hyperparameters."
        ) if nse is not None else "Model trained and saved."

        return result

    except ImportError as e:
        return {
            "error": True,
            "code": "MISSING_DEPENDENCY",
            "message": str(e),
            "install_hint": (
                "pip install neuralhydrology" if "neural" in str(e).lower()
                else "pip install hydrodl2 torch numpy"
            ),
        }
    except Exception as e:
        log.error("train_hydro_model failed: %s", e, exc_info=True)
        return _tool_error_to_dict(e)


@mcp.tool()
def get_model_results(session_id: str) -> dict:
    """
    Return the cached model training results for a session.

    If no model has been trained, returns a clear message with instructions.
    Use train_hydro_model to train a model first.

    Parameters
    ----------
    session_id : str
        Research session identifier.

    Returns
    -------
    dict with framework, model_type, nse, kge, rmse, model_dir, and metadata.
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)

        if session.model is None:
            return {
                "error": False,
                "model_trained": False,
                "message": (
                    f"No model trained yet for session '{session_id}'. "
                    "Call train_hydro_model to train one."
                ),
                "prerequisite_status": {
                    s: (getattr(session, s) is not None) for s in
                    ("watershed", "streamflow", "forcing", "camels")
                },
            }

        result = session.model
        nse = result.get("nse")
        return {
            "model_trained": True,
            **result,
            "performance_rating": (
                "excellent" if nse is not None and nse >= 0.75 else
                "satisfactory" if nse is not None and nse >= 0.50 else
                "poor" if nse is not None else "unknown"
            ),
        }

    except Exception as e:
        log.error("get_model_results failed: %s", e)
        return _tool_error_to_dict(e)
