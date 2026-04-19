# YAML Workflow Definitions

This directory contains **declarative workflow definitions** in YAML format that work alongside the Python workflow implementations in `python/ai_hydro/workflows/`.

## 📋 Purpose

YAML workflows serve as **intelligent documentation and discovery metadata** for the RAG (Retrieval-Augmented Generation) system. They enable:

1. **AI Discovery**: The RAG system reads these files to understand available workflows
2. **Smart Recommendations**: AI can suggest appropriate workflows based on user queries
3. **Context Injection**: Provide structured information to prevent AI hallucinations
4. **Documentation**: Human-readable specifications with examples
5. **Flexibility**: Can be modified without changing Python code

## 🔄 Dual Workflow Architecture

AI-Hydro uses a two-layer workflow system:

| Layer | Location | Purpose | Nature |
|-------|----------|---------|---------|
| **YAML** | `knowledge/workflows/` | Documentation + Discovery | Flexible, Declarative |
| **Python** | `python/ai_hydro/workflows/` | Execution + Implementation | Rigid, Imperative |

**Key Relationship**:
- **YAML defines** what the workflow should do (inputs, outputs, steps)
- **Python implements** how to actually do it (code, error handling, data processing)
- **RAG connects** them by reading YAML and recommending Python execution

## 📁 Current Workflows

- `fetch_hydrological_data.yaml` - Download streamflow and watershed data
- `compute_signatures.yaml` - Calculate hydrological signatures
- `auto_modeling.yaml` - Automated hydrological modeling
- `rag_search.yaml` - RAG-powered knowledge search

## 📐 YAML Schema

Each workflow YAML file follows this structure:

```yaml
# === METADATA ===
name: Workflow Name                    # Human-readable name
description: What this workflow does   # Clear explanation
category: data_acquisition            # Category (see below)
version: 1.0.0                        # Semantic version

# === INPUTS ===
inputs:
  - name: parameter_name              # Parameter identifier
    type: string                      # Data type (see types below)
    description: What this parameter is
    required: true                    # Whether required
    default: "value"                  # Optional default value
    options:                          # Optional list of valid options
      - option1
      - option2

# === OUTPUTS ===
outputs:
  - name: output_name                 # Output identifier
    type: dataframe                   # Data type
    description: What this output contains

# === WORKFLOW STEPS ===
steps:
  - name: step_name                   # Step identifier
    description: What this step does
    action: python.module.function    # Python function to call
    params:                           # Parameters for this step
      param1: ${inputs.parameter_name}     # Reference to input
      param2: ${steps.previous_step.output} # Reference to previous step

# === DEPENDENCIES ===
dependencies:
  python:                             # Required Python packages
    - package>=version

# === EXAMPLE ===
example_usage: |
  # Example showing typical usage
  parameter_name: "example_value"
  
# === REFERENCES ===
references:                           # Data sources and methods
  - Name: URL
```

## 🏷️ Categories

Use these standard categories:

- `data_acquisition` - Fetching data from external sources
- `data_processing` - Processing and transforming data
- `analysis` - Computing signatures, attributes, statistics
- `modeling` - Hydrological model setup and execution
- `investigation` - Scientific analysis workflows
- `utility` - Helper workflows (RAG search, validation, etc.)

## 📊 Data Types

Standard types for inputs/outputs:

- `string` - Text values (gauge IDs, dates, paths)
- `integer` - Whole numbers
- `float` - Decimal numbers
- `boolean` - True/False values
- `date` - Date strings (YYYY-MM-DD)
- `array` - Lists of values
- `dataframe` - Pandas DataFrame (time series data)
- `geodataframe` - GeoPandas GeoDataFrame (spatial data)
- `dict` - Dictionary/JSON object

## ✨ Creating New YAML Workflows

### Step 1: Choose Category and Name

```yaml
name: Extract Soil Properties
description: Extract soil attributes for a watershed
category: data_processing
version: 1.0.0
```

### Step 2: Define Inputs

```yaml
inputs:
  - name: watershed_geometry
    type: geodataframe
    description: Watershed boundary as GeoDataFrame
    required: true
    
  - name: depth_layers
    type: array
    description: Soil depth layers to extract (cm)
    required: false
    default: [0, 30, 100, 200]
    options: [0, 10, 30, 60, 100, 200]
```

### Step 3: Define Expected Outputs

```yaml
outputs:
  - name: soil_attributes
    type: dict
    description: Dictionary of soil properties
    
  - name: soil_units
    type: dict
    description: Units for each attribute
```

### Step 4: Document Workflow Steps

```yaml
steps:
  - name: fetch_soilgrids
    description: Download SoilGrids data for watershed
    action: python.ai_hydro.tools.soil.fetch_soilgrids
    params:
      geometry: ${inputs.watershed_geometry}
      layers: ${inputs.depth_layers}
  
  - name: compute_attributes
    description: Compute soil attributes from SoilGrids
    action: python.ai_hydro.tools.soil.extract_soil_attributes
    params:
      soilgrids_data: ${steps.fetch_soilgrids.output}
      geometry: ${inputs.watershed_geometry}
```

### Step 5: List Dependencies

```yaml
dependencies:
  python:
    - geopandas>=0.13.0
    - rasterio>=1.3.0
    - numpy>=1.24.0
```

### Step 6: Provide Usage Example

```yaml
example_usage: |
  # Extract soil properties for Wabash River watershed
  
  from ai_hydro.tools.watershed import delineate_watershed
  from ai_hydro.workflows.soil import extract_soil_properties
  
  # Get watershed boundary
  watershed = delineate_watershed('03335000')
  
  # Extract soil properties
  result = extract_soil_properties(
      watershed_geometry=watershed['geometry'],
      depth_layers=[0, 30, 100]
  )
  
  print(f"Mean soil porosity: {result['soil_attributes']['porosity']}")
```

### Step 7: Add References

```yaml
references:
  - SoilGrids: https://www.soilgrids.org/
  - ISRIC Data: https://data.isric.org/
```

## 🎯 Best Practices

### DO ✅

- **Use clear, descriptive names** for workflows, parameters, and steps
- **Provide complete descriptions** that explain purpose and behavior
- **Include realistic examples** showing typical usage patterns
- **List all dependencies** with minimum version requirements
- **Use standard data types** from the list above
- **Reference Python implementations** correctly with full module paths
- **Add references** to data sources and methods
- **Version your workflows** using semantic versioning

### DON'T ❌

- **Don't create YAML without Python implementation** - they must work together
- **Don't use custom data types** - stick to standard types
- **Don't skip example_usage** - examples are crucial for RAG
- **Don't use relative paths** - use absolute module paths
- **Don't duplicate workflows** - extend existing ones if possible
- **Don't forget required fields** - name, description, inputs, outputs, steps

## 🤖 How RAG Uses These Files

When you ask AI-Hydro a question, the RAG system:

1. **Loads YAML workflows** from this directory
2. **Tokenizes your query** (e.g., "fetch streamflow data")
3. **Scores workflows** by keyword relevance
4. **Injects context** into AI conversation:
   ```
   WORKFLOW_AVAILABLE: fetch_hydrological_data
   DESCRIPTION: Download streamflow, watershed boundaries...
   INPUTS: gauge_id (string, required), start_date (date), end_date (date)
   PYTHON_IMPLEMENTATION: python.ai_hydro.workflows.fetch_data.fetch_hydrological_data()
   ```
5. **AI recommends** the workflow with proper parameters
6. **Python executes** the actual workflow function

**Result**: The AI can't hallucinate non-existent workflows or parameters!

## 🔗 Linking YAML to Python

### In YAML `steps.action`:
```yaml
steps:
  - name: fetch_streamflow
    action: python.ai_hydro.workflows.fetch_data.fetch_streamflow
```

### In Python Implementation:
```python
# python/ai_hydro/workflows/fetch_data.py

def fetch_streamflow(gauge_id: str, start_date: str, end_date: str):
    """Implementation of the workflow step"""
    # Actual code here
    pass
```

### Naming Convention:
- **YAML file**: `fetch_hydrological_data.yaml`
- **Python file**: `fetch_data.py`
- **Python function**: `fetch_hydrological_data()` or similar

## 📚 Examples

### Simple Workflow
```yaml
name: Validate Gauge ID
description: Check if a USGS gauge ID is valid
category: utility
version: 1.0.0

inputs:
  - name: gauge_id
    type: string
    description: USGS gauge identifier (8 digits)
    required: true

outputs:
  - name: is_valid
    type: boolean
    description: Whether gauge ID is valid

steps:
  - name: validate
    description: Validate gauge ID format and existence
    action: python.ai_hydro.tools.watershed.validate_gauge_id
    params:
      gauge_id: ${inputs.gauge_id}

dependencies:
  python:
    - pygeohydro>=0.16.0

example_usage: |
  from ai_hydro.tools.watershed import validate_gauge_id
  
  is_valid = validate_gauge_id('01031500')
  print(f"Valid: {is_valid}")
```

### Complex Multi-Step Workflow
```yaml
name: Complete CAMELS Extraction
description: Extract all CAMELS attributes for a watershed
category: analysis
version: 1.0.0

inputs:
  - name: gauge_id
    type: string
    required: true
  - name: start_date
    type: date
    required: true
  - name: end_date
    type: date
    required: true

outputs:
  - name: attributes
    type: dict
    description: All CAMELS attributes
  - name: units
    type: dict
    description: Units for each attribute

steps:
  - name: delineate_watershed
    action: python.ai_hydro.tools.watershed.delineate_watershed
    params:
      gauge_id: ${inputs.gauge_id}
  
  - name: extract_topography
    action: python.ai_hydro.tools.topography.extract_topographic_attributes
    params:
      watershed_geom: ${steps.delineate_watershed.output.geometry}
  
  - name: extract_climate
    action: python.ai_hydro.tools.climate.extract_climate_indices
    params:
      watershed_geom: ${steps.delineate_watershed.output.geometry}
      start_date: ${inputs.start_date}
      end_date: ${inputs.end_date}
  
  - name: extract_hydrology
    action: python.ai_hydro.tools.hydrology.extract_hydrological_signatures
    params:
      gauge_id: ${inputs.gauge_id}
      watershed_geom: ${steps.delineate_watershed.output.geometry}
      drainage_area: ${steps.delineate_watershed.output.area_km2}

dependencies:
  python:
    - pygeohydro>=0.16.0
    - py3dep>=0.16.0
    - pygridmet>=0.15.0
```

## 🔍 Testing Your YAML

After creating a YAML workflow:

1. **Validate YAML syntax**: Use a YAML linter
2. **Check Python implementation exists**: Verify the `action` paths
3. **Test RAG discovery**: Query the RAG system
4. **Verify parameter types**: Ensure types match Python function signatures
5. **Test example code**: Run the example_usage code

## 🚀 Workflow Lifecycle

1. **Design**: Plan workflow purpose and steps
2. **Document**: Create YAML file with complete metadata
3. **Implement**: Create Python implementation in `python/ai_hydro/workflows/`
4. **Test**: Validate both YAML and Python work together
5. **Register**: RAG system automatically discovers new YAML files
6. **Use**: AI can now recommend and execute the workflow
7. **Maintain**: Update version when making changes

## 📖 Additional Resources

- **Schema Validation**: `knowledge/schema.json` - JSON schema for validation
- **Python Workflows**: `python/ai_hydro/workflows/` - Implementation directory
- **RAG Engine**: `python/ai_hydro/rag/engine.py` - How RAG reads these files
- **Workflow Registry**: `python/ai_hydro/registry/workflow_registry.py` - Registration
- **Contributing Guide**: `knowledge/CONTRIBUTING.md` - General guidelines

## 💡 Tips for Success

1. **Start simple**: Begin with a single-step workflow
2. **Copy existing patterns**: Use similar workflows as templates
3. **Test incrementally**: Verify each step independently
4. **Document thoroughly**: Future you (and others) will thank you
5. **Use meaningful names**: Make intent clear from the name
6. **Keep it focused**: One workflow = one clear purpose
7. **Version carefully**: Bump version when changing behavior

---

**Questions?** See `docs/architecture.md` and `docs/tools/index.md` for more details.
