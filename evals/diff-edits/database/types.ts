// Database type definitions for diff-edits evaluation system

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
	case_id: string
	run_id: string
	created_at: string
	description: string
	system_prompt_hash: string
	task_id: string
	tokens_in_context: number
	file_hash?: string
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

// Input types for creating records
export interface CreateSystemPromptInput {
  name: string;
  content: string;
}

export interface CreateProcessingFunctionsInput {
  name: string;
  parsing_function: string;
  diff_edit_function: string;
}

export interface CreateFileInput {
  filepath: string;
  content: string;
  tokens?: number;
}

export interface CreateBenchmarkRunInput {
  description?: string;
  system_prompt_hash: string;
}

export interface CreateCaseInput {
  run_id: string;
  description: string;
  system_prompt_hash: string;
  task_id: string;
  tokens_in_context: number;
  file_hash?: string;
}

export interface CreateResultInput {
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
}

// Analysis result types
export interface ModelSuccessRate {
  model_id: string;
  total_runs: number;
  successful_runs: number;
  success_rate: number;
}

export interface ModelLatency {
  model_id: string;
  avg_time_to_first_token_ms: number;
  avg_time_to_first_edit_ms: number;
  avg_time_round_trip_ms: number;
}

export interface CostAnalysis {
  run_id: string;
  model_id: string;
  total_cost_usd: number;
  avg_cost_per_case: number;
  total_completion_tokens: number;
}

export interface ErrorDistribution {
  error_enum: number;
  count: number;
  percentage: number;
}

export interface FailedCase {
  case_id: string;
  model_id: string;
  error_enum: number;
  description: string;
  raw_model_output?: string;
}

export interface PerformanceTrend {
  date: string;
  model_id: string;
  success_rate: number;
  avg_latency_ms: number;
  avg_cost_usd: number;
}

export interface ModelComparison {
  model_id: string;
  success_rate: number;
  avg_latency_ms: number;
  avg_cost_usd: number;
  total_runs: number;
}
