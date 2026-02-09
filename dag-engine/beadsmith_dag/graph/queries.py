"""Graph querying utilities for impact analysis."""

from collections import defaultdict
from typing import Any

import networkx as nx

from ..models import EdgeConfidence, ImpactReport


class GraphQueries:
    """Query utilities for dependency graph analysis."""

    def __init__(self, graph: nx.DiGraph) -> None:
        """Initialise with a NetworkX graph.

        Args:
            graph: NetworkX DiGraph to query.
        """
        self.graph = graph

    def get_callers(self, node_id: str) -> list[str]:
        """Get all nodes that call/reference the given node.

        Args:
            node_id: ID of the node to find callers for.

        Returns:
            List of node IDs that have edges to this node.
        """
        if node_id not in self.graph:
            return []
        return list(self.graph.predecessors(node_id))

    def get_callees(self, node_id: str) -> list[str]:
        """Get all nodes that the given node calls/references.

        Args:
            node_id: ID of the node to find callees for.

        Returns:
            List of node IDs that this node has edges to.
        """
        if node_id not in self.graph:
            return []
        return list(self.graph.successors(node_id))

    def get_impact(
        self,
        node_id: str,
        max_depth: int | None = None,
        min_confidence: str | None = None,
    ) -> ImpactReport:
        """Compute the impact of changes to a node.

        Traverses the graph in reverse (predecessors) to find all nodes
        that depend on the given node, directly or indirectly.

        Args:
            node_id: ID of the changed node.
            max_depth: Maximum traversal depth (None for unlimited).
            min_confidence: Minimum confidence level to follow edges.

        Returns:
            ImpactReport with affected files, functions, and suggested tests.
        """
        # Extract file path and optional function name
        if ":" in node_id:
            changed_file, changed_func = node_id.split(":", 1)
        else:
            changed_file = node_id
            changed_func = None

        # If node doesn't exist in graph, return minimal report
        if node_id not in self.graph:
            return ImpactReport(
                changed_file=changed_file,
                changed_function=changed_func,
            )

        # BFS to find all affected nodes
        affected_nodes: set[str] = set()
        visited: set[str] = set()
        queue: list[tuple[str, int]] = [(node_id, 0)]
        has_circular = False

        confidence_order = {"high": 3, "medium": 2, "low": 1, "unsafe": 0}
        min_level = confidence_order.get(min_confidence or "unsafe", 0)
        max_depth_reached = 0

        while queue:
            current, depth = queue.pop(0)

            if current in visited:
                # Detected a cycle
                has_circular = True
                continue

            visited.add(current)

            if max_depth is not None and depth > max_depth:
                continue

            max_depth_reached = max(max_depth_reached, depth)

            # Get all predecessors (nodes that depend on current)
            for pred in self.graph.predecessors(current):
                edge_data = self.graph.edges[pred, current]
                edge_confidence = edge_data.get("confidence", "medium")

                # Skip edges below confidence threshold
                if confidence_order.get(edge_confidence, 0) < min_level:
                    continue

                if pred not in visited:
                    affected_nodes.add(pred)
                    queue.append((pred, depth + 1))

        # Separate into files and functions
        affected_files: list[str] = []
        affected_functions: list[str] = []
        confidence_counts: dict[str, int] = defaultdict(int)

        for node in affected_nodes:
            # Count confidence levels of edges to this node
            for pred in self.graph.predecessors(node):
                if pred in affected_nodes or pred == node_id:
                    edge_data = self.graph.edges[pred, node]
                    conf = edge_data.get("confidence", "medium")
                    confidence_counts[conf] += 1

            if ":" in node:
                # It's a function/method/class
                file_part = node.split(":")[0]
                affected_functions.append(node)
                if file_part not in affected_files:
                    affected_files.append(file_part)
            else:
                # It's a file
                if node not in affected_files:
                    affected_files.append(node)

        # Find test files
        suggested_tests = [
            f for f in affected_files
            if "test" in f.lower() or f.endswith("_test.py") or f.startswith("test_")
        ]

        return ImpactReport(
            changed_file=changed_file,
            changed_function=changed_func,
            affected_files=sorted(affected_files),
            affected_functions=sorted(affected_functions),
            suggested_tests=sorted(suggested_tests),
            confidence_breakdown=dict(confidence_counts),
            impact_depth=max_depth_reached,
            has_circular_dependencies=has_circular,
        )

    def get_node_info(self, node_id: str) -> dict[str, Any] | None:
        """Get information about a specific node.

        Args:
            node_id: ID of the node.

        Returns:
            Dictionary of node attributes, or None if not found.
        """
        if node_id not in self.graph:
            return None
        return dict(self.graph.nodes[node_id])

    def get_edge_info(self, from_node: str, to_node: str) -> dict[str, Any] | None:
        """Get information about a specific edge.

        Args:
            from_node: Source node ID.
            to_node: Target node ID.

        Returns:
            Dictionary of edge attributes, or None if not found.
        """
        if not self.graph.has_edge(from_node, to_node):
            return None
        return dict(self.graph.edges[from_node, to_node])

    def find_cycles(self) -> list[list[str]]:
        """Find all cycles in the graph.

        Returns:
            List of cycles, where each cycle is a list of node IDs.
        """
        try:
            cycles = list(nx.simple_cycles(self.graph))
            return cycles
        except nx.NetworkXError:
            return []

    def get_subgraph(self, node_ids: list[str]) -> nx.DiGraph:
        """Get a subgraph containing only the specified nodes and edges between them.

        Args:
            node_ids: List of node IDs to include.

        Returns:
            NetworkX DiGraph subgraph.
        """
        return self.graph.subgraph(node_ids).copy()

    def get_reachable_from(self, node_id: str, direction: str = "forward") -> set[str]:
        """Get all nodes reachable from a starting node.

        Args:
            node_id: Starting node ID.
            direction: "forward" (successors) or "backward" (predecessors).

        Returns:
            Set of reachable node IDs.
        """
        if node_id not in self.graph:
            return set()

        if direction == "forward":
            return nx.descendants(self.graph, node_id)
        else:
            return nx.ancestors(self.graph, node_id)

    def get_shortest_path(self, from_node: str, to_node: str) -> list[str] | None:
        """Find shortest path between two nodes.

        Args:
            from_node: Source node ID.
            to_node: Target node ID.

        Returns:
            List of node IDs forming the path, or None if no path exists.
        """
        try:
            return nx.shortest_path(self.graph, from_node, to_node)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
