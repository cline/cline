import type {
	AgentMode,
	CoreSessionConfig,
	Llms,
	ProviderSettings,
	RuntimeLoggerConfig,
	SessionLineage,
	SessionManifest,
	ToolPolicy,
} from "@cline/core";
import type { Message } from "@cline/shared";

export type CliOutputMode = "text" | "json";
export type CliAgentMode = AgentMode;
export type CliReasoningEffort = NonNullable<
	NonNullable<ProviderSettings["reasoning"]>["effort"]
>;
export type CliCompactionMode = "agentic" | "basic" | "off";

/**
 * An agent profile from .cline/agents applied to the main Cline agent for
 * the current session. Session-only: never persisted to settings.
 */
export interface ActiveAgentProfile {
	name: string;
	/** Profile body, captured at selection time (survives file deletion mid-session) */
	systemPrompt: string;
	/**
	 * Plugin names from the profile's plugins frontmatter. When present (even
	 * empty), only these plugins plus always-enabled ones load this session.
	 */
	plugins?: string[];
	/**
	 * Builtin tool allowlist from the profile's tools frontmatter. When present
	 * (even empty), builtin tools outside the list are disabled this session.
	 */
	tools?: string[];
	/**
	 * Skill allowlist from the profile's skills frontmatter. When present, only
	 * these skills are surfaced by the skills tool this session.
	 */
	skills?: string[];
	/**
	 * Provider/model from the profile's frontmatter, applied once at selection
	 * time. A later explicit /model change wins for the rest of the session.
	 */
	providerId?: string;
	modelId?: string;
}

export interface Config extends Omit<CoreSessionConfig, "apiKey" | "mode"> {
	apiKey: string;
	knownModels?: Record<string, Llms.ModelInfo>;
	loggerConfig?: RuntimeLoggerConfig;
	verbose: boolean;
	timeoutSeconds?: number;
	sandbox: boolean;
	sandboxDataDir?: string;
	thinking: boolean;
	outputMode: CliOutputMode;
	mode: CliAgentMode;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
	agentProfile?: ActiveAgentProfile;
}

export interface ActiveCliSession {
	manifest: SessionManifest;
}

export interface StoredApiMessages {
	version: 1;
	updated_at: string;
	messages: Message[];
}

export interface SessionDbRow {
	session_id: string;
	provider: string;
	model: string;
	cwd: string;
	workspace_root: string;
	team_name?: string | null;
	enable_tools: number;
	enable_spawn: number;
	enable_teams: number;
	prompt?: string | null;
}

export interface SubagentSessionInput
	extends Required<
		Pick<SessionLineage, "agentId" | "parentAgentId" | "conversationId">
	> {
	prompt?: string;
	rootSessionId?: string;
}

export interface ParsedArgs {
	prompt?: string;
	systemPrompt?: string;
	key?: string;
	verbose: boolean;
	interactive: boolean;
	outputMode: CliOutputMode;
	mode: CliAgentMode;
	timeoutSeconds?: number;
	invalidTimeoutSeconds?: string;
	thinking: boolean;
	/** Whether --thinking was explicitly provided on the command line */
	thinkingExplicitlySet?: boolean;
	reasoningEffort?: CliReasoningEffort;
	invalidThinkingLevel?: string;
	compactionMode?: CliCompactionMode;
	invalidCompactionMode?: string;
	invalidAutoApprove?: string;
	sandbox: boolean;
	dataDir?: string;
	configDir?: string;
	hooksDir?: string;
	worktree?: boolean;
	acpMode: boolean;
	model?: string;
	provider?: string;
	id?: string;
	retries?: number;
	invalidRetries?: string;
	cwd?: string;
	teamName?: string;
	defaultToolAutoApprove: boolean;
	autoApproveOverride?: boolean;
	/** Agent profile name from .cline/agents to apply to the main agent */
	agent?: string;
}
