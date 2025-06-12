### Integration Strategy
- Start fresh (no backward compatibility needed)
- Keep existing JSON test cases as source data
- Database stores results only, cases loaded from JSON files
- Existing workflow remains unchanged, enhanced with database storage

## Current System Analysis

### Current Architecture
- **TestRunner.ts**: Main orchestrator that loads test cases from JSON files and runs evaluations
- **ClineWrapper.ts**: Handles LLM API calls and diff edit processing  
- **Test Cases**: Stored as individual JSON files in `diff-edits/cases/`
- **Results**: Stored as individual JSON files in `diff-edits/results/`
- **System Prompts**: Generated dynamically from functions in `diff-edits/prompts/`
- **Parsing/Diff Functions**: Versioned functions for processing LLM responses

### Current Data Flow
1. Load test cases from JSON files
2. Generate system prompt using selected prompt function
3. Run N iterations per test case with specified model/config
4. Process LLM response to extract tool calls
5. Validate diff edits against original files
6. Save results as JSON files

## Database Schema Design

Based on the existing `evals-database-design.md`, we'll implement these core tables:

### 1. `system_prompts`
```sql
CREATE TABLE system_prompts (
    hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. `processing_functions`
```sql
CREATE TABLE processing_functions (
    hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parsing_function TEXT NOT NULL,
    diff_edit_function TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3. `files`
```sql
CREATE TABLE files (
    hash TEXT PRIMARY KEY,
    filepath TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4. `runs`
```sql
CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    system_prompt_hash TEXT NOT NULL,
    FOREIGN KEY (system_prompt_hash) REFERENCES system_prompts(hash)
);
```

### 5. `cases`
```sql
CREATE TABLE cases (
    case_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT NOT NULL,
    system_prompt_hash TEXT NOT NULL,
    task_id TEXT NOT NULL,
    tokens_in_context INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (system_prompt_hash) REFERENCES system_prompts(hash)
);
```

### 6. `results`
```sql
CREATE TABLE results (
    result_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    processing_functions_hash TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    error_enum INTEGER,
    num_edits INTEGER,
    num_lines_deleted INTEGER,
    num_lines_added INTEGER,
    time_to_first_token_ms INTEGER,
    time_to_first_edit_ms INTEGER,
    time_round_trip_ms INTEGER,
    cost_usd REAL,
    completion_tokens INTEGER,
    raw_model_output TEXT,
    file_edited_hash TEXT,
    parsed_tool_call_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (case_id) REFERENCES cases(case_id),
    FOREIGN KEY (processing_functions_hash) REFERENCES processing_functions(hash)
);
```

## Implementation Plan

### Phase 1: Database Infrastructure

#### 1.1 Create Database Module (`diff-edits/database/`)
- `diff-edits/database/schema.sql` - Complete schema definition
- `diff-edits/database/client.ts` - Singleton database client with connection management
- `diff-edits/database/migrations.ts` - Schema migration utilities
- `diff-edits/database/operations.ts` - CRUD operations for all tables

#### 1.2 Database Client Features
- SQLite connection with WAL mode for concurrent access
- Automatic database creation if not exists
- Transaction support for batch operations
- Connection pooling for parallel execution
- Proper error handling and logging

### Phase 2: Data Access Layer

#### 2.1 Core Operations (`diff-edits/database/operations.ts`)
```typescript
// System Prompts
export async function upsertSystemPrompt(name: string, content: string): Promise<string>
export async function getSystemPromptByHash(hash: string): Promise<SystemPrompt | null>

// Processing Functions  
export async function upsertProcessingFunctions(name: string, parsing: string, diffEdit: string): Promise<string>
export async function getProcessingFunctionsByHash(hash: string): Promise<ProcessingFunctions | null>

// Files
export async function upsertFile(filepath: string, content: string, tokens?: number): Promise<string>
export async function getFileByHash(hash: string): Promise<FileRecord | null>

// Benchmark Runs
export async function createBenchmarkRun(description: string, systemPromptHash: string): Promise<string>
export async function getBenchmarkRun(runId: string): Promise<BenchmarkRun | null>

// Cases
export async function createCase(runId: string, description: string, systemPromptHash: string, taskId: string, tokensInContext: number): Promise<string>
export async function getCasesByRun(runId: string): Promise<Case[]>

// Results
export async function insertResult(result: ResultData): Promise<string>
export async function getResultsByRun(runId: string): Promise<Result[]>
export async function getResultsByCase(caseId: string): Promise<Result[]>
```

#### 2.2 Hash Generation
- Use SHA-256 for content hashing
- Consistent hashing for system prompts (hash the generated content)
- File content hashing for deduplication
- Processing function hashing (combine parsing + diff function names)

### Phase 3: TestRunner Integration

#### 3.1 Modified TestRunner Workflow
1. **Initialization**
   - Create database if not exists
   - Generate run ID and create benchmark run record
   - Hash and store system prompt content
   - Hash and store processing function configuration

2. **Case Processing**
   - For each JSON test case:
     - Hash and store file content
     - Create benchmark case record with serialized messages
     - Link to run, system prompt, and file hashes

3. **Result Storage**
   - Replace JSON file writing with database inserts
   - Store detailed metrics and timing information
   - Maintain transaction consistency for batch operations

#### 3.2 Updated TestRunner.ts Changes
```typescript
class NodeTestRunner {
  private dbClient: DatabaseClient;
  private currentRunId: string;
  
  constructor(isReplay: boolean) {
    this.dbClient = DatabaseClient.getInstance();
    // ... existing initialization
  }
  
  async initializeRun(testConfig: TestConfig): Promise<string> {
    // Create benchmark run record
    // Hash and store system prompt
    // Hash and store processing functions
    // Return run ID
  }
  
  async processTestCase(testCase: TestCase, runId: string): Promise<string> {
    // Hash and store file content
    // Create benchmark case record
    // Return case ID
  }
  
  async storeResult(result: TestResult, runId: string, caseId: string): Promise<void> {
    // Insert benchmark result record
  }
}
```

### Phase 4: CLI Integration

#### 4.1 Database Location
- Default location: `diff-edits/evals.db`
- Configurable via environment variable: `DIFF_EVALS_DB_PATH`
- Auto-create directory if needed

#### 4.2 CLI Enhancements
- Add database initialization to `runDiffEval.ts`
- Add database status/info commands
- Add data export/import utilities
- Add cleanup/maintenance commands

### Phase 5: Analysis & Reporting

#### 5.1 Query Utilities (`diff-edits/database/queries.ts`)
```typescript
// Performance analysis
export async function getSuccessRatesByModel(): Promise<ModelSuccessRate[]>
export async function getAverageLatencyByModel(): Promise<ModelLatency[]>
export async function getCostAnalysisByRun(): Promise<CostAnalysis[]>

// Error analysis  
export async function getErrorDistribution(): Promise<ErrorDistribution[]>
export async function getFailedCasesByError(): Promise<FailedCase[]>

// Trend analysis
export async function getPerformanceTrends(): Promise<PerformanceTrend[]>
export async function getModelComparisons(): Promise<ModelComparison[]>
```

#### 5.2 Recommended Indexes
```sql
CREATE INDEX idx_results_run_model ON results(run_id, model_id);
CREATE INDEX idx_results_case_model ON results(case_id, model_id);
CREATE INDEX idx_results_success ON results(succeeded);
```

## Implementation Details

### Database Client Singleton Pattern
```typescript
export class DatabaseClient {
  private static instance: DatabaseClient;
  private db: Database;
  
  private constructor() {
    const dbPath = process.env.DIFF_EVALS_DB_PATH || path.join(__dirname, '../evals.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Enable concurrent access
    this.initializeSchema();
  }
  
  static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }
}
```

### Concurrent Access Strategy
- Use SQLite WAL mode for concurrent reads during parallel execution
- Implement connection pooling for write operations
- Use transactions for batch operations
- Implement retry logic for busy database scenarios

### Integration Strategy
- Start fresh (no backward compatibility needed)
- Keep existing JSON test cases as source data
- Database stores results only, cases loaded from JSON files
- Gradual integration path available if needed later

## File Structure

```
diff-edits/
├── database/
│   ├── client.ts           # Singleton database client
│   ├── operations.ts       # CRUD operations
│   ├── queries.ts          # Analysis queries
│   ├── schema.sql          # Complete schema
│   ├── migrations.ts       # Schema migrations
│   └── types.ts           # Database type definitions
├── evals.db               # SQLite database file
├── TestRunner.ts          # Updated with DB integration
├── ClineWrapper.ts        # Minimal changes for result structure
└── types.ts              # Updated with DB-related types
```

## Benefits

1. **Queryable Data**: Complex analysis queries across runs, models, and time periods
2. **Concurrent Access**: Multiple evaluation processes can run simultaneously
3. **Data Integrity**: Foreign key constraints and transactions ensure consistency
4. **Performance**: Indexed queries for fast analysis and reporting
5. **Scalability**: Handle large numbers of test cases and results efficiently
6. **Deduplication**: Hash-based storage eliminates duplicate content
7. **Versioning**: Track different system prompts and processing functions over time

## Implementation Steps

### Step 1: Install SQLite dependency
```bash
cd diff-edits && npm install better-sqlite3 @types/better-sqlite3
```

### Step 2: Create database schema file
Create `diff-edits/database/schema.sql` with the 6 tables defined above.

### Step 3: Create database client
Create `diff-edits/database/client.ts` - singleton pattern with SQLite connection, WAL mode, auto-schema creation.

### Step 4: Create TypeScript types
Create `diff-edits/database/types.ts` with TypeScript interfaces for all tables:
```typescript
export interface SystemPrompt {
  hash: string;
  name: string;
  content: string;
  created_at: string;
}

export interface ProcessingFunctions {
  hash: string;
  name: string;
  parsing_function: string;
  diff_edit_function: string;
  created_at: string;
}

export interface FileRecord {
  hash: string;
  filepath: string;
  content: string;
  tokens?: number;
  created_at: string;
}

export interface BenchmarkRun {
  run_id: string;
  created_at: string;
  description?: string;
  system_prompt_hash: string;
}

export interface Case {
  case_id: string;
  run_id: string;
  created_at: string;
  description: string;
  system_prompt_hash: string;
  task_id: string;
  tokens_in_context: number;
}

export interface Result {
  result_id: string;
  run_id: string;
  case_id: string;
  model_id: string;
  processing_functions_hash: string;
  succeeded: boolean;
  error_enum?: number;
  num_edits?: number;
  num_lines_deleted?: number;
  num_lines_added?: number;
  time_to_first_token_ms?: number;
  time_to_first_edit_ms?: number;
  time_round_trip_ms?: number;
  cost_usd?: number;
  completion_tokens?: number;
  raw_model_output?: string;
  file_edited_hash?: string;
  parsed_tool_call_json?: string;
  created_at: string;
}
```

### Step 5: Create database operations
Create `diff-edits/database/operations.ts` with the upsert/insert/get functions for all tables.

### Step 6: Update TestRunner.ts
- Add database client initialization
- Replace JSON result file writing with database inserts
- Add run/case creation at start of each test run

### Step 7: Update CLI command
Modify `cli/src/commands/runDiffEval.ts` to initialize database before running tests.

That's it. The system will then store results in SQLite instead of JSON files while keeping everything else the same.
