# Language Parser Template

Use this template when adding support for a new language to the DAG engine.

## File Structure

Create `dag-engine/cline_dag/parsers/{language}_parser.py`:

```python
"""Parser for {Language} files."""

from pathlib import Path
import structlog

from ..models import EdgeConfidence, GraphEdge, GraphNode, NodeType, AnalysisWarning

logger = structlog.get_logger()


class {Language}Parser:
    """Parse {Language} files and extract symbols and dependencies."""

    def __init__(self) -> None:
        self.nodes: list[GraphNode] = []
        self.edges: list[GraphEdge] = []
        self.current_file: str = ""
        self.imports: dict[str, str] = {}  # alias -> module path

    def parse_file(
        self, file_path: Path
    ) -> tuple[list[GraphNode], list[GraphEdge], list[AnalysisWarning]]:
        """Parse a file and extract nodes and edges.

        Args:
            file_path: Absolute path to the source file

        Returns:
            Tuple of (nodes, edges, warnings)
        """
        self.nodes = []
        self.edges = []
        self.current_file = str(file_path)
        self.imports = {}
        warnings = []

        try:
            source = file_path.read_text(encoding="utf-8")
            # Parse source into AST
            tree = self._parse_source(source, file_path)
        except (SyntaxError, UnicodeDecodeError) as e:
            logger.warning("Failed to parse file", file=str(file_path), error=str(e))
            warnings.append(AnalysisWarning(
                type="parse_error",
                file=str(file_path),
                line=1,
                description=str(e),
                severity="high",
            ))
            return [], [], warnings

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

        # Extract symbols
        self._extract_imports(tree)
        self._extract_definitions(tree)
        self._extract_calls(tree)

        return self.nodes, self.edges, warnings

    def _parse_source(self, source: str, file_path: Path):
        """Parse source code into AST.

        Implement using language-specific parser.
        """
        raise NotImplementedError

    def _extract_imports(self, tree) -> None:
        """Extract import statements and create import edges."""
        raise NotImplementedError

    def _extract_definitions(self, tree) -> None:
        """Extract class/function definitions and create nodes."""
        raise NotImplementedError

    def _extract_calls(self, tree) -> None:
        """Extract function calls and create call edges."""
        raise NotImplementedError

    def _get_confidence(self, name: str) -> EdgeConfidence:
        """Determine confidence level for a reference.

        Guidelines:
        - HIGH: Known import, type-annotated, static reference
        - MEDIUM: Inferred type, pattern-matched
        - LOW: Duck-typed, loosely matched
        - UNSAFE: Dynamic access, reflection, eval
        """
        if name in self.imports:
            return EdgeConfidence.HIGH

        # Add language-specific heuristics
        return EdgeConfidence.MEDIUM
```

## Registration

In `dag-engine/cline_dag/analyser.py`:

```python
# Import at top
from .parsers.{language}_parser import {Language}Parser

# In __init__
self.{language}_parser = {Language}Parser()

# In analyse_project loop
elif suffix == ".{ext}":
    nodes, edges, warnings = self.{language}_parser.parse_file(file_path)
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    all_warnings.extend(warnings)
```

## File Extension Registration

In `_find_source_files()`:

```python
if suffix in (".py", ".js", ".jsx", ".ts", ".tsx", ".{ext}"):
    files.append(path)
```

## Testing

Create `dag-engine/tests/test_{language}_parser.py`:

```python
"""Tests for the {Language} parser."""

from pathlib import Path
import pytest
from cline_dag.parsers.{language}_parser import {Language}Parser
from cline_dag.models import NodeType, EdgeConfidence


@pytest.fixture
def parser():
    return {Language}Parser()


@pytest.fixture
def sample_file(tmp_path: Path) -> Path:
    file_path = tmp_path / "sample.{ext}"
    file_path.write_text('''
    # Sample {Language} code for testing
    ''')
    return file_path


class Test{Language}Parser:
    def test_parses_file(self, parser, sample_file: Path) -> None:
        nodes, edges, warnings = parser.parse_file(sample_file)
        assert len(nodes) >= 1  # At least the file node
        assert len(warnings) == 0

    def test_extracts_imports(self, parser, sample_file: Path) -> None:
        nodes, edges, warnings = parser.parse_file(sample_file)
        import_edges = [e for e in edges if e.edge_type == "import"]
        # Assert expected imports

    def test_extracts_definitions(self, parser, sample_file: Path) -> None:
        nodes, edges, warnings = parser.parse_file(sample_file)
        # Assert expected class/function nodes

    def test_handles_syntax_errors(self, parser, tmp_path: Path) -> None:
        bad_file = tmp_path / "bad.{ext}"
        bad_file.write_text("this is not valid syntax {{{")
        nodes, edges, warnings = parser.parse_file(bad_file)
        assert len(warnings) > 0
        assert warnings[0].type == "parse_error"
```
