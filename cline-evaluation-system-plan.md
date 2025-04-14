# Cline Evaluation System: Implementation Plan

This document outlines the comprehensive plan for implementing the Cline Evaluation System, which will allow us to benchmark Cline against various coding evaluation frameworks including modified Exercism, SWE-Bench, SWELancer, and Multi-SWE-Bench.

## Folder Architecture

The evaluation system will be organized with the following folder structure:

```
cline-repo/
├── src/
│   ├── services/
│   │   ├── test/
│   │   │   ├── TestServer.ts         # Enhanced HTTP server for task execution
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── evals/                            # Main directory for evaluation system
│   ├── cli/                          # CLI tool for orchestrating evaluations
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry point
│   │   │   ├── commands/             # CLI commands (setup, run, report)
│   │   │   ├── adapters/             # Benchmark adapters
│   │   │   ├── db/                   # Database management
│   │   │   └── utils/                # Utility functions
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── repositories/                 # Cloned benchmark repositories
│   │   ├── exercism/                 # Modified Exercism (from cte/evals)
│   │   ├── swe-bench/                # SWE-Bench repository
│   │   ├── swelancer/                # SWELancer repository
│   │   └── multi-swe/                # Multi-SWE-Bench repository
│   ├── results/                      # Evaluation results storage
│   │   ├── runs/                     # Individual run results
│   │   └── reports/                  # Generated reports
│   └── dashboard/                    # Optional web dashboard
│       ├── src/
│       ├── public/
│       └── package.json
└── ...
```

## Implementation Plan

### Phase 1: Enhance Test Server

The first step is to enhance our existing HTTP server to provide comprehensive task results.

#### 1.1 Update `/task` Endpoint

Modify the existing endpoint in `src/services/test/TestServer.ts` to return detailed information about completed tasks:

```typescript
// Enhanced response format
{
  success: true,
  taskId: "task123",
  completed: true,
  metrics: {
    tokensIn: 1234,
    tokensOut: 5678,
    cost: 0.05,
    duration: 45000, // ms
  },
  messages: [...],  // All messages from the conversation
  files: {
    created: ["file1.js", "file2.js"],
    modified: ["existing.js"],
    deleted: ["old.js"],
    diff: "..." // Full Git diff
  }
}
```

#### 1.2 Implement Git Integration

Add Git-based file tracking to capture changes made during task execution:

```typescript
async function getFileChanges(workspacePath: string): Promise<{
  created: string[],
  modified: string[],
  deleted: string[],
  diff: string
}> {
  // Get list of changed files
  const { stdout: statusOutput } = await execa('git', ['status', '--porcelain'], { cwd: workspacePath });
  
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  
  // Parse git status output
  statusOutput.split('\n').filter(Boolean).forEach(line => {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    
    if (status === 'A' || status === '??') {
      created.push(file);
    } else if (status === 'M') {
      modified.push(file);
    } else if (status === 'D') {
      deleted.push(file);
    }
  });
  
  // Get the full diff
  const { stdout: diffOutput } = await execa('git', ['diff'], { cwd: workspacePath });
  
  return {
    created,
    modified,
    deleted,
    diff: diffOutput
  };
}
```

#### 1.3 Collect Task Metrics

Enhance the task completion handler to collect comprehensive metrics:

```typescript
// When task completes
const taskHistory = await visibleWebview.controller.getTaskHistory();
const taskData = taskHistory.find(t => t.id === taskId);
const messages = await getSavedClineMessages(context, taskId);
const fileChanges = await getFileChanges(workspacePath);

// Return comprehensive data
res.end(JSON.stringify({
  success: true,
  taskId,
  completed: true,
  metrics: {
    tokensIn: taskData.tokensIn,
    tokensOut: taskData.tokensOut,
    cost: taskData.totalCost,
    duration: Date.now() - taskStartTime,
  },
  messages,
  files: fileChanges
}));
```

#### 1.4 Implement Tool Call Tracking

Add functionality to track tool calls and failures during task execution:

```typescript
// Track tool calls and failures during task execution
function createToolCallTracker(webviewProvider: WebviewProvider): {
  toolCalls: Record<string, number>;
  toolFailures: Record<string, number>;
} {
  const tracker = {
    toolCalls: {} as Record<string, number>,
    toolFailures: {} as Record<string, number>
  };
  
  // Intercept messages to track tool usage
  const originalPostMessageToWebview = webviewProvider.controller.postMessageToWebview;
  webviewProvider.controller.postMessageToWebview = async (message: ExtensionMessage) => {
    // Track tool calls
    if (message.type === "partialMessage" && message.partialMessage?.say === "tool") {
      const toolName = (message.partialMessage.text as any)?.tool;
      if (toolName) {
        tracker.toolCalls[toolName] = (tracker.toolCalls[toolName] || 0) + 1;
      }
    }
    
    // Track tool failures
    if (message.type === "partialMessage" && message.partialMessage?.say === "error") {
      const errorText = message.partialMessage.text;
      if (errorText && errorText.includes("Error executing tool")) {
        const match = errorText.match(/Error executing tool: (\w+)/);
        if (match && match[1]) {
          const toolName = match[1];
          tracker.toolFailures[toolName] = (tracker.toolFailures[toolName] || 0) + 1;
        }
      }
    }
    
    return originalPostMessageToWebview.call(webviewProvider.controller, message);
  };
  
  return tracker;
}
```

Update the task completion handler to include tool metrics:

```typescript
// Initialize tool tracker when starting a task
const toolTracker = createToolCallTracker(visibleWebview);

// When task completes
const taskHistory = await visibleWebview.controller.getTaskHistory();
const taskData = taskHistory.find(t => t.id === taskId);
const messages = await getSavedClineMessages(context, taskId);
const fileChanges = await getFileChanges(workspacePath);

// Get tool call metrics
const toolMetrics = {
  toolCalls: toolTracker.toolCalls,
  toolFailures: toolTracker.toolFailures,
  totalToolCalls: Object.values(toolTracker.toolCalls).reduce((a, b) => a + b, 0),
  totalToolFailures: Object.values(toolTracker.toolFailures).reduce((a, b) => a + b, 0),
  toolSuccessRate: calculateToolSuccessRate(toolTracker.toolCalls, toolTracker.toolFailures)
};

// Return comprehensive data
res.end(JSON.stringify({
  success: true,
  taskId,
  completed: true,
  metrics: {
    tokensIn: taskData.tokensIn,
    tokensOut: taskData.tokensOut,
    cost: taskData.totalCost,
    duration: Date.now() - taskStartTime,
    ...toolMetrics  // Include tool metrics
  },
  messages,
  files: fileChanges
}));
```

Helper function to calculate tool success rate:

```typescript
function calculateToolSuccessRate(
  toolCalls: Record<string, number>,
  toolFailures: Record<string, number>
): number {
  const totalCalls = Object.values(toolCalls).reduce((a, b) => a + b, 0);
  const totalFailures = Object.values(toolFailures).reduce((a, b) => a + b, 0);
  
  if (totalCalls === 0) {
    return 1.0; // No calls means no failures
  }
  
  return 1.0 - (totalFailures / totalCalls);
}
```

### Phase 2: Create Core CLI Framework

Next, we'll build a flexible CLI tool that can orchestrate evaluations across multiple benchmarks.

#### 2.1 Set Up CLI Project

Create a new package for the CLI tool:

```bash
mkdir -p evals/cli
cd evals/cli
npm init -y
npm install yargs execa sqlite better-sqlite3 chalk ora commander
npm install --save-dev typescript @types/node @types/yargs
```

#### 2.2 Define CLI Structure

Implement the core CLI structure with commands for setup, running evaluations, and reporting:

```typescript
// evals/cli/src/index.ts
import yargs from 'yargs';
import { setupHandler } from './commands/setup';
import { runHandler } from './commands/run';
import { reportHandler } from './commands/report';

const cli = yargs
  .command('setup', 'Clone and set up benchmark repositories', {
    benchmarks: {
      describe: 'Comma-separated list of benchmarks to set up',
      type: 'string',
      default: 'exercism,swe-bench,swelancer,multi-swe'
    }
  }, setupHandler)
  .command('run', 'Run evaluations', {
    benchmark: {
      describe: 'Specific benchmark to run',
      type: 'string'
    },
    model: {
      describe: 'Model to evaluate',
      type: 'string',
      default: 'claude-3-opus-20240229'
    },
    count: {
      describe: 'Number of tasks to run',
      type: 'number'
    }
  }, runHandler)
  .command('report', 'Generate reports', {}, reportHandler)
  .help()
  .argv;
```

#### 2.3 Implement VSCode Spawning

Create a utility function to spawn VSCode instances with the Cline extension:

```typescript
// evals/cli/src/utils/vscode.ts
import { execa } from 'execa';
import * as path from 'path';

export async function spawnVSCode(workspacePath: string, vsixPath?: string): Promise<void> {
  const args = ['--disable-workspace-trust', '-n', workspacePath];
  
  // If a specific VSIX is provided, install it
  if (vsixPath) {
    args.unshift('--install-extension', vsixPath);
  }
  
  await execa('code', args, {
    env: {
      CLINE_TEST_MODE: 'true',  // Enable test mode
    },
    stdio: 'inherit'
  });
}
```

#### 2.4 Implement Task Submission

Create a function to send tasks to the HTTP server:

```typescript
// evals/cli/src/utils/task.ts
import fetch from 'node-fetch';

export async function sendTaskToServer(task: string): Promise<any> {
  const response = await fetch('http://localhost:9876/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ task }),
  });
  
  return response.json();
}
```

### Phase 3: Implement Benchmark Adapters

Create adapters for each benchmark type to standardize task execution.

#### 3.1 Define Adapter Interface

Create a common interface for all benchmark adapters:

```typescript
// evals/cli/src/adapters/types.ts
export interface Task {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  setupCommands: string[];
  verificationCommands: string[];
  metadata: Record<string, any>;
}

export interface VerificationResult {
  success: boolean;
  metrics: Record<string, any>;
}

export interface BenchmarkAdapter {
  name: string;
  setup(): Promise<void>;
  listTasks(): Promise<Task[]>;
  prepareTask(taskId: string): Promise<Task>;
  verifyResult(task: Task, result: any): Promise<VerificationResult>;
}
```

#### 3.2 Implement Exercism Adapter

Create an adapter for the modified Exercism benchmark:

```typescript
// evals/cli/src/adapters/exercism.ts
import * as path from 'path';
import * as fs from 'fs';
import { execa } from 'execa';
import { BenchmarkAdapter, Task, VerificationResult } from './types';

const EVALS_DIR = path.resolve(__dirname, '../../../repositories');

export class ExercismAdapter implements BenchmarkAdapter {
  name = 'exercism';
  
  async setup(): Promise<void> {
    // Clone repository if needed
    if (!fs.existsSync(path.join(EVALS_DIR, 'exercism'))) {
      await execa('git', ['clone', 'https://github.com/cte/evals.git', 
                         path.join(EVALS_DIR, 'exercism')]);
    }
  }
  
  async listTasks(): Promise<Task[]> {
    const tasks: Task[] = [];
    const exercisesDir = path.join(EVALS_DIR, 'exercism');
    
    // Read language directories
    const languages = fs.readdirSync(exercisesDir)
      .filter(dir => fs.statSync(path.join(exercisesDir, dir)).isDirectory())
      .filter(dir => !dir.startsWith('.'));
    
    for (const language of languages) {
      const languageDir = path.join(exercisesDir, language);
      
      // Read exercise directories
      const exercises = fs.readdirSync(languageDir)
        .filter(dir => fs.statSync(path.join(languageDir, dir)).isDirectory());
      
      for (const exercise of exercises) {
        const exerciseDir = path.join(languageDir, exercise);
        
        // Read instructions
        let description = '';
        const instructionsPath = path.join(exerciseDir, 'instructions.md');
        if (fs.existsSync(instructionsPath)) {
          description = fs.readFileSync(instructionsPath, 'utf-8');
        }
        
        // Determine test commands based on language
        let testCommands: string[] = [];
        switch (language) {
          case 'javascript':
            testCommands = ['pnpm install', 'pnpm test'];
            break;
          case 'python':
            testCommands = ['uv run python3 -m pytest -o markers=task *_test.py'];
            break;
          case 'go':
            testCommands = ['go test'];
            break;
          case 'java':
            testCommands = ['./gradlew test'];
            break;
          case 'rust':
            testCommands = ['cargo test'];
            break;
        }
        
        tasks.push({
          id: `exercism-${language}-${exercise}`,
          name: exercise,
          description,
          workspacePath: exerciseDir,
          setupCommands: [],
          verificationCommands: testCommands,
          metadata: {
            language,
            type: 'exercism'
          }
        });
      }
    }
    
    return tasks;
  }
  
  async prepareTask(taskId: string): Promise<Task> {
    const tasks = await this.listTasks();
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    // Initialize Git repository for tracking changes
    await execa('git', ['init'], { cwd: task.workspacePath });
    await execa('git', ['add', '.'], { cwd: task.workspacePath });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: task.workspacePath });
    
    return task;
  }
  
  async verifyResult(task: Task, result: any): Promise<VerificationResult> {
    // Run verification commands
    let success = true;
    let output = '';
    
    for (const command of task.verificationCommands) {
      try {
        const [cmd, ...args] = command.split(' ');
        const { stdout } = await execa(cmd, args, { cwd: task.workspacePath });
        output += stdout + '\n';
      } catch (error) {
        success = false;
        output += error.stdout + '\n' + error.stderr + '\n';
      }
    }
    
    // Parse test results
    const testsPassed = (output.match(/PASS/g) || []).length;
    const testsFailed = (output.match(/FAIL/g) || []).length;
    const testsTotal = testsPassed + testsFailed;
    
    return {
      success,
      metrics: {
        testsPassed,
        testsFailed,
        testsTotal,
        functionalCorrectness: testsTotal > 0 ? testsPassed / testsTotal : 0
      }
    };
  }
}
```

#### 3.3 Implement SWE-Bench Adapter

Create an adapter for the SWE-Bench benchmark:

```typescript
// evals/cli/src/adapters/swe-bench.ts
import * as path from 'path';
import * as fs from 'fs';
import { execa } from 'execa';
import { BenchmarkAdapter, Task, VerificationResult } from './types';

const EVALS_DIR = path.resolve(__dirname, '../../../repositories');

export class SWEBenchAdapter implements BenchmarkAdapter {
  name = 'swe-bench';
  
  async setup(): Promise<void> {
    // Clone repository if needed
    if (!fs.existsSync(path.join(EVALS_DIR, 'swe-bench'))) {
      await execa('git', ['clone', 'https://github.com/SWE-bench/SWE-bench', 
                         path.join(EVALS_DIR, 'swe-bench')]);
    }
    
    // Install dependencies
    await execa('pip', ['install', '-r', 'requirements.txt'], 
               { cwd: path.join(EVALS_DIR, 'swe-bench') });
  }
  
  async listTasks(): Promise<Task[]> {
    // Implementation specific to SWE-Bench
    // ...
  }
  
  async prepareTask(taskId: string): Promise<Task> {
    // Implementation specific to SWE-Bench
    // ...
  }
  
  async verifyResult(task: Task, result: any): Promise<VerificationResult> {
    // Implementation specific to SWE-Bench
    // ...
  }
}
```

#### 3.4 Implement Remaining Adapters

Similarly, implement adapters for SWELancer and Multi-SWE-Bench.

#### 3.5 Create Adapter Registry

Create a registry to manage all adapters:

```typescript
// evals/cli/src/adapters/index.ts
import { BenchmarkAdapter } from './types';
import { ExercismAdapter } from './exercism';
import { SWEBenchAdapter } from './swe-bench';
import { SWELancerAdapter } from './swelancer';
import { MultiSWEAdapter } from './multi-swe';

const adapters: Record<string, BenchmarkAdapter> = {
  'exercism': new ExercismAdapter(),
  'swe-bench': new SWEBenchAdapter(),
  'swelancer': new SWELancerAdapter(),
  'multi-swe': new MultiSWEAdapter()
};

export function getAdapter(name: string): BenchmarkAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Adapter for benchmark '${name}' not found`);
  }
  return adapter;
}

export function getAllAdapters(): BenchmarkAdapter[] {
  return Object.values(adapters);
}
```

### Phase 4: Add Results Storage & Database

Create a database for storing evaluation results and metrics.

#### 4.1 Define Database Schema

Create a SQLite database with tables for runs, tasks, and results:

```typescript
// evals/cli/src/db/schema.ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  total_tool_failures INTEGER DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
`;
```

#### 4.2 Implement Database Class

Create a class to manage database operations:

```typescript
// evals/cli/src/db/index.ts
import * as path from 'path';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

const EVALS_DIR = path.resolve(__dirname, '../../../');

export class ResultsDatabase {
  private db: Database.Database;
  
  constructor() {
    this.db = new Database(path.join(EVALS_DIR, 'results', 'evals.db'));
    this.initSchema();
  }
  
  private initSchema(): void {
    this.db.exec(SCHEMA);
  }
  
  createRun(id: string, model: string, benchmark: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, timestamp, model, benchmark)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(id, Date.now(), model, benchmark);
  }
  
  completeRun(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE runs SET completed = 1 WHERE id = ?
    `);
    
    stmt.run(id);
  }
  
  createTask(id: string, runId: string, taskId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, run_id, task_id, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(id, runId, taskId, Date.now());
  }
  
  completeTask(id: string, success: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET success = ? WHERE id = ?
    `);
    
    stmt.run(success ? 1 : 0, id);
  }
  
  addMetric(taskId: string, name: string, value: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (task_id, name, value)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(taskId, name, value);
  }
  
  addFile(taskId: string, path: string, status: 'created' | 'modified' | 'deleted'): void {
    const stmt = this.db.prepare(`
      INSERT INTO files (task_id, path, status)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(taskId, path, status);
  }
  
  getRuns(): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM runs ORDER BY timestamp DESC
    `);
    
    return stmt.all();
  }
  
  getRunTasks(runId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE run_id = ? ORDER BY timestamp ASC
    `);
    
    return stmt.all(runId);
  }
  
  getTaskMetrics(taskId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT name, value FROM metrics WHERE task_id = ?
    `);
    
    return stmt.all(taskId);
  }
  
  getTaskFiles(taskId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT path, status FROM files WHERE task_id = ?
    `);
    
    return stmt.all(taskId);
  }
}
```

#### 4.3 Implement Result Storage

Create functions to store task results in the database:

```typescript
// evals/cli/src/utils/results.ts
import { v4 as uuidv4 } from 'uuid';
import { ResultsDatabase } from '../db';

export async function storeTaskResult(
  runId: string,
  task: any,
  result: any,
  verification: any
): Promise<void> {
  const db = new ResultsDatabase();
  const taskId = uuidv4();
  
  // Store task with tool call metrics
  const totalToolCalls = result.metrics.totalToolCalls || 0;
  const totalToolFailures = result.metrics.totalToolFailures || 0;
  
  // Create task with tool metrics
  const stmt = db.db.prepare(`
    INSERT INTO tasks (id, run_id, task_id, timestamp, success, total_tool_calls, total_tool_failures)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    taskId, 
    runId, 
    task.id, 
    Date.now(), 
    verification.success ? 1 : 0,
    totalToolCalls,
    totalToolFailures
  );
  
  // Store metrics
  db.addMetric(taskId, 'tokensIn', result.metrics.tokensIn);
  db.addMetric(taskId, 'tokensOut', result.metrics.tokensOut);
  db.addMetric(taskId, 'cost', result.metrics.cost);
  db.addMetric(taskId, 'duration', result.metrics.duration);
  
  // Store tool call metrics
  if (result.metrics.toolCalls) {
    const addToolCallStmt = db.db.prepare(`
      INSERT INTO tool_calls (task_id, tool_name, call_count, failure_count)
      VALUES (?, ?, ?, ?)
    `);
    
    for (const [toolName, callCount] of Object.entries(result.metrics.toolCalls)) {
      const failureCount = result.metrics.toolFailures?.[toolName] || 0;
      addToolCallStmt.run(taskId, toolName, callCount, failureCount);
    }
  }
  
  // Store verification metrics
  for (const [key, value] of Object.entries(verification.metrics)) {
    if (typeof value === 'number') {
      db.addMetric(taskId, key, value);
    }
  }
  
  // Store file changes
  for (const file of result.files.created) {
    db.addFile(taskId, file, 'created');
  }
  
  for (const file of result.files.modified) {
    db.addFile(taskId, file, 'modified');
  }
  
  for (const file of result.files.deleted) {
    db.addFile(taskId, file, 'deleted');
  }
}
```

### Phase 5: Create Reporting System

Build a reporting system for analyzing evaluation results.

#### 5.1 Implement Report Generation

Create functions to generate reports from the database:

```typescript
// evals/cli/src/commands/report.ts
import * as fs from 'fs';
import * as path from 'path';
import { ResultsDatabase } from '../db';

export async function reportHandler(argv: any): Promise<void> {
  const db = new ResultsDatabase();
  const runs = db.getRuns();
  
  console.log(`Found ${runs.length} evaluation runs`);
  
  // Generate summary report
  const summary = {
    runs: runs.length,
    models: [...new Set(runs.map(run => run.model))],
    benchmarks: [...new Set(runs.map(run => run.benchmark))],
    tasks: 0,
    successRate: 0,
    averageTokens: 0,
    averageCost: 0,
    averageDuration: 0,
    totalToolCalls: 0,
    totalToolFailures: 0,
    toolSuccessRate: 0,
    toolUsage: {} as Record<string, { calls: number, failures: number }>
  };
  
  let totalTasks = 0;
  let successfulTasks = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let totalToolCalls = 0;
  let totalToolFailures = 0;
  
  for (const run of runs) {
    const tasks = db.getRunTasks(run.id);
    totalTasks += tasks.length;
    
    for (const task of tasks) {
      if (task.success) {
        successfulTasks++;
      }
      
      const metrics = db.getTaskMetrics(task.id);
      
      const tokensIn = metrics.find(m => m.name === 'tokensIn')?.value || 0;
      const tokensOut = metrics.find(m => m.name === 'tokensOut')?.value || 0;
      totalTokens += tokensIn + tokensOut;
      
      totalCost += metrics.find(m => m.name === 'cost')?.value || 0;
      totalDuration += metrics.find(m => m.name === 'duration')?.value || 0;
      
      // Collect tool call metrics
      totalToolCalls += task.total_tool_calls || 0;
      totalToolFailures += task.total_tool_failures || 0;
      
      // Get detailed tool usage
      const stmt = db.db.prepare(`
        SELECT tool_name, call_count, failure_count 
        FROM tool_calls 
        WHERE task_id = ?
      `);
      
      const toolCalls = stmt.all(task.id);
      
      for (const toolCall of toolCalls) {
        if (!summary.toolUsage[toolCall.tool_name]) {
          summary.toolUsage[toolCall.tool_name] = {
            calls: 0,
            failures: 0
          };
        }
        
        summary.toolUsage[toolCall.tool_name].calls += toolCall.call_count;
        summary.toolUsage[toolCall.tool_name].failures += toolCall.failure_count;
      }
    }
  }
  
  // Calculate tool success rate
  summary.totalToolCalls = totalToolCalls;
  summary.totalToolFailures = totalToolFailures;
  summary.toolSuccessRate = totalToolCalls > 0 ? 1 - (totalToolFailures / totalToolCalls) : 1.0;
  
  summary.tasks = totalTasks;
  summary.successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;
  summary.averageTokens = totalTasks > 0 ? totalTokens / totalTasks : 0;
  summary.averageCost = totalTasks > 0 ? totalCost / totalTasks : 0;
  summary.averageDuration = totalTasks > 0 ? totalDuration / totalTasks : 0;
  
  // Generate benchmark-specific reports
  const benchmarkReports: Record<string, any> = {};
  
  for (const benchmark of summary.benchmarks) {
    const benchmarkRuns = runs.filter(run => run.benchmark === benchmark);
    const benchmarkSummary = {
      runs: benchmarkRuns.length,
      models: [...new Set(benchmarkRuns.map(run => run.model))],
      tasks: 0,
      successRate: 0,
      averageTokens: 0,
      averageCost: 0,
      averageDuration: 0
    };
    
    let benchmarkTasks = 0;
    let benchmarkSuccessfulTasks = 0;
    let benchmarkTotalTokens = 0;
    let benchmarkTotalCost = 0;
    let benchmarkTotalDuration = 0;
    
    for (const run of benchmarkRuns) {
      const tasks = db.getRunTasks(run.id);
      benchmarkTasks += tasks.length;
      
      for (const task of tasks) {
        if (task.success) {
          benchmarkSuccessfulTasks++;
        }
        
        const metrics = db.getTaskMetrics(task.id);
        
        const tokensIn = metrics.find(m => m.name === 'tokensIn')?.value || 0;
        const tokensOut = metrics.find(m => m.name === 'tokensOut')?.value || 0;
        benchmarkTotalTokens += tokensIn + tokensOut;
        
        benchmarkTotalCost += metrics.find(m => m.name === 'cost')?.value || 0;
        benchmarkTotalDuration += metrics.find(m => m.name === 'duration')?.value || 0;
      }
    }
    
    benchmarkSummary.tasks = benchmarkTasks;
    benchmarkSummary.successRate = benchmarkTasks > 0 ? benchmarkSuccessfulTasks / benchmarkTasks : 0;
    benchmarkSummary.averageTokens = benchmarkTasks > 0 ? benchmarkTotalTokens / benchmarkTasks : 0;
    benchmarkSummary.averageCost = benchmarkTasks > 0 ? benchmarkTotalCost / benchmarkTasks : 0;
    benchmarkSummary.averageDuration = benchmarkTasks > 0 ? benchmarkTotalDuration / benchmarkTasks : 0;
    
    benchmarkReports[benchmark] = benchmarkSummary;
  }
  
  // Generate model-specific reports
  const modelReports: Record<string, any> = {};
  
  for (const model of summary.models) {
    const modelRuns = runs.filter(run => run.model === model);
    const modelSummary = {
      runs: modelRuns.length,
      benchmarks: [...new Set(modelRuns.map(run => run.benchmark))],
      tasks: 0,
      successRate: 0,
      averageTokens: 0,
      averageCost: 0,
      averageDuration: 0
    };
    
    // Similar calculation as above for model-specific metrics
    // ...
    
    modelReports[model] = modelSummary;
  }
  
  // Save reports
  const reportDir = path.join(__dirname, '../../../results/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  
  fs.writeFileSync(
    path.join(reportDir, `summary-${timestamp}.json`),
    JSON.stringify(summary, null, 2)
  );
  
  fs.writeFileSync(
    path.join(reportDir, `benchmarks-${timestamp}.json`),
    JSON.stringify(benchmarkReports, null, 2)
  );
  
  fs.writeFileSync(
    path.join(reportDir, `models-${timestamp}.json`),
    JSON.stringify(modelReports, null, 2)
  );
  
  console.log(`Reports generated in ${reportDir}`);
}
```

#### 5.2 Implement Markdown Report Generation

Create a function to generate markdown reports:

```typescript
// evals/cli/src/utils/markdown.ts
import * as fs from 'fs';
import * as path from 'path';

export function generateMarkdownReport(
  summary: any,
  benchmarkReports: Record<string, any>,
  modelReports: Record<string, any>,
  outputPath: string
): void {
  let markdown = `# Cline Evaluation Report\n\n`;
  
  markdown += `## Summary\n\n`;
  markdown += `- **Total Runs:** ${summary.runs}\n`;
  markdown += `- **Models:** ${summary.models.join(', ')}\n`;
  markdown += `- **Benchmarks:** ${summary.benchmarks.join(', ')}\n`;
  markdown += `- **Total Tasks:** ${summary.tasks}\n`;
  markdown += `- **Success Rate:** ${(summary.successRate * 100).toFixed(2)}%\n`;
  markdown += `- **Average Tokens:** ${Math.round(summary.averageTokens)}\n`;
  markdown += `- **Average Cost:** $${summary.averageCost.toFixed(4)}\n`;
  markdown += `- **Average Duration:** ${(summary.averageDuration / 1000).toFixed(2)}s\n`;
  markdown += `- **Total Tool Calls:** ${summary.totalToolCalls}\n`;
  markdown += `- **Tool Success Rate:** ${(summary.toolSuccessRate * 100).toFixed(2)}%\n\n`;
  
  markdown += `## Tool Usage\n\n`;
  markdown += `| Tool | Calls | Failures | Success Rate |\n`;
  markdown += `| ---- | ----- | -------- | ------------ |\n`;
  
  for (const [toolName, metrics] of Object.entries(summary.toolUsage)) {
    const successRate = metrics.calls > 0 ? 
      (1 - (metrics.failures / metrics.calls)) * 100 : 
      100;
    
    markdown += `| ${toolName} | ${metrics.calls} | ${metrics.failures} | ${successRate.toFixed(2)}% |\n`;
  }
  
  markdown += `\n## Benchmark Results\n\n`;
  
  for (const [benchmark, report] of Object.entries(benchmarkReports)) {
    markdown += `### ${benchmark}\n\n`;
    markdown += `- **Runs:** ${report.runs}\n`;
    markdown += `- **Models:** ${report.models.join(', ')}\n`;
    markdown += `- **Tasks:** ${report.tasks}\n`;
    markdown += `- **Success Rate:** ${(report.successRate * 100).toFixed(2)}%\n`;
    markdown += `- **Average Tokens:** ${Math.round(report.averageTokens)}\n`;
    markdown += `- **Average Cost:** $${report.averageCost.toFixed(4)}\n`;
    markdown += `- **Average Duration:** ${(report.averageDuration / 1000).toFixed(2)}s\n\n`;
  }
  
  markdown += `## Model Results\n\n`;
  
  for (const [model, report] of Object.entries(modelReports)) {
    markdown += `### ${model}\n\n`;
    markdown += `- **Runs:** ${report.runs}\n`;
    markdown += `- **Benchmarks:** ${report.benchmarks.join(', ')}\n`;
    markdown += `- **Tasks:** ${report.tasks}\n`;
    markdown += `- **Success Rate:** ${(report.successRate * 100).toFixed(2)}%\n`;
    markdown += `- **Average Tokens:** ${Math.round(report.averageTokens)}\n`;
    markdown += `- **Average Cost:** $${report.averageCost.toFixed(4)}\n`;
    markdown += `- **Average Duration:** ${(report.averageDuration / 1000).toFixed(2)}s\n\n`;
  }
  
  // Write markdown to file
  fs.writeFileSync(outputPath, markdown);
  
  console.log(`Markdown report generated at ${outputPath}`);
}
```

### Phase 6: Build Web Dashboard (Optional)

Create a simple web interface for viewing evaluation results.

#### 6.1 Set Up Dashboard Project

Create a new package for the web dashboard:

```bash
mkdir -p evals/dashboard
cd evals/dashboard
npm init -y
npm install express ejs chart.js sqlite better-sqlite3
npm install --save-dev typescript @types/node @types/express
```

#### 6.2 Implement Basic Server

Create a simple Express server to serve the dashboard:

```typescript
// evals/dashboard/src/index.ts
import express from 'express';
import * as path from 'path';
import { ResultsDatabase } from '../../cli/src/db';

const app = express();
const port = 3000;

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Dashboard route
app.get('/', async (req, res) => {
  const db = new ResultsDatabase();
  const runs = db.getRuns();
  
  res.render('dashboard', { runs });
});

// Run details route
app.get('/run/:id', async (req, res) => {
  const db = new ResultsDatabase();
  const run = db.getRuns().find(r => r.id === req.params.id);
  
  if (!run) {
    return res.status(404).send('Run not found');
  }
  
  const tasks = db.getRunTasks(run.id);
  
  // Collect metrics for each task
  const taskDetails = tasks.map(task => {
    const metrics = db.getTaskMetrics(task.id);
    const files = db.getTaskFiles(task.id);
    
    return {
      ...task,
      metrics: metrics.reduce((acc, m) => ({ ...acc, [m.name]: m.value }), {}),
      files: {
        created: files.filter(f => f.status === 'created').map(f => f.path),
        modified: files.filter(f => f.status === 'modified').map(f => f.path),
        deleted: files.filter(f => f.status === 'deleted').map(f => f.path)
      }
    };
  });
  
  res.render('run', { run, tasks: taskDetails });
});

// Start the server
app.listen(port, () => {
  console.log(`Dashboard available at http://localhost:${port}`);
});
```

#### 6.3 Create Dashboard Views

Create EJS templates for the dashboard:

```html
<!-- evals/dashboard/src/views/dashboard.ejs -->
<!DOCTYPE html>
<html>
<head>
  <title>Cline Evaluation Dashboard</title>
  <link rel="stylesheet" href="/css/styles.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <header>
    <h1>Cline Evaluation Dashboard</h1>
  </header>
  
  <main>
    <section class="summary">
      <h2>Evaluation Runs</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Date</th>
            <th>Model</th>
            <th>Benchmark</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <% runs.forEach(run => { %>
            <tr>
              <td><%= run.id %></td>
              <td><%= new Date(run.timestamp).toLocaleString() %></td>
              <td><%= run.model %></td>
              <td><%= run.benchmark %></td>
              <td><%= run.completed ? 'Completed' : 'In Progress' %></td>
              <td><a href="/run/<%= run.id %>">View Details</a></td>
            </tr>
          <% }); %>
        </tbody>
      </table>
    </section>
    
    <section class="charts">
      <h2>Success Rates by Benchmark</h2>
      <canvas id="benchmarkChart"></canvas>
      
      <h2>Success Rates by Model</h2>
      <canvas id="modelChart"></canvas>
    </section>
  </main>
  
  <script src="/js/dashboard.js"></script>
</body>
</html>
```

### Phase 7: Command Implementation

Implement the core CLI commands for running evaluations.

#### 7.1 Setup Command

Implement the setup command to clone and prepare benchmark repositories:

```typescript
// evals/cli/src/commands/setup.ts
import * as fs from 'fs';
import * as path from 'path';
import { getAllAdapters } from '../adapters';

export async function setupHandler(argv: any): Promise<void> {
  const benchmarks = argv.benchmarks.split(',');
  
  console.log(`Setting up benchmarks: ${benchmarks.join(', ')}`);
  
  // Create directories
  const evals_dir = path.resolve(__dirname, '../../../');
  const repos_dir = path.join(evals_dir, 'repositories');
  const results_dir = path.join(evals_dir, 'results');
  
  fs.mkdirSync(repos_dir, { recursive: true });
  fs.mkdirSync(results_dir, { recursive: true });
  fs.mkdirSync(path.join(results_dir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(results_dir, 'reports'), { recursive: true });
  
  // Set up each benchmark
  const adapters = getAllAdapters().filter(adapter => benchmarks.includes(adapter.name));
  
  for (const adapter of adapters) {
    console.log(`Setting up ${adapter.name}...`);
    await adapter.setup();
    console.log(`${adapter.name} setup complete`);
  }
  
  console.log('Setup complete');
}
```

#### 7.2 Run Command

Implement the run command to execute evaluations:

```typescript
// evals/cli/src/commands/run.ts
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ora from 'ora';
import { getAdapter, getAllAdapters } from '../adapters';
import { ResultsDatabase } from '../db';
import { spawnVSCode } from '../utils/vscode';
import { sendTaskToServer } from '../utils/task';
import { storeTaskResult } from '../utils/results';

export async function runHandler(argv: any): Promise<void> {
  // Determine which benchmarks to run
  const benchmarks = argv.benchmark ? [argv.benchmark] : getAllAdapters().map(a => a.name);
  const model = argv.model;
  const count = argv.count || Infinity;
  
  console.log(`Running evaluations for model: ${model}`);
  console.log(`Benchmarks: ${benchmarks.join(', ')}`);
  
  // Create a run for each benchmark
  for (const benchmark of benchmarks) {
    const runId = uuidv4();
    const db = new ResultsDatabase();
    
    console.log(`\nStarting run for benchmark: ${benchmark}`);
    
    // Create run in database
    db.createRun(runId, model, benchmark);
    
    // Get adapter for this benchmark
    const adapter = getAdapter(benchmark);
    
    // List tasks
    const spinner = ora('Listing tasks...').start();
    const tasks = await adapter.listTasks();
    spinner.succeed(`Found ${tasks.length} tasks for ${benchmark}`);
    
    // Limit number of tasks if specified
    const tasksToRun = tasks.slice(0, count);
    
    console.log(`Running ${tasksToRun.length} tasks...`);
    
    // Run each task
    for (let i = 0; i < tasksToRun.length; i++) {
      const task = tasksToRun[i];
      
      console.log(`\nTask ${i + 1}/${tasksToRun.length}: ${task.name}`);
      
      // Prepare task
      const spinner = ora('Preparing task...').start();
      const preparedTask = await adapter.prepareTask(task.id);
      spinner.succeed('Task prepared');
      
      // Spawn VSCode
      console.log('Spawning VSCode...');
      await spawnVSCode(preparedTask.workspacePath);
      
      // Send task to server
      console.log('Sending task to server...');
      const result = await sendTaskToServer(preparedTask.description);
      
      // Verify result
      console.log('Verifying result...');
      const verification = await adapter.verifyResult(preparedTask, result);
      
      // Store result
      console.log('Storing result...');
      await storeTaskResult(runId, preparedTask, result, verification);
      
      console.log(`Task completed. Success: ${verification.success}`);
    }
    
    // Mark run as complete
    db.completeRun(runId);
    
    console.log(`\nRun complete for benchmark: ${benchmark}`);
  }
  
  console.log('\nAll evaluations complete');
}
```

### Phase 8: Integration and Testing

Integrate all components and test the evaluation system.

#### 8.1 Integration Testing

Create a test script to verify the integration of all components:

```typescript
// evals/cli/src/test/integration.ts
import * as path from 'path';
import { execa } from 'execa';
import { getAdapter } from '../adapters';
import { spawnVSCode } from '../utils/vscode';
import { sendTaskToServer } from '../utils/task';

async function runIntegrationTest(): Promise<void> {
  console.log('Running integration test...');
  
  // Test adapter setup
  const adapter = getAdapter('exercism');
  await adapter.setup();
  
  // Test task listing
  const tasks = await adapter.listTasks();
  console.log(`Found ${tasks.length} tasks`);
  
  if (tasks.length === 0) {
    throw new Error('No tasks found');
  }
  
  // Test task preparation
  const task = tasks[0];
  const preparedTask = await adapter.prepareTask(task.id);
  
  // Test VSCode spawning
  await spawnVSCode(preparedTask.workspacePath);
  
  // Test task submission
  const result = await sendTaskToServer(preparedTask.description);
  
  // Test result verification
  const verification = await adapter.verifyResult(preparedTask, result);
  
  console.log('Integration test complete');
  console.log('Result:', result);
  console.log('Verification:', verification);
}

runIntegrationTest().catch(console.error);
```

#### 8.2 End-to-End Testing

Create a script to run a complete end-to-end test:

```typescript
// evals/cli/src/test/e2e.ts
import { execa } from 'execa';

async function runE2ETest(): Promise<void> {
  console.log('Running end-to-end test...');
  
  // Setup
  await execa('node', ['dist/index.js', 'setup', '--benchmarks', 'exercism'], { stdio: 'inherit' });
  
  // Run a single task
  await execa('node', ['dist/index.js', 'run', '--benchmark', 'exercism', '--model', 'claude-3-opus-20240229', '--count', '1'], { stdio: 'inherit' });
  
  // Generate report
  await execa('node', ['dist/index.js', 'report'], { stdio: 'inherit' });
  
  console.log('End-to-end test complete');
}

runE2ETest().catch(console.error);
```

## Conclusion

This implementation plan provides a comprehensive roadmap for building the Cline Evaluation System. By following these steps, we can create a flexible and powerful system for benchmarking Cline against various coding evaluation frameworks.

The key components of the system are:

1. **Enhanced Test Server**: Provides detailed task results including metrics and file changes
2. **CLI Framework**: Orchestrates evaluations across multiple benchmarks
3. **Benchmark Adapters**: Standardize task execution for different benchmark types
4. **Results Storage**: Stores evaluation results in a database for analysis
5. **Reporting System**: Generates reports and visualizations of evaluation results
6. **Web Dashboard**: Provides a user-friendly interface for viewing results

This modular approach allows us to start with a simple implementation and gradually add support for more benchmarks and features as needed.
