# Bead Data Model

Complete type definitions for the bead workflow system.

## Core Types

```typescript
// src/shared/beads.ts

/**
 * A discrete unit of work within a task.
 */
export interface Bead {
  /** Unique identifier */
  id: string;

  /** Parent task ID */
  taskId: string;

  /** Sequential bead number within the task */
  beadNumber: number;

  /** Current status */
  status: BeadStatus;

  /** When this bead started */
  startedAt: Date;

  /** When this bead completed (if finished) */
  completedAt?: Date;

  /** The prompt sent to the LLM */
  prompt: string;

  /** The LLM's response */
  response: string;

  /** Files modified during this bead */
  filesChanged: FileChange[];

  /** Test results if tests were run */
  testResults?: TestResult[];

  /** Git commit hash if committed */
  commitHash?: string;

  /** Tokens consumed by this bead */
  tokensUsed: number;

  /** Number of retry iterations within this bead */
  iterationCount: number;

  /** Impact analysis from DAG */
  impactSummary?: ImpactSummary;
}

export type BeadStatus =
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'skipped';

/**
 * A file modification within a bead.
 */
export interface FileChange {
  /** Relative file path */
  filePath: string;

  /** Type of change */
  changeType: 'created' | 'modified' | 'deleted';

  /** Unified diff */
  diff: string;

  /** Lines added */
  linesAdded: number;

  /** Lines removed */
  linesRemoved: number;

  /** Nodes impacted by this change (from DAG) */
  impactedNodes?: string[];
}

/**
 * Result of running a test.
 */
export interface TestResult {
  /** Test name/identifier */
  name: string;

  /** Whether the test passed */
  passed: boolean;

  /** Test output (truncated) */
  output?: string;

  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Summary of change impact from DAG analysis.
 */
export interface ImpactSummary {
  /** Files that may be affected */
  affectedFiles: string[];

  /** Functions that may be affected */
  affectedFunctions: string[];

  /** Suggested test files to run */
  suggestedTests: string[];

  /** Breakdown by confidence level */
  confidenceBreakdown: {
    high: number;
    medium: number;
    low: number;
    unsafe: number;
  };
}
```

## Task Definition

```typescript
/**
 * Definition of a task to execute.
 */
export interface TaskDefinition {
  /** Unique task identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Absolute path to workspace root */
  workspaceRoot: string;

  /** Conditions that must be met for completion */
  successCriteria: SuccessCriterion[];

  /** Maximum tokens to consume */
  tokenBudget: number;

  /** Maximum bead iterations before failing */
  maxIterations: number;

  /** Optional test command override */
  testCommand?: string;
}

/**
 * A condition for task completion.
 */
export interface SuccessCriterion {
  /** Type of criterion */
  type: 'tests_pass' | 'done_tag' | 'no_errors' | 'custom';

  /** Optional configuration for the criterion */
  config?: Record<string, unknown>;
}
```

## Task State Extensions

Add these fields to `src/core/task/TaskState.ts`:

```typescript
export interface TaskState {
  // ... existing fields ...

  /** Current bead ID */
  currentBeadId?: string;

  /** Current bead number */
  beadNumber: number;

  /** Current bead status */
  beadStatus: BeadStatus;

  /** Iterations within current bead */
  beadIterationCount: number;

  /** Success criteria for this task */
  successCriteria: SuccessCriterion[];

  /** Remaining token budget */
  tokenBudgetRemaining: number;

  /** Summary of last completed bead */
  lastBeadSummary?: BeadSummary;

  /** All beads for this task */
  beads: Bead[];
}

export interface BeadSummary {
  beadNumber: number;
  status: BeadStatus;
  filesChanged: number;
  tokensUsed: number;
  testsPassed?: boolean;
}
```

## Bead Result

```typescript
/**
 * Result returned after executing a bead.
 */
export interface BeadResult {
  /** Bead number */
  beadNumber: number;

  /** Files that were changed */
  filesChanged: string[];

  /** Git commit hash if committed */
  commitHash?: string;

  /** Test results if tests ran */
  testResults?: TestResult[];

  /** Errors encountered */
  errors: string[];

  /** Tokens consumed */
  tokensUsed: number;

  /** Whether the bead executed without errors */
  success: boolean;

  /** Whether DONE tag was found */
  isDone: boolean;

  /** Impact analysis */
  impact?: ImpactSummary;
}
```

## Task Status

```typescript
export type TaskStatus =
  | 'idle'           // No task running
  | 'running'        // Executing a bead
  | 'paused'         // User paused
  | 'awaiting_approval'  // Waiting for user to approve bead
  | 'completed'      // All criteria met
  | 'failed';        // Budget exhausted or max iterations
```

## Events

```typescript
// Events emitted by BeadManager

interface BeadManagerEvents {
  'taskStarted': (task: TaskDefinition) => void;
  'beadStarted': (beadNumber: number) => void;
  'beadComplete': (result: BeadResult) => void;
  'beadError': (error: { beadNumber: number; error: Error }) => void;
  'awaitingApproval': (result: BeadResult) => void;
  'beadApproved': (beadNumber: number) => void;
  'beadRejected': (data: { beadNumber: number; feedback: string }) => void;
  'taskCompleted': (summary: TaskSummary) => void;
  'taskFailed': (error: Error) => void;
  'taskPaused': () => void;
  'taskResumed': () => void;
  'taskCancelled': () => void;
  'dagUpdated': (graph: ProjectGraph) => void;
}
```
