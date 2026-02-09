/**
 * Bead types for the Ralph Wiggum loop pattern.
 *
 * A "bead" is one small, reviewable chunk of work that the agent completes
 * before stopping for approval. Each bead produces a clear diff, commit,
 * and review step.
 */

/**
 * Status of a bead in the review workflow.
 */
export type BeadStatus = "running" | "awaiting_approval" | "approved" | "rejected" | "skipped"

/**
 * Type of success criterion for completing a bead or task.
 */
export type SuccessCriterionType = "tests_pass" | "done_tag" | "no_errors" | "custom"

/**
 * Success criterion configuration.
 */
export interface SuccessCriterion {
	type: SuccessCriterionType
	/** Optional configuration for the criterion (e.g., test command for tests_pass) */
	config?: Record<string, unknown>
}

/**
 * Result of evaluating success criteria.
 */
export interface SuccessCriteriaResult {
	allPassed: boolean
	results: Partial<Record<SuccessCriterionType, boolean>>
	details?: string
}

/**
 * A change to a single file within a bead.
 */
export interface BeadFileChange {
	filePath: string
	changeType: "created" | "modified" | "deleted"
	diff?: string
	linesAdded?: number
	linesRemoved?: number
	/** Node IDs of symbols impacted by this change (from DAG analysis) */
	impactedNodes?: string[]
}

/**
 * Result of a test run within a bead.
 */
export interface BeadTestResult {
	name: string
	passed: boolean
	output?: string
	duration?: number
}

/**
 * A single bead representing one discrete chunk of work.
 */
export interface Bead {
	/** Unique identifier for this bead */
	id: string
	/** ID of the parent task */
	taskId: string
	/** Sequential bead number within the task (1-indexed) */
	beadNumber: number
	/** Current status in the approval workflow */
	status: BeadStatus
	/** Timestamp when the bead started */
	startedAt: number
	/** Timestamp when the bead completed (approved/rejected/skipped) */
	completedAt?: number
	/** Checkpoint hash at bead start (for diff presentation) */
	startCheckpointHash?: string
	/** The prompt sent to the LLM for this bead */
	prompt?: string
	/** The LLM's response */
	response?: string
	/** Files changed in this bead */
	filesChanged: BeadFileChange[]
	/** Test results if tests were run */
	testResults?: BeadTestResult[]
	/** Git commit hash if the bead was committed */
	commitHash?: string
	/** Tokens used by the LLM in this bead */
	tokensUsed: number
	/** Number of retry iterations within this bead */
	iterationCount: number
	/** Errors encountered during execution */
	errors: string[]
	/** User feedback if the bead was rejected */
	rejectionFeedback?: string
	/** Impact summary from DAG analysis */
	impactSummary?: BeadImpactSummary
}

/**
 * Summary of the impact analysis for a bead.
 */
export interface BeadImpactSummary {
	/** Files that may be affected by changes in this bead */
	affectedFiles: string[]
	/** Functions that may be affected */
	affectedFunctions: string[]
	/** Suggested test files to run */
	suggestedTests: string[]
	/** Breakdown of edge confidence levels */
	confidenceBreakdown: {
		high: number
		medium: number
		low: number
		unsafe: number
	}
}

/**
 * Task definition with success criteria for the Ralph loop.
 */
export interface BeadTaskDefinition {
	/** Unique task identifier */
	id: string
	/** Human-readable task description */
	description: string
	/** Workspace root path */
	workspaceRoot: string
	/** Criteria that must be met for task completion */
	successCriteria: SuccessCriterion[]
	/** Maximum tokens allowed for the entire task */
	tokenBudget: number
	/** Maximum number of bead iterations */
	maxIterations: number
	/** Optional: command to run tests */
	testCommand?: string
}

/**
 * Overall status of the Ralph loop task.
 */
export type BeadTaskStatus = "idle" | "running" | "paused" | "awaiting_approval" | "completed" | "failed"

/**
 * Summary of task completion.
 */
export interface BeadTaskSummary {
	/** Total number of beads executed */
	beadCount: number
	/** Total tokens used across all beads */
	totalTokensUsed: number
	/** Whether the task completed successfully */
	success: boolean
	/** Final status */
	status: BeadTaskStatus
	/** Completion timestamp */
	completedAt: number
	/** Error message if failed */
	errorMessage?: string
}

/**
 * State for the bead manager / Ralph loop controller.
 */
export interface BeadManagerState {
	/** Current task being executed */
	currentTask: BeadTaskDefinition | null
	/** Current task status */
	status: BeadTaskStatus
	/** Current bead number (0 if not started) */
	currentBeadNumber: number
	/** Beads completed so far */
	beads: Bead[]
	/** Total tokens used */
	totalTokensUsed: number
	/** Total iteration count across all beads */
	totalIterationCount: number
	/** Most recent success criteria evaluation */
	lastCriteriaResult?: SuccessCriteriaResult
}

/**
 * Message types for bead-related UI updates.
 */
export interface BeadsmithSayBeadStarted {
	beadNumber: number
	taskId: string
	taskDescription: string
}

export interface BeadsmithSayBeadCompleted {
	beadNumber: number
	filesChanged: string[]
	tokensUsed: number
	success: boolean
	errors?: string[]
}

export interface BeadsmithAskBeadReview {
	beadNumber: number
	filesChanged: BeadFileChange[]
	/** @deprecated Diff is now presented via checkpoint system, not inline */
	diff?: string
	impactSummary?: BeadImpactSummary
	testResults?: BeadTestResult[]
	commitHash?: string
}
