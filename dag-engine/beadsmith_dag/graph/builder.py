"""Build NetworkX graph from parsed nodes and edges."""

import networkx as nx

from ..models import GraphEdge, GraphNode


class GraphBuilder:
    """Build and manage NetworkX dependency graph."""

    def build(self, nodes: list[GraphNode], edges: list[GraphEdge]) -> nx.DiGraph:
        """Build a NetworkX directed graph from nodes and edges.

        Args:
            nodes: List of GraphNode objects.
            edges: List of GraphEdge objects.

        Returns:
            NetworkX DiGraph with all nodes and edges.
        """
        G: nx.DiGraph = nx.DiGraph()

        # Add nodes with attributes
        for node in nodes:
            G.add_node(
                node.id,
                type=node.type.value,
                file_path=node.file_path,
                line_number=node.line_number,
                name=node.name,
                docstring=node.docstring,
                parameters=node.parameters,
                return_type=node.return_type,
            )

        # Add edges with attributes
        for edge in edges:
            G.add_edge(
                edge.from_node,
                edge.to_node,
                edge_type=edge.edge_type.value,
                confidence=edge.confidence.value,
                line_number=edge.line_number,
                label=edge.label,
            )

        return G

    def merge_graphs(self, graphs: list[nx.DiGraph]) -> nx.DiGraph:
        """Merge multiple graphs into one.

        Args:
            graphs: List of NetworkX DiGraphs to merge.

        Returns:
            Merged NetworkX DiGraph.
        """
        merged: nx.DiGraph = nx.DiGraph()

        for G in graphs:
            # Add all nodes
            for node_id, attrs in G.nodes(data=True):
                if node_id not in merged:
                    merged.add_node(node_id, **attrs)

            # Add all edges
            for from_node, to_node, attrs in G.edges(data=True):
                if not merged.has_edge(from_node, to_node):
                    merged.add_edge(from_node, to_node, **attrs)

        return merged

    def filter_by_confidence(
        self, G: nx.DiGraph, min_confidence: str
    ) -> nx.DiGraph:
        """Filter graph to only include edges at or above a confidence level.

        Args:
            G: NetworkX DiGraph to filter.
            min_confidence: Minimum confidence level ("high", "medium", "low", "unsafe").

        Returns:
            Filtered NetworkX DiGraph.
        """
        confidence_order = {"high": 3, "medium": 2, "low": 1, "unsafe": 0}
        min_level = confidence_order.get(min_confidence, 0)

        filtered: nx.DiGraph = nx.DiGraph()

        # Copy all nodes
        filtered.add_nodes_from(G.nodes(data=True))

        # Copy only edges meeting confidence threshold
        for from_node, to_node, attrs in G.edges(data=True):
            edge_confidence = attrs.get("confidence", "medium")
            if confidence_order.get(edge_confidence, 0) >= min_level:
                filtered.add_edge(from_node, to_node, **attrs)

        return filtered
