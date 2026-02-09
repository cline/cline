# Cline+ DAG Analysis Engine

Dependency graph analysis engine for the Cline+ (Beadsmith) VS Code extension.

## Overview

This Python package analyses codebases to build a dependency graph, enabling the AI agent to understand the architectural implications of code changes before making them.

## Features

- **Python AST Parsing**: Extract symbols (functions, classes, methods) and dependencies (imports, calls, inheritance) from Python files
- **NetworkX Graph**: Build and query dependency graphs using NetworkX
- **Impact Analysis**: Compute which files and functions are affected by a change
- **Confidence Scoring**: Rate dependencies by confidence level (high, medium, low, unsafe)
- **JSON-RPC Server**: Communicate with the VS Code extension via stdio

## Installation

```bash
# Create virtual environment
python -m venv .venv

# Activate (Linux/macOS)
source .venv/bin/activate
# Activate (Windows)
.venv\Scripts\activate

# Install with dev dependencies
pip install -e ".[dev]"
```

## Usage

### As a Server (for VS Code extension)

```bash
python -m cline_dag.server
```

The server reads JSON-RPC 2.0 requests from stdin and writes responses to stdout.

### As a Library

```python
from pathlib import Path
from cline_dag.analyser import ProjectAnalyser

# Create analyser
analyser = ProjectAnalyser()

# Analyse a project
graph = analyser.analyse_project(Path("/path/to/project"))

# Get impact of a change
impact = analyser.get_impact("/path/to/file.py", function_name="my_function")

print(f"Affected files: {impact.affected_files}")
print(f"Suggested tests: {impact.suggested_tests}")
```

## JSON-RPC Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_status` | `{}` | `DagServiceStatus` | Health check |
| `analyse_project` | `{ root: string }` | `ProjectGraph` | Full project analysis |
| `analyse_file` | `{ file: string }` | `{ nodes, edges }` | Single file analysis |
| `get_impact` | `{ file: string, function?: string }` | `ImpactReport` | Impact analysis |
| `get_callers` | `{ node_id: string }` | `string[]` | List callers |
| `get_callees` | `{ node_id: string }` | `string[]` | List callees |
| `invalidate_file` | `{ file: string }` | `void` | Mark for re-analysis |
| `clear_cache` | `{}` | `void` | Clear cached graph |

## Development

```bash
# Run tests
pytest

# Run tests with coverage
pytest --cov=cline_dag --cov-report=html

# Lint
ruff check .

# Type check
mypy cline_dag
```

## Architecture

```
cline_dag/
├── __init__.py
├── models.py         # Pydantic models (mirroring TypeScript types)
├── analyser.py       # Main ProjectAnalyser coordinating all components
├── server.py         # JSON-RPC server for VS Code extension
├── parsers/
│   ├── __init__.py
│   └── python_parser.py   # Python AST parser
└── graph/
    ├── __init__.py
    ├── builder.py    # NetworkX graph construction
    └── queries.py    # Impact analysis and graph queries
```

## License

Apache 2.0
