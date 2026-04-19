# AI-Hydro Python Package

**Version**: 1.0.0-alpha.1  
**Purpose**: Domain-specific computational intelligence for hydrological analysis

---

## Overview

The `ai_hydro` package provides a robust, production-ready Python library for hydrological data analysis, watershed characterization, and CAMELS-style attribute extraction. The package is designed with best practices for isolated imports, lazy loading, and clear error handling.

## Package Structure

```
ai_hydro/
├── __init__.py                 # Package entry point
├── README.md                   # This file
│
├── tools/                      # Tier 2: Individual analysis tools
│   ├── watershed.py           # Watershed delineation
│   ├── hydrology.py           # Hydrological signatures
│   ├── climate.py             # Climate indices
│   ├── topography.py          # Topographic attributes
│   ├── soil.py                # Soil characteristics
│   ├── vegetation.py          # Vegetation attributes
│   ├── geology.py             # Geological properties
│   ├── geomorphic.py          # Geomorphic parameters
│   └── forcing.py             # Climate forcing data
│
├── workflows/                  # Tier 3: Complete analysis pipelines
│   ├── camels_extraction.py   # Complete CAMELS attribute extraction
│   ├── fetch_data.py          # Data retrieval workflows
│   ├── compute_signatures.py  # Signature computation
│   ├── investigation.py       # Scientific investigation
│   ├── modeling.py            # Automated modeling
│   └── rag_search.py          # RAG-powered search
│
├── rag/                        # RAG system for intelligent tool discovery
│   ├── engine.py              # Main RAG orchestrator
│   ├── config.py              # Configuration
│   └── ...
│
├── registry/                   # Tool and workflow registration
│   ├── tool_registry.py       # Tool indexing
│   └── workflow_registry.py   # Workflow management
│
├── utils/                      # Utility functions
│   ├── validators.py          # Data validation
│   └── path_resolver.py       # Path resolution
│
└── knowledge/                  # Domain knowledge base
    ├── camels_metadata.json   # CAMELS attribute definitions
    └── ...
```

---

## Development Guidelines

### Core Principles

1. **Lazy Imports**: Import heavy dependencies only when functions are called
2. **Clear Errors**: Raise ImportError with install instructions when dependencies missing
3. **Logging**: Use structured logging instead of print statements
4. **Type Hints**: Provide complete type annotations for all public functions
5. **Public API**: Declare explicit `__all__` in every module
6. **Self-Testing**: Include smoke tests in `if __name__ == "__main__"` blocks

### Module Template

Every tool/workflow module should follow this pattern:

```python
"""
Module Title
============

Brief description of what this module does.

Functions
---------
public_function_1(param1, param2) -> ReturnType
    Description
public_function_2(param1) -> ReturnType
    Description

References
----------
- Citation 1
- Citation 2

Examples
--------
>>> from ai_hydro.tools.example import public_function_1
>>> result = public_function_1('param')
>>> print(result)
"""

from typing import Dict, Optional, List
import logging
import warnings

# Lightweight imports only at module level
import numpy as np
import pandas as pd

# Module logger
log = logging.getLogger(__name__)
warnings.filterwarnings('ignore')

# Public API - explicitly declare all public functions
__all__ = ['public_function_1', 'public_function_2']


def public_function_1(
    param1: str,
    param2: float = 1.0
) -> Dict[str, float]:
    """
    Complete docstring following NumPy style.
    
    Parameters
    ----------
    param1 : str
        Description of param1
    param2 : float, optional
        Description of param2 (default: 1.0)
        
    Returns
    -------
    Dict[str, float]
        Description of return value with keys:
        - key1: Description
        - key2: Description
        
    Raises
    ------
    ImportError
        If required dependencies not installed
    ValueError
        If invalid parameters provided
        
    Examples
    --------
    >>> result = public_function_1('test', 2.0)
    >>> print(result['key1'])
    
    Notes
    -----
    - Important note 1
    - Important note 2
    """
    
    # Lazy import heavy dependencies
    try:
        import heavy_library
    except ImportError as e:
        raise ImportError(
            "Missing dependency 'heavy_library'. "
            "Install with: pip install heavy_library"
        ) from e
    
    # Input validation
    if not param1:
        raise ValueError("param1 cannot be empty")
    
    # Log progress
    log.info(f"Processing {param1} with param2={param2}")
    
    try:
        # Main logic here
        result = {
            'key1': param2 * 2,
            'key2': len(param1)
        }
        
        log.info(f"Successfully processed {param1}")
        return result
        
    except Exception as e:
        log.error(f"Error processing {param1}: {e}")
        raise


def _private_helper(x: float) -> float:
    """
    Private helper function (not in __all__).
    
    Parameters
    ----------
    x : float
        Input value
        
    Returns
    -------
    float
        Processed value
    """
    return x * 2


# Example usage and smoke tests
if __name__ == "__main__":
    # Configure logging for tests
    logging.basicConfig(
        level=logging.INFO,
        format='%(levelname)s: %(message)s'
    )
    
    try:
        # Test with simple inputs
        result = public_function_1('test', 2.0)
        print(f"\n✅ SUCCESS: Function executed")
        print(f"   Result: {result}")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
```

---

## Creating New Tools (Tier 2)

### Step 1: Create Module File

Create a new file in `tools/` directory (e.g., `tools/my_new_tool.py`)

### Step 2: Implement Functions

Follow the module template above with:
- Complete docstrings
- Lazy imports
- Type hints
- Error handling
- Logging

### Step 3: Add to Knowledge Base

Update `knowledge/tools/tier2_wrappers.json`:

```json
{
  "ai_hydro.tools.my_new_tool": {
    "extract_my_attributes": {
      "description": "Extract attributes using my new method",
      "parameters": {
        "required": ["param1"],
        "optional": ["param2"]
      },
      "returns": "Dictionary with computed attributes",
      "keywords": ["keyword1", "keyword2", "analysis"],
      "examples": [
        "Extract attributes for watershed: extract_my_attributes(watershed)"
      ],
      "category": "attribute_extraction",
      "data_sources": ["SOURCE1", "SOURCE2"],
      "units": {
        "attr1": "meters",
        "attr2": "percent"
      }
    }
  }
}
```

### Step 4: Test Isolated Import

Run the test suite:

```bash
python test_isolated_imports.py
```

### Step 5: Add Smoke Test

Include a working example in the `if __name__ == "__main__"` block.

---

## Creating New Workflows (Tier 3)

### Step 1: Create Workflow File

Create a new file in `workflows/` directory (e.g., `workflows/my_workflow.py`)

### Step 2: Implement Workflow

Workflows orchestrate multiple tools:

```python
"""
My Workflow
===========

Complete workflow description.
"""

from typing import Dict
import logging

log = logging.getLogger(__name__)

__all__ = ['my_complete_workflow']


def my_complete_workflow(
    gauge_id: str,
    start_date: str,
    end_date: str
) -> Dict:
    """
    Complete workflow that orchestrates multiple tools.
    
    Parameters
    ----------
    gauge_id : str
        USGS gauge identifier
    start_date : str
        Start date (YYYY-MM-DD)
    end_date : str
        End date (YYYY-MM-DD)
        
    Returns
    -------
    Dict
        Complete results with:
        - success: bool
        - data: Dict with all computed attributes
        - errors: List of any errors encountered
    """
    
    # Import tools as needed (lazy)
    from ai_hydro.tools.watershed import delineate_watershed
    from ai_hydro.tools.topography import extract_topographic_attributes
    
    log.info(f"Starting workflow for {gauge_id}")
    
    result = {
        'success': False,
        'data': {},
        'errors': []
    }
    
    try:
        # Step 1: Delineate watershed
        watershed = delineate_watershed(gauge_id)
        result['data']['watershed'] = watershed
        
        # Step 2: Extract attributes
        topo = extract_topographic_attributes(watershed['geometry'])
        result['data']['topography'] = topo
        
        # Continue with more tools...
        
        result['success'] = True
        log.info(f"Workflow completed successfully")
        
    except Exception as e:
        result['errors'].append(str(e))
        log.error(f"Workflow failed: {e}")
    
    return result
```

### Step 3: Add to Knowledge Base

Update `knowledge/tools/tier3_workflows.json` with workflow metadata.

### Step 4: Test Workflow

Create comprehensive tests and add to test suite.

---

## Best Practices

### 1. Lazy Imports

**✅ DO THIS:**
```python
def my_function():
    try:
        import heavy_library
    except ImportError as e:
        raise ImportError(
            "Missing dependency 'heavy_library'. "
            "Install with: pip install heavy_library"
        ) from e
    
    # Use heavy_library here
```

**❌ DON'T DO THIS:**
```python
import heavy_library  # At module level

def my_function():
    # Use heavy_library here
```

### 2. Error Messages

**✅ DO THIS:**
```python
raise ImportError(
    "Missing dependency 'pygridmet'. "
    "Install with: pip install pygridmet"
) from e
```

**❌ DON'T DO THIS:**
```python
raise ImportError("pygridmet not found")  # No install hint
```

### 3. Logging vs Print

**✅ DO THIS:**
```python
log.info("Processing data...")
log.warning("Missing optional parameter")
log.error(f"Failed to process: {e}")
```

**❌ DON'T DO THIS:**
```python
print("Processing data...")  # User-facing output
```

### 4. Type Hints

**✅ DO THIS:**
```python
def extract_data(
    gauge_id: str,
    start_date: str,
    area_km2: float = 100.0
) -> Dict[str, float]:
```

**❌ DON'T DO THIS:**
```python
def extract_data(gauge_id, start_date, area_km2=100.0):
```

### 5. Return Types

**✅ DO THIS:**
```python
# Consistent return type
return {
    'result': value,
    'units': 'meters',
    'metadata': {}
}
```

**❌ DON'T DO THIS:**
```python
# Mixed return types
if success:
    return value
else:
    return None
```

---

## Testing

### Run Test Suite

```bash
# Test isolated imports
python test_isolated_imports.py

# Test individual module
python -m python.ai_hydro.tools.hydrology

# Test with pytest (if available)
pytest python/tests/
```

### Manual Testing

```python
# Test lazy import behavior
from ai_hydro.tools.climate import extract_climate_indices
# Should succeed even if pygridmet not installed

# Test error message
try:
    result = extract_climate_indices(watershed, "2020-01-01", "2020-12-31")
except ImportError as e:
    print(e)  # Should show clear install instructions
```

---

## Common Issues & Solutions

### Issue: "Module not found" on import

**Solution**: Ensure lazy imports are used inside functions, not at module level.

### Issue: Global variables undefined

**Solution**: Don't use module-level optional imports as globals. Import inside functions.

### Issue: Mixed return types

**Solution**: Standardize on Dict return types with consistent keys.

### Issue: Silent failures

**Solution**: Raise exceptions with clear messages instead of returning NaN/None.

---

## Migration from Old Code

If you have old code using the previous patterns:

### Old Pattern (Before Refactoring)
```python
from ai_hydro.tools.hydrology import extract_hydrological_signatures

# This would fail if dependencies missing
result = extract_hydrological_signatures(...)
```

### New Pattern (After Refactoring)
```python
from ai_hydro.tools.hydrology import extract_hydrological_signatures

try:
    result = extract_hydrological_signatures(...)
except ImportError as e:
    print(f"Install required dependencies: {e}")
```

**Note**: The new pattern provides clearer error messages and better debugging.

---

## Resources

- **Architecture**: See `docs/architecture.md`
- **Tools Reference**: See `docs/tools/index.md` (and per-category pages under `docs/tools/`)
- **Contributing**: See `CONTRIBUTING.md`

---

## Contributing

When adding new tools or workflows:

1. Follow the module template exactly
2. Add comprehensive docstrings
3. Use lazy imports for all heavy dependencies
4. Include type hints on all public functions
5. Add to knowledge base JSON files
6. Include smoke tests in `if __name__ == "__main__"`
7. Run test suite to verify isolated imports work
8. Update this README if adding new patterns

---

## Support

For questions or issues:
- Check existing documentation first
- Review example modules (hydrology.py, climate.py, topography.py)
- Run test suite to validate changes
- Follow the coding patterns established in refactored modules

---

**Maintained by**: AI-Hydro Development Team  
**Last Updated**: October 2025  
**Status**: Production-Ready (Tier 2 tools), In Progress (remaining modules)
