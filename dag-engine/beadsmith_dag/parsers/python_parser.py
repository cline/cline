"""Python AST-based code analyser.

Extracts symbols (classes, functions, methods) and dependencies
(imports, function calls, inheritance) from Python source files.
"""

import ast
from pathlib import Path
from typing import TYPE_CHECKING

import structlog

from ..models import EdgeConfidence, EdgeType, GraphEdge, GraphNode, NodeType

if TYPE_CHECKING:
    from collections.abc import Generator

logger = structlog.get_logger()


class PythonParser:
    """Parse Python files and extract symbols and dependencies."""

    def __init__(self) -> None:
        self.nodes: list[GraphNode] = []
        self.edges: list[GraphEdge] = []
        self.current_file: str = ""
        self.current_class: str | None = None
        self.current_function: str | None = None
        self.imports: dict[str, str] = {}  # alias -> fully qualified module path
        self.local_symbols: set[str] = set()  # symbols defined in current file

    def parse_file(self, file_path: Path) -> tuple[list[GraphNode], list[GraphEdge]]:
        """Parse a Python file and extract nodes and edges.

        Args:
            file_path: Path to the Python file to parse.

        Returns:
            Tuple of (nodes, edges) extracted from the file.
        """
        self.nodes = []
        self.edges = []
        self.current_file = str(file_path)
        self.current_class = None
        self.current_function = None
        self.imports = {}
        self.local_symbols = set()

        try:
            source = file_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError as e:
            logger.warning("Syntax error parsing file", file=str(file_path), error=str(e))
            return [], []
        except UnicodeDecodeError as e:
            logger.warning("Encoding error reading file", file=str(file_path), error=str(e))
            return [], []

        # Add file node
        self.nodes.append(
            GraphNode(
                id=self.current_file,
                type=NodeType.FILE,
                file_path=self.current_file,
                line_number=1,
                name=file_path.name,
            )
        )

        # First pass: collect imports and local symbol definitions
        self._collect_imports_and_symbols(tree)

        # Second pass: extract definitions and calls
        self._visit(tree)

        return self.nodes, self.edges

    def _collect_imports_and_symbols(self, tree: ast.Module) -> None:
        """Collect imports and local symbol definitions."""
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name
                    self.imports[name] = alias.name
                    # Add import edge from file to module
                    self.edges.append(
                        GraphEdge(
                            from_node=self.current_file,
                            to_node=alias.name,
                            edge_type=EdgeType.IMPORT,
                            confidence=EdgeConfidence.HIGH,
                            line_number=node.lineno,
                            label=f"import {alias.name}",
                        )
                    )

            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    name = alias.asname or alias.name
                    full_path = f"{module}.{alias.name}" if module else alias.name
                    self.imports[name] = full_path
                    # Add import edge
                    self.edges.append(
                        GraphEdge(
                            from_node=self.current_file,
                            to_node=module if module else alias.name,
                            edge_type=EdgeType.IMPORT,
                            confidence=EdgeConfidence.HIGH,
                            line_number=node.lineno,
                            label=f"from {module} import {alias.name}" if module else f"import {alias.name}",
                        )
                    )

            elif isinstance(node, ast.ClassDef):
                self.local_symbols.add(node.name)

            elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                self.local_symbols.add(node.name)

            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        self.local_symbols.add(target.id)

    def _visit(self, node: ast.AST) -> None:
        """Visit AST nodes recursively."""
        if isinstance(node, ast.ClassDef):
            self._handle_class(node)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            self._handle_function(node)
        elif isinstance(node, ast.Call):
            self._handle_call(node)

        for child in ast.iter_child_nodes(node):
            self._visit(child)

    def _handle_class(self, node: ast.ClassDef) -> None:
        """Handle class definition."""
        class_id = f"{self.current_file}:{node.name}"

        self.nodes.append(
            GraphNode(
                id=class_id,
                type=NodeType.CLASS,
                file_path=self.current_file,
                line_number=node.lineno,
                name=node.name,
                docstring=ast.get_docstring(node),
                end_line_number=node.end_lineno,
            )
        )

        # Track inheritance
        for base in node.bases:
            base_name = self._get_name(base)
            if base_name:
                self.edges.append(
                    GraphEdge(
                        from_node=class_id,
                        to_node=self._resolve_name(base_name),
                        edge_type=EdgeType.INHERIT,
                        confidence=self._get_confidence(base_name),
                        line_number=node.lineno,
                        label=f"inherits from {base_name}",
                    )
                )

        # Process methods with class context
        old_class = self.current_class
        self.current_class = node.name
        for child in node.body:
            self._visit(child)
        self.current_class = old_class

    def _handle_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        """Handle function/method definition."""
        if self.current_class:
            func_id = f"{self.current_file}:{self.current_class}.{node.name}"
            node_type = NodeType.METHOD
        else:
            func_id = f"{self.current_file}:{node.name}"
            node_type = NodeType.FUNCTION

        # Extract parameters
        params = self._extract_parameters(node)

        # Extract return type
        return_type = None
        if node.returns:
            return_type = ast.unparse(node.returns)

        self.nodes.append(
            GraphNode(
                id=func_id,
                type=node_type,
                file_path=self.current_file,
                line_number=node.lineno,
                name=node.name,
                docstring=ast.get_docstring(node),
                parameters=params,
                return_type=return_type,
                end_line_number=node.end_lineno,
            )
        )

        # Process function body with function context
        old_function = self.current_function
        self.current_function = node.name
        for child in node.body:
            self._visit(child)
        self.current_function = old_function

    def _handle_call(self, node: ast.Call) -> None:
        """Handle function call."""
        caller_id = self._get_current_scope_id()
        if not caller_id:
            return

        callee_name = self._get_name(node.func)
        if not callee_name:
            return

        # Skip common builtins that don't represent real dependencies
        if callee_name in {"print", "len", "str", "int", "float", "bool", "list", "dict", "set", "tuple", "range", "enumerate", "zip", "map", "filter", "sorted", "reversed", "min", "max", "sum", "any", "all", "isinstance", "issubclass", "hasattr", "getattr", "setattr", "delattr", "type", "id", "repr", "open", "super"}:
            return

        resolved_callee = self._resolve_name(callee_name)

        self.edges.append(
            GraphEdge(
                from_node=caller_id,
                to_node=resolved_callee,
                edge_type=EdgeType.CALL,
                confidence=self._get_confidence(callee_name),
                line_number=node.lineno,
                label=f"calls {callee_name}",
            )
        )

    def _extract_parameters(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
        """Extract parameter names and types from a function definition."""
        params = []

        # Regular args
        for arg in node.args.args:
            param = arg.arg
            if arg.annotation:
                param += f": {ast.unparse(arg.annotation)}"
            params.append(param)

        # *args
        if node.args.vararg:
            param = f"*{node.args.vararg.arg}"
            if node.args.vararg.annotation:
                param += f": {ast.unparse(node.args.vararg.annotation)}"
            params.append(param)

        # **kwargs
        if node.args.kwarg:
            param = f"**{node.args.kwarg.arg}"
            if node.args.kwarg.annotation:
                param += f": {ast.unparse(node.args.kwarg.annotation)}"
            params.append(param)

        return params

    def _get_name(self, node: ast.expr) -> str | None:
        """Extract name from AST expression node."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            value = self._get_name(node.value)
            if value:
                return f"{value}.{node.attr}"
            return node.attr
        elif isinstance(node, ast.Subscript):
            return self._get_name(node.value)
        elif isinstance(node, ast.Call):
            return self._get_name(node.func)
        return None

    def _get_current_scope_id(self) -> str | None:
        """Get the ID of the current function/method scope."""
        if self.current_function:
            if self.current_class:
                return f"{self.current_file}:{self.current_class}.{self.current_function}"
            return f"{self.current_file}:{self.current_function}"
        return None

    def _resolve_name(self, name: str) -> str:
        """Resolve a name to its fully qualified form if possible."""
        # Check if it's a direct import
        if name in self.imports:
            return self.imports[name]

        # Check if it's a dotted name with first part imported
        if "." in name:
            parts = name.split(".")
            if parts[0] in self.imports:
                return f"{self.imports[parts[0]]}.{'.'.join(parts[1:])}"

        # Check if it's a local symbol
        if name in self.local_symbols:
            return f"{self.current_file}:{name}"

        # Return as-is (external reference)
        return name

    def _get_confidence(self, name: str) -> EdgeConfidence:
        """Determine confidence level for a reference."""
        # High confidence: known import or local symbol
        if name in self.imports or name in self.local_symbols:
            return EdgeConfidence.HIGH

        # Check dotted names
        if "." in name:
            first_part = name.split(".")[0]
            if first_part in self.imports or first_part in self.local_symbols:
                return EdgeConfidence.HIGH

        # Check for dynamic patterns
        if "getattr" in name or "[" in name or "eval" in name or "exec" in name:
            return EdgeConfidence.UNSAFE

        # Unknown external reference - medium confidence
        return EdgeConfidence.MEDIUM
