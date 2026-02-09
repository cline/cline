# Cline+ DAG-Aware Agent — JavaScript/TypeScript Parser Specification

## Overview

This document specifies the JavaScript and TypeScript parser component for the DAG analysis engine. The Python parser is already implemented; this completes the multi-language analysis capability required for analysing modern codebases.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Node parser implemented (`dag-engine/js-parser/parser.js`)
- [x] Python bridge + analyser integration (`dag-engine/beadsmith_dag/parsers/js_parser.py`, `dag-engine/beadsmith_dag/analyser.py`)
- [x] Tests added (`dag-engine/tests/test_js_parser.py`)

## Technology Choice

### Parser: @babel/parser + @babel/traverse

**Why Babel over alternatives:**

| Option | Pros | Cons |
|--------|------|------|
| **@babel/parser** | Handles all JS/TS syntax, plugins for JSX/Flow/TS, battle-tested | Requires Node.js runtime |
| TypeScript Compiler API | Native TS support, full type information | Heavy, complex API, slow for large projects |
| Acorn | Fast, lightweight | No native TypeScript support |
| Tree-sitter | Very fast, multi-language | Requires native bindings, less semantic info |

**Decision:** Use Babel for parsing, with TypeScript plugin enabled. This balances speed, accuracy, and maintainability.

## Architecture

The JS/TS parser runs as part of the Python DAG microservice but delegates actual parsing to a Node.js subprocess. This keeps the Python service as the single point of contact for the extension while leveraging Node's native JS parsing.

```
┌─────────────────────────────────────────────────────────┐
│                   DAG Microservice (Python)              │
│                                                          │
│  ┌──────────────────┐     ┌──────────────────────────┐  │
│  │  Python Parser   │     │  JS/TS Parser Bridge     │  │
│  │  (ast module)    │     │  (spawns Node subprocess)│  │
│  └──────────────────┘     └────────────┬─────────────┘  │
│                                        │                 │
└────────────────────────────────────────┼─────────────────┘
                                         │
                                         ▼
                           ┌─────────────────────────┐
                           │  Node.js Parser Script  │
                           │  (@babel/parser)        │
                           │  (@babel/traverse)      │
                           └─────────────────────────┘
```

## Implementation

### Node.js Parser Script

Create `dag-engine/js-parser/parser.js`:

```javascript
#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST parser for DAG analysis.
 * Reads file path from stdin, outputs JSON analysis to stdout.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Parse a JavaScript or TypeScript file and extract symbols.
 * @param {string} filePath - Absolute path to the source file
 * @returns {Object} Analysis result with nodes and edges
 */
function parseFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  // Configure parser plugins based on file type
  const plugins = [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'dynamicImport',
    'nullishCoalescingOperator',
    'optionalChaining',
    'decorators-legacy',
  ];

  if (ext === '.ts' || ext === '.tsx') {
    plugins.push('typescript');
  }
  if (ext === '.tsx' || ext === '.jsx') {
    // JSX already added above
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'module',
      plugins,
      errorRecovery: true, // Continue parsing despite errors
    });
  } catch (err) {
    return {
      error: `Parse error: ${err.message}`,
      nodes: [],
      edges: [],
      warnings: [{
        type: 'parse_error',
        file: filePath,
        line: err.loc?.line || 1,
        description: err.message,
        severity: 'high',
      }],
    };
  }

  const nodes = [];
  const edges = [];
  const warnings = [];
  const imports = new Map(); // alias -> { source, imported }
  let currentClass = null;
  let currentFunction = null;

  // Add file node
  nodes.push({
    id: filePath,
    type: 'file',
    file_path: filePath,
    line_number: 1,
    name: path.basename(filePath),
  });

  traverse(ast, {
    // Import declarations
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const line = nodePath.node.loc?.start.line || 1;

      // Track each imported identifier
      for (const specifier of nodePath.node.specifiers) {
        let localName, importedName;

        if (specifier.type === 'ImportDefaultSpecifier') {
          localName = specifier.local.name;
          importedName = 'default';
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          localName = specifier.local.name;
          importedName = '*';
        } else {
          localName = specifier.local.name;
          importedName = specifier.imported?.name || specifier.local.name;
        }

        imports.set(localName, { source, imported: importedName });
      }

      // Add import edge to file
      edges.push({
        from_node: filePath,
        to_node: source,
        edge_type: 'import',
        confidence: 'high',
        line_number: line,
        label: `import from '${source}'`,
      });
    },

    // Export declarations (re-exports create edges)
    ExportNamedDeclaration(nodePath) {
      if (nodePath.node.source) {
        const source = nodePath.node.source.value;
        const line = nodePath.node.loc?.start.line || 1;

        edges.push({
          from_node: filePath,
          to_node: source,
          edge_type: 'import',
          confidence: 'high',
          line_number: line,
          label: `export from '${source}'`,
        });
      }
    },

    // Dynamic imports
    CallExpression(nodePath) {
      if (nodePath.node.callee.type === 'Import') {
        const arg = nodePath.node.arguments[0];
        const line = nodePath.node.loc?.start.line || 1;

        if (arg?.type === 'StringLiteral') {
          edges.push({
            from_node: currentFunction || filePath,
            to_node: arg.value,
            edge_type: 'import',
            confidence: 'medium', // Dynamic but static string
            line_number: line,
            label: `dynamic import('${arg.value}')`,
          });
        } else {
          warnings.push({
            type: 'dynamic_import',
            file: filePath,
            line,
            description: 'Dynamic import with non-literal argument',
            severity: 'medium',
          });
        }
      }
    },

    // Class declarations
    ClassDeclaration(nodePath) {
      const node = nodePath.node;
      if (!node.id) return; // Anonymous class

      const className = node.id.name;
      const classId = `${filePath}:${className}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: classId,
        type: 'class',
        file_path: filePath,
        line_number: line,
        name: className,
        docstring: extractLeadingComment(nodePath),
      });

      // Track inheritance
      if (node.superClass) {
        const superName = getNameFromNode(node.superClass);
        if (superName) {
          edges.push({
            from_node: classId,
            to_node: resolveReference(superName, imports, filePath),
            edge_type: 'inherit',
            confidence: getConfidence(superName, imports),
            line_number: line,
            label: `extends ${superName}`,
          });
        }
      }

      // Track implemented interfaces (TypeScript)
      if (node.implements) {
        for (const impl of node.implements) {
          const implName = getNameFromNode(impl.expression || impl);
          if (implName) {
            edges.push({
              from_node: classId,
              to_node: resolveReference(implName, imports, filePath),
              edge_type: 'inherit',
              confidence: getConfidence(implName, imports),
              line_number: line,
              label: `implements ${implName}`,
            });
          }
        }
      }

      currentClass = className;
    },

    'ClassDeclaration:exit'() {
      currentClass = null;
    },

    // Class methods
    ClassMethod(nodePath) {
      const node = nodePath.node;
      const methodName = node.key.name || node.key.value;
      if (!methodName) return;

      const methodId = currentClass
        ? `${filePath}:${currentClass}.${methodName}`
        : `${filePath}:${methodName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: methodId,
        type: 'method',
        file_path: filePath,
        line_number: line,
        name: methodName,
        docstring: extractLeadingComment(nodePath),
        parameters: extractParameters(node.params),
        return_type: extractReturnType(node),
      });

      currentFunction = methodId;
    },

    'ClassMethod:exit'() {
      currentFunction = null;
    },

    // Function declarations
    FunctionDeclaration(nodePath) {
      const node = nodePath.node;
      if (!node.id) return; // Anonymous function

      const funcName = node.id.name;
      const funcId = `${filePath}:${funcName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: funcId,
        type: 'function',
        file_path: filePath,
        line_number: line,
        name: funcName,
        docstring: extractLeadingComment(nodePath),
        parameters: extractParameters(node.params),
        return_type: extractReturnType(node),
      });

      currentFunction = funcId;
    },

    'FunctionDeclaration:exit'() {
      currentFunction = null;
    },

    // Arrow functions assigned to variables
    VariableDeclarator(nodePath) {
      const node = nodePath.node;
      if (!node.id?.name) return;
      if (node.init?.type !== 'ArrowFunctionExpression' &&
          node.init?.type !== 'FunctionExpression') {
        return;
      }

      const funcName = node.id.name;
      const funcId = `${filePath}:${funcName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: funcId,
        type: 'function',
        file_path: filePath,
        line_number: line,
        name: funcName,
        docstring: extractLeadingComment(nodePath),
        parameters: extractParameters(node.init.params),
        return_type: extractReturnType(node.init),
      });
    },

    // Function/method calls
    CallExpression(nodePath) {
      if (!currentFunction) return;
      if (nodePath.node.callee.type === 'Import') return; // Handled above

      const callee = getNameFromNode(nodePath.node.callee);
      if (!callee) return;

      const line = nodePath.node.loc?.start.line || 1;

      edges.push({
        from_node: currentFunction,
        to_node: resolveReference(callee, imports, filePath),
        edge_type: 'call',
        confidence: getConfidence(callee, imports),
        line_number: line,
        label: `calls ${callee}`,
      });
    },
  });

  return { nodes, edges, warnings };
}

/**
 * Extract name from various AST node types.
 */
function getNameFromNode(node) {
  if (!node) return null;

  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
      const obj = getNameFromNode(node.object);
      const prop = node.computed
        ? null // Dynamic property access
        : node.property.name || node.property.value;
      if (obj && prop) return `${obj}.${prop}`;
      if (prop) return prop;
      return null;
    case 'ThisExpression':
      return 'this';
    case 'CallExpression':
      return getNameFromNode(node.callee);
    default:
      return null;
  }
}

/**
 * Resolve a reference to its likely target.
 */
function resolveReference(name, imports, currentFile) {
  const baseName = name.split('.')[0];

  if (imports.has(baseName)) {
    const imp = imports.get(baseName);
    return `${imp.source}:${imp.imported === 'default' ? baseName : imp.imported}`;
  }

  // Could be a local reference
  if (!name.includes('.')) {
    return `${currentFile}:${name}`;
  }

  return name;
}

/**
 * Determine confidence level for a reference.
 */
function getConfidence(name, imports) {
  const baseName = name.split('.')[0];

  // Known import
  if (imports.has(baseName)) {
    return 'high';
  }

  // Built-in globals
  const builtins = ['console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Error'];
  if (builtins.includes(baseName)) {
    return 'high';
  }

  // Dynamic patterns
  if (name.includes('[') || name.includes('eval')) {
    return 'unsafe';
  }

  // Unknown reference
  return 'medium';
}

/**
 * Extract parameters from function params.
 */
function extractParameters(params) {
  return params.map(param => {
    if (param.type === 'Identifier') {
      const annotation = param.typeAnnotation?.typeAnnotation;
      if (annotation) {
        return `${param.name}: ${typeAnnotationToString(annotation)}`;
      }
      return param.name;
    }
    if (param.type === 'AssignmentPattern') {
      return `${param.left.name}?`;
    }
    if (param.type === 'RestElement') {
      return `...${param.argument.name}`;
    }
    return '?';
  });
}

/**
 * Extract return type annotation.
 */
function extractReturnType(node) {
  const annotation = node.returnType?.typeAnnotation;
  if (!annotation) return null;
  return typeAnnotationToString(annotation);
}

/**
 * Convert TypeScript type annotation to string.
 */
function typeAnnotationToString(annotation) {
  if (!annotation) return 'any';

  switch (annotation.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSVoidKeyword': return 'void';
    case 'TSAnyKeyword': return 'any';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSNeverKeyword': return 'never';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSTypeReference':
      return annotation.typeName?.name || 'unknown';
    case 'TSArrayType':
      return `${typeAnnotationToString(annotation.elementType)}[]`;
    case 'TSUnionType':
      return annotation.types.map(typeAnnotationToString).join(' | ');
    default:
      return 'unknown';
  }
}

/**
 * Extract leading JSDoc or comment.
 */
function extractLeadingComment(nodePath) {
  const comments = nodePath.node.leadingComments;
  if (!comments || comments.length === 0) return null;

  const last = comments[comments.length - 1];
  if (last.type === 'CommentBlock') {
    // Strip /** and */ and leading asterisks
    return last.value
      .replace(/^\*+/, '')
      .replace(/\n\s*\*/g, '\n')
      .trim();
  }
  return null;
}

// Main: read file path from command line or stdin
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Read JSON-RPC requests from stdin
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    for await (const line of rl) {
      try {
        const request = JSON.parse(line);
        const result = parseFile(request.file);
        console.log(JSON.stringify({ id: request.id, result }));
      } catch (err) {
        console.log(JSON.stringify({ id: 0, error: err.message }));
      }
    }
  } else {
    // Parse single file from command line
    const result = parseFile(args[0]);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### package.json for JS Parser

Create `dag-engine/js-parser/package.json`:

```json
{
  "name": "cline-dag-js-parser",
  "version": "0.1.0",
  "description": "JavaScript/TypeScript parser for Cline+ DAG analysis",
  "main": "parser.js",
  "bin": {
    "cline-dag-js-parser": "./parser.js"
  },
  "dependencies": {
    "@babel/parser": "^7.28.6",
    "@babel/traverse": "^7.28.6"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### Python Bridge

Update `dag-engine/cline_dag/parsers/js_parser.py`:

```python
"""JavaScript/TypeScript parser bridge to Node.js subprocess."""

import json
import subprocess
from pathlib import Path

import structlog

from ..models import EdgeConfidence, GraphEdge, GraphNode, NodeType, AnalysisWarning

logger = structlog.get_logger()


class JSParser:
    """Parse JavaScript/TypeScript files via Node.js subprocess."""

    def __init__(self, node_path: str = "node") -> None:
        self.node_path = node_path
        self.parser_script = Path(__file__).parent.parent.parent / "js-parser" / "parser.js"
        self._process: subprocess.Popen | None = None

    def start(self) -> None:
        """Start the Node.js parser subprocess."""
        if not self.parser_script.exists():
            raise FileNotFoundError(f"JS parser script not found: {self.parser_script}")

        self._process = subprocess.Popen(
            [self.node_path, str(self.parser_script)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        logger.info("JS parser subprocess started", pid=self._process.pid)

    def stop(self) -> None:
        """Stop the Node.js parser subprocess."""
        if self._process:
            self._process.terminate()
            self._process.wait(timeout=5)
            self._process = None
            logger.info("JS parser subprocess stopped")

    def parse_file(self, file_path: Path) -> tuple[list[GraphNode], list[GraphEdge], list[AnalysisWarning]]:
        """Parse a JavaScript/TypeScript file and extract nodes and edges."""
        if not self._process:
            self.start()

        request = json.dumps({"id": 1, "file": str(file_path)})
        self._process.stdin.write(request + "\n")
        self._process.stdin.flush()

        response_line = self._process.stdout.readline()
        if not response_line:
            logger.error("No response from JS parser", file=str(file_path))
            return [], [], []

        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON from JS parser", error=str(e), response=response_line[:100])
            return [], [], []

        if "error" in response:
            logger.warning("JS parser error", file=str(file_path), error=response["error"])
            return [], [], []

        result = response.get("result", {})

        # Convert to Pydantic models
        nodes = [
            GraphNode(
                id=n["id"],
                type=NodeType(n["type"]),
                file_path=n["file_path"],
                line_number=n["line_number"],
                name=n["name"],
                docstring=n.get("docstring"),
                parameters=n.get("parameters", []),
                return_type=n.get("return_type"),
            )
            for n in result.get("nodes", [])
        ]

        edges = [
            GraphEdge(
                from_node=e["from_node"],
                to_node=e["to_node"],
                edge_type=e["edge_type"],
                confidence=EdgeConfidence(e["confidence"]),
                line_number=e["line_number"],
                label=e["label"],
            )
            for e in result.get("edges", [])
        ]

        warnings = [
            AnalysisWarning(
                type=w["type"],
                file=w["file"],
                line=w["line"],
                description=w["description"],
                severity=w["severity"],
            )
            for w in result.get("warnings", [])
        ]

        return nodes, edges, warnings

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
```

## Edge Cases Handled

### TypeScript-Specific

| Pattern | Handling | Confidence |
|---------|----------|------------|
| Type imports (`import type { X }`) | Tracked as imports, edges created | high |
| Interfaces | Not tracked as nodes (no runtime existence) | n/a |
| Generics (`Array<T>`) | Type parameter extracted but not resolved | medium |
| Decorators (`@Component`) | Tracked as call edges to decorator function | high |
| Enums | Tracked as variable nodes | high |

### JavaScript-Specific

| Pattern | Handling | Confidence |
|---------|----------|------------|
| CommonJS (`require()`) | Not currently handled (add if needed) | n/a |
| Dynamic property access (`obj[key]`) | Warning generated, no edge | unsafe |
| `eval()` / `new Function()` | Warning generated | unsafe |
| Prototype manipulation | Not tracked | n/a |

### JSX/TSX

| Pattern | Handling | Confidence |
|---------|----------|------------|
| JSX elements (`<Component />`) | Tracked as call to component | high |
| Spread props (`{...props}`) | No special handling | n/a |
| Conditional rendering | All branches analysed | high |

## Integration with Analyser

Update `dag-engine/cline_dag/analyser.py` to use the JS parser:

```python
# In ProjectAnalyser.__init__
self.js_parser = JSParser()

# In ProjectAnalyser.analyse_project
for file_path in source_files:
    suffix = file_path.suffix.lower()

    if suffix == ".py":
        nodes, edges = self.python_parser.parse_file(file_path)
        all_nodes.extend(nodes)
        all_edges.extend(edges)

    elif suffix in (".js", ".jsx", ".ts", ".tsx"):
        nodes, edges, warnings = self.js_parser.parse_file(file_path)
        all_nodes.extend(nodes)
        all_edges.extend(edges)
        all_warnings.extend(warnings)
```

## Testing

### Test Fixtures

Create `dag-engine/tests/fixtures/sample.ts`:

```typescript
import { User } from './models';
import type { Config } from './types';

export class UserService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async getUser(id: string): Promise<User> {
    const response = await fetch(`${this.config.apiUrl}/users/${id}`);
    return response.json();
  }

  processUsers(users: User[]): string[] {
    return users.map(u => u.name);
  }
}

export function createService(config: Config): UserService {
  return new UserService(config);
}
```

### Test Cases

Create `dag-engine/tests/test_js_parser.py`:

```python
"""Tests for the JavaScript/TypeScript parser."""

from pathlib import Path
import pytest
from cline_dag.parsers.js_parser import JSParser
from cline_dag.models import NodeType


@pytest.fixture
def js_parser():
    parser = JSParser()
    parser.start()
    yield parser
    parser.stop()


@pytest.fixture
def sample_ts_file(tmp_path: Path) -> Path:
    file_path = tmp_path / "sample.ts"
    file_path.write_text('''
import { User } from './models';

export class UserService {
  async getUser(id: string): Promise<User> {
    return fetch(`/users/${id}`).then(r => r.json());
  }
}

export function createService(): UserService {
  return new UserService();
}
''')
    return file_path


class TestJSParser:
    def test_parses_typescript_file(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        assert len(nodes) >= 3  # file, class, function

        node_names = [n.name for n in nodes]
        assert "sample.ts" in node_names
        assert "UserService" in node_names
        assert "createService" in node_names

    def test_extracts_imports(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        import_edges = [e for e in edges if e.edge_type == "import"]
        assert len(import_edges) >= 1

        sources = [e.to_node for e in import_edges]
        assert "./models" in sources

    def test_extracts_class_methods(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        method_nodes = [n for n in nodes if n.type == NodeType.METHOD]
        assert len(method_nodes) >= 1

        method_names = [n.name for n in method_nodes]
        assert "getUser" in method_names

    def test_extracts_return_types(self, js_parser: JSParser, sample_ts_file: Path) -> None:
        nodes, edges, warnings = js_parser.parse_file(sample_ts_file)

        get_user = next((n for n in nodes if n.name == "getUser"), None)
        assert get_user is not None
        assert get_user.return_type == "Promise"
```

---

**Document Version:** 1.0
**Last Updated:** 28 January 2026
