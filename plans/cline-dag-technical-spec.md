# Cline+ DAG-Aware Agent — Technical Specification

## Architecture Overview

Cline+ follows a modular architecture with clear separation between the VS Code extension host, the React-based webview UI, and the Python-based DAG analysis microservice. The extension orchestrates the Ralph loop while delegating dependency analysis to a subprocess for performance and access to Python's mature AST tooling.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Ralph loop + bead manager core (`src/core/ralph/*`, `src/core/beads/*`)
- [x] DAG bridge + Python engine (`src/services/dag/*`, `dag-engine/`)
- [x] JS/TS parser integrated (`dag-engine/beadsmith_dag/parsers/js_parser.py`)
- [~] Incremental analysis wiring (watcher exists, not wired)
- [~] DAG UI integration (panel exists, not mounted in app)
- [~] DAG context injection (prompt component exists, dagImpact not wired)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Extension Main (extension.ts)                   │   │
│  │  • Command registration      • Webview management           │   │
│  │  • Configuration handling    • Lifecycle management         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌───────────────────────┐    ┌────────────────────────────────┐   │
│  │   Ralph Loop          │    │   DAG Bridge                   │   │
│  │   Controller          │    │   (TypeScript ↔ Python)        │   │
│  │                       │    │                                │   │
│  │  • Task queue         │◄──►│  • Subprocess management       │   │
│  │  • Iteration mgmt     │    │  • JSON-RPC protocol           │   │
│  │  • Success checking   │    │  • Health monitoring           │   │
│  │  • Token budgeting    │    │  • Result caching              │   │
│  └───────────────────────┘    └────────────────────────────────┘   │
│           │                               │                         │
│           ▼                               ▼                         │
│  ┌───────────────────────┐    ┌────────────────────────────────┐   │
│  │   Agent Core          │    │   Git Service                  │   │
│  │   (Cline fork)        │    │                                │   │
│  │                       │    │  • Commit creation             │   │
│  │  • File operations    │    │  • Diff generation             │   │
│  │  • Terminal exec      │    │  • History tracking            │   │
│  │  • MCP integration    │    │  • Branch management           │   │
│  │  • LLM providers      │    │                                │   │
│  └───────────────────────┘    └────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 Webview Message API                          │   │
│  │  • postMessage interface    • Bidirectional communication   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└───────────────────────────────────────────────────────────────────┬─┘
                                                                    │
┌───────────────────────────────────────────────────────────────────┼─┐
│                      Webview (React)                              │ │
├───────────────────────────────────────────────────────────────────┼─┤
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │ │
│  │ Chat Panel   │  │ DAG Panel    │  │ Review Panel            │ │ │
│  │              │  │              │  │                         │ │ │
│  │ • Messages   │  │ • D3.js viz  │  │ • Diff viewer           │ │ │
│  │ • Input      │  │ • Node info  │  │ • Impact summary        │ │ │
│  │ • History    │  │ • Search     │  │ • Approval buttons      │ │ │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘ │ │
└───────────────────────────────────────────────────────────────────┴─┘
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  DAG Analysis Microservice (Python)                 │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              JSON-RPC Server (stdio)                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │ Python Analyser  │  │ JS/TS Analyser   │  │ Graph Engine    │   │
│  │                  │  │                  │  │                 │   │
│  │ • AST parsing    │  │ • Babel parsing  │  │ • NetworkX      │   │
│  │ • Import extract │  │ • Import extract │  │ • Reachability  │   │
│  │ • Call analysis  │  │ • Call analysis  │  │ • Impact query  │   │
│  │ • Type hints     │  │ • Type analysis  │  │ • Cycle detect  │   │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Symbol Resolution Engine                        │   │
│  │  • Cross-file reference tracking                            │   │
│  │  • Confidence scoring (high/medium/low/unsafe)              │   │
│  │  • Dynamic pattern detection                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                                                    │
                                                                    ▼
                        ┌─────────────────────────┐
                        │   LLM Provider          │
                        │   (External API)        │
                        │                         │
                        │  • Anthropic Claude     │
                        │  • OpenAI               │
                        │  • Ollama (local)       │
                        └─────────────────────────┘
```

## Technology Stack

### Runtime Environment

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Extension Host | Node.js | 20+ | VS Code extension runtime |
| Extension Language | TypeScript | 5.9+ | Type-safe extension development |
| Webview Framework | React | 19.x | UI components |
| Webview Bundler | esbuild | 0.27+ | Fast bundling for extension |
| DAG Microservice | Python | 3.12+ | Dependency analysis |
| Graph Library | NetworkX | 3.6+ | Graph algorithms |

### Key Dependencies

#### Extension (TypeScript)

| Package | Version | Purpose |
|---------|---------|---------|
| @types/vscode | 1.108.1 | VS Code API types |
| react | 19.2.4 | Webview UI framework |
| react-dom | 19.2.4 | React DOM rendering |
| typescript | 5.9.3 | TypeScript compiler |
| esbuild | 0.27.2 | Bundler |
| @babel/parser | 7.28.6 | JS/TS AST parsing |
| @babel/traverse | 7.28.6 | AST traversal |
| d3 | 7.9.0 | Graph visualisation |
| vitest | 4.0.18 | Unit testing |

#### DAG Microservice (Python)

| Package | Version | Purpose |
|---------|---------|---------|
| networkx | 3.6.1 | Graph data structure and algorithms |
| pydantic | 2.12.5 | Data validation and serialisation |
| structlog | 25.5.0 | Structured logging |
| watchdog | 6.0.0 | File system monitoring |
| aiofiles | 25.1.0 | Async file I/O |
| httpx | 0.28.1 | HTTP client (for npm registry queries) |
| pytest | 9.0.2 | Testing framework |
| pytest-asyncio | 1.3.0 | Async test support |
| ruff | 0.14.14 | Linting |
| mypy | 1.19.1 | Type checking |

## Component Design

### Ralph Loop Controller

**Responsibility:** Orchestrate iterative agent execution until success criteria are met.

**Key Interfaces:**

```typescript
interface TaskDefinition {
  id: string;
  description: string;
  successCriteria: SuccessCriterion[];
  tokenBudget: number;
  maxIterations: number;
  workspaceRoot: string;
}

interface SuccessCriterion {
  type: 'tests_pass' | 'done_tag' | 'no_errors' | 'custom';
  config?: Record<string, unknown>;
}

interface BeadResult {
  beadNumber: number;
  filesChanged: string[];
  commitHash?: string;
  testResults?: TestResult[];
  errors: string[];
  tokensUsed: number;
  success: boolean;
}

interface RalphLoopController {
  startTask(task: TaskDefinition): Promise<void>;
  pauseTask(): void;
  resumeTask(): void;
  cancelTask(): void;
  getStatus(): TaskStatus;
  onBeadComplete(callback: (result: BeadResult) => void): void;
  onTaskComplete(callback: (summary: TaskSummary) => void): void;
}
```

**State Machine:**

```
                    ┌─────────┐
                    │  IDLE   │
                    └────┬────┘
                         │ startTask()
                         ▼
                    ┌─────────┐
         ┌─────────│ RUNNING │◄────────────┐
         │         └────┬────┘             │
         │              │                  │
         │   ┌──────────┼──────────┐       │
         │   │          │          │       │
         │   ▼          ▼          ▼       │
         │ ┌────┐   ┌──────┐   ┌──────┐   │
         │ │WAIT│   │CHECK │   │RETRY │───┘
         │ │USER│   │PASS? │   │BEAD  │
         │ └─┬──┘   └──┬───┘   └──────┘
         │   │         │
         │   │    ┌────┴────┐
         │   │    │         │
         │   ▼    ▼         ▼
         │ ┌────────┐   ┌────────┐
         └►│COMPLETE│   │ FAILED │
           └────────┘   └────────┘
```

### DAG Analysis Engine

**Responsibility:** Generate and maintain project dependency graph with confidence scoring.

**Key Interfaces:**

```python
from enum import Enum
from pydantic import BaseModel

class EdgeConfidence(str, Enum):
    HIGH = "high"       # Static, unambiguous reference
    MEDIUM = "medium"   # Type-inferred or pattern-matched
    LOW = "low"         # Duck-typed or loosely matched
    UNSAFE = "unsafe"   # Dynamic/reflection-based

class NodeType(str, Enum):
    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"

class GraphNode(BaseModel):
    id: str                    # Unique identifier (file:symbol)
    type: NodeType
    file_path: str
    line_number: int
    name: str
    docstring: str | None = None
    parameters: list[str] = []
    return_type: str | None = None

class GraphEdge(BaseModel):
    from_node: str
    to_node: str
    edge_type: str             # "import", "call", "inherit", "reference"
    confidence: EdgeConfidence
    line_number: int
    label: str                 # Human-readable description

class ProjectGraph(BaseModel):
    version: str
    project_root: str
    analysis_timestamp: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    warnings: list[AnalysisWarning]
    summary: GraphSummary

class ImpactReport(BaseModel):
    changed_file: str
    affected_files: list[str]
    affected_functions: list[str]
    suggested_tests: list[str]
    confidence_breakdown: dict[EdgeConfidence, int]
```

**Analysis Pipeline:**

```
Source Files
     │
     ▼
┌─────────────────┐
│ Language        │
│ Detection       │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Python │ │JS/TS  │
│Parser │ │Parser │
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
┌─────────────────┐
│ Symbol          │
│ Extraction      │
│ (imports,       │
│  functions,     │
│  calls)         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cross-File      │
│ Resolution      │
│ (match calls    │
│  to definitions)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Confidence      │
│ Scoring         │
│ (type hints,    │
│  pattern match) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Graph           │
│ Construction    │
│ (NetworkX)      │
└────────┬────────┘
         │
         ▼
    ProjectGraph
```

### Webview Components

**Responsibility:** Provide interactive UI for chat, DAG visualisation, and bead review.

**Component Hierarchy:**

```
<App>
├── <ChatPanel>
│   ├── <MessageList>
│   │   └── <Message>
│   ├── <InputArea>
│   └── <StatusBar>
│
├── <DAGPanel>
│   ├── <GraphCanvas>          # D3.js force-directed graph
│   ├── <NodeDetails>          # Hover/click details
│   ├── <SearchBar>            # Find file/function
│   ├── <ConfidenceFilter>     # Toggle edge visibility
│   └── <ImpactHighlighter>    # Flash affected nodes
│
└── <ReviewPanel>
    ├── <BeadSummary>
    │   ├── <ChangedFiles>
    │   └── <ImpactSummary>
    ├── <DiffViewer>
    ├── <TestResults>
    └── <ApprovalButtons>
```

**Message Protocol (Extension ↔ Webview):**

```typescript
// Extension → Webview
type ExtensionMessage =
  | { type: 'dag:update'; payload: ProjectGraph }
  | { type: 'bead:start'; payload: BeadInfo }
  | { type: 'bead:complete'; payload: BeadResult }
  | { type: 'chat:response'; payload: ChatMessage }
  | { type: 'impact:highlight'; payload: string[] }
  | { type: 'status:update'; payload: TaskStatus };

// Webview → Extension
type WebviewMessage =
  | { type: 'chat:send'; payload: string }
  | { type: 'bead:approve'; payload: string }
  | { type: 'bead:reject'; payload: { beadId: string; feedback: string } }
  | { type: 'bead:skip'; payload: string }
  | { type: 'dag:query'; payload: { type: 'impact'; node: string } }
  | { type: 'navigate:file'; payload: { file: string; line: number } };
```

## Data Model

### Entities

#### Task
Represents a user-defined coding task with success criteria.

```typescript
interface Task {
  id: string;
  createdAt: Date;
  description: string;
  workspaceRoot: string;
  successCriteria: SuccessCriterion[];
  tokenBudget: number;
  maxIterations: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  beads: Bead[];
  totalTokensUsed: number;
}
```

#### Bead
Represents one discrete chunk of work within a Ralph loop iteration.

```typescript
interface Bead {
  id: string;
  taskId: string;
  beadNumber: number;
  startedAt: Date;
  completedAt?: Date;
  prompt: string;
  response: string;
  filesChanged: FileChange[];
  testResults?: TestResult[];
  commitHash?: string;
  tokensUsed: number;
  iterationCount: number;  // Retries within this bead
  status: 'running' | 'awaiting_approval' | 'approved' | 'rejected' | 'skipped';
}
```

#### FileChange
Represents a modification to a single file.

```typescript
interface FileChange {
  filePath: string;
  changeType: 'created' | 'modified' | 'deleted';
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  impactedNodes: string[];  // From DAG analysis
}
```

### Data Flows

**Task Execution Flow:**

```
User Input                Extension                    DAG Service
    │                         │                            │
    │  Define task            │                            │
    ├────────────────────────►│                            │
    │                         │  Analyse project           │
    │                         ├───────────────────────────►│
    │                         │                            │
    │                         │◄───────────────────────────┤
    │                         │  ProjectGraph              │
    │                         │                            │
    │                         │  Build prompt with DAG     │
    │                         │  context                   │
    │                         │                            │
    │                         │        ┌─────────────────┐ │
    │                         ├───────►│  LLM Provider   │ │
    │                         │        └─────────────────┘ │
    │                         │                            │
    │  Show diff + impact     │◄──────────────────────────┤│
    │◄────────────────────────┤                            │
    │                         │                            │
    │  Approve                │                            │
    ├────────────────────────►│                            │
    │                         │  Apply changes             │
    │                         │  Run tests                 │
    │                         │  Commit bead               │
    │                         │                            │
    │                         │  Re-analyse (incremental)  │
    │                         ├───────────────────────────►│
    │                         │                            │
    │                         │  Check success criteria    │
    │                         │         │                  │
    │                         │    ┌────┴────┐             │
    │                         │    ▼         ▼             │
    │                         │  Pass      Fail            │
    │                         │    │         │             │
    │  Task complete          │◄───┘         │             │
    │◄────────────────────────┤              │             │
    │                         │              │             │
    │                         │   Loop with  │             │
    │                         │   error ctx  │             │
    │                         │◄─────────────┘             │
```

## API Design

### Extension Commands

| Command | ID | Description |
|---------|----|----|
| Start Task | `cline-dag.startTask` | Open task input and begin execution |
| Pause Task | `cline-dag.pauseTask` | Pause current task (awaits user resume) |
| Resume Task | `cline-dag.resumeTask` | Resume paused task |
| Cancel Task | `cline-dag.cancelTask` | Cancel and rollback current task |
| Show DAG | `cline-dag.showDAG` | Open DAG visualisation panel |
| Refresh DAG | `cline-dag.refreshDAG` | Force re-analyse entire project |
| Show Impact | `cline-dag.showImpact` | Show impact of current file |

### DAG Microservice JSON-RPC API

All communication via stdio using JSON-RPC 2.0.

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `analyse_project` | `{ root: string }` | `ProjectGraph` | Full project analysis |
| `analyse_file` | `{ file: string }` | `FileAnalysis` | Single file analysis |
| `get_impact` | `{ file: string, function?: string }` | `ImpactReport` | Compute change impact |
| `get_callers` | `{ node_id: string }` | `string[]` | List all callers of node |
| `get_callees` | `{ node_id: string }` | `string[]` | List all callees of node |
| `invalidate_file` | `{ file: string }` | `void` | Mark file for re-analysis |
| `get_status` | `{}` | `ServiceStatus` | Health check |

## Security Considerations

### Authentication & Secrets

- **API Keys:** Stored using VS Code's `SecretStorage` API; never logged or included in error reports
- **No Telemetry:** Extension does not send usage data to external services
- **Local Analysis:** All code analysis runs locally; source code never leaves the machine except in LLM prompts

### Authorisation

- **Workspace Trust:** Extension respects VS Code's workspace trust model; disabled in untrusted workspaces
- **File Access:** Limited to current workspace; cannot access files outside workspace root
- **Terminal Execution:** Commands require explicit user approval before execution

### Data Protection

- **Prompt Sanitisation:** Remove sensitive patterns (API keys, passwords) before sending to LLM
- **Git Operations:** Sanitise user input in commit messages to prevent injection
- **Subprocess Isolation:** Python microservice runs with minimal privileges in workspace directory

### Secrets Management

- **Environment Variables:** Support `.env` files for local development; never commit secrets
- **VS Code Settings:** Sensitive settings use `scope: 'machine'` to prevent sync
- **Credential Rotation:** Clear guidance in docs for rotating compromised API keys

## Deployment & Distribution

### VS Code Marketplace

- Package as `.vsix` using `vsce`
- Publish to VS Code Marketplace under MIT license
- Include bundled Python microservice wheel

### Python Microservice Distribution

- Distribute as PyPI package: `cline-dag-engine`
- Extension auto-installs on first activation if not present
- Version pinning to ensure compatibility

### Release Process

1. Run full test suite (TypeScript + Python)
2. Update `CHANGELOG.md`
3. Bump version in `package.json` and `pyproject.toml`
4. Build extension: `npm run package`
5. Build Python wheel: `python -m build`
6. Publish to VS Code Marketplace
7. Publish to PyPI
8. Tag release in git

## Monitoring & Observability

### Logging Strategy

**Extension (TypeScript):**
- Use VS Code's `OutputChannel` for user-visible logs
- Structured JSON logs to file for debugging
- Log levels: error, warn, info, debug, trace

**Microservice (Python):**
- Use `structlog` for structured logging
- Output to stderr (captured by extension)
- Include correlation IDs for request tracing

### Metrics to Capture

| Metric | Type | Description |
|--------|------|-------------|
| `dag.analysis_duration_ms` | Histogram | Time to analyse project |
| `dag.node_count` | Gauge | Number of nodes in graph |
| `dag.edge_count` | Gauge | Number of edges in graph |
| `ralph.iteration_count` | Counter | Number of loop iterations |
| `ralph.bead_duration_ms` | Histogram | Time per bead |
| `ralph.token_usage` | Counter | Tokens consumed |
| `llm.request_duration_ms` | Histogram | LLM API latency |

### Error Reporting

- Capture stack traces for unexpected errors
- Include sanitised context (file counts, not file contents)
- Offer user option to copy error report for GitHub issues

---

**Document Version:** 1.0  
**Last Updated:** 28 January 2026  
**Status:** Approved for Implementation
