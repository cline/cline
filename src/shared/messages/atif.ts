/**
 * Agent Trajectory Interchange Format (ATIF) v1.3 Type Definitions
 *
 * This file contains TypeScript type definitions for the ATIF specification,
 * which provides a standardized format for logging LLM agent interactions.
 *
 * Specification: https://github.com/harbor-project/rfcs/blob/main/0001-trajectory-format.md
 */

/**
 * Root-level ATIF trajectory object
 */
export interface ATIFTrajectory {
	schema_version: string // e.g., "ATIF-v1.3"
	session_id: string
	agent: ATIFAgentSchema
	steps: ATIFStepObject[]
	notes?: string
	final_metrics?: ATIFFinalMetricsSchema
	extra?: Record<string, unknown>
}

/**
 * Agent configuration schema
 */
export interface ATIFAgentSchema {
	name: string // e.g., "cline"
	version: string // e.g., "1.0.0"
	model_name?: string // Default model for trajectory
	extra?: Record<string, unknown>
}

/**
 * Aggregate metrics for entire trajectory
 */
export interface ATIFFinalMetricsSchema {
	total_prompt_tokens?: number
	total_completion_tokens?: number
	total_cached_tokens?: number
	total_cost_usd?: number
	total_steps?: number
	extra?: Record<string, unknown>
}

/**
 * Individual step in the trajectory
 */
export interface ATIFStepObject {
	step_id: number // Ordinal index starting from 1
	timestamp?: string // ISO 8601 timestamp
	source: "system" | "user" | "agent"
	model_name?: string // Only applicable when source is "agent"
	reasoning_effort?: string | number // Only applicable when source is "agent"
	message: string // Required but can be empty string
	reasoning_content?: string // Only applicable when source is "agent"
	tool_calls?: ATIFToolCallSchema[] // Only applicable when source is "agent"
	observation?: ATIFObservationSchema // Can be present for agent and system steps
	metrics?: ATIFMetricsSchema // Only applicable when source is "agent"
	extra?: Record<string, unknown>
}

/**
 * Tool call schema (function invocation)
 */
export interface ATIFToolCallSchema {
	tool_call_id: string
	function_name: string
	arguments: Record<string, unknown> // Must be valid JSON object, can be empty
}

/**
 * Observation schema (environment feedback)
 */
export interface ATIFObservationSchema {
	results: ATIFObservationResultSchema[]
}

/**
 * Individual observation result
 */
export interface ATIFObservationResultSchema {
	source_call_id?: string // Maps to tool_call_id, null for non-tool actions
	content?: string // May be omitted when subagent_trajectory_ref is present
	subagent_trajectory_ref?: ATIFSubagentTrajectoryRefSchema[]
}

/**
 * Subagent trajectory reference
 */
export interface ATIFSubagentTrajectoryRefSchema {
	session_id: string
	trajectory_path?: string // File path, URL, or database reference
	extra?: Record<string, unknown>
}

/**
 * Per-step LLM metrics
 */
export interface ATIFMetricsSchema {
	prompt_tokens?: number // Total input tokens (includes cached + non-cached)
	completion_tokens?: number // Total output tokens
	cached_tokens?: number // Subset of prompt_tokens that were cache hits
	cost_usd?: number // Monetary cost for this step
	completion_token_ids?: number[] // Token IDs for RL training (v1.3)
	logprobs?: number[] // Log probabilities for each completion token
	extra?: Record<string, unknown> // Provider-specific metrics
}

/**
 * Source type for ATIF steps
 */
export type ATIFSourceType = "system" | "user" | "agent"

/**
 * Mapping between Cline roles and ATIF sources
 */
export const CLINE_ROLE_TO_ATIF_SOURCE: Record<string, ATIFSourceType> = {
	user: "user",
	assistant: "agent",
}

/**
 * Constants for ATIF format
 */
export const ATIF_SCHEMA_VERSION = "ATIF-v1.3"
export const ATIF_AGENT_NAME = "cline"
