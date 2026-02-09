# DAG Engine JSON-RPC API Reference

The DAG engine communicates via JSON-RPC 2.0 over stdio.

## Protocol

**Request format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "method_name",
  "params": { ... }
}
```

**Response format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

**Error format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```

## Methods

### get_status

Health check and version info.

**Parameters:** None

**Returns:**
```json
{
  "status": "ready",
  "version": "0.1.0"
}
```

---

### analyse_project

Analyse entire project and return dependency graph.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `root` | string | Yes | Absolute path to project root |

**Returns:** `ProjectGraph`
```json
{
  "version": "1.0",
  "project_root": "/path/to/project",
  "analysis_timestamp": "2026-01-28T12:00:00Z",
  "nodes": [ ... ],
  "edges": [ ... ],
  "warnings": [ ... ],
  "summary": {
    "files": 25,
    "functions": 150,
    "edges": 480,
    "high_confidence_edges": 400,
    "medium_confidence_edges": 60,
    "low_confidence_edges": 15,
    "unsafe_edges": 5
  }
}
```

---

### analyse_file

Analyse a single file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | Yes | Absolute path to file |

**Returns:**
```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

---

### get_impact

Compute change impact for a file or function.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | Yes | Absolute path to file |
| `function` | string | No | Function name (optional) |

**Returns:** `ImpactReport`
```json
{
  "changed_file": "/path/to/file.py",
  "affected_files": [
    "/path/to/dependent1.py",
    "/path/to/dependent2.py"
  ],
  "affected_functions": [
    "/path/to/dependent1.py:some_function",
    "/path/to/dependent2.py:another_function"
  ],
  "suggested_tests": [
    "/path/to/tests/test_file.py"
  ],
  "confidence_breakdown": {
    "high": 5,
    "medium": 2,
    "low": 1,
    "unsafe": 0
  }
}
```

---

### get_callers

Get all nodes that call/reference a given node.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `node_id` | string | Yes | Node ID (format: `file:symbol`) |

**Returns:**
```json
["file1.py:func_a", "file2.py:Class.method"]
```

---

### get_callees

Get all nodes that a given node calls/references.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `node_id` | string | Yes | Node ID (format: `file:symbol`) |

**Returns:**
```json
["file1.py:helper", "file2.py:util"]
```

---

### invalidate_file

Mark a file for re-analysis (cache invalidation).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | Yes | Absolute path to file |

**Returns:** `null`

---

## Data Types

### GraphNode

```json
{
  "id": "path/to/file.py:ClassName",
  "type": "class",
  "file_path": "path/to/file.py",
  "line_number": 15,
  "name": "ClassName",
  "docstring": "Optional docstring",
  "parameters": ["self", "arg1: str"],
  "return_type": "bool"
}
```

**NodeType values:** `file`, `class`, `function`, `method`, `variable`

### GraphEdge

```json
{
  "from_node": "path/to/file.py:caller",
  "to_node": "path/to/other.py:callee",
  "edge_type": "call",
  "confidence": "high",
  "line_number": 42,
  "label": "calls callee"
}
```

**EdgeType values:** `import`, `call`, `inherit`, `reference`

**EdgeConfidence values:** `high`, `medium`, `low`, `unsafe`

### AnalysisWarning

```json
{
  "type": "dynamic_call",
  "file": "path/to/file.py",
  "line": 87,
  "description": "Dynamic call via getattr",
  "severity": "medium"
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 | Application error |
