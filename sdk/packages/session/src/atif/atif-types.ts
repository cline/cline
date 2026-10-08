/**
 * Agent Trajectory Interchange Format (ATIF) v1.7, as defined by the Harbor
 * RFC and Pydantic models at commit 0533a59c41ce435d9e59ff8c82da67f6e5b6edc7
 * (https://github.com/harbor-framework/harbor). `atif-v1.7.schema.json` is the
 * JSON Schema generated from those models; these types follow it field for
 * field. Optional fields are omitted rather than set to null.
 */

export const ATIF_SCHEMA_VERSION = "ATIF-v1.7";

export type AtifExtra = Record<string, unknown>;

export interface AtifImageSource {
	media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	path: string;
}

export type AtifContentPart =
	| { type: "text"; text: string }
	| { type: "image"; source: AtifImageSource };

export type AtifContent = string | AtifContentPart[];

export interface AtifAgent {
	name: string;
	version: string;
	model_name?: string | null;
	/** OpenAI function-calling format: `{ type: "function", function: {...} }`. */
	tool_definitions?: Record<string, unknown>[] | null;
	extra?: AtifExtra | null;
}

export interface AtifToolCall {
	tool_call_id: string;
	function_name: string;
	arguments: Record<string, unknown>;
	extra?: AtifExtra | null;
}

export interface AtifSubagentTrajectoryRef {
	trajectory_id?: string | null;
	session_id?: string | null;
	trajectory_path?: string | null;
	extra?: AtifExtra | null;
}

export interface AtifObservationResult {
	source_call_id?: string | null;
	content?: AtifContent | null;
	subagent_trajectory_ref?: AtifSubagentTrajectoryRef[] | null;
	extra?: AtifExtra | null;
}

export interface AtifObservation {
	results: AtifObservationResult[];
}

export interface AtifMetrics {
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	cached_tokens?: number | null;
	cost_usd?: number | null;
	prompt_token_ids?: number[] | null;
	completion_token_ids?: number[] | null;
	logprobs?: number[] | null;
	extra?: AtifExtra | null;
}

export interface AtifFinalMetrics {
	total_prompt_tokens?: number | null;
	total_completion_tokens?: number | null;
	total_cached_tokens?: number | null;
	total_cost_usd?: number | null;
	total_steps?: number | null;
	extra?: AtifExtra | null;
}

export type AtifStepSource = "system" | "user" | "agent";

export interface AtifStep {
	step_id: number;
	timestamp?: string | null;
	source: AtifStepSource;
	model_name?: string | null;
	reasoning_effort?: string | number | null;
	message: AtifContent;
	reasoning_content?: string | null;
	tool_calls?: AtifToolCall[] | null;
	observation?: AtifObservation | null;
	metrics?: AtifMetrics | null;
	is_copied_context?: boolean | null;
	llm_call_count?: number | null;
	extra?: AtifExtra | null;
}

export interface AtifTrajectory {
	schema_version?:
		| "ATIF-v1.0"
		| "ATIF-v1.1"
		| "ATIF-v1.2"
		| "ATIF-v1.3"
		| "ATIF-v1.4"
		| "ATIF-v1.5"
		| "ATIF-v1.6"
		| "ATIF-v1.7";
	session_id?: string | null;
	trajectory_id?: string | null;
	agent: AtifAgent;
	steps: AtifStep[];
	notes?: string | null;
	final_metrics?: AtifFinalMetrics | null;
	continued_trajectory_ref?: string | null;
	extra?: AtifExtra | null;
	subagent_trajectories?: AtifTrajectory[] | null;
}
