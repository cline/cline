"""Tests for the JavaScript/TypeScript parser."""

from pathlib import Path

import pytest

from beadsmith_dag.models import NodeType, EdgeType
from beadsmith_dag.parsers.js_parser import JSParser


@pytest.fixture
def js_parser():
    """Create a JS parser instance."""
    parser = JSParser()
    try:
        parser.start()
        yield parser
    finally:
        parser.stop()


@pytest.fixture
def sample_ts_file(tmp_path: Path) -> Path:
    """Create a sample TypeScript file."""
    file_path = tmp_path / "sample.ts"
    file_path.write_text('''
import { User } from './models';
import type { Config } from './types';

export class UserService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async getUser(id: string): Promise<User> {
    return fetch(`/users/${id}`).then(r => r.json());
  }
}

export function createService(config: Config): UserService {
  return new UserService(config);
}
''')
    return file_path


@pytest.fixture
def sample_jsx_file(tmp_path: Path) -> Path:
    """Create a sample JSX file."""
    file_path = tmp_path / "Component.jsx"
    file_path.write_text('''
import React from 'react';
import { Button } from './Button';
import { useUser } from './hooks';

export function UserProfile({ userId }) {
  const user = useUser(userId);

  return (
    <div className="profile">
      <h1>{user.name}</h1>
      <Button onClick={() => console.log('clicked')}>
        Edit Profile
      </Button>
    </div>
  );
}
''')
    return file_path


class TestJSParser:
    """Tests for JS/TS parser."""

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_parses_typescript_file(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        """Test parsing a TypeScript file."""
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        # Should have at least: file, class, methods, function
        assert len(nodes) >= 4

        node_names = [n.name for n in nodes]
        assert "sample.ts" in node_names
        assert "UserService" in node_names
        assert "createService" in node_names

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_extracts_imports(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        """Test that imports are extracted as edges."""
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        import_edges = [e for e in edges if e.edge_type == EdgeType.IMPORT]
        assert len(import_edges) >= 2  # Two import statements

        import_sources = [e.to_node for e in import_edges]
        assert "./models" in import_sources
        assert "./types" in import_sources

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_extracts_class_methods(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        """Test that class methods are extracted."""
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        method_nodes = [n for n in nodes if n.type == NodeType.METHOD]
        assert len(method_nodes) >= 2  # constructor, getUser

        method_names = [n.name for n in method_nodes]
        assert "constructor" in method_names
        assert "getUser" in method_names

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_extracts_return_types(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        """Test that return types are extracted from TypeScript."""
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        get_user = next((n for n in nodes if n.name == "getUser"), None)
        assert get_user is not None
        assert get_user.return_type is not None
        assert "Promise" in get_user.return_type

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_extracts_function_calls(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        """Test that function calls create edges."""
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        call_edges = [e for e in edges if e.edge_type == EdgeType.CALL]
        # createService calls UserService constructor
        assert any("UserService" in e.to_node for e in call_edges)

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_parses_jsx_components(self, js_parser: JSParser, sample_jsx_file: Path) -> None:
        """Test parsing JSX and component usage."""
        nodes, edges, warnings = js_parser.parse_file(sample_jsx_file)

        # Should find the UserProfile function
        node_names = [n.name for n in nodes]
        assert "UserProfile" in node_names

        # Should find Button component usage
        call_edges = [e for e in edges if e.edge_type == EdgeType.CALL]
        button_calls = [e for e in call_edges if "Button" in e.to_node]
        assert len(button_calls) >= 1

    @pytest.mark.skipif(
        not Path("/usr/bin/node").exists() and not Path("C:/Program Files/nodejs/node.exe").exists(),
        reason="Node.js not installed"
    )
    def test_inheritance_edges(self, js_parser: JSParser, tmp_path: Path) -> None:
        """Test that class inheritance creates edges."""
        file_path = tmp_path / "derived.ts"
        file_path.write_text('''
import { BaseClass } from './base';

export class DerivedClass extends BaseClass {
  doSomething() {
    return super.doSomething();
  }
}
''')

        nodes, edges, warnings = js_parser.parse_file(file_path)

        inherit_edges = [e for e in edges if e.edge_type == EdgeType.INHERIT]
        assert len(inherit_edges) >= 1
        assert any("BaseClass" in e.to_node for e in inherit_edges)
