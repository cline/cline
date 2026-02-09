"""JavaScript/TypeScript parser bridge to Node.js subprocess."""

import json
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import structlog

from ..models import AnalysisWarning, EdgeConfidence, EdgeType, GraphEdge, GraphNode, NodeType

if TYPE_CHECKING:
    pass

logger = structlog.get_logger()


class JSParser:
    """Parse JavaScript/TypeScript files via Node.js subprocess."""

    # Map string types to enums
    NODE_TYPE_MAP = {
        "file": NodeType.FILE,
        "class": NodeType.CLASS,
        "function": NodeType.FUNCTION,
        "method": NodeType.METHOD,
    }

    EDGE_TYPE_MAP = {
        "import": EdgeType.IMPORT,
        "call": EdgeType.CALL,
        "inherit": EdgeType.INHERIT,
    }

    CONFIDENCE_MAP = {
        "high": EdgeConfidence.HIGH,
        "medium": EdgeConfidence.MEDIUM,
        "low": EdgeConfidence.LOW,
        "unsafe": EdgeConfidence.UNSAFE,
    }

    def __init__(self, node_path: str = "node") -> None:
        """Initialize JS parser.

        Args:
            node_path: Path to node executable.
        """
        self.node_path = node_path
        self.parser_script = (
            Path(__file__).parent.parent.parent / "js-parser" / "parser.js"
        )
        self._process: subprocess.Popen | None = None
        self._request_id = 0

    def start(self) -> None:
        """Start the Node.js parser subprocess."""
        if self._process is not None:
            return

        if not self.parser_script.exists():
            raise FileNotFoundError(f"JS parser script not found: {self.parser_script}")

        try:
            self._process = subprocess.Popen(
                [self.node_path, str(self.parser_script)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            logger.info("JS parser subprocess started", pid=self._process.pid)
        except FileNotFoundError:
            logger.error("Node.js not found", node_path=self.node_path)
            raise
        except Exception as e:
            logger.error("Failed to start JS parser", error=str(e))
            raise

    def stop(self) -> None:
        """Stop the Node.js parser subprocess."""
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
            logger.info("JS parser subprocess stopped")

    def is_running(self) -> bool:
        """Check if the parser subprocess is running."""
        return self._process is not None and self._process.poll() is None

    def parse_file(
        self, file_path: Path
    ) -> tuple[list[GraphNode], list[GraphEdge], list[AnalysisWarning]]:
        """Parse a JavaScript/TypeScript file and extract nodes and edges.

        Args:
            file_path: Path to the file to parse.

        Returns:
            Tuple of (nodes, edges, warnings).
        """
        if not self.is_running():
            self.start()

        if not self._process or not self._process.stdin or not self._process.stdout:
            logger.error("JS parser process not available")
            return [], [], []

        self._request_id += 1
        request = json.dumps({"id": self._request_id, "file": str(file_path)})

        try:
            self._process.stdin.write(request + "\n")
            self._process.stdin.flush()

            response_line = self._process.stdout.readline()
            if not response_line:
                logger.error("No response from JS parser", file=str(file_path))
                # Process may have died, try to restart
                self.stop()
                return [], [], []

            response = json.loads(response_line)

        except (json.JSONDecodeError, BrokenPipeError, OSError) as e:
            logger.error(
                "Error communicating with JS parser",
                file=str(file_path),
                error=str(e),
            )
            self.stop()
            return [], [], []

        if "error" in response:
            logger.warning(
                "JS parser error", file=str(file_path), error=response["error"]
            )
            return [], [], []

        result = response.get("result", {})

        # Convert to Pydantic models
        nodes = []
        for n in result.get("nodes", []):
            try:
                node_type = self.NODE_TYPE_MAP.get(n["type"], NodeType.FILE)
                nodes.append(
                    GraphNode(
                        id=n["id"],
                        type=node_type,
                        file_path=n["file_path"],
                        line_number=n["line_number"],
                        name=n["name"],
                        docstring=n.get("docstring"),
                        parameters=n.get("parameters", []),
                        return_type=n.get("return_type"),
                        end_line_number=n.get("end_line_number"),
                    )
                )
            except Exception as e:
                logger.warning("Failed to parse node", node=n, error=str(e))

        edges = []
        for e in result.get("edges", []):
            try:
                edge_type = self.EDGE_TYPE_MAP.get(e["edge_type"], EdgeType.CALL)
                confidence = self.CONFIDENCE_MAP.get(
                    e["confidence"], EdgeConfidence.MEDIUM
                )
                edges.append(
                    GraphEdge(
                        from_node=e["from_node"],
                        to_node=e["to_node"],
                        edge_type=edge_type,
                        confidence=confidence,
                        line_number=e["line_number"],
                        label=e.get("label", ""),
                    )
                )
            except Exception as err:
                logger.warning("Failed to parse edge", edge=e, error=str(err))

        warnings = []
        for w in result.get("warnings", []):
            try:
                warnings.append(
                    AnalysisWarning(
                        type=w["type"],
                        file=w["file"],
                        line=w["line"],
                        description=w["description"],
                        severity=w.get("severity", "medium"),
                    )
                )
            except Exception as err:
                logger.warning("Failed to parse warning", warning=w, error=str(err))

        logger.debug(
            "Parsed JS/TS file",
            file=str(file_path),
            nodes=len(nodes),
            edges=len(edges),
            warnings=len(warnings),
        )

        return nodes, edges, warnings

    def __enter__(self) -> "JSParser":
        """Context manager entry."""
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        self.stop()


# Singleton instance for reuse
_js_parser: JSParser | None = None


def get_js_parser(node_path: str = "node") -> JSParser:
    """Get or create a shared JS parser instance.

    Args:
        node_path: Path to node executable.

    Returns:
        JSParser instance.
    """
    global _js_parser
    if _js_parser is None:
        _js_parser = JSParser(node_path)
    return _js_parser
