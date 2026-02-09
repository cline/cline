# Cline+ DAG-Aware Agent — Testing Strategy

## Overview

This document defines the testing strategy for Cline+, including unit tests, integration tests, and validation methodology for the 95%+ DAG accuracy target. It establishes test fixtures, metrics, and continuous integration practices.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Parser unit tests exist (`dag-engine/tests/test_python_parser.py`, `dag-engine/tests/test_js_parser.py`)
- [ ] Impact analysis tests (not found)
- [ ] Extension ↔ DAG service integration tests (not found)
- [ ] DAG accuracy validation scripts/fixtures (not found)
- [ ] Performance benchmarks (not found)

## Testing Objectives

| Objective | Target | Measurement |
|-----------|--------|-------------|
| DAG accuracy (static deps) | ≥95% | Precision/recall on reference projects |
| Extension stability | <0.1% crash rate | Error telemetry |
| Bead completion rate | ≥80% | Tasks completed without user intervention |
| Performance (DAG gen) | <30s for 1000 files | Benchmark suite |
| Performance (incremental) | <2s per file | Benchmark suite |

## Test Categories

### 1. Unit Tests

#### Extension (TypeScript)

| Component | Test File | Coverage Target |
|-----------|-----------|-----------------|
| RalphLoopController | `tests/ralph.test.ts` | 90% |
| DAGBridge | `tests/dag-bridge.test.ts` | 85% |
| ContextBuilder | `tests/context.test.ts` | 90% |
| BeadExecutor | `tests/executor.test.ts` | 80% |
| Provider adapters | `tests/providers/*.test.ts` | 85% |

**Example: Ralph Loop Tests**

```typescript
// tests/ralph.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RalphLoopController } from '../src/extension/ralph/controller';
import type { DAGBridge } from '../src/extension/dag/bridge';
import type { TaskDefinition } from '../src/extension/ralph/controller';

describe('RalphLoopController', () => {
  let controller: RalphLoopController;
  let mockDagBridge: DAGBridge;

  beforeEach(() => {
    mockDagBridge = {
      analyseProject: vi.fn().mockResolvedValue({
        nodes: [],
        edges: [],
        warnings: [],
        summary: { files: 0, functions: 0, edges: 0 },
      }),
      getImpact: vi.fn().mockResolvedValue({
        affectedFiles: [],
        affectedFunctions: [],
        suggestedTests: [],
      }),
    } as unknown as DAGBridge;

    controller = new RalphLoopController(mockDagBridge);
  });

  describe('startTask', () => {
    it('should transition from idle to running', async () => {
      const task: TaskDefinition = {
        id: 'test-1',
        description: 'Test task',
        workspaceRoot: '/test',
        successCriteria: [{ type: 'done_tag' }],
        tokenBudget: 10000,
        maxIterations: 5,
      };

      expect(controller.getStatus()).toBe('idle');

      // Start task (will pause at approval)
      const startPromise = controller.startTask(task);

      // Wait for first bead to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(controller.getStatus()).toBe('awaiting_approval');
    });

    it('should reject starting a task when already running', async () => {
      const task: TaskDefinition = {
        id: 'test-1',
        description: 'Test task',
        workspaceRoot: '/test',
        successCriteria: [{ type: 'done_tag' }],
        tokenBudget: 10000,
        maxIterations: 5,
      };

      controller.startTask(task);

      await expect(controller.startTask(task)).rejects.toThrow('already running');
    });
  });

  describe('token budget', () => {
    it('should fail when token budget is exhausted', async () => {
      const task: TaskDefinition = {
        id: 'test-1',
        description: 'Test task',
        workspaceRoot: '/test',
        successCriteria: [{ type: 'done_tag' }],
        tokenBudget: 100, // Very low budget
        maxIterations: 10,
      };

      const failedHandler = vi.fn();
      controller.on('taskFailed', failedHandler);

      await controller.startTask(task);

      // Simulate token usage exceeding budget
      // In real implementation, executeBead would consume tokens

      expect(failedHandler).toHaveBeenCalled();
    });
  });

  describe('success criteria', () => {
    it('should complete task when DONE tag is found', async () => {
      // Test implementation
    });

    it('should complete task when tests pass', async () => {
      // Test implementation
    });
  });
});
```

#### DAG Engine (Python)

| Component | Test File | Coverage Target |
|-----------|-----------|-----------------|
| PythonParser | `tests/test_python_parser.py` | 90% |
| JSParser | `tests/test_js_parser.py` | 90% |
| GraphBuilder | `tests/test_graph_builder.py` | 85% |
| ImpactAnalysis | `tests/test_impact.py` | 90% |
| SymbolResolution | `tests/test_resolution.py` | 85% |
| JSONRPCServer | `tests/test_server.py` | 80% |

**Example: Impact Analysis Tests**

```python
# dag-engine/tests/test_impact.py
"""Tests for impact analysis queries."""

import pytest
from pathlib import Path
from cline_dag.analyser import ProjectAnalyser
from cline_dag.models import EdgeConfidence


@pytest.fixture
def sample_project(tmp_path: Path) -> Path:
    """Create a sample project with known dependencies."""

    # models.py - base module
    (tmp_path / "models.py").write_text('''
class User:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello, {self.name}"
''')

    # services.py - depends on models
    (tmp_path / "services.py").write_text('''
from models import User

class UserService:
    def create_user(self, name: str) -> User:
        return User(name)

    def greet_user(self, user: User) -> str:
        return user.greet()
''')

    # views.py - depends on services
    (tmp_path / "views.py").write_text('''
from services import UserService

def handle_request(name: str) -> str:
    service = UserService()
    user = service.create_user(name)
    return service.greet_user(user)
''')

    # tests/test_views.py - test file
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_views.py").write_text('''
from views import handle_request

def test_handle_request():
    result = handle_request("World")
    assert "Hello" in result
''')

    return tmp_path


class TestImpactAnalysis:
    """Test suite for impact analysis."""

    def test_direct_impact(self, sample_project: Path) -> None:
        """Changing models.py should affect services.py directly."""
        analyser = ProjectAnalyser()
        analyser.analyse_project(sample_project)

        impact = analyser.get_impact(str(sample_project / "models.py"))

        # services.py imports models.py
        assert any("services.py" in f for f in impact.affected_files)

    def test_transitive_impact(self, sample_project: Path) -> None:
        """Changing models.py should transitively affect views.py."""
        analyser = ProjectAnalyser()
        analyser.analyse_project(sample_project)

        impact = analyser.get_impact(str(sample_project / "models.py"))

        # views.py depends on services.py which depends on models.py
        assert any("views.py" in f for f in impact.affected_files)

    def test_function_level_impact(self, sample_project: Path) -> None:
        """Changing User.greet should affect UserService.greet_user."""
        analyser = ProjectAnalyser()
        analyser.analyse_project(sample_project)

        impact = analyser.get_impact(
            str(sample_project / "models.py"),
            function_name="User.greet"
        )

        assert any("greet_user" in f for f in impact.affected_functions)

    def test_suggested_tests(self, sample_project: Path) -> None:
        """Should suggest test files that cover affected code."""
        analyser = ProjectAnalyser()
        analyser.analyse_project(sample_project)

        impact = analyser.get_impact(str(sample_project / "models.py"))

        assert any("test_views.py" in t for t in impact.suggested_tests)

    def test_confidence_breakdown(self, sample_project: Path) -> None:
        """Should provide confidence breakdown for impact edges."""
        analyser = ProjectAnalyser()
        analyser.analyse_project(sample_project)

        impact = analyser.get_impact(str(sample_project / "models.py"))

        # All edges in this simple project should be high confidence
        assert impact.confidence_breakdown.get("high", 0) > 0

    def test_no_impact_for_isolated_file(self, tmp_path: Path) -> None:
        """A file with no dependents should have empty impact."""
        (tmp_path / "isolated.py").write_text("x = 1")

        analyser = ProjectAnalyser()
        analyser.analyse_project(tmp_path)

        impact = analyser.get_impact(str(tmp_path / "isolated.py"))

        assert len(impact.affected_files) == 0
```

### 2. Integration Tests

#### Extension ↔ DAG Service

```typescript
// tests/integration/dag-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DAGBridge } from '../../src/extension/dag/bridge';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('DAG Bridge Integration', () => {
  let bridge: DAGBridge;
  let testProject: string;

  beforeAll(async () => {
    // Create temp project
    testProject = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-test-'));

    // Create sample files
    fs.writeFileSync(
      path.join(testProject, 'main.py'),
      'from utils import helper\n\ndef main():\n    helper()\n'
    );
    fs.writeFileSync(
      path.join(testProject, 'utils.py'),
      'def helper():\n    return 42\n'
    );

    // Start bridge
    bridge = new DAGBridge('python3', path.resolve(__dirname, '../..'));
    await bridge.start();
  });

  afterAll(() => {
    bridge.stop();
    fs.rmSync(testProject, { recursive: true });
  });

  it('should analyse a Python project', async () => {
    const graph = await bridge.analyseProject(testProject);

    expect(graph.summary.files).toBe(2);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('should compute impact for a file', async () => {
    // First analyse
    await bridge.analyseProject(testProject);

    const impact = await bridge.getImpact(path.join(testProject, 'utils.py'));

    expect(impact.affectedFiles).toContain(path.join(testProject, 'main.py'));
  });

  it('should handle missing files gracefully', async () => {
    const impact = await bridge.getImpact(
      path.join(testProject, 'nonexistent.py')
    );

    expect(impact.affectedFiles).toEqual([]);
  });
});
```

#### End-to-End Bead Execution

```typescript
// tests/e2e/bead-execution.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as vscode from 'vscode';

describe('End-to-End Bead Execution', () => {
  // These tests run in VS Code Extension Host

  it('should execute a simple bead', async () => {
    // Open test workspace
    // Start task
    // Wait for bead completion
    // Verify file changes
    // Approve bead
    // Check final state
  });

  it('should retry on failure', async () => {
    // Start task that will fail initially
    // Verify error is captured
    // Verify retry with error context
    // Approve final result
  });
});
```

### 3. DAG Accuracy Validation

#### Reference Projects

We validate DAG accuracy against these reference projects with known dependency structures:

| Project | Language | Files | Functions | Ground Truth |
|---------|----------|-------|-----------|--------------|
| `fixtures/python-flask-app` | Python | 25 | 80 | Manual annotation |
| `fixtures/typescript-react-app` | TypeScript | 40 | 150 | Manual annotation |
| `fixtures/mixed-monorepo` | Python + TS | 60 | 200 | Manual annotation |

#### Ground Truth Format

```json
{
  "project": "python-flask-app",
  "version": "1.0",
  "files": 25,
  "annotations": {
    "edges": [
      {
        "from": "app.py:create_app",
        "to": "config.py:Config",
        "type": "call",
        "expected_confidence": "high"
      },
      {
        "from": "models/user.py:User",
        "to": "models/base.py:BaseModel",
        "type": "inherit",
        "expected_confidence": "high"
      }
    ],
    "non_edges": [
      {
        "from": "tests/test_user.py",
        "to": "models/admin.py",
        "reason": "No actual dependency"
      }
    ]
  }
}
```

#### Validation Script

```python
# dag-engine/tests/validation/validate_accuracy.py
"""Validate DAG accuracy against ground truth annotations."""

import json
from pathlib import Path
from dataclasses import dataclass

from cline_dag.analyser import ProjectAnalyser


@dataclass
class ValidationResult:
    project: str
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1_score: float


def validate_project(project_path: Path, annotations_path: Path) -> ValidationResult:
    """Validate DAG against ground truth annotations."""

    # Load annotations
    with open(annotations_path) as f:
        annotations = json.load(f)

    # Analyse project
    analyser = ProjectAnalyser()
    graph = analyser.analyse_project(project_path)

    # Build set of detected edges
    detected_edges = {
        (e.from_node, e.to_node, e.edge_type)
        for e in graph.edges
    }

    # Build set of expected edges
    expected_edges = {
        (e["from"], e["to"], e["type"])
        for e in annotations["annotations"]["edges"]
    }

    # Build set of known non-edges
    non_edges = {
        (e["from"], e["to"])
        for e in annotations["annotations"].get("non_edges", [])
    }

    # Calculate metrics
    true_positives = len(detected_edges & expected_edges)
    false_positives = sum(
        1 for e in detected_edges
        if (e[0], e[1]) in non_edges
    )
    false_negatives = len(expected_edges - detected_edges)

    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0
    f1_score = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    return ValidationResult(
        project=annotations["project"],
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        precision=precision,
        recall=recall,
        f1_score=f1_score,
    )


def run_validation_suite() -> dict[str, ValidationResult]:
    """Run validation on all reference projects."""

    fixtures_dir = Path(__file__).parent / "fixtures"
    results = {}

    for project_dir in fixtures_dir.iterdir():
        if not project_dir.is_dir():
            continue

        annotations_file = project_dir / "ground_truth.json"
        if not annotations_file.exists():
            continue

        result = validate_project(project_dir, annotations_file)
        results[result.project] = result

        print(f"{result.project}:")
        print(f"  Precision: {result.precision:.2%}")
        print(f"  Recall: {result.recall:.2%}")
        print(f"  F1 Score: {result.f1_score:.2%}")
        print()

    # Calculate aggregate
    total_tp = sum(r.true_positives for r in results.values())
    total_fp = sum(r.false_positives for r in results.values())
    total_fn = sum(r.false_negatives for r in results.values())

    aggregate_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    aggregate_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0

    print("=" * 40)
    print(f"Aggregate Precision: {aggregate_precision:.2%}")
    print(f"Aggregate Recall: {aggregate_recall:.2%}")
    print(f"Target: 95% precision")
    print(f"Status: {'PASS' if aggregate_precision >= 0.95 else 'FAIL'}")

    return results


if __name__ == "__main__":
    run_validation_suite()
```

### 4. Performance Benchmarks

#### Benchmark Suite

```python
# dag-engine/tests/benchmarks/benchmark_dag.py
"""Performance benchmarks for DAG analysis."""

import time
import tempfile
from pathlib import Path

import pytest

from cline_dag.analyser import ProjectAnalyser


def generate_project(num_files: int, functions_per_file: int) -> Path:
    """Generate a synthetic project for benchmarking."""

    project_dir = Path(tempfile.mkdtemp())

    for i in range(num_files):
        file_content = f'"""Module {i}."""\n\n'

        # Add imports to previous files
        if i > 0:
            file_content += f"from module_{i-1} import func_{i-1}_0\n\n"

        # Add functions
        for j in range(functions_per_file):
            file_content += f"""
def func_{i}_{j}(x: int) -> int:
    '''Function {j} in module {i}.'''
    return x + {j}
"""
            # Add calls to other functions
            if j > 0:
                file_content += f"    _ = func_{i}_{j-1}(x)\n"

        (project_dir / f"module_{i}.py").write_text(file_content)

    return project_dir


class TestPerformance:
    """Performance benchmark tests."""

    @pytest.mark.benchmark
    def test_analyse_100_files(self, benchmark) -> None:
        """Benchmark: Analyse 100 files."""
        project = generate_project(100, 10)
        analyser = ProjectAnalyser()

        result = benchmark(lambda: analyser.analyse_project(project))

        assert result.summary.files == 100

    @pytest.mark.benchmark
    def test_analyse_500_files(self, benchmark) -> None:
        """Benchmark: Analyse 500 files."""
        project = generate_project(500, 10)
        analyser = ProjectAnalyser()

        result = benchmark(lambda: analyser.analyse_project(project))

        assert result.summary.files == 500

    @pytest.mark.benchmark
    def test_analyse_1000_files(self, benchmark) -> None:
        """Benchmark: Analyse 1000 files (target: <30s)."""
        project = generate_project(1000, 10)
        analyser = ProjectAnalyser()

        start = time.time()
        result = analyser.analyse_project(project)
        duration = time.time() - start

        assert result.summary.files == 1000
        assert duration < 30, f"Analysis took {duration:.1f}s, target is <30s"

    @pytest.mark.benchmark
    def test_incremental_analysis(self, benchmark) -> None:
        """Benchmark: Incremental analysis (target: <2s)."""
        project = generate_project(500, 10)
        analyser = ProjectAnalyser()

        # Initial full analysis
        analyser.analyse_project(project)

        # Modify one file
        (project / "module_250.py").write_text("# Modified\ndef new_func(): pass\n")

        # Benchmark incremental re-analysis
        start = time.time()
        analyser.invalidate_file(str(project / "module_250.py"))
        result = analyser.analyse_file(project / "module_250.py")
        duration = time.time() - start

        assert duration < 2, f"Incremental analysis took {duration:.1f}s, target is <2s"

    @pytest.mark.benchmark
    def test_impact_query(self, benchmark) -> None:
        """Benchmark: Impact query on large graph."""
        project = generate_project(500, 10)
        analyser = ProjectAnalyser()
        analyser.analyse_project(project)

        # Query impact of a central file
        result = benchmark(lambda: analyser.get_impact(str(project / "module_250.py")))

        assert len(result.affected_files) > 0
```

## Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typescript-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run tests
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          flags: typescript

  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install dependencies
        run: |
          cd dag-engine
          pip install -e ".[dev]"

      - name: Run linter
        run: |
          cd dag-engine
          ruff check .
          mypy cline_dag

      - name: Run tests
        run: |
          cd dag-engine
          pytest --cov=cline_dag --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./dag-engine/coverage.xml
          flags: python

  dag-accuracy:
    runs-on: ubuntu-latest
    needs: [python-tests]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: |
          cd dag-engine
          pip install -e .

      - name: Run accuracy validation
        run: |
          cd dag-engine
          python tests/validation/validate_accuracy.py

      - name: Check accuracy threshold
        run: |
          # Fail if accuracy < 95%
          cd dag-engine
          python -c "
          from tests.validation.validate_accuracy import run_validation_suite
          results = run_validation_suite()
          total_tp = sum(r.true_positives for r in results.values())
          total_fp = sum(r.false_positives for r in results.values())
          precision = total_tp / (total_tp + total_fp)
          assert precision >= 0.95, f'Precision {precision:.2%} below 95% threshold'
          "

  performance:
    runs-on: ubuntu-latest
    needs: [python-tests]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: |
          cd dag-engine
          pip install -e ".[dev]"

      - name: Run benchmarks
        run: |
          cd dag-engine
          pytest tests/benchmarks/ -v --benchmark-autosave

      - name: Check performance thresholds
        run: |
          cd dag-engine
          pytest tests/benchmarks/benchmark_dag.py::TestPerformance::test_analyse_1000_files -v

  integration-tests:
    runs-on: ubuntu-latest
    needs: [typescript-tests, python-tests]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install all dependencies
        run: |
          npm ci
          cd dag-engine && pip install -e .

      - name: Build extension
        run: npm run build

      - name: Run integration tests
        run: npm run test:integration
```

## Test Data Management

### Fixture Organisation

```
dag-engine/tests/
├── fixtures/
│   ├── python-flask-app/
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── models/
│   │   └── ground_truth.json
│   ├── typescript-react-app/
│   │   ├── src/
│   │   ├── package.json
│   │   └── ground_truth.json
│   └── mixed-monorepo/
│       ├── backend/
│       ├── frontend/
│       └── ground_truth.json
├── validation/
│   └── validate_accuracy.py
└── benchmarks/
    └── benchmark_dag.py
```

### Adding New Test Fixtures

1. Create project directory in `fixtures/`
2. Add representative code samples
3. Create `ground_truth.json` with manual annotations
4. Run validation to establish baseline
5. Add to CI validation suite

---

**Document Version:** 1.0
**Last Updated:** 28 January 2026
