// Main database module exports
export { DatabaseClient, getDatabase } from './client';
export * from './types';
export * from './operations';
export * from './queries';

// Re-export commonly used functions for convenience
export {
  upsertSystemPrompt,
  upsertProcessingFunctions,
  upsertFile,
  createBenchmarkRun,
  createCase,
  insertResult,
  getRunStats
} from './operations';

export {
  getSuccessRatesByModel,
  getModelComparisons,
  getDatabaseSummary,
  getErrorDistribution
} from './queries';
