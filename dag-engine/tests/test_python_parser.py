"""Tests for the Python parser."""

from pathlib import Path

import pytest

from beadsmith_dag.models import EdgeType, NodeType
from beadsmith_dag.parsers.python_parser import PythonParser


class TestPythonParser:
    """Test suite for PythonParser."""

    def test_parse_simple_file(self, sample_python_file: Path) -> None:
        """Test parsing a simple Python file."""
        parser = PythonParser()
        nodes, edges = parser.parse_file(sample_python_file)

        # Should find file, class, and functions
        assert len(nodes) >= 4

        # Check for expected nodes
        node_names = [n.name for n in nodes]
        assert "sample.py" in node_names
        assert "User" in node_names
        assert "greet" in node_names
        assert "process_user" in node_names
        assert "main" in node_names

    def test_extracts_class_with_docstring(self, sample_python_file: Path) -> None:
        """Test that class docstrings are extracted."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        class_node = next((n for n in nodes if n.name == "User"), None)
        assert class_node is not None
        assert class_node.type == NodeType.CLASS
        assert class_node.docstring == "A user class."

    def test_extracts_method(self, sample_python_file: Path) -> None:
        """Test that methods are identified correctly."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        method_node = next((n for n in nodes if n.name == "greet"), None)
        assert method_node is not None
        assert method_node.type == NodeType.METHOD
        assert method_node.docstring == "Return a greeting."
        assert method_node.return_type == "str"

    def test_extracts_function(self, sample_python_file: Path) -> None:
        """Test that standalone functions are identified correctly."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        func_node = next((n for n in nodes if n.name == "process_user"), None)
        assert func_node is not None
        assert func_node.type == NodeType.FUNCTION
        assert "user: User" in func_node.parameters

    def test_extracts_imports(self, sample_python_file: Path) -> None:
        """Test that import edges are created."""
        parser = PythonParser()
        _, edges = parser.parse_file(sample_python_file)

        import_edges = [e for e in edges if e.edge_type == EdgeType.IMPORT]
        assert len(import_edges) >= 1

        # Should have import from typing
        typing_import = next(
            (e for e in import_edges if "typing" in e.to_node), None
        )
        assert typing_import is not None

    def test_file_node_is_created(self, sample_python_file: Path) -> None:
        """Test that a file node is always created."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        file_node = next((n for n in nodes if n.type == NodeType.FILE), None)
        assert file_node is not None
        assert file_node.name == "sample.py"
        assert file_node.line_number == 1

    def test_handles_syntax_error(self, temp_project: Path) -> None:
        """Test that syntax errors are handled gracefully."""
        bad_file = temp_project / "bad.py"
        bad_file.write_text("def foo(:\n    pass")  # Syntax error

        parser = PythonParser()
        nodes, edges = parser.parse_file(bad_file)

        # Should return empty lists, not raise
        assert nodes == []
        assert edges == []

    def test_handles_encoding_error(self, temp_project: Path) -> None:
        """Test that encoding errors are handled gracefully."""
        bad_file = temp_project / "bad.py"
        bad_file.write_bytes(b"\xff\xfe invalid utf-8")

        parser = PythonParser()
        nodes, edges = parser.parse_file(bad_file)

        # Should return empty lists, not raise
        assert nodes == []
        assert edges == []


class TestMultiFileProject:
    """Test parsing multiple files and their relationships."""

    def test_inheritance_edges(self, multi_file_project: Path) -> None:
        """Test that inheritance edges are created."""
        parser = PythonParser()
        models_file = multi_file_project / "models.py"
        nodes, edges = parser.parse_file(models_file)

        # Find Admin class
        admin_node = next((n for n in nodes if n.name == "Admin"), None)
        assert admin_node is not None
        assert admin_node.type == NodeType.CLASS

        # Find inheritance edge
        inherit_edges = [e for e in edges if e.edge_type == EdgeType.INHERIT]
        admin_inherits = next(
            (e for e in inherit_edges if "Admin" in e.from_node), None
        )
        assert admin_inherits is not None
        assert "User" in admin_inherits.to_node

    def test_import_edges_cross_file(self, multi_file_project: Path) -> None:
        """Test that imports from other files create edges."""
        parser = PythonParser()
        services_file = multi_file_project / "services.py"
        _, edges = parser.parse_file(services_file)

        import_edges = [e for e in edges if e.edge_type == EdgeType.IMPORT]

        # Should have import from models
        models_import = next(
            (e for e in import_edges if "models" in e.to_node), None
        )
        assert models_import is not None
