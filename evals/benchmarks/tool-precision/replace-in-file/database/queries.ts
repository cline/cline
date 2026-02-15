import { DatabaseClient } from './client';
import {
  ModelSuccessRate,
  ModelLatency,
  CostAnalysis,
  ErrorDistribution,
  FailedCase,
  PerformanceTrend,
  ModelComparison
} from './types';

const db = DatabaseClient.getInstance();

// Performance analysis queries
export async function getSuccessRatesByModel(): Promise<ModelSuccessRate[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      model_id,
      COUNT(*) as total_runs,
      SUM(CASE WHEN succeeded THEN 1 ELSE 0 END) as successful_runs,
      ROUND(AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate
    FROM results
    WHERE error_enum NOT IN (1, 6, 7) OR error_enum IS NULL  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY model_id
    ORDER BY success_rate DESC, total_runs DESC
  `);
  
  return stmt.all() as ModelSuccessRate[];
}

export async function getAverageLatencyByModel(): Promise<ModelLatency[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      model_id,
      ROUND(AVG(time_to_first_token_ms), 2) as avg_time_to_first_token_ms,
      ROUND(AVG(time_to_first_edit_ms), 2) as avg_time_to_first_edit_ms,
      ROUND(AVG(time_round_trip_ms), 2) as avg_time_round_trip_ms
    FROM results
    WHERE time_to_first_token_ms IS NOT NULL
    GROUP BY model_id
    ORDER BY avg_time_round_trip_ms ASC
  `);
  
  return stmt.all() as ModelLatency[];
}

export async function getCostAnalysisByRun(): Promise<CostAnalysis[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      run_id,
      model_id,
      ROUND(SUM(cost_usd), 4) as total_cost_usd,
      ROUND(AVG(cost_usd), 4) as avg_cost_per_case,
      SUM(completion_tokens) as total_completion_tokens
    FROM results
    WHERE cost_usd IS NOT NULL
    GROUP BY run_id, model_id
    ORDER BY total_cost_usd DESC
  `);
  
  return stmt.all() as CostAnalysis[];
}

// Error analysis queries
export async function getErrorDistribution(): Promise<ErrorDistribution[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      error_enum,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM results WHERE succeeded = 0), 2) as percentage
    FROM results
    WHERE succeeded = 0 AND error_enum IS NOT NULL
    GROUP BY error_enum
    ORDER BY count DESC
  `);
  
  return stmt.all() as ErrorDistribution[];
}

export async function getFailedCasesByError(errorEnum?: number): Promise<FailedCase[]> {
  let query = `
    SELECT 
      r.case_id,
      r.model_id,
      r.error_enum,
      c.description,
      r.raw_model_output
    FROM results r
    JOIN cases c ON r.case_id = c.case_id
    WHERE r.succeeded = 0
  `;
  
  const params: any[] = [];
  if (errorEnum !== undefined) {
    query += ` AND r.error_enum = ?`;
    params.push(errorEnum);
  }
  
  query += ` ORDER BY r.created_at DESC LIMIT 100`;
  
  const stmt = db.getDatabase().prepare(query);
  return stmt.all(...params) as FailedCase[];
}

// Trend analysis queries
export async function getPerformanceTrends(days: number = 30): Promise<PerformanceTrend[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      DATE(r.created_at) as date,
      r.model_id,
      ROUND(AVG(CASE WHEN r.succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(r.time_round_trip_ms), 2) as avg_latency_ms,
      ROUND(AVG(r.cost_usd), 4) as avg_cost_usd
    FROM results r
    WHERE r.created_at >= datetime('now', '-' || ? || ' days')
      AND (r.error_enum NOT IN (1, 6, 7) OR r.error_enum IS NULL)  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY DATE(r.created_at), r.model_id
    ORDER BY date DESC, model_id
  `);
  
  return stmt.all(days) as PerformanceTrend[];
}

export async function getModelComparisons(): Promise<ModelComparison[]> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      model_id,
      ROUND(AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(time_round_trip_ms), 2) as avg_latency_ms,
      ROUND(AVG(cost_usd), 4) as avg_cost_usd,
      COUNT(*) as total_runs
    FROM results
    WHERE error_enum NOT IN (1, 6, 7) OR error_enum IS NULL  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY model_id
    HAVING total_runs >= 10
    ORDER BY success_rate DESC, avg_latency_ms ASC
  `);
  
  return stmt.all() as ModelComparison[];
}

// Advanced analysis queries
export async function getTopPerformingCases(limit: number = 10): Promise<Array<{
  case_id: string;
  description: string;
  success_rate: number;
  avg_latency_ms: number;
  total_runs: number;
}>> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      c.case_id,
      c.description,
      ROUND(AVG(CASE WHEN r.succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(r.time_round_trip_ms), 2) as avg_latency_ms,
      COUNT(r.result_id) as total_runs
    FROM cases c
    JOIN results r ON c.case_id = r.case_id
    WHERE r.error_enum NOT IN (1, 6, 7) OR r.error_enum IS NULL  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY c.case_id, c.description
    HAVING total_runs >= 5
    ORDER BY success_rate DESC, avg_latency_ms ASC
    LIMIT ?
  `);
  
  return stmt.all(limit) as Array<{
    case_id: string;
    description: string;
    success_rate: number;
    avg_latency_ms: number;
    total_runs: number;
  }>;
}

export async function getWorstPerformingCases(limit: number = 10): Promise<Array<{
  case_id: string;
  description: string;
  success_rate: number;
  avg_latency_ms: number;
  total_runs: number;
}>> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      c.case_id,
      c.description,
      ROUND(AVG(CASE WHEN r.succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(r.time_round_trip_ms), 2) as avg_latency_ms,
      COUNT(r.result_id) as total_runs
    FROM cases c
    JOIN results r ON c.case_id = r.case_id
    WHERE r.error_enum NOT IN (1, 6, 7) OR r.error_enum IS NULL  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY c.case_id, c.description
    HAVING total_runs >= 5
    ORDER BY success_rate ASC, avg_latency_ms DESC
    LIMIT ?
  `);
  
  return stmt.all(limit) as Array<{
    case_id: string;
    description: string;
    success_rate: number;
    avg_latency_ms: number;
    total_runs: number;
  }>;
}

export async function getModelPerformanceByTimeOfDay(): Promise<Array<{
  model_id: string;
  hour: number;
  success_rate: number;
  avg_latency_ms: number;
  total_runs: number;
}>> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      model_id,
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      ROUND(AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(time_round_trip_ms), 2) as avg_latency_ms,
      COUNT(*) as total_runs
    FROM results
    GROUP BY model_id, hour
    HAVING total_runs >= 5
    ORDER BY model_id, hour
  `);
  
  return stmt.all() as Array<{
    model_id: string;
    hour: number;
    success_rate: number;
    avg_latency_ms: number;
    total_runs: number;
  }>;
}

export async function getRunComparison(runId1: string, runId2: string): Promise<{
  run1: { run_id: string; success_rate: number; avg_latency_ms: number; avg_cost_usd: number; total_cases: number };
  run2: { run_id: string; success_rate: number; avg_latency_ms: number; avg_cost_usd: number; total_cases: number };
}> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      run_id,
      ROUND(AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
      ROUND(AVG(time_round_trip_ms), 2) as avg_latency_ms,
      ROUND(AVG(cost_usd), 4) as avg_cost_usd,
      COUNT(DISTINCT case_id) as total_cases
    FROM results
    WHERE run_id IN (?, ?)
    GROUP BY run_id
  `);
  
  const results = stmt.all(runId1, runId2) as Array<{
    run_id: string;
    success_rate: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    total_cases: number;
  }>;
  
  const run1 = results.find(r => r.run_id === runId1);
  const run2 = results.find(r => r.run_id === runId2);
  
  if (!run1 || !run2) {
    throw new Error('One or both runs not found');
  }
  
  return { run1, run2 };
}

// Summary statistics
export async function getDatabaseSummary(): Promise<{
  total_runs: number;
  total_cases: number;
  total_results: number;
  valid_results: number;
  unique_models: number;
  overall_success_rate: number;
  date_range: { earliest: string; latest: string };
}> {
  const stmt = db.getDatabase().prepare(`
    SELECT 
      (SELECT COUNT(*) FROM runs) as total_runs,
      (SELECT COUNT(*) FROM cases) as total_cases,
      (SELECT COUNT(*) FROM results) as total_results,
      (SELECT COUNT(*) FROM results WHERE error_enum NOT IN (1, 6, 7) OR error_enum IS NULL) as valid_results,
      (SELECT COUNT(DISTINCT model_id) FROM results) as unique_models,
      (SELECT ROUND(AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) * 100, 2) 
       FROM results 
       WHERE error_enum NOT IN (1, 6, 7) OR error_enum IS NULL) as overall_success_rate,
      (SELECT MIN(created_at) FROM results) as earliest,
      (SELECT MAX(created_at) FROM results) as latest
    FROM results
    LIMIT 1
  `);
  
  const result = stmt.get() as any;
  return {
    total_runs: result.total_runs || 0,
    total_cases: result.total_cases || 0,
    total_results: result.total_results || 0,
    valid_results: result.valid_results || 0,
    unique_models: result.unique_models || 0,
    overall_success_rate: result.overall_success_rate || 0,
    date_range: {
      earliest: result.earliest || '',
      latest: result.latest || ''
    }
  };
}
