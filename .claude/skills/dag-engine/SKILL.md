---
name: dag-engine
description: Work with the Python DAG analysis engine. Use when creating parsers, adding language support, implementing graph queries, debugging impact analysis, testing dependency detection, or modifying NetworkX graph structure. Triggers on "parser", "dependency graph", "impact analysis", "NetworkX", "AST parsing".
---

# DAG Engine Development

The DAG engine is a Python microservice in `dag-engine/` that analyses codebases and builds dependency graphs. It communicates via JSON-RPC over stdio.

## Quick Reference

| Component | Location | Purpose |
|-----------|----------|---------|
| Server | `cline_dag/server.py` | JSON-RPC entry point |
| Analyser | `cline_dag/analyser.py` | Main coordinator |
| Python parser | `cline_dag/parsers/python_parser.py` | AST analysis |
| JS/TS parser | `cline_dag/parsers/js_parser.py` | Babel bridge |
| Graph builder | `cline_dag/graph/builder.py` | NetworkX construction |
| Models | `cline_dag/models.py` | Pydantic schemas |

## Common Tasks

### Add a new language parser

See [references/parser-template.md](references/parser-template.md) for the full template.

1. Create `cline_dag/parsers/new_lang_parser.py`
2. Implement `parse_file()` returning `(nodes, edges)`
3. Register in `analyser.py`
4. Add file extension to `_find_source_files()`

### Test parser output

```bash
cd dag-engine && python -c "
from pathlib import Path
from cline_dag.parsers.python_parser import PythonParser
parser = PythonParser()
nodes, edges = parser.parse_file(Path('path/to/file.py'))
for n in nodes: print(f'{n.type}: {n.name}')
for e in edges: print(f'{e.from_node} -> {e.to_node}')
"
```

### Test impact analysis

```bash
cd dag-engine && python -c "
from pathlib import Path
from cline_dag.analyser import ProjectAnalyser
analyser = ProjectAnalyser()
analyser.analyse_project(Path('/path/to/project'))
impact = analyser.get_impact('/path/to/project/file.py')
print(f'Affected: {impact.affected_files}')
"
```

### Run test suite

```bash
cd dag-engine && pytest -v
```

## Key Data Models

```python
class EdgeConfidence(str, Enum):
    HIGH = "high"       # Static, unambiguous
    MEDIUM = "medium"   # Type-inferred
    LOW = "low"         # Duck-typed
    UNSAFE = "unsafe"   # Dynamic/reflection

class GraphNode(BaseModel):
    id: str             # "file_path:symbol_name"
    type: NodeType      # file|class|function|method
    file_path: str
    line_number: int
    name: str
```

## Confidence Scoring

| Pattern | Confidence | Example |
|---------|------------|---------|
| Direct import | HIGH | `from x import Y` |
| Type annotation | HIGH | `def f(x: MyClass)` |
| Assignment inference | MEDIUM | `x = get_thing()` |
| Duck-typed call | LOW | `obj.method()` |
| getattr/eval | UNSAFE | `getattr(obj, name)` |

## Additional Resources

- [references/parser-template.md](references/parser-template.md) - Full parser implementation template
- [references/json-rpc-api.md](references/json-rpc-api.md) - Complete API reference
- `plans/cline-dag-technical-spec.md` - Architecture spec
- `plans/cline-dag-js-parser-spec.md` - JS/TS parser details
