/**
 * Type definitions for Harbor framework output structure
 * These schemas document Harbor's jobs/ directory format (read-only, we validate against this)
 *
 * Harbor is the execution framework used by cline-bench.
 * See: https://harborframework.com
 */

export interface HarborTrialConfig {
	task_id: string
	model: string
	agent: string
	environment?: string
	retries?: number
}

export interface HarborTrialResult {
	reward: 0 | 1 // Binary pass/fail from verifier
	duration_sec: number
	cost_usd: number
	tokens_in?: number
	tokens_out?: number
	timestamp?: string
}

export interface HarborTrialFiles {
	agent: {
		"cline.txt": string // Full conversation log
		"setup/stdout.txt": string
		"setup/stderr.txt": string
		"setup/return-code.txt": string
		[key: string]: string // command-N/ directories with stdout, stderr, return-code.txt
	}
	verifier: {
		"reward.txt": "0" | "1"
		"test-stdout.txt": string
		"test-stderr.txt": string
	}
}

/**
 * Structure of a single trial directory
 * Example: jobs/2025-01-25__10-30-00/01k7a12s...disco__fhSEuhr/
 */
export interface HarborTrialDirectory {
	"config.json": HarborTrialConfig
	"result.json": HarborTrialResult
	agent: HarborTrialFiles["agent"]
	verifier: HarborTrialFiles["verifier"]
}

/**
 * Structure of a job's config.json
 */
export interface HarborJobConfig {
	model: string
	agent: string
	tasks: string[] // Task IDs
	trials_per_task: number
	environment: string // "docker" | "daytona"
	created_at?: string
}

/**
 * Structure of a job's result.json (aggregate)
 */
export interface HarborJobResult {
	total_tasks: number
	passed_tasks: number
	failed_tasks: number
	total_cost_usd: number
	total_duration_sec: number
	started_at?: string
	completed_at?: string
}

/**
 * Complete job directory structure
 * Example: jobs/2025-01-25__10-30-00/
 */
export interface HarborJobDirectory {
	"config.json": HarborJobConfig
	"result.json": HarborJobResult
	trials: Record<string, HarborTrialDirectory> // trial-hash -> trial data
}

/**
 * Parsed trial result from Harbor output
 */
export interface ParsedHarborTrial {
	taskId: string
	trialHash: string
	passed: boolean
	duration: number
	cost: number
	tokensIn?: number
	tokensOut?: number
	logs: string // Full cline.txt content
	testOutput: string // Test verification output
	errors: string[] // Setup or command errors
}

/**
 * Utility type for extracting trial directory paths
 */
export interface HarborTrialPath {
	jobDir: string
	trialDir: string
	taskId: string
	trialHash: string
}
