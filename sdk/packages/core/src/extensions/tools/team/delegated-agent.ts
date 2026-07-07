import {
	type AgentConfig,
	type AgentEvent,
	type AgentHooks,
	type AgentTool,
	type BasicLogger,
	DEFAULT_API_TIMEOUT_MS,
	type HookErrorMode,
	type ITelemetryService,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@cline/shared";
import { SessionRuntime } from "../../../runtime/orchestration/session-runtime-orchestrator";
import {
	buildSubAgentSystemPrompt,
	buildTeammateSystemPrompt,
} from "./subagent-prompts";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];

export type DelegatedAgentConnectionConfig = Pick<
	AgentConfig,
	| "providerId"
	| "modelId"
	| "apiKey"
	| "baseUrl"
	| "headers"
	| "providerConfig"
	| "knownModels"
	| "thinking"
	| "thinkingBudgetTokens"
	| "reasoningEffort"
	| "maxTokensPerTurn"
>;

export interface DelegatedAgentRuntimeConfig
	extends DelegatedAgentConnectionConfig {
	cwd?: string;
	providerId: string;
	clinePlatform?: string;
	clineIdeName?: string;
	maxIterations?: number;
	apiTimeoutMs?: number;
	hooks?: AgentHooks;
	extensions?: AgentExtension[];
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	workspaceMetadata?: string;
}

export interface DelegatedAgentConfigProvider {
	getRuntimeConfig(): DelegatedAgentRuntimeConfig;
	getConnectionConfig(): DelegatedAgentConnectionConfig;
	updateConnectionDefaults(
		overrides: Partial<DelegatedAgentConnectionConfig>,
	): void;
}

export type DelegatedAgentKind = "subagent" | "teammate";

export interface BuildDelegatedAgentConfigOptions {
	kind: DelegatedAgentKind;
	prompt: string;
	tools: AgentTool[];
	configProvider: DelegatedAgentConfigProvider;
	parentAgentId?: string;
	maxIterations?: number;
	abortSignal?: AbortSignal;
	onEvent?: (event: AgentEvent) => void;
	hookErrorMode?: HookErrorMode;
	toolPolicies?: AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
	role?: string;
	cwd?: string;
}

export function createDelegatedAgentConfigProvider(
	initialConfig: DelegatedAgentRuntimeConfig,
): DelegatedAgentConfigProvider {
	let runtimeConfig: DelegatedAgentRuntimeConfig = { ...initialConfig };

	return {
		getRuntimeConfig: () => runtimeConfig,
		getConnectionConfig: () => ({
			providerId: runtimeConfig.providerId,
			modelId: runtimeConfig.modelId,
			apiKey: runtimeConfig.apiKey,
			baseUrl: runtimeConfig.baseUrl,
			headers: runtimeConfig.headers,
			providerConfig: runtimeConfig.providerConfig,
			knownModels: runtimeConfig.knownModels,
			thinking: runtimeConfig.thinking,
			thinkingBudgetTokens: runtimeConfig.thinkingBudgetTokens,
			reasoningEffort: runtimeConfig.reasoningEffort,
			maxTokensPerTurn: runtimeConfig.maxTokensPerTurn,
		}),
		updateConnectionDefaults: (overrides) => {
			runtimeConfig = {
				...runtimeConfig,
				...overrides,
			};
		},
	};
}

export function buildDelegatedAgentConfig(
	options: BuildDelegatedAgentConfigOptions,
): AgentConfig & { role?: string } {
	const runtimeConfig = options.configProvider.getRuntimeConfig();
	const systemPrompt =
		options.kind === "teammate"
			? buildTeammateSystemPrompt(options.prompt, runtimeConfig)
			: buildSubAgentSystemPrompt(options.prompt, runtimeConfig);

	return {
		...options.configProvider.getConnectionConfig(),
		systemPrompt,
		tools: options.tools,
		maxIterations: options.maxIterations ?? runtimeConfig.maxIterations,
		apiTimeoutMs: runtimeConfig.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
		parentAgentId: options.parentAgentId,
		abortSignal: options.abortSignal,
		onEvent: options.onEvent,
		hooks: runtimeConfig.hooks,
		extensions: runtimeConfig.extensions,
		hookErrorMode: options.hookErrorMode ?? "ignore",
		toolPolicies: options.toolPolicies,
		requestToolApproval: options.requestToolApproval,
		logger: runtimeConfig.logger,
		role: options.role,
	};
}

export function createDelegatedAgent(
	options: BuildDelegatedAgentConfigOptions,
): SessionRuntime {
	const config = buildDelegatedAgentConfig(options);
	const session = new SessionRuntime(config);
	if (config.onEvent) {
		session.subscribeEvents(config.onEvent);
	}
	return session;
}
