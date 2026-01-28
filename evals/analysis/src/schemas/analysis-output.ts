/**
 * Type definitions for Cline Analysis Framework output
 * These schemas define the structured JSON output from our analysis tools
 */

/**
 * Versioned analysis output schema (V1)
 * Breaking changes should increment the version number
 */
export interface AnalysisOutputV1 {
	schema_version: "1.0"
	metadata: AnalysisMetadata
	summary: AnalysisSummary
	tasks: TaskResultV1[]
	failures: FailureAnalysis
}

export interface AnalysisMetadata {
	generated_at: string // ISO 8601 timestamp
	analysis_version: string // Package version (from package.json)
	job_id: string // Job directory name (e.g., "2025-01-25__10-30-00")
	model: string // Model used for the run
	agent: string // Agent name (e.g., "cline-cli")
	environment: string // "docker" | "daytona"
}

export interface AnalysisSummary {
	total_tasks: number
	total_trials: number
	pass_at_1: number // Probability at least 1 of k=1 succeeds
	pass_at_3: number // Probability at least 1 of k=3 succeeds
	pass_caret_3: number // Probability ALL k=3 succeed (reliability)
	total_cost_usd: number
	total_duration_sec: number
	flaky_task_count: number // Tasks with variance across trials
}

export interface TaskResultV1 {
	task_id: string
	task_name: string
	trials: TrialResultV1[]
	metrics: TaskMetrics
	status: "pass" | "fail" | "flaky"
	total_cost_usd: number
	avg_duration_sec: number
}

export interface TrialResultV1 {
	trial_index: number // 0-indexed trial number
	trial_hash: string // Hash from trial directory name
	passed: boolean
	duration_sec: number
	cost_usd: number
	tokens_in?: number
	tokens_out?: number
	failures: FailureInfo[] // Classified failure patterns
}

export interface TaskMetrics {
	pass_at_1: number // P(at least 1 of 1 succeeds)
	pass_at_3: number // P(at least 1 of 3 succeeds)
	pass_caret_3: number // P(all 3 succeed) - reliability metric
	flakiness_score: number // Entropy-based variance measure (0-1)
}

export interface FailureInfo {
	name: string // Pattern name (e.g., "gemini_signature")
	category: FailureCategory
	excerpt: string // Log excerpt showing the failure
	issue_url?: string // GitHub issue link if applicable
}

export type FailureCategory =
	| "provider_bug" // Cline integration bugs (Gemini #7974, Claude #7998)
	| "transient" // Rate limits, network timeouts, service unavailable
	| "harness" // Test harness or verification script failure
	| "environment" // Docker/Daytona setup failure
	| "policy" // Model safety/content policy refusal
	| "auth" // Invalid API credentials
	| "task_failure" // Model couldn't solve the task

export interface FailureAnalysis {
	by_category: Record<FailureCategory, number>
	by_pattern: FailurePatternSummary[]
}

export interface FailurePatternSummary {
	name: string
	count: number
	issue_url?: string
	examples: FailureExample[]
}

export interface FailureExample {
	task_id: string
	trial_index: number
	excerpt: string
}

/**
 * Tool Precision Test Result (for replace_in_file benchmarks)
 */
export interface ToolPrecisionResult {
	schema_version: "1.0"
	benchmark: "tool-precision/replace-in-file"
	total_cases: number
	passed: number
	failed: number
	pass_rate: number
	avg_latency_ms: number
	known_failures: string[]
	timestamp: string
}

/**
 * Coding Exercises Result (for small task benchmarks)
 */
export interface CodingExercisesResult {
	schema_version: "1.0"
	benchmark: "coding-exercises"
	total_exercises: number
	passed: number
	failed: number
	pass_at_1: number
	avg_duration_sec: number
	known_failures: string[]
	timestamp: string
}

/**
 * Comparison result between two analysis outputs
 */
export interface ComparisonResult {
	baseline: AnalysisSummary
	current: AnalysisSummary
	delta: {
		pass_at_1: number // Percentage point change
		pass_at_3: number
		pass_caret_3: number
		cost_usd: number
		duration_sec: number
	}
	regression_detected: boolean
	tasks_regressed: string[] // Task IDs that got worse
	tasks_improved: string[] // Task IDs that got better
}
