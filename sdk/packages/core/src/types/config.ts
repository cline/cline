import type {
	AgentConfig,
	AgentHooks,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
	HookErrorMode,
	MessageWithMetadata,
} from "@clinebot/agents";
import type * as LlmsProviders from "@clinebot/llms";
import type {
	AgentMode,
	BasicLogger,
	ExtensionContext,
	ITelemetryService,
	SessionExecutionConfig,
	SessionPromptConfig,
	SessionWorkspaceConfig,
	Tool,
} from "@clinebot/shared";
import type { TeamEvent } from "../team";
import type { ToolRoutingRule } from "../tools/model-tool-routing";

export type CoreAgentMode = AgentMode;

export interface CoreModelConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	providerConfig?: LlmsProviders.ProviderConfig;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	/**
	 * Request model-side thinking/reasoning when supported.
	 */
	thinking?: boolean;
	/**
	 * Explicit reasoning effort override for capable models.
	 */
	reasoningEffort?: LlmsProviders.ProviderConfig["reasoningEffort"];
}

export interface CoreRuntimeFeatures {
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
}

export interface CoreCompactionContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: MessageWithMetadata[];
	model: {
		id: string;
		provider: string;
		info?: LlmsProviders.ModelInfo;
	};
	contextWindowTokens: number;
	triggerTokens: number;
	thresholdRatio: number;
	utilizationRatio: number;
}

export interface CoreCompactionResult {
	messages: MessageWithMetadata[];
}

export interface CoreCompactionSummarizerConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	providerConfig?: LlmsProviders.ProviderConfig;
	maxOutputTokens?: number;
}

export type CoreCompactionStrategy = "basic" | "agentic";

export interface CoreCompactionConfig {
	enabled?: boolean;
	strategy?: CoreCompactionStrategy;
	thresholdRatio?: number;
	reserveTokens?: number;
	preserveRecentTokens?: number;
	contextWindowTokens?: number;
	summarizer?: CoreCompactionSummarizerConfig;
	compact?: (
		context: CoreCompactionContext,
	) =>
		| Promise<CoreCompactionResult | undefined>
		| CoreCompactionResult
		| undefined;
}

export interface CoreSessionConfig
	extends CoreModelConfig,
		CoreRuntimeFeatures,
		Omit<SessionWorkspaceConfig, "workspaceRoot">,
		Omit<SessionPromptConfig, "systemPrompt">,
		Omit<
			SessionExecutionConfig,
			| "enableTools"
			| "teamName"
			| "missionLogIntervalSteps"
			| "missionLogIntervalMs"
			| "maxConsecutiveMistakes"
		> {
	sessionId?: string;
	workspaceRoot?: string;
	systemPrompt: string;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	hooks?: AgentHooks;
	hookErrorMode?: HookErrorMode;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	extensionContext?: ExtensionContext;
	extraTools?: Tool[];
	pluginPaths?: string[];
	extensions?: AgentConfig["extensions"];
	execution?: AgentConfig["execution"];
	compaction?: CoreCompactionConfig;
	onTeamEvent?: (event: TeamEvent) => void;
	onConsecutiveMistakeLimitReached?: (
		context: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision;
	toolRoutingRules?: ToolRoutingRule[];
	/**
	 * Optional skill allowlist for the `skills` tool. When provided, only these
	 * skills are surfaced in tool metadata and invocable by name.
	 */
	skills?: string[];
	workspaceMetadata?: string;
}
