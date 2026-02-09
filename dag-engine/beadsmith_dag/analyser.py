"""Main project analyser coordinating all analysis components."""

import time
from pathlib import Path

import networkx as nx
import structlog

from .graph.builder import GraphBuilder
from .graph.queries import GraphQueries
from .models import (
    AnalysisWarning,
    EdgeConfidence,
    GraphSummary,
    ImpactReport,
    NodeType,
    ProjectGraph,
)
from .parsers.js_parser import JSParser
from .parsers.python_parser import PythonParser

logger = structlog.get_logger()


class ProjectAnalyser:
    """Coordinate analysis of entire projects."""

    # Directories to ignore during analysis
    IGNORE_DIRS = {
        "__pycache__",
        "node_modules",
        ".git",
        ".venv",
        "venv",
        ".tox",
        "dist",
        "build",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "env",
        ".env",
        "site-packages",
        ".idea",
        ".vscode",
        "coverage",
        ".coverage",
        "htmlcov",
        ".eggs",
        "*.egg-info",
    }

    # File extensions to analyse
    PYTHON_EXTENSIONS = {".py", ".pyi"}
    JS_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx"}

    def __init__(self, node_path: str = "node") -> None:
        self.python_parser = PythonParser()
        self.js_parser = JSParser(node_path)
        self.graph_builder = GraphBuilder()
        self.cached_graph: ProjectGraph | None = None
        self.nx_graph: nx.DiGraph | None = None
        self.queries: GraphQueries | None = None
        # Track nodes/edges by file for incremental updates
        self._nodes_by_file: dict[str, list] = {}
        self._edges_by_file: dict[str, list] = {}
        self._project_root: Path | None = None

    def analyse_project(self, root: Path) -> ProjectGraph:
        """Analyse entire project and build dependency graph.

        Args:
            root: Root path of the project to analyse.

        Returns:
            ProjectGraph containing all nodes, edges, and summary.
        """
        start_time = time.perf_counter()
        logger.info("Starting project analysis", root=str(root))

        self._project_root = root
        self._nodes_by_file = {}
        self._edges_by_file = {}

        all_nodes = []
        all_edges = []
        warnings: list[AnalysisWarning] = []

        # Find all source files
        source_files = self._find_source_files(root)
        logger.info("Found source files", count=len(source_files))

        # Parse each file
        for file_path in source_files:
            suffix = file_path.suffix.lower()
            file_key = str(file_path)

            try:
                if suffix in self.PYTHON_EXTENSIONS:
                    nodes, edges = self.python_parser.parse_file(file_path)
                    all_nodes.extend(nodes)
                    all_edges.extend(edges)
                    # Track by file for incremental updates
                    self._nodes_by_file[file_key] = nodes
                    self._edges_by_file[file_key] = edges

                elif suffix in self.JS_EXTENSIONS:
                    nodes, edges, file_warnings = self.js_parser.parse_file(file_path)
                    all_nodes.extend(nodes)
                    all_edges.extend(edges)
                    warnings.extend(file_warnings)
                    # Track by file for incremental updates
                    self._nodes_by_file[file_key] = nodes
                    self._edges_by_file[file_key] = edges

            except Exception as e:
                logger.warning(
                    "Error parsing file",
                    file=str(file_path),
                    error=str(e),
                )
                warnings.append(
                    AnalysisWarning(
                        type="parse_error",
                        file=str(file_path),
                        line=0,
                        description=f"Failed to parse: {e}",
                        severity="medium",
                    )
                )

        # Build NetworkX graph for queries
        self.nx_graph = self.graph_builder.build(all_nodes, all_edges)
        self.queries = GraphQueries(self.nx_graph)

        # Detect circular dependencies
        cycles = self.queries.find_cycles()
        for cycle in cycles[:10]:  # Limit to first 10 cycles
            cycle_str = " -> ".join(cycle[:5])
            if len(cycle) > 5:
                cycle_str += f" -> ... ({len(cycle)} nodes)"
            warnings.append(
                AnalysisWarning(
                    type="circular_dependency",
                    file=cycle[0].split(":")[0] if ":" in cycle[0] else cycle[0],
                    line=0,
                    description=f"Circular dependency: {cycle_str}",
                    severity="medium",
                )
            )

        # Calculate summary
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        file_count = len([n for n in all_nodes if n.type == NodeType.FILE])
        function_count = len(
            [n for n in all_nodes if n.type in (NodeType.FUNCTION, NodeType.METHOD)]
        )
        class_count = len([n for n in all_nodes if n.type == NodeType.CLASS])

        summary = GraphSummary(
            files=file_count,
            functions=function_count,
            classes=class_count,
            edges=len(all_edges),
            high_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.HIGH]
            ),
            medium_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.MEDIUM]
            ),
            low_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.LOW]
            ),
            unsafe_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.UNSAFE]
            ),
            analysis_time_ms=elapsed_ms,
        )

        self.cached_graph = ProjectGraph(
            project_root=str(root),
            nodes=all_nodes,
            edges=all_edges,
            warnings=warnings,
            summary=summary,
        )

        logger.info(
            "Analysis complete",
            files=summary.files,
            functions=summary.functions,
            classes=summary.classes,
            edges=summary.edges,
            time_ms=elapsed_ms,
        )

        return self.cached_graph

    def analyse_file(self, file_path: Path) -> dict:
        """Analyse a single file and return its nodes and edges.

        Args:
            file_path: Path to the file to analyse.

        Returns:
            Dictionary with "nodes", "edges", and "warnings" lists.
        """
        suffix = file_path.suffix.lower()
        warnings: list[AnalysisWarning] = []

        if suffix in self.PYTHON_EXTENSIONS:
            nodes, edges = self.python_parser.parse_file(file_path)
        elif suffix in self.JS_EXTENSIONS:
            nodes, edges, warnings = self.js_parser.parse_file(file_path)
        else:
            nodes, edges = [], []

        return {
            "nodes": [n.model_dump() for n in nodes],
            "edges": [e.model_dump() for e in edges],
            "warnings": [w.model_dump() for w in warnings],
        }

    def get_impact(
        self,
        file_path: str,
        function_name: str | None = None,
        max_depth: int | None = None,
        min_confidence: str | None = None,
    ) -> ImpactReport:
        """Compute impact of changes to a file or function.

        Args:
            file_path: Path to the changed file.
            function_name: Optional specific function that changed.
            max_depth: Maximum traversal depth.
            min_confidence: Minimum confidence level to include.

        Returns:
            ImpactReport with affected files and functions.
        """
        if not self.queries:
            return ImpactReport(changed_file=file_path, changed_function=function_name)

        # Construct node ID
        if function_name:
            node_id = f"{file_path}:{function_name}"
        else:
            node_id = file_path

        return self.queries.get_impact(
            node_id, max_depth=max_depth, min_confidence=min_confidence
        )

    def get_callers(self, node_id: str) -> list[str]:
        """Get all nodes that call/reference the given node.

        Args:
            node_id: ID of the node.

        Returns:
            List of caller node IDs.
        """
        if not self.queries:
            return []
        return self.queries.get_callers(node_id)

    def get_callees(self, node_id: str) -> list[str]:
        """Get all nodes that the given node calls/references.

        Args:
            node_id: ID of the node.

        Returns:
            List of callee node IDs.
        """
        if not self.queries:
            return []
        return self.queries.get_callees(node_id)

    def invalidate_file(self, file_path: str) -> ProjectGraph | None:
        """Incrementally re-analyse a changed file.

        This removes old nodes/edges for the file, re-parses it,
        and rebuilds the graph with the updated data.

        Args:
            file_path: Path to the file that changed.

        Returns:
            Updated ProjectGraph or None if no cached graph exists.
        """
        logger.info("File invalidated, starting incremental update", file=file_path)

        if not self.cached_graph:
            logger.warning("No cached graph, cannot perform incremental update")
            return None

        path = Path(file_path)
        file_key = str(path)
        suffix = path.suffix.lower()

        # Check if this is a supported file type
        if suffix not in self.PYTHON_EXTENSIONS | self.JS_EXTENSIONS:
            logger.debug("Unsupported file type, skipping", file=file_path)
            return self.cached_graph

        # Remove old nodes/edges for this file
        old_nodes = self._nodes_by_file.get(file_key, [])
        old_edges = self._edges_by_file.get(file_key, [])
        old_node_ids = {n.id for n in old_nodes}

        # Re-parse the file
        new_nodes = []
        new_edges = []
        new_warnings: list[AnalysisWarning] = []

        try:
            if path.exists():
                if suffix in self.PYTHON_EXTENSIONS:
                    new_nodes, new_edges = self.python_parser.parse_file(path)
                elif suffix in self.JS_EXTENSIONS:
                    new_nodes, new_edges, new_warnings = self.js_parser.parse_file(path)

                self._nodes_by_file[file_key] = new_nodes
                self._edges_by_file[file_key] = new_edges
            else:
                # File was deleted
                if file_key in self._nodes_by_file:
                    del self._nodes_by_file[file_key]
                if file_key in self._edges_by_file:
                    del self._edges_by_file[file_key]
                logger.info("File deleted, removed from graph", file=file_path)

        except Exception as e:
            logger.warning("Error re-parsing file", file=file_path, error=str(e))
            new_warnings.append(
                AnalysisWarning(
                    type="parse_error",
                    file=file_path,
                    line=0,
                    description=f"Failed to parse: {e}",
                    severity="medium",
                )
            )

        # Rebuild all nodes/edges from tracked data
        all_nodes = []
        all_edges = []
        for nodes in self._nodes_by_file.values():
            all_nodes.extend(nodes)
        for edges in self._edges_by_file.values():
            all_edges.extend(edges)

        # Rebuild NetworkX graph
        self.nx_graph = self.graph_builder.build(all_nodes, all_edges)
        self.queries = GraphQueries(self.nx_graph)

        # Detect circular dependencies
        warnings = list(new_warnings)
        cycles = self.queries.find_cycles()
        for cycle in cycles[:10]:
            cycle_str = " -> ".join(cycle[:5])
            if len(cycle) > 5:
                cycle_str += f" -> ... ({len(cycle)} nodes)"
            warnings.append(
                AnalysisWarning(
                    type="circular_dependency",
                    file=cycle[0].split(":")[0] if ":" in cycle[0] else cycle[0],
                    line=0,
                    description=f"Circular dependency: {cycle_str}",
                    severity="medium",
                )
            )

        # Update summary
        file_count = len([n for n in all_nodes if n.type == NodeType.FILE])
        function_count = len(
            [n for n in all_nodes if n.type in (NodeType.FUNCTION, NodeType.METHOD)]
        )
        class_count = len([n for n in all_nodes if n.type == NodeType.CLASS])

        summary = GraphSummary(
            files=file_count,
            functions=function_count,
            classes=class_count,
            edges=len(all_edges),
            high_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.HIGH]
            ),
            medium_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.MEDIUM]
            ),
            low_confidence_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.LOW]
            ),
            unsafe_edges=len(
                [e for e in all_edges if e.confidence == EdgeConfidence.UNSAFE]
            ),
            analysis_time_ms=0,  # Incremental, so we don't track full time
        )

        self.cached_graph = ProjectGraph(
            project_root=self.cached_graph.project_root,
            nodes=all_nodes,
            edges=all_edges,
            warnings=warnings,
            summary=summary,
        )

        logger.info(
            "Incremental update complete",
            file=file_path,
            old_nodes=len(old_nodes),
            new_nodes=len(new_nodes),
            old_edges=len(old_edges),
            new_edges=len(new_edges),
        )

        return self.cached_graph

    def _find_source_files(self, root: Path) -> list[Path]:
        """Find all source files in the project.

        Args:
            root: Root directory to search.

        Returns:
            List of paths to source files.
        """
        files: list[Path] = []

        for path in root.rglob("*"):
            # Skip ignored directories
            if any(part in self.IGNORE_DIRS for part in path.parts):
                continue

            # Skip hidden files/directories
            if any(part.startswith(".") and part not in {".pyi"} for part in path.parts):
                continue

            if path.is_file():
                suffix = path.suffix.lower()
                if suffix in self.PYTHON_EXTENSIONS | self.JS_EXTENSIONS:
                    files.append(path)

        return sorted(files)

    def get_cached_graph(self) -> ProjectGraph | None:
        """Get the cached project graph if available.

        Returns:
            Cached ProjectGraph or None.
        """
        return self.cached_graph

    def clear_cache(self) -> None:
        """Clear the cached graph and all tracking data."""
        self.cached_graph = None
        self.nx_graph = None
        self.queries = None
        self._nodes_by_file = {}
        self._edges_by_file = {}
        self._project_root = None
        logger.info("Cache cleared")

    def shutdown(self) -> None:
        """Shutdown the analyser and cleanup resources."""
        self.clear_cache()
        if self.js_parser:
            self.js_parser.stop()
        logger.info("Analyser shutdown complete")
