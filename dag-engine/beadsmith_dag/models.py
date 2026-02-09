"""Pydantic models for the DAG analysis engine.

These models mirror the TypeScript types in src/services/dag/types.ts
to ensure consistent data structures across the extension and engine.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EdgeConfidence(str, Enum):
    """Confidence level for dependency edges."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNSAFE = "unsafe"


class NodeType(str, Enum):
    """Type of node in the dependency graph."""

    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"


class EdgeType(str, Enum):
    """Type of relationship between nodes."""

    IMPORT = "import"
    CALL = "call"
    INHERIT = "inherit"
    REFERENCE = "reference"


class GraphNode(BaseModel):
    """A node in the dependency graph representing a code symbol."""

    id: str = Field(description="Unique identifier (format: file_path:symbol_name)")
    type: NodeType
    file_path: str
    line_number: int
    name: str
    docstring: str | None = None
    parameters: list[str] = Field(default_factory=list)
    return_type: str | None = None
    column_number: int | None = None
    end_line_number: int | None = None


class GraphEdge(BaseModel):
    """An edge in the dependency graph representing a relationship."""

    from_node: str
    to_node: str
    edge_type: EdgeType
    confidence: EdgeConfidence
    line_number: int
    label: str
    context: str | None = None


class AnalysisWarning(BaseModel):
    """Warning generated during analysis."""

    type: str = Field(
        description="Category: dynamic_import, late_binding, circular_dependency, reflection, parse_error, unknown"
    )
    file: str
    line: int
    description: str
    severity: str = Field(description="low, medium, high")


class GraphSummary(BaseModel):
    """Summary statistics for the graph."""

    files: int
    functions: int
    classes: int = 0
    edges: int
    high_confidence_edges: int
    medium_confidence_edges: int
    low_confidence_edges: int
    unsafe_edges: int
    analysis_time_ms: int | None = None


class ProjectGraph(BaseModel):
    """Complete project dependency graph."""

    version: str = "1.0"
    project_root: str
    analysis_timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    warnings: list[AnalysisWarning] = Field(default_factory=list)
    summary: GraphSummary


class ImpactReport(BaseModel):
    """Report of change impact analysis."""

    changed_file: str
    changed_function: str | None = None
    affected_files: list[str] = Field(default_factory=list)
    affected_functions: list[str] = Field(default_factory=list)
    suggested_tests: list[str] = Field(default_factory=list)
    confidence_breakdown: dict[str, int] = Field(default_factory=dict)
    impact_depth: int = 0
    has_circular_dependencies: bool = False


class DagServiceStatus(BaseModel):
    """Status of the DAG analysis service."""

    running: bool = True
    version: str = "0.1.0"
    has_cache: bool = False
    last_analysis: str | None = None
    file_count: int | None = None
    error: str | None = None


class JsonRpcRequest(BaseModel):
    """JSON-RPC 2.0 request."""

    jsonrpc: str = "2.0"
    id: int
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class JsonRpcResponse(BaseModel):
    """JSON-RPC 2.0 response."""

    jsonrpc: str = "2.0"
    id: int
    result: Any | None = None
    error: dict[str, Any] | None = None

    @classmethod
    def success(cls, request_id: int, result: Any) -> "JsonRpcResponse":
        """Create a successful response."""
        return cls(id=request_id, result=result)

    @classmethod
    def error_response(
        cls, request_id: int, code: int, message: str, data: Any = None
    ) -> "JsonRpcResponse":
        """Create an error response."""
        error_obj: dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            error_obj["data"] = data
        return cls(id=request_id, error=error_obj)


# JSON-RPC error codes
class JsonRpcErrorCode:
    """Standard JSON-RPC 2.0 error codes."""

    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    # Custom error codes (-32000 to -32099 reserved for implementation)
    ANALYSIS_ERROR = -32001
    FILE_NOT_FOUND = -32002
