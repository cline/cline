import { DatabaseClient } from './client';
import {
  SystemPrompt,
  ProcessingFunctions,
  FileRecord,
  BenchmarkRun,
  Case,
  Result,
  CreateSystemPromptInput,
  CreateProcessingFunctionsInput,
  CreateFileInput,
  CreateBenchmarkRunInput,
  CreateCaseInput,
  CreateResultInput
} from './types';

const db = DatabaseClient.getInstance();

// System Prompts Operations
export async function upsertSystemPrompt(input: CreateSystemPromptInput): Promise<string> {
  const hash = DatabaseClient.generateHash(input.content);
  
  const stmt = db.getDatabase().prepare(`
    INSERT OR IGNORE INTO system_prompts (hash, name, content)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(hash, input.name, input.content);
  return hash;
}

export async function getSystemPromptByHash(hash: string): Promise<SystemPrompt | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM system_prompts WHERE hash = ?
  `);
  
  const result = stmt.get(hash) as SystemPrompt | undefined;
  return result || null;
}

// Processing Functions Operations
export async function upsertProcessingFunctions(input: CreateProcessingFunctionsInput): Promise<string> {
  const hash = DatabaseClient.generateHash(input.parsing_function + input.diff_edit_function);
  
  const stmt = db.getDatabase().prepare(`
    INSERT OR IGNORE INTO processing_functions (hash, name, parsing_function, diff_edit_function)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(hash, input.name, input.parsing_function, input.diff_edit_function);
  return hash;
}

export async function getProcessingFunctionsByHash(hash: string): Promise<ProcessingFunctions | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM processing_functions WHERE hash = ?
  `);
  
  const result = stmt.get(hash) as ProcessingFunctions | undefined;
  return result || null;
}

// Files Operations
export async function upsertFile(input: CreateFileInput): Promise<string> {
  const hash = DatabaseClient.generateHash(input.content);
  
  const stmt = db.getDatabase().prepare(`
    INSERT OR IGNORE INTO files (hash, filepath, content, tokens)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(hash, input.filepath, input.content, input.tokens || null);
  return hash;
}

export async function getFileByHash(hash: string): Promise<FileRecord | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM files WHERE hash = ?
  `);
  
  const result = stmt.get(hash) as FileRecord | undefined;
  return result || null;
}

// Benchmark Runs Operations
export async function createBenchmarkRun(input: CreateBenchmarkRunInput): Promise<string> {
  const runId = DatabaseClient.generateId();
  
  const stmt = db.getDatabase().prepare(`
    INSERT INTO runs (run_id, description, system_prompt_hash)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(runId, input.description || null, input.system_prompt_hash);
  return runId;
}

export async function getBenchmarkRun(runId: string): Promise<BenchmarkRun | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM runs WHERE run_id = ?
  `);
  
  const result = stmt.get(runId) as BenchmarkRun | undefined;
  return result || null;
}

export async function getAllBenchmarkRuns(): Promise<BenchmarkRun[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM runs ORDER BY created_at DESC
  `);
  
  return stmt.all() as BenchmarkRun[];
}

// Cases Operations
export async function createCase(input: CreateCaseInput): Promise<string> {
  const caseId = DatabaseClient.generateId();
  
  const stmt = db.getDatabase().prepare(`
    INSERT INTO cases (case_id, run_id, description, system_prompt_hash, task_id, tokens_in_context, file_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    caseId,
    input.run_id,
    input.description,
    input.system_prompt_hash,
    input.task_id,
    input.tokens_in_context,
    input.file_hash || null
  );
  
  return caseId;
}

export async function getCasesByRun(runId: string): Promise<Case[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM cases WHERE run_id = ? ORDER BY created_at
  `);
  
  return stmt.all(runId) as Case[];
}

export async function getCaseById(caseId: string): Promise<Case | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM cases WHERE case_id = ?
  `);
  
  const result = stmt.get(caseId) as Case | undefined;
  return result || null;
}

// Results Operations
export async function insertResult(input: CreateResultInput): Promise<string> {
  const resultId = DatabaseClient.generateId();
  
  const stmt = db.getDatabase().prepare(`
    INSERT INTO results (
      result_id, run_id, case_id, model_id, processing_functions_hash,
      succeeded, error_enum, num_edits, num_lines_deleted, num_lines_added,
      time_to_first_token_ms, time_to_first_edit_ms, time_round_trip_ms,
      cost_usd, completion_tokens, raw_model_output, file_edited_hash,
      parsed_tool_call_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    resultId,
    input.run_id,
    input.case_id,
    input.model_id,
    input.processing_functions_hash,
    input.succeeded ? 1 : 0, // Convert boolean to integer
    input.error_enum || null,
    input.num_edits || null,
    input.num_lines_deleted || null,
    input.num_lines_added || null,
    input.time_to_first_token_ms || null,
    input.time_to_first_edit_ms || null,
    input.time_round_trip_ms || null,
    input.cost_usd || null,
    input.completion_tokens || null,
    input.raw_model_output || null,
    input.file_edited_hash || null,
    input.parsed_tool_call_json || null
  );
  
  return resultId;
}

export async function getResultsByRun(runId: string): Promise<Result[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM results WHERE run_id = ? ORDER BY created_at
  `);
  
  return stmt.all(runId) as Result[];
}

export async function getResultsByCase(caseId: string): Promise<Result[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM results WHERE case_id = ? ORDER BY created_at
  `);
  
  return stmt.all(caseId) as Result[];
}

export async function getResultById(resultId: string): Promise<Result | null> {
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM results WHERE result_id = ?
  `);
  
  const result = stmt.get(resultId) as Result | undefined;
  return result || null;
}

// Batch operations for performance
export async function insertResultsBatch(inputs: CreateResultInput[]): Promise<string[]> {
  const stmt = db.getDatabase().prepare(`
    INSERT INTO results (
      result_id, run_id, case_id, model_id, processing_functions_hash,
      succeeded, error_enum, num_edits, num_lines_deleted, num_lines_added,
      time_to_first_token_ms, time_to_first_edit_ms, time_round_trip_ms,
      cost_usd, completion_tokens, raw_model_output, file_edited_hash,
      parsed_tool_call_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  return db.transaction(() => {
    const resultIds: string[] = [];
    
    for (const input of inputs) {
      const resultId = DatabaseClient.generateId();
      
      stmt.run(
        resultId,
        input.run_id,
        input.case_id,
        input.model_id,
        input.processing_functions_hash,
        input.succeeded ? 1 : 0, // Convert boolean to integer
        input.error_enum || null,
        input.num_edits || null,
        input.num_lines_deleted || null,
        input.num_lines_added || null,
        input.time_to_first_token_ms || null,
        input.time_to_first_edit_ms || null,
        input.time_round_trip_ms || null,
        input.cost_usd || null,
        input.completion_tokens || null,
        input.raw_model_output || null,
        input.file_edited_hash || null,
        input.parsed_tool_call_json || null
      );
      
      resultIds.push(resultId);
    }
    
    return resultIds;
  });
}

export async function createCasesBatch(inputs: CreateCaseInput[]): Promise<string[]> {
  const stmt = db.getDatabase().prepare(`
    INSERT INTO cases (case_id, run_id, description, system_prompt_hash, task_id, tokens_in_context)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  return db.transaction(() => {
    const caseIds: string[] = [];
    
    for (const input of inputs) {
      const caseId = DatabaseClient.generateId();
      
      stmt.run(
        caseId,
        input.run_id,
        input.description,
        input.system_prompt_hash,
        input.task_id,
        input.tokens_in_context
      );
      
      caseIds.push(caseId);
    }
    
    return caseIds;
  });
}

// Utility functions
export async function getRunStats(runId: string): Promise<{
  total_cases: number;
  total_results: number;
  success_rate: number;
  avg_cost: number;
  avg_latency: number;
}> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      COUNT(DISTINCT c.case_id) as total_cases,
      COUNT(r.result_id) as total_results,
      AVG(CASE WHEN r.succeeded THEN 1.0 ELSE 0.0 END) as success_rate,
      AVG(r.cost_usd) as avg_cost,
      AVG(r.time_round_trip_ms) as avg_latency
    FROM cases c
    LEFT JOIN results r ON c.case_id = r.case_id
    WHERE c.run_id = ?
  `);
  
  const result = stmt.get(runId) as any;
  return {
    total_cases: result.total_cases || 0,
    total_results: result.total_results || 0,
    success_rate: result.success_rate || 0,
    avg_cost: result.avg_cost || 0,
    avg_latency: result.avg_latency || 0
  };
}

// Count valid attempts for a specific case and model
export async function getValidAttemptCount(caseId: string, modelId: string): Promise<number> {
  const stmt = db.getDatabase().prepare(`
    SELECT COUNT(*) as count
    FROM results 
    WHERE case_id = ? 
      AND model_id = ?
      AND error_enum NOT IN (1, 6, 7)  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
  `);
  
  const result = stmt.get(caseId, modelId) as { count: number };
  return result.count;
}

// Get valid results for a specific case and model (for analysis)
export async function getValidResults(caseId: string, modelId: string, limit?: number): Promise<Result[]> {
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const stmt = db.getDatabase().prepare(`
    SELECT * FROM results 
    WHERE case_id = ? 
      AND model_id = ?
      AND error_enum NOT IN (1, 6, 7)  -- Only valid attempts
    ORDER BY created_at
    ${limitClause}
  `);
  
  return stmt.all(caseId, modelId) as Result[];
}
