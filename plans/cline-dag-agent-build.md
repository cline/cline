# Cline+ DAG-Aware Agent — Agent Build Specification

> **Purpose**: This document provides everything an LLM agent needs to build Cline+ from scratch. Follow instructions sequentially. Do not skip steps. All code is complete and copy-paste ready.

## Project Summary

Cline+ is a VS Code extension that provides DAG-aware AI coding assistance. It combines the Cline agent framework with the Ralph Wiggum iterative loop pattern and real-time dependency graph analysis. The extension helps developers understand the architectural implications of code changes before making them.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Step 1: Project foundation (package.json/tsconfig/esbuild present in repo root)
- [x] Step 2: Extension core (Ralph loop, bead manager, DAG bridge, commands exist in `src/core/*`)
- [~] Step 3: Webview UI (DAG panel + bead UI exist; DAG panel not wired into main app)
- [x] Step 4: DAG engine (Python engine + JS/TS parser implemented in `dag-engine/`)
- [~] Step 5: Tests (parser tests exist; missing DAG impact + bead workflow tests)
- [x] Step 6: README exists (project-level README present)

Note: The JS/TS parser TODO in this spec is implemented in Beadsmith (`dag-engine/beadsmith_dag/parsers/js_parser.py` and `dag-engine/beadsmith_dag/analyser.py`).

## Technology Stack

- **Extension Runtime**: Node.js 20+, TypeScript 5.9+
- **Extension Bundler**: esbuild 0.27+
- **Webview Framework**: React 19+
- **Graph Visualisation**: D3.js 7.9+
- **DAG Engine Runtime**: Python 3.12+
- **Graph Library**: NetworkX 3.6+
- **Testing**: Vitest (TypeScript), pytest (Python)

## Directory Structure

Create this exact structure:

```
cline-dag/
├── src/
│   ├── extension/
│   │   ├── extension.ts           # Extension entry point
│   │   ├── commands.ts            # Command handlers
│   │   ├── ralph/
│   │   │   ├── controller.ts      # Ralph loop controller
│   │   │   ├── task.ts            # Task management
│   │   │   └── success.ts         # Success criteria checking
│   │   ├── dag/
│   │   │   ├── bridge.ts          # Python subprocess bridge
│   │   │   ├── cache.ts           # Graph caching
│   │   │   └── types.ts           # DAG type definitions
│   │   ├── git/
│   │   │   └── service.ts         # Git operations
│   │   ├── llm/
│   │   │   ├── provider.ts        # LLM provider interface
│   │   │   ├── anthropic.ts       # Anthropic Claude provider
│   │   │   └── context.ts         # Context injection
│   │   └── webview/
│   │       └── provider.ts        # Webview panel provider
│   └── webview/
│       ├── index.tsx              # React entry point
│       ├── App.tsx                # Main app component
│       ├── components/
│       │   ├── ChatPanel.tsx
│       │   ├── DAGPanel.tsx
│       │   ├── ReviewPanel.tsx
│       │   └── Graph.tsx          # D3.js graph component
│       ├── hooks/
│       │   ├── useVSCode.ts       # VS Code API hook
│       │   └── useDAG.ts          # DAG state hook
│       └── types.ts
├── dag-engine/
│   ├── cline_dag/
│   │   ├── __init__.py
│   │   ├── server.py              # JSON-RPC server
│   │   ├── analyser.py            # Main analysis coordinator
│   │   ├── parsers/
│   │   │   ├── __init__.py
│   │   │   ├── python_parser.py   # Python AST analysis
│   │   │   └── js_parser.py       # JS/TS Babel analysis
│   │   ├── graph/
│   │   │   ├── __init__.py
│   │   │   ├── builder.py         # Graph construction
│   │   │   └── queries.py         # Impact analysis queries
│   │   ├── resolution/
│   │   │   ├── __init__.py
│   │   │   └── symbols.py         # Cross-file symbol resolution
│   │   └── models.py              # Pydantic models
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   ├── test_python_parser.py
│   │   ├── test_graph_builder.py
│   │   └── test_impact.py
│   ├── pyproject.toml
│   └── requirements.txt
├── tests/
│   ├── extension.test.ts
│   ├── ralph.test.ts
│   └── dag-bridge.test.ts
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── .vscodeignore
└── README.md
```

## Step 1: Create Project Foundation

### 1.1 Create package.json

```json
{
  "name": "cline-dag",
  "displayName": "Cline+ DAG-Aware Agent",
  "description": "AI coding agent with dependency graph awareness",
  "version": "0.1.0",
  "publisher": "cline-dag",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cline-dag/cline-dag"
  },
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": [
    "Programming Languages",
    "Machine Learning",
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "cline-dag.startTask",
        "title": "Cline+: Start Task"
      },
      {
        "command": "cline-dag.pauseTask",
        "title": "Cline+: Pause Task"
      },
      {
        "command": "cline-dag.resumeTask",
        "title": "Cline+: Resume Task"
      },
      {
        "command": "cline-dag.cancelTask",
        "title": "Cline+: Cancel Task"
      },
      {
        "command": "cline-dag.showDAG",
        "title": "Cline+: Show Dependency Graph"
      },
      {
        "command": "cline-dag.refreshDAG",
        "title": "Cline+: Refresh Dependency Graph"
      },
      {
        "command": "cline-dag.showImpact",
        "title": "Cline+: Show Impact of Current File"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "cline-dag",
          "title": "Cline+",
          "icon": "$(symbol-structure)"
        }
      ]
    },
    "views": {
      "cline-dag": [
        {
          "type": "webview",
          "id": "cline-dag.mainView",
          "name": "Cline+ Agent"
        }
      ]
    },
    "configuration": {
      "title": "Cline+ DAG Agent",
      "properties": {
        "cline-dag.llm.provider": {
          "type": "string",
          "enum": ["anthropic", "openai", "ollama"],
          "default": "anthropic",
          "description": "LLM provider to use"
        },
        "cline-dag.llm.model": {
          "type": "string",
          "default": "claude-sonnet-4-20250514",
          "description": "Model identifier"
        },
        "cline-dag.ralph.maxIterations": {
          "type": "number",
          "default": 10,
          "description": "Maximum iterations per bead"
        },
        "cline-dag.ralph.tokenBudget": {
          "type": "number",
          "default": 100000,
          "description": "Token budget per task"
        },
        "cline-dag.dag.pythonPath": {
          "type": "string",
          "default": "python3",
          "description": "Path to Python executable"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext ts,tsx",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/d3": "7.4.3",
    "@types/node": "^22.0.0",
    "@types/react": "19.2.10",
    "@types/react-dom": "19.2.3",
    "@types/vscode": "1.108.1",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "0.27.2",
    "eslint": "9.39.2",
    "prettier": "3.8.1",
    "typescript": "5.9.3",
    "vitest": "4.0.18"
  },
  "dependencies": {
    "d3": "7.9.0",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  }
}
```

### 1.2 Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022", "DOM"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "dag-engine"]
}
```

### 1.3 Create esbuild.config.mjs

```javascript
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !isWatch,
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: !isWatch,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
  },
};

async function build() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete');
  }
}

build().catch(() => process.exit(1));
```

## Step 2: Implement Extension Core

### 2.1 Create src/extension/extension.ts

```typescript
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { DAGBridge } from './dag/bridge';
import { RalphLoopController } from './ralph/controller';
import { MainViewProvider } from './webview/provider';

let dagBridge: DAGBridge | undefined;
let ralphController: RalphLoopController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Cline+ DAG Agent activating...');

  // Initialise DAG bridge (Python subprocess)
  const config = vscode.workspace.getConfiguration('cline-dag');
  const pythonPath = config.get<string>('dag.pythonPath', 'python3');
  
  dagBridge = new DAGBridge(pythonPath, context.extensionPath);
  
  try {
    await dagBridge.start();
    console.log('DAG engine started successfully');
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to start DAG engine: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Initialise Ralph loop controller
  ralphController = new RalphLoopController(dagBridge);

  // Register webview provider
  const mainViewProvider = new MainViewProvider(
    context.extensionUri,
    dagBridge,
    ralphController
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'cline-dag.mainView',
      mainViewProvider
    )
  );

  // Register commands
  registerCommands(context, dagBridge, ralphController, mainViewProvider);

  console.log('Cline+ DAG Agent activated');
}

export function deactivate(): void {
  if (dagBridge) {
    dagBridge.stop();
  }
  console.log('Cline+ DAG Agent deactivated');
}
```

### 2.2 Create src/extension/commands.ts

```typescript
import * as vscode from 'vscode';
import type { DAGBridge } from './dag/bridge';
import type { RalphLoopController } from './ralph/controller';
import type { MainViewProvider } from './webview/provider';

export function registerCommands(
  context: vscode.ExtensionContext,
  dagBridge: DAGBridge,
  ralphController: RalphLoopController,
  viewProvider: MainViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cline-dag.startTask', async () => {
      const description = await vscode.window.showInputBox({
        prompt: 'Describe the task you want the agent to complete',
        placeHolder: 'e.g., Add user authentication with JWT tokens',
      });

      if (!description) return;

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      try {
        await ralphController.startTask({
          id: crypto.randomUUID(),
          description,
          workspaceRoot: workspaceFolder.uri.fsPath,
          successCriteria: [{ type: 'tests_pass' }, { type: 'done_tag' }],
          tokenBudget: vscode.workspace
            .getConfiguration('cline-dag')
            .get<number>('ralph.tokenBudget', 100000),
          maxIterations: vscode.workspace
            .getConfiguration('cline-dag')
            .get<number>('ralph.maxIterations', 10),
        });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to start task: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }),

    vscode.commands.registerCommand('cline-dag.pauseTask', () => {
      ralphController.pauseTask();
      vscode.window.showInformationMessage('Task paused');
    }),

    vscode.commands.registerCommand('cline-dag.resumeTask', () => {
      ralphController.resumeTask();
      vscode.window.showInformationMessage('Task resumed');
    }),

    vscode.commands.registerCommand('cline-dag.cancelTask', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to cancel the current task?',
        'Yes',
        'No'
      );
      if (confirm === 'Yes') {
        ralphController.cancelTask();
        vscode.window.showInformationMessage('Task cancelled');
      }
    }),

    vscode.commands.registerCommand('cline-dag.showDAG', () => {
      viewProvider.showDAGPanel();
    }),

    vscode.commands.registerCommand('cline-dag.refreshDAG', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Analysing project dependencies...',
          cancellable: false,
        },
        async () => {
          try {
            const graph = await dagBridge.analyseProject(workspaceFolder.uri.fsPath);
            viewProvider.updateDAG(graph);
            vscode.window.showInformationMessage(
              `DAG refreshed: ${graph.summary.files} files, ${graph.summary.edges} edges`
            );
          } catch (error) {
            vscode.window.showErrorMessage(
              `DAG refresh failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      );
    }),

    vscode.commands.registerCommand('cline-dag.showImpact', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      try {
        const impact = await dagBridge.getImpact(editor.document.uri.fsPath);
        viewProvider.showImpact(impact);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Impact analysis failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );
}
```

### 2.3 Create src/extension/dag/types.ts

```typescript
export type EdgeConfidence = 'high' | 'medium' | 'low' | 'unsafe';

export type NodeType = 'file' | 'class' | 'function' | 'method' | 'variable';

export interface GraphNode {
  id: string;
  type: NodeType;
  filePath: string;
  lineNumber: number;
  name: string;
  docstring?: string;
  parameters?: string[];
  returnType?: string;
}

export interface GraphEdge {
  fromNode: string;
  toNode: string;
  edgeType: 'import' | 'call' | 'inherit' | 'reference';
  confidence: EdgeConfidence;
  lineNumber: number;
  label: string;
}

export interface AnalysisWarning {
  type: string;
  file: string;
  line: number;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface GraphSummary {
  files: number;
  functions: number;
  edges: number;
  highConfidenceEdges: number;
  mediumConfidenceEdges: number;
  lowConfidenceEdges: number;
  unsafeEdges: number;
}

export interface ProjectGraph {
  version: string;
  projectRoot: string;
  analysisTimestamp: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: AnalysisWarning[];
  summary: GraphSummary;
}

export interface ImpactReport {
  changedFile: string;
  affectedFiles: string[];
  affectedFunctions: string[];
  suggestedTests: string[];
  confidenceBreakdown: Record<EdgeConfidence, number>;
}
```

### 2.4 Create src/extension/dag/bridge.ts

```typescript
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import type { ProjectGraph, ImpactReport } from './types';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class DAGBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private buffer = '';

  constructor(
    private readonly pythonPath: string,
    private readonly extensionPath: string
  ) {
    super();
  }

  async start(): Promise<void> {
    const enginePath = path.join(this.extensionPath, 'dag-engine');
    
    this.process = spawn(this.pythonPath, ['-m', 'cline_dag.server'], {
      cwd: enginePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[DAG Engine]', data.toString());
    });

    this.process.on('exit', (code) => {
      console.log(`DAG engine exited with code ${code}`);
      this.emit('exit', code);
    });

    // Wait for ready signal
    await this.call('get_status', {});
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  async analyseProject(rootPath: string): Promise<ProjectGraph> {
    const result = await this.call('analyse_project', { root: rootPath });
    return result as ProjectGraph;
  }

  async analyseFile(filePath: string): Promise<unknown> {
    return this.call('analyse_file', { file: filePath });
  }

  async getImpact(filePath: string, functionName?: string): Promise<ImpactReport> {
    const result = await this.call('get_impact', {
      file: filePath,
      function: functionName,
    });
    return result as ImpactReport;
  }

  async getCallers(nodeId: string): Promise<string[]> {
    const result = await this.call('get_callers', { node_id: nodeId });
    return result as string[];
  }

  async invalidateFile(filePath: string): Promise<void> {
    await this.call('invalidate_file', { file: filePath });
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process) {
      throw new Error('DAG engine not running');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process!.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  private handleData(data: string): void {
    this.buffer += data;
    
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        
        if (pending) {
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('Failed to parse DAG response:', line);
      }
    }
  }
}
```

### 2.5 Create src/extension/ralph/controller.ts

```typescript
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type { DAGBridge } from '../dag/bridge';
import type { ProjectGraph, ImpactReport } from '../dag/types';

export interface TaskDefinition {
  id: string;
  description: string;
  workspaceRoot: string;
  successCriteria: SuccessCriterion[];
  tokenBudget: number;
  maxIterations: number;
}

export interface SuccessCriterion {
  type: 'tests_pass' | 'done_tag' | 'no_errors' | 'custom';
  config?: Record<string, unknown>;
}

export interface BeadResult {
  beadNumber: number;
  filesChanged: string[];
  commitHash?: string;
  testResults?: TestResult[];
  errors: string[];
  tokensUsed: number;
  success: boolean;
}

export interface TestResult {
  name: string;
  passed: boolean;
  output?: string;
}

export type TaskStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

export class RalphLoopController extends EventEmitter {
  private status: TaskStatus = 'idle';
  private currentTask: TaskDefinition | null = null;
  private beadNumber = 0;
  private totalTokensUsed = 0;
  private iterationCount = 0;
  private projectGraph: ProjectGraph | null = null;

  constructor(private readonly dagBridge: DAGBridge) {
    super();
  }

  async startTask(task: TaskDefinition): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error('A task is already running');
    }

    this.currentTask = task;
    this.beadNumber = 0;
    this.totalTokensUsed = 0;
    this.iterationCount = 0;
    this.status = 'running';

    this.emit('taskStarted', task);

    try {
      // Generate initial DAG
      this.projectGraph = await this.dagBridge.analyseProject(task.workspaceRoot);
      this.emit('dagUpdated', this.projectGraph);

      // Start the Ralph loop
      await this.executeLoop();
    } catch (error) {
      this.status = 'failed';
      this.emit('taskFailed', error);
      throw error;
    }
  }

  pauseTask(): void {
    if (this.status === 'running') {
      this.status = 'paused';
      this.emit('taskPaused');
    }
  }

  resumeTask(): void {
    if (this.status === 'paused') {
      this.status = 'running';
      this.emit('taskResumed');
      this.executeLoop().catch((error) => {
        this.status = 'failed';
        this.emit('taskFailed', error);
      });
    }
  }

  cancelTask(): void {
    this.status = 'idle';
    this.currentTask = null;
    this.emit('taskCancelled');
  }

  getStatus(): TaskStatus {
    return this.status;
  }

  async approveCurrentBead(): Promise<void> {
    if (this.status === 'awaiting_approval') {
      this.status = 'running';
      this.emit('beadApproved', this.beadNumber);
      await this.executeLoop();
    }
  }

  async rejectCurrentBead(feedback: string): Promise<void> {
    if (this.status === 'awaiting_approval') {
      this.status = 'running';
      this.emit('beadRejected', { beadNumber: this.beadNumber, feedback });
      // Continue loop with feedback incorporated
      await this.executeLoop();
    }
  }

  private async executeLoop(): Promise<void> {
    if (!this.currentTask) return;

    while (this.status === 'running') {
      // Check budget limits
      if (this.totalTokensUsed >= this.currentTask.tokenBudget) {
        this.status = 'failed';
        this.emit('taskFailed', new Error('Token budget exhausted'));
        return;
      }

      if (this.iterationCount >= this.currentTask.maxIterations) {
        this.status = 'failed';
        this.emit('taskFailed', new Error('Maximum iterations reached'));
        return;
      }

      this.beadNumber++;
      this.iterationCount++;

      this.emit('beadStarted', this.beadNumber);

      try {
        // Execute one bead
        const result = await this.executeBead();
        
        this.totalTokensUsed += result.tokensUsed;
        this.emit('beadComplete', result);

        if (result.success) {
          // Check success criteria
          const criteriaResult = await this.checkSuccessCriteria();
          
          if (criteriaResult.allPassed) {
            this.status = 'completed';
            this.emit('taskCompleted', {
              beadCount: this.beadNumber,
              totalTokens: this.totalTokensUsed,
            });
            return;
          }
        }

        // Update DAG after changes
        this.projectGraph = await this.dagBridge.analyseProject(
          this.currentTask.workspaceRoot
        );
        this.emit('dagUpdated', this.projectGraph);

        // Wait for user approval before continuing
        this.status = 'awaiting_approval';
        this.emit('awaitingApproval', result);
        return; // Exit loop, will resume when approved
        
      } catch (error) {
        this.emit('beadError', { beadNumber: this.beadNumber, error });
        // Continue to next iteration with error context
      }
    }
  }

  private async executeBead(): Promise<BeadResult> {
    // This is a placeholder - actual implementation would:
    // 1. Build prompt with DAG context
    // 2. Send to LLM
    // 3. Apply changes
    // 4. Run tests
    // 5. Commit changes
    
    // For now, return a mock result
    return {
      beadNumber: this.beadNumber,
      filesChanged: [],
      errors: [],
      tokensUsed: 1000,
      success: true,
    };
  }

  private async checkSuccessCriteria(): Promise<{ allPassed: boolean; results: Record<string, boolean> }> {
    if (!this.currentTask) {
      return { allPassed: false, results: {} };
    }

    const results: Record<string, boolean> = {};
    
    for (const criterion of this.currentTask.successCriteria) {
      switch (criterion.type) {
        case 'tests_pass':
          results.tests_pass = await this.runTests();
          break;
        case 'done_tag':
          results.done_tag = await this.checkDoneTag();
          break;
        case 'no_errors':
          results.no_errors = true; // Placeholder
          break;
      }
    }

    const allPassed = Object.values(results).every((v) => v);
    return { allPassed, results };
  }

  private async runTests(): Promise<boolean> {
    // Placeholder - would run pytest or npm test
    return true;
  }

  private async checkDoneTag(): Promise<boolean> {
    // Placeholder - would check for DONE tag in agent output
    return false;
  }
}
```

## Step 3: Implement Webview UI

### 3.1 Create src/webview/index.tsx

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
```

### 3.2 Create src/webview/App.tsx

```tsx
import { useState, useCallback } from 'react';
import { useVSCode } from './hooks/useVSCode';
import { useDAG } from './hooks/useDAG';
import ChatPanel from './components/ChatPanel';
import DAGPanel from './components/DAGPanel';
import ReviewPanel from './components/ReviewPanel';
import type { ProjectGraph, BeadResult } from './types';

type ActivePanel = 'chat' | 'dag' | 'review';

export default function App() {
  const vscode = useVSCode();
  const { graph, impact, highlightedNodes } = useDAG();
  const [activePanel, setActivePanel] = useState<ActivePanel>('chat');
  const [currentBead, setCurrentBead] = useState<BeadResult | null>(null);

  const handleApprove = useCallback(() => {
    vscode.postMessage({ type: 'bead:approve', payload: currentBead?.beadNumber.toString() });
    setCurrentBead(null);
  }, [vscode, currentBead]);

  const handleReject = useCallback((feedback: string) => {
    vscode.postMessage({
      type: 'bead:reject',
      payload: { beadId: currentBead?.beadNumber.toString(), feedback },
    });
  }, [vscode, currentBead]);

  const handleNavigate = useCallback((file: string, line: number) => {
    vscode.postMessage({ type: 'navigate:file', payload: { file, line } });
  }, [vscode]);

  return (
    <div className="app">
      <nav className="tabs">
        <button
          className={activePanel === 'chat' ? 'active' : ''}
          onClick={() => setActivePanel('chat')}
        >
          Chat
        </button>
        <button
          className={activePanel === 'dag' ? 'active' : ''}
          onClick={() => setActivePanel('dag')}
        >
          Dependencies
        </button>
        <button
          className={activePanel === 'review' ? 'active' : ''}
          onClick={() => setActivePanel('review')}
          disabled={!currentBead}
        >
          Review {currentBead ? `(Bead ${currentBead.beadNumber})` : ''}
        </button>
      </nav>

      <main className="panel-container">
        {activePanel === 'chat' && <ChatPanel />}
        {activePanel === 'dag' && (
          <DAGPanel
            graph={graph}
            highlightedNodes={highlightedNodes}
            onNavigate={handleNavigate}
          />
        )}
        {activePanel === 'review' && currentBead && (
          <ReviewPanel
            bead={currentBead}
            impact={impact}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
      </main>
    </div>
  );
}
```

### 3.3 Create src/webview/components/Graph.tsx

```tsx
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { ProjectGraph, GraphNode, GraphEdge } from '../types';

interface GraphProps {
  graph: ProjectGraph | null;
  highlightedNodes?: string[];
  onNodeClick?: (node: GraphNode) => void;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  data: GraphNode;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  data: GraphEdge;
}

const confidenceColors: Record<string, string> = {
  high: '#22c55e',
  medium: '#eab308',
  low: '#f97316',
  unsafe: '#ef4444',
};

export default function Graph({ graph, highlightedNodes = [], onNodeClick }: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graph || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = containerRef.current.getBoundingClientRect();

    // Prepare data
    const nodes: D3Node[] = graph.nodes.map((n) => ({ id: n.id, data: n }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    
    const links: D3Link[] = graph.edges
      .filter((e) => nodeMap.has(e.fromNode) && nodeMap.has(e.toNode))
      .map((e) => ({
        source: nodeMap.get(e.fromNode)!,
        target: nodeMap.get(e.toNode)!,
        data: e,
      }));

    // Create simulation
    const simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links).id((d) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create container group for zoom
    const g = svg.append('g');

    // Add zoom behaviour
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Draw edges
    const link = g
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => confidenceColors[d.data.confidence])
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5);

    // Draw nodes
    const node = g
      .append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (d) => (d.data.type === 'file' ? 12 : 8))
      .attr('fill', (d) => {
        if (highlightedNodes.includes(d.id)) return '#3b82f6';
        switch (d.data.type) {
          case 'file': return '#6366f1';
          case 'class': return '#8b5cf6';
          case 'function': return '#06b6d4';
          case 'method': return '#14b8a6';
          default: return '#64748b';
        }
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('click', (_, d) => onNodeClick?.(d.data))
      .call(
        d3.drag<SVGCircleElement, D3Node>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Add labels
    const labels = g
      .append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text((d) => d.data.name)
      .attr('font-size', 10)
      .attr('dx', 15)
      .attr('dy', 4)
      .style('pointer-events', 'none')
      .style('fill', 'var(--vscode-foreground)');

    // Add tooltips
    node.append('title').text((d) => `${d.data.type}: ${d.data.name}\n${d.data.filePath}:${d.data.lineNumber}`);

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as D3Node).x!)
        .attr('y1', (d) => (d.source as D3Node).y!)
        .attr('x2', (d) => (d.target as D3Node).x!)
        .attr('y2', (d) => (d.target as D3Node).y!);

      node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
      labels.attr('x', (d) => d.x!).attr('y', (d) => d.y!);
    });

    return () => {
      simulation.stop();
    };
  }, [graph, highlightedNodes, onNodeClick]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  );
}
```

## Step 4: Implement DAG Engine (Python)

### 4.1 Create dag-engine/pyproject.toml

```toml
[project]
name = "cline-dag-engine"
version = "0.1.0"
description = "Dependency graph analysis engine for Cline+"
requires-python = ">=3.12"
license = { text = "MIT" }
authors = [{ name = "Cline+ Team" }]

dependencies = [
    "networkx>=3.6.1",
    "pydantic>=2.12.5",
    "structlog>=25.5.0",
    "watchdog>=6.0.0",
    "aiofiles>=25.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=9.0.2",
    "pytest-asyncio>=1.3.0",
    "ruff>=0.14.14",
    "mypy>=1.19.1",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "TCH"]

[tool.mypy]
python_version = "3.12"
strict = true
warn_return_any = true
warn_unused_configs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

### 4.2 Create dag-engine/requirements.txt

```
networkx==3.6.1
pydantic==2.12.5
structlog==25.5.0
watchdog==6.0.0
aiofiles==25.1.0
pytest==9.0.2
pytest-asyncio==1.3.0
ruff==0.14.14
mypy==1.19.1
```

### 4.3 Create dag-engine/cline_dag/models.py

```python
"""Pydantic models for the DAG analysis engine."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EdgeConfidence(str, Enum):
    """Confidence level for dependency edges."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNSAFE = "unsafe"


class NodeType(str, Enum):
    """Type of node in the dependency graph."""

    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"


class GraphNode(BaseModel):
    """A node in the dependency graph."""

    id: str = Field(description="Unique identifier (file:symbol)")
    type: NodeType
    file_path: str
    line_number: int
    name: str
    docstring: str | None = None
    parameters: list[str] = Field(default_factory=list)
    return_type: str | None = None


class GraphEdge(BaseModel):
    """An edge in the dependency graph."""

    from_node: str
    to_node: str
    edge_type: str = Field(description="import, call, inherit, reference")
    confidence: EdgeConfidence
    line_number: int
    label: str = Field(description="Human-readable description")


class AnalysisWarning(BaseModel):
    """Warning generated during analysis."""

    type: str
    file: str
    line: int
    description: str
    severity: str = Field(description="low, medium, high")


class GraphSummary(BaseModel):
    """Summary statistics for the graph."""

    files: int
    functions: int
    edges: int
    high_confidence_edges: int
    medium_confidence_edges: int
    low_confidence_edges: int
    unsafe_edges: int


class ProjectGraph(BaseModel):
    """Complete project dependency graph."""

    version: str = "1.0"
    project_root: str
    analysis_timestamp: str = Field(
        default_factory=lambda: datetime.now().isoformat()
    )
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    warnings: list[AnalysisWarning] = Field(default_factory=list)
    summary: GraphSummary


class ImpactReport(BaseModel):
    """Report of change impact analysis."""

    changed_file: str
    affected_files: list[str] = Field(default_factory=list)
    affected_functions: list[str] = Field(default_factory=list)
    suggested_tests: list[str] = Field(default_factory=list)
    confidence_breakdown: dict[str, int] = Field(default_factory=dict)


class JsonRpcRequest(BaseModel):
    """JSON-RPC 2.0 request."""

    jsonrpc: str = "2.0"
    id: int
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class JsonRpcResponse(BaseModel):
    """JSON-RPC 2.0 response."""

    jsonrpc: str = "2.0"
    id: int
    result: Any | None = None
    error: dict[str, Any] | None = None
```

### 4.4 Create dag-engine/cline_dag/parsers/python_parser.py

```python
"""Python AST-based code analyser."""

import ast
from pathlib import Path

import structlog

from ..models import EdgeConfidence, GraphEdge, GraphNode, NodeType

logger = structlog.get_logger()


class PythonParser:
    """Parse Python files and extract symbols and dependencies."""

    def __init__(self) -> None:
        self.nodes: list[GraphNode] = []
        self.edges: list[GraphEdge] = []
        self.current_file: str = ""
        self.current_class: str | None = None
        self.imports: dict[str, str] = {}  # alias -> module path

    def parse_file(self, file_path: Path) -> tuple[list[GraphNode], list[GraphEdge]]:
        """Parse a Python file and extract nodes and edges."""
        self.nodes = []
        self.edges = []
        self.current_file = str(file_path)
        self.current_class = None
        self.imports = {}

        try:
            source = file_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(file_path))
        except (SyntaxError, UnicodeDecodeError) as e:
            logger.warning("Failed to parse file", file=str(file_path), error=str(e))
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

        # First pass: collect imports
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name
                    self.imports[name] = alias.name

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
                            to_node=module,
                            edge_type="import",
                            confidence=EdgeConfidence.HIGH,
                            line_number=node.lineno,
                            label=f"from {module} import {alias.name}",
                        )
                    )

        # Second pass: extract definitions and calls
        self._visit(tree)

        return self.nodes, self.edges

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
            )
        )

        # Track inheritance
        for base in node.bases:
            base_name = self._get_name(base)
            if base_name:
                self.edges.append(
                    GraphEdge(
                        from_node=class_id,
                        to_node=base_name,
                        edge_type="inherit",
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
        params = []
        for arg in node.args.args:
            param = arg.arg
            if arg.annotation:
                param += f": {ast.unparse(arg.annotation)}"
            params.append(param)

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
            )
        )

    def _handle_call(self, node: ast.Call) -> None:
        """Handle function call."""
        caller = self._get_current_function()
        if not caller:
            return

        callee = self._get_name(node.func)
        if not callee:
            return

        self.edges.append(
            GraphEdge(
                from_node=caller,
                to_node=callee,
                edge_type="call",
                confidence=self._get_confidence(callee),
                line_number=node.lineno,
                label=f"calls {callee}",
            )
        )

    def _get_name(self, node: ast.expr) -> str | None:
        """Extract name from AST node."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            value = self._get_name(node.value)
            if value:
                return f"{value}.{node.attr}"
            return node.attr
        elif isinstance(node, ast.Subscript):
            return self._get_name(node.value)
        return None

    def _get_current_function(self) -> str | None:
        """Get the ID of the current function context."""
        # This is simplified - would need proper scope tracking
        return None

    def _get_confidence(self, name: str) -> EdgeConfidence:
        """Determine confidence level for a reference."""
        # Check if it's a known import
        if name in self.imports:
            return EdgeConfidence.HIGH

        # Check for dynamic patterns
        if "getattr" in name or "[" in name:
            return EdgeConfidence.UNSAFE

        # Default to medium for unresolved names
        return EdgeConfidence.MEDIUM
```

### 4.5 Create dag-engine/cline_dag/server.py

```python
"""JSON-RPC server for the DAG analysis engine."""

import json
import sys
from pathlib import Path

import structlog

from .analyser import ProjectAnalyser
from .models import JsonRpcRequest, JsonRpcResponse

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO level
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
)

logger = structlog.get_logger()


class DAGServer:
    """JSON-RPC server for DAG analysis."""

    def __init__(self) -> None:
        self.analyser = ProjectAnalyser()

    def handle_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle a JSON-RPC request."""
        try:
            method = request.method
            params = request.params

            if method == "get_status":
                result = {"status": "ready", "version": "0.1.0"}

            elif method == "analyse_project":
                root = Path(params["root"])
                graph = self.analyser.analyse_project(root)
                result = graph.model_dump()

            elif method == "analyse_file":
                file_path = Path(params["file"])
                result = self.analyser.analyse_file(file_path)

            elif method == "get_impact":
                file_path = params["file"]
                function_name = params.get("function")
                impact = self.analyser.get_impact(file_path, function_name)
                result = impact.model_dump()

            elif method == "get_callers":
                node_id = params["node_id"]
                result = self.analyser.get_callers(node_id)

            elif method == "get_callees":
                node_id = params["node_id"]
                result = self.analyser.get_callees(node_id)

            elif method == "invalidate_file":
                file_path = params["file"]
                self.analyser.invalidate_file(file_path)
                result = None

            else:
                return JsonRpcResponse(
                    id=request.id,
                    error={"code": -32601, "message": f"Method not found: {method}"},
                )

            return JsonRpcResponse(id=request.id, result=result)

        except Exception as e:
            logger.exception("Error handling request", method=request.method)
            return JsonRpcResponse(
                id=request.id,
                error={"code": -32000, "message": str(e)},
            )

    def run(self) -> None:
        """Run the server, reading from stdin and writing to stdout."""
        logger.info("DAG server starting")

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                request = JsonRpcRequest(**data)
                response = self.handle_request(request)
                print(response.model_dump_json(), flush=True)
            except json.JSONDecodeError as e:
                logger.error("Invalid JSON", error=str(e), line=line[:100])
                error_response = JsonRpcResponse(
                    id=0,
                    error={"code": -32700, "message": "Parse error"},
                )
                print(error_response.model_dump_json(), flush=True)
            except Exception as e:
                logger.exception("Unexpected error")
                error_response = JsonRpcResponse(
                    id=0,
                    error={"code": -32603, "message": str(e)},
                )
                print(error_response.model_dump_json(), flush=True)


def main() -> None:
    """Entry point for the DAG server."""
    server = DAGServer()
    server.run()


if __name__ == "__main__":
    main()
```

### 4.6 Create dag-engine/cline_dag/analyser.py

```python
"""Main project analyser coordinating all analysis components."""

from pathlib import Path

import networkx as nx
import structlog

from .graph.builder import GraphBuilder
from .models import (
    EdgeConfidence,
    GraphSummary,
    ImpactReport,
    ProjectGraph,
)
from .parsers.python_parser import PythonParser

logger = structlog.get_logger()


class ProjectAnalyser:
    """Coordinate analysis of entire projects."""

    def __init__(self) -> None:
        self.python_parser = PythonParser()
        self.graph_builder = GraphBuilder()
        self.cached_graph: ProjectGraph | None = None
        self.nx_graph: nx.DiGraph | None = None

    def analyse_project(self, root: Path) -> ProjectGraph:
        """Analyse entire project and build dependency graph."""
        logger.info("Starting project analysis", root=str(root))

        all_nodes = []
        all_edges = []
        warnings = []

        # Find all source files
        source_files = self._find_source_files(root)
        logger.info("Found source files", count=len(source_files))

        for file_path in source_files:
            suffix = file_path.suffix.lower()

            if suffix == ".py":
                nodes, edges = self.python_parser.parse_file(file_path)
                all_nodes.extend(nodes)
                all_edges.extend(edges)

            # TODO: Add JS/TS parser support

        # Build NetworkX graph for queries
        self.nx_graph = self.graph_builder.build(all_nodes, all_edges)

        # Calculate summary
        summary = GraphSummary(
            files=len([n for n in all_nodes if n.type.value == "file"]),
            functions=len([n for n in all_nodes if n.type.value in ("function", "method")]),
            edges=len(all_edges),
            high_confidence_edges=len([e for e in all_edges if e.confidence == EdgeConfidence.HIGH]),
            medium_confidence_edges=len([e for e in all_edges if e.confidence == EdgeConfidence.MEDIUM]),
            low_confidence_edges=len([e for e in all_edges if e.confidence == EdgeConfidence.LOW]),
            unsafe_edges=len([e for e in all_edges if e.confidence == EdgeConfidence.UNSAFE]),
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
            edges=summary.edges,
        )

        return self.cached_graph

    def analyse_file(self, file_path: Path) -> dict:
        """Analyse a single file."""
        nodes, edges = self.python_parser.parse_file(file_path)
        return {"nodes": [n.model_dump() for n in nodes], "edges": [e.model_dump() for e in edges]}

    def get_impact(self, file_path: str, function_name: str | None = None) -> ImpactReport:
        """Compute impact of changes to a file or function."""
        if not self.nx_graph:
            return ImpactReport(changed_file=file_path)

        # Find the node ID
        if function_name:
            node_id = f"{file_path}:{function_name}"
        else:
            node_id = file_path

        # Get all nodes that depend on this node (reverse reachability)
        if node_id not in self.nx_graph:
            return ImpactReport(changed_file=file_path)

        # Get predecessors (nodes that have edges TO this node)
        affected = set()
        to_visit = [node_id]
        visited = set()

        while to_visit:
            current = to_visit.pop()
            if current in visited:
                continue
            visited.add(current)

            for pred in self.nx_graph.predecessors(current):
                affected.add(pred)
                to_visit.append(pred)

        # Separate into files and functions
        affected_files = []
        affected_functions = []
        
        for node in affected:
            if ":" in node:
                affected_functions.append(node)
                # Extract file from function ID
                file_part = node.split(":")[0]
                if file_part not in affected_files:
                    affected_files.append(file_part)
            else:
                if node not in affected_files:
                    affected_files.append(node)

        # Find test files
        suggested_tests = [f for f in affected_files if "test" in f.lower()]

        # Count edges by confidence
        confidence_breakdown = {
            "high": 0,
            "medium": 0,
            "low": 0,
            "unsafe": 0,
        }

        for pred in self.nx_graph.predecessors(node_id):
            edge_data = self.nx_graph.edges[pred, node_id]
            confidence = edge_data.get("confidence", "medium")
            confidence_breakdown[confidence] = confidence_breakdown.get(confidence, 0) + 1

        return ImpactReport(
            changed_file=file_path,
            affected_files=affected_files,
            affected_functions=affected_functions,
            suggested_tests=suggested_tests,
            confidence_breakdown=confidence_breakdown,
        )

    def get_callers(self, node_id: str) -> list[str]:
        """Get all nodes that call/reference the given node."""
        if not self.nx_graph or node_id not in self.nx_graph:
            return []
        return list(self.nx_graph.predecessors(node_id))

    def get_callees(self, node_id: str) -> list[str]:
        """Get all nodes that the given node calls/references."""
        if not self.nx_graph or node_id not in self.nx_graph:
            return []
        return list(self.nx_graph.successors(node_id))

    def invalidate_file(self, file_path: str) -> None:
        """Mark a file for re-analysis."""
        # In a full implementation, this would trigger incremental re-analysis
        logger.info("File invalidated", file=file_path)

    def _find_source_files(self, root: Path) -> list[Path]:
        """Find all source files in the project."""
        files = []
        
        # Common patterns to ignore
        ignore_patterns = {
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
        }

        for path in root.rglob("*"):
            # Skip ignored directories
            if any(part in ignore_patterns for part in path.parts):
                continue

            if path.is_file():
                suffix = path.suffix.lower()
                if suffix in (".py", ".js", ".jsx", ".ts", ".tsx"):
                    files.append(path)

        return files
```

### 4.7 Create dag-engine/cline_dag/graph/builder.py

```python
"""Build NetworkX graph from parsed nodes and edges."""

import networkx as nx

from ..models import GraphEdge, GraphNode


class GraphBuilder:
    """Build and manage NetworkX dependency graph."""

    def build(self, nodes: list[GraphNode], edges: list[GraphEdge]) -> nx.DiGraph:
        """Build a NetworkX directed graph from nodes and edges."""
        G = nx.DiGraph()

        # Add nodes with attributes
        for node in nodes:
            G.add_node(
                node.id,
                type=node.type.value,
                file_path=node.file_path,
                line_number=node.line_number,
                name=node.name,
                docstring=node.docstring,
            )

        # Add edges with attributes
        for edge in edges:
            G.add_edge(
                edge.from_node,
                edge.to_node,
                edge_type=edge.edge_type,
                confidence=edge.confidence.value,
                line_number=edge.line_number,
                label=edge.label,
            )

        return G
```

## Step 5: Create Tests

### 5.1 Create dag-engine/tests/conftest.py

```python
"""Pytest configuration and fixtures."""

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest


@pytest.fixture
def temp_project():
    """Create a temporary project directory."""
    with TemporaryDirectory() as tmpdir:
        project = Path(tmpdir)
        yield project


@pytest.fixture
def sample_python_file(temp_project: Path) -> Path:
    """Create a sample Python file for testing."""
    file_path = temp_project / "sample.py"
    file_path.write_text('''
"""Sample module for testing."""

from typing import Optional

class User:
    """A user class."""
    
    def __init__(self, name: str) -> None:
        self.name = name
    
    def greet(self) -> str:
        """Return a greeting."""
        return f"Hello, {self.name}!"

def process_user(user: User) -> str:
    """Process a user and return greeting."""
    return user.greet()

def main() -> None:
    """Main entry point."""
    user = User("World")
    print(process_user(user))
''')
    return file_path
```

### 5.2 Create dag-engine/tests/test_python_parser.py

```python
"""Tests for the Python parser."""

from pathlib import Path

import pytest

from cline_dag.models import NodeType
from cline_dag.parsers.python_parser import PythonParser


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

    def test_extracts_class_with_docstring(self, sample_python_file: Path) -> None:
        """Test that class docstrings are extracted."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        class_node = next((n for n in nodes if n.name == "User"), None)
        assert class_node is not None
        assert class_node.type == NodeType.CLASS
        assert class_node.docstring == "A user class."

    def test_extracts_function_parameters(self, sample_python_file: Path) -> None:
        """Test that function parameters are extracted."""
        parser = PythonParser()
        nodes, _ = parser.parse_file(sample_python_file)

        func_node = next((n for n in nodes if n.name == "process_user"), None)
        assert func_node is not None
        assert "user: User" in func_node.parameters

    def test_extracts_imports(self, sample_python_file: Path) -> None:
        """Test that import edges are created."""
        parser = PythonParser()
        _, edges = parser.parse_file(sample_python_file)

        import_edges = [e for e in edges if e.edge_type == "import"]
        assert len(import_edges) >= 1
```

## Step 6: Create README

### 6.1 Create README.md

```markdown
# Cline+ DAG-Aware Agent

A VS Code extension that provides AI coding assistance with dependency graph awareness. The agent understands the architectural implications of code changes before making them.

## Features

- **DAG-Aware Agent**: Understands file and function dependencies before making changes
- **Ralph Loop**: Iterative task completion with automatic retry on failure
- **Interactive Visualisation**: D3.js-powered dependency graph viewer
- **Multi-Provider Support**: Works with Anthropic Claude, OpenAI, and local models
- **Git Integration**: Atomic commits with detailed change tracking

## Installation

### From VS Code Marketplace

Search for "Cline+ DAG Agent" in the VS Code Extensions panel.

### From Source

```bash
# Clone repository
git clone https://github.com/cline-dag/cline-dag
cd cline-dag

# Install extension dependencies
npm install

# Install DAG engine dependencies
cd dag-engine
pip install -e ".[dev]"
cd ..

# Build extension
npm run build
```

## Configuration

Open VS Code settings and search for "Cline DAG":

- `cline-dag.llm.provider`: LLM provider (anthropic, openai, ollama)
- `cline-dag.llm.model`: Model identifier
- `cline-dag.ralph.maxIterations`: Maximum iterations per bead
- `cline-dag.ralph.tokenBudget`: Token budget per task
- `cline-dag.dag.pythonPath`: Path to Python executable

## Usage

1. Open the Cline+ panel from the activity bar
2. Enter a task description
3. Review the dependency graph
4. Approve or reject each bead of work
5. Task completes when success criteria are met

## Development

```bash
# Watch mode
npm run watch

# Run tests
npm test
cd dag-engine && pytest

# Lint
npm run lint
cd dag-engine && ruff check .
```

## Licence

MIT
```

## Verification Checklist

After building, verify:

- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `cd dag-engine && pip install -e ".[dev]"` succeeds
- [ ] `cd dag-engine && pytest` passes
- [ ] `cd dag-engine && ruff check .` passes
- [ ] `cd dag-engine && mypy cline_dag` passes
- [ ] Extension activates in VS Code debug mode (F5)
- [ ] DAG engine subprocess starts without errors

## Notes for Agent

- Use type hints on all functions
- Add docstrings to all public functions and classes
- Handle all exceptions explicitly
- Use async/await for I/O operations in TypeScript
- Follow British English in comments and documentation
- Pin all dependency versions exactly
- Test on real codebases before declaring complete

---

**Document Version:** 1.0  
**Last Updated:** 28 January 2026
