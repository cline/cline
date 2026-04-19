---
description: AI-Hydro plugin data contract — every tool returns a HydroResult with structured data plus HydroMeta provenance (tool, version, source, parameters, timestamp).
---

# Data Contract

All AI-Hydro tools must follow the `HydroResult` / `HydroMeta` data contract. This ensures that every tool produces provenance-tracked, session-compatible results.

---

## HydroResult

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class HydroResult:
    data: dict[str, Any]   # tool-specific results
    meta: "HydroMeta"      # provenance metadata
```

---

## HydroMeta

```python
@dataclass
class HydroMeta:
    tool: str           # function name, e.g. "compute_snow_signatures"
    version: str        # your package version, e.g. "0.1.0"
    source: str         # data source description
    retrieved_at: str   # ISO 8601 UTC timestamp
    parameters: dict    # all input parameters used
```

---

## Importing

```python
from ai_hydro.core.types import HydroResult, HydroMeta
```

---

## Minimal Compliant Tool

```python
from ai_hydro.core.types import HydroResult, HydroMeta
from datetime import datetime, timezone


def my_tool(gauge_id: str) -> dict:
    """Short description — the agent reads this."""

    # ... your computation ...
    result_data = {"value": 42, "units": "m"}

    result = HydroResult(
        data=result_data,
        meta=HydroMeta(
            tool="my_tool",
            version="0.1.0",
            source="Description of where data came from",
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            parameters={"gauge_id": gauge_id},
        ),
    )

    return result.data  # MCP tools return dict, not HydroResult
```

---

## Storing in Session

To cache results across conversations, write to HydroSession:

```python
from ai_hydro.session import HydroSession

session = HydroSession.load(gauge_id)
session.set_slot("my_slot_name", result.data, result.meta.__dict__)
session.save()
```

Custom slot names are supported — you don't need to modify the core `HydroSession` to add new slots. The dynamic slot system (`_slots` dict) accepts any string key.

---

## Error Handling

Return errors as dicts, not exceptions:

```python
# Good
return {"error": f"No streamflow data for gauge {gauge_id}. Call fetch_streamflow_data first."}

# Bad — MCP will return a 500 error to the agent
raise ValueError("No data")
```

The agent can read and report dict errors gracefully. Unhandled exceptions produce opaque failure messages.
