import type {
	AgentMode,
	RpcChatRuntimeLoggerConfig,
	SessionLineage,
	ToolPolicy,
} from "@clinebot/core";
import type { CoreSessionConfig, SessionManifest } from "@clinebot/core/node";
import type { providers as LlmsProviders } from "@clinebot/llms";

export type CliOutputMode = "text" | "json";
export type CliAgentMode = AgentMode;
export type CliReasoningEffort = NonNullable<
	NonNullable<LlmsProviders.ProviderSettings["reasoning"]>["effort"]
>;

export interface Config extends Omit<CoreSessionConfig, "apiKey" | "mode"> {
	apiKey: string;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	loggerConfig?: RpcChatRuntimeLoggerConfig;
	verbose: boolean;
	timeoutSeconds?: number;
	sandbox: boolean;
	sandboxDataDir?: string;
	thinking: boolean;
	missionLogIntervalSteps: number;
	missionLogIntervalMs: number;
	showUsage: boolean;
	showTimings: boolean;
	outputMode: CliOutputMode;
	mode: CliAgentMode;
	yolo?: boolean;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
}

export interface ActiveCliSession {
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
	manifest: SessionManifest;
}

export interface StoredApiMessages {
	version: 1;
	updated_at: string;
	messages: LlmsProviders.Message[];
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
	showUsage: boolean;
	showTimings: boolean;
	outputMode: CliOutputMode;
	mode: CliAgentMode;
	yolo?: boolean;
	timeoutSeconds?: number;
	invalidTimeoutSeconds?: string;
	thinking: boolean;
	reasoningEffort?: CliReasoningEffort;
	liveModelCatalog: boolean;
	invalidReasoningEffort?: string;
	sandbox: boolean;
	sandboxDir?: string;
	configDir?: string;
	hooksDir?: string;
	acpMode: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	enableTools: boolean;
	model?: string;
	provider?: string;
	taskId?: string;
	maxIterations?: number;
	maxConsecutiveMistakes?: number;
	invalidMaxConsecutiveMistakes?: string;
	cwd?: string;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
}
