export type Plan = "free" | "pro";

export type TaskStatus =
	| "queued"
	| "provisioning"
	| "running"
	| "waiting_approval"
	| "succeeded"
	| "failed"
	| "cancelled";

export type WorkspaceState = "pending" | "provisioning" | "ready" | "stopped" | "error" | "deleted";

export type ApprovalMode = "auto" | "writes" | "read_only";

export type ProjectRow = {
	id: string;
	owner_id: string;
	name: string;
	description: string;
	language: string;
	template: string;
	repo_url: string | null;
	default_model: string | null;
	approval_mode: ApprovalMode;
	status: "active" | "archived";
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
};

export type WorkspaceRow = {
	id: string;
	project_id: string;
	owner_id: string;
	provider: string;
	external_id: string | null;
	state: WorkspaceState;
	root_path: string;
	preview_url: string | null;
	preview_port: number | null;
	resources: Record<string, unknown>;
	last_active_at: string | null;
	expires_at: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
};

export type ConversationRow = {
	id: string;
	project_id: string;
	owner_id: string;
	title: string;
	created_at: string;
	updated_at: string;
};

export type TaskRow = {
	id: string;
	project_id: string;
	owner_id: string;
	conversation_id: string;
	title: string;
	prompt: string;
	model_id: string;
	status: TaskStatus;
	progress: number;
	iteration: number;
	max_iterations: number;
	error: string | null;
	summary: string | null;
	remaining_issues: unknown[];
	usage: Record<string, number>;
	files_changed: number;
	cancel_requested: boolean;
	worker_id: string | null;
	attempt: number;
	max_attempts: number;
	started_at: string | null;
	completed_at: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
};

export type TaskEventRow = {
	id: number;
	task_id: string;
	owner_id: string;
	type: string;
	level: "debug" | "info" | "warn" | "error";
	message: string | null;
	tool_name: string | null;
	payload: Record<string, unknown> | null;
	created_at: string;
};

export type MessageRow = {
	id: string;
	conversation_id: string;
	task_id: string | null;
	owner_id: string;
	role: "user" | "assistant" | "tool" | "system";
	content: unknown;
	model_id: string | null;
	created_at: string;
};

export type FileChangeRow = {
	id: string;
	project_id: string;
	task_id: string | null;
	owner_id: string;
	path: string;
	change_type: "create" | "update" | "delete" | "revert";
	before_content: string | null;
	after_content: string | null;
	diff: string | null;
	status: "applied" | "reverted";
	tool_call_id: string | null;
	created_at: string;
};

export type ApprovalRow = {
	id: string;
	task_id: string;
	owner_id: string;
	tool_name: string;
	input: Record<string, unknown>;
	input_hash: string;
	status: "pending" | "approved" | "rejected" | "expired";
	decided_at: string | null;
	decided_by: string | null;
	note: string | null;
	created_at: string;
};

export type ProfileRow = {
	id: string;
	email: string;
	display_name: string | null;
	avatar_url: string | null;
	plan: Plan;
	default_model: string | null;
	theme: string;
	onboarded: boolean;
	created_at: string;
	updated_at: string;
};

export type SettingsRow = {
	owner_id: string;
	default_model: string | null;
	theme: string;
	monthly_token_limit: number | null;
	monthly_task_limit: number | null;
	max_concurrent_tasks: number;
	terminal_timeout_seconds: number;
	created_at: string;
	updated_at: string;
};

export type UsageRecordRow = {
	id: string;
	owner_id: string;
	project_id: string | null;
	task_id: string | null;
	model_id: string;
	provider: string;
	prompt_tokens: number;
	completion_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	cost_usd: number | string;
	pricing: Record<string, unknown> | null;
	created_at: string;
};

export type OpenRouterModel = {
	id: string;
	name: string;
	description: string | null;
	contextLength: number | null;
	maxCompletionTokens: number | null;
	provider: string;
	supportsTools: boolean;
	supportsStreaming: boolean;
	inputModalities: string[];
	pricing: {
		promptPerToken: number | null;
		completionPerToken: number | null;
		request: number | null;
		promptPerMillion: number | null;
		completionPerMillion: number | null;
	};
	moderated: boolean;
	created: number | null;
};

export type ModelsResponse = {
	models: OpenRouterModel[];
	configured: boolean;
	source: "openrouter";
	fetchedAt: string;
	total: number;
	error?: string;
};
