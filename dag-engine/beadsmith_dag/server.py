"""JSON-RPC server for the DAG analysis engine.

This server communicates with the VS Code extension via stdio,
accepting JSON-RPC 2.0 requests and returning responses.
"""

import json
import sys
from pathlib import Path
from typing import Any

import structlog

from .analyser import ProjectAnalyser
from .models import (
    DagServiceStatus,
    JsonRpcErrorCode,
    JsonRpcRequest,
    JsonRpcResponse,
)

# Configure structlog to output JSON to stderr (stdout is reserved for responses)
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO level
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
)

logger = structlog.get_logger()


class DAGServer:
    """JSON-RPC server for DAG analysis.

    Handles requests from the VS Code extension to analyse projects,
    compute impact, and query the dependency graph.
    """

    def __init__(self) -> None:
        self.analyser = ProjectAnalyser()
        self.version = "0.1.0"

    def handle_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle a JSON-RPC request.

        Args:
            request: Parsed JSON-RPC request.

        Returns:
            JSON-RPC response with result or error.
        """
        method = request.method
        params = request.params

        try:
            if method == "get_status":
                result = self._handle_get_status()

            elif method == "analyse_project":
                result = self._handle_analyse_project(params)

            elif method == "analyse_file":
                result = self._handle_analyse_file(params)

            elif method == "get_impact":
                result = self._handle_get_impact(params)

            elif method == "get_callers":
                result = self._handle_get_callers(params)

            elif method == "get_callees":
                result = self._handle_get_callees(params)

            elif method == "invalidate_file":
                result = self._handle_invalidate_file(params)

            elif method == "clear_cache":
                result = self._handle_clear_cache()

            elif method == "get_cached_graph":
                result = self._handle_get_cached_graph()

            elif method == "query_nodes":
                result = self._handle_query_nodes(params)

            elif method == "get_edges_for_node":
                result = self._handle_get_edges_for_node(params)

            else:
                return JsonRpcResponse.error_response(
                    request.id,
                    JsonRpcErrorCode.METHOD_NOT_FOUND,
                    f"Method not found: {method}",
                )

            return JsonRpcResponse.success(request.id, result)

        except KeyError as e:
            logger.warning("Missing required parameter", method=method, param=str(e))
            return JsonRpcResponse.error_response(
                request.id,
                JsonRpcErrorCode.INVALID_PARAMS,
                f"Missing required parameter: {e}",
            )
        except FileNotFoundError as e:
            logger.warning("File not found", method=method, error=str(e))
            return JsonRpcResponse.error_response(
                request.id,
                JsonRpcErrorCode.FILE_NOT_FOUND,
                str(e),
            )
        except Exception as e:
            logger.exception("Error handling request", method=method)
            return JsonRpcResponse.error_response(
                request.id,
                JsonRpcErrorCode.ANALYSIS_ERROR,
                str(e),
            )

    def _handle_get_status(self) -> dict[str, Any]:
        """Handle get_status request."""
        cached = self.analyser.get_cached_graph()
        return DagServiceStatus(
            running=True,
            version=self.version,
            has_cache=cached is not None,
            last_analysis=cached.analysis_timestamp if cached else None,
            file_count=cached.summary.files if cached else None,
        ).model_dump()

    def _handle_analyse_project(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle analyse_project request."""
        root = Path(params["root"])
        if not root.exists():
            raise FileNotFoundError(f"Project root not found: {root}")

        graph = self.analyser.analyse_project(root)
        return graph.model_dump()

    def _handle_analyse_file(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle analyse_file request."""
        file_path = Path(params["file"])
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        return self.analyser.analyse_file(file_path)

    def _handle_get_impact(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle get_impact request."""
        file_path = params["file"]
        function_name = params.get("function")
        max_depth = params.get("max_depth")
        min_confidence = params.get("min_confidence")

        impact = self.analyser.get_impact(
            file_path,
            function_name=function_name,
            max_depth=max_depth,
            min_confidence=min_confidence,
        )
        return impact.model_dump()

    def _handle_get_callers(self, params: dict[str, Any]) -> list[str]:
        """Handle get_callers request."""
        node_id = params["node_id"]
        return self.analyser.get_callers(node_id)

    def _handle_get_callees(self, params: dict[str, Any]) -> list[str]:
        """Handle get_callees request."""
        node_id = params["node_id"]
        return self.analyser.get_callees(node_id)

    def _handle_invalidate_file(self, params: dict[str, Any]) -> None:
        """Handle invalidate_file request."""
        file_path = params["file"]
        self.analyser.invalidate_file(file_path)
        return None

    def _handle_clear_cache(self) -> None:
        """Handle clear_cache request."""
        self.analyser.clear_cache()
        return None

    def _handle_get_cached_graph(self) -> dict[str, Any] | None:
        """Handle get_cached_graph request."""
        cached = self.analyser.get_cached_graph()
        if cached is None:
            return None
        return cached.model_dump()

    def _handle_query_nodes(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle query_nodes request.

        Searches cached graph nodes by file path, name, and/or type.
        """
        cached = self.analyser.get_cached_graph()
        if cached is None:
            return {"nodes": [], "total_count": 0}

        file_path = params.get("file_path")
        name = params.get("name")
        node_type = params.get("type")
        limit = params.get("limit", 100)

        matches = []
        for node in cached.nodes:
            if file_path and file_path not in node.file_path:
                continue
            if name and name.lower() not in node.name.lower():
                continue
            if node_type and node.type.value != node_type:
                continue
            matches.append(node.model_dump())
            if len(matches) >= limit:
                break

        return {"nodes": matches, "total_count": len(matches)}

    def _handle_get_edges_for_node(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle get_edges_for_node request.

        Returns incoming and outgoing edges for a specific node.
        """
        node_id = params["node_id"]
        cached = self.analyser.get_cached_graph()
        if cached is None:
            return {"incoming": [], "outgoing": []}

        incoming = [
            e.model_dump() for e in cached.edges if e.to_node == node_id
        ]
        outgoing = [
            e.model_dump() for e in cached.edges if e.from_node == node_id
        ]

        return {"incoming": incoming, "outgoing": outgoing}

    def run(self) -> None:
        """Run the server, reading from stdin and writing to stdout.

        The server reads JSON-RPC requests (one per line) from stdin
        and writes JSON-RPC responses to stdout.
        """
        logger.info("DAG server starting", version=self.version)

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                request = JsonRpcRequest(**data)
                response = self.handle_request(request)

                # Write response to stdout (the extension reads from here)
                print(response.model_dump_json(), flush=True)

            except json.JSONDecodeError as e:
                logger.error("Invalid JSON", error=str(e), line=line[:100])
                error_response = JsonRpcResponse.error_response(
                    0,
                    JsonRpcErrorCode.PARSE_ERROR,
                    "Parse error: invalid JSON",
                )
                print(error_response.model_dump_json(), flush=True)

            except Exception as e:
                logger.exception("Unexpected error processing request")
                error_response = JsonRpcResponse.error_response(
                    0,
                    JsonRpcErrorCode.INTERNAL_ERROR,
                    f"Internal error: {e}",
                )
                print(error_response.model_dump_json(), flush=True)

        logger.info("DAG server shutting down")


def main() -> None:
    """Entry point for the DAG server."""
    server = DAGServer()
    server.run()


if __name__ == "__main__":
    main()
