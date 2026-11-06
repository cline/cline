import type {
	AgentConfig,
	AgentEvent,
	AgentHooks,
	AgentTool,
	BasicLogger,
	DelegationTarget,
	HookErrorMode,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import { SessionRuntime } from "../../../runtime/orchestration/session-runtime-orchestrator";
import type { CoreModelConfig } from "../../../types/config";
import {
	buildSubAgentSystemPrompt,
	buildTeammateSystemPrompt,
} from "./subagent-prompts";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];

export type DelegatedAgentConnectionConfig = CoreModelConfig &
	Pick<AgentConfig, "onAuthError" | "extensionContext">;

export interface DelegatedAgentRuntimeConfig
	extends DelegatedAgentConnectionConfig {
	cwd?: string;
	providerId: string;
	clinePlatform?: string;
	clineIdeName?: string;
	maxIterations?: number;
	hooks?: AgentHooks;
	extensions?: AgentExtension[];
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	workspaceMetadata?: string;
	/**
	 * Stable end-user identity inherited from the parent session so
	 * delegated-agent telemetry (Langfuse `userId`) groups with the user.
	 */
	distinctId?: string;
	/**
	 * Root core session id inherited from the parent session so
	 * delegated-agent telemetry (Langfuse `sessionId`) groups with it.
	 */
	sessionId?: string;
}

export interface DelegatedAgentConfigProvider {
	getRuntimeConfig(): DelegatedAgentRuntimeConfig;
	getConnectionConfig(): DelegatedAgentConnectionConfig;
	updateConnectionDefaults(
		overrides: Partial<DelegatedAgentConnectionConfig>,
	): void;
	resolveTarget?: ResolveDelegatedAgentConfig;
}

export type ResolveDelegatedAgentConfig = (
	target: DelegationTarget | undefined,
	parent: DelegatedAgentRuntimeConfig,
	signal?: AbortSignal,
) => Promise<DelegatedAgentConfigProvider>;

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
	resolveTarget?: ResolveDelegatedAgentConfig,
): DelegatedAgentConfigProvider {
	let runtimeConfig: DelegatedAgentRuntimeConfig = { ...initialConfig };

	return {
		resolveTarget,
		getRuntimeConfig: () => runtimeConfig,
		getConnectionConfig: () => ({
			providerId: runtimeConfig.providerId,
			modelId: runtimeConfig.modelId,
			apiKey: runtimeConfig.apiKey,
			baseUrl: runtimeConfig.baseUrl,
			headers: runtimeConfig.headers,
			onAuthError: runtimeConfig.onAuthError,
			providerConfig: runtimeConfig.providerConfig,
			knownModels: runtimeConfig.knownModels,
			thinking: runtimeConfig.thinking,
			reasoningEffort: runtimeConfig.reasoningEffort,
			thinkingBudgetTokens: runtimeConfig.thinkingBudgetTokens,
			maxTokensPerTurn: runtimeConfig.maxTokensPerTurn,
			temperature: runtimeConfig.temperature,
			extensionContext: runtimeConfig.extensionContext,
		}),
		updateConnectionDefaults: (overrides) => {
			runtimeConfig = {
				...runtimeConfig,
				...overrides,
			};
		},
	};
}

export async function resolveDelegatedAgentConfig(
	parent: DelegatedAgentConfigProvider,
	target?: DelegationTarget,
	signal?: AbortSignal,
): Promise<DelegatedAgentConfigProvider> {
	signal?.throwIfAborted();
	const snapshot = { ...parent.getRuntimeConfig() };
	if (parent.resolveTarget) {
		const resolved = await parent.resolveTarget(target, snapshot, signal);
		signal?.throwIfAborted();
		return resolved;
	}
	if (target && target.providerId !== snapshot.providerId) {
		throw new Error(
			"Cross-provider delegation requires a host connection resolver.",
		);
	}
	return createDelegatedAgentConfigProvider({
		...snapshot,
		...(target ? { modelId: target.modelId } : {}),
	});
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
		distinctId: runtimeConfig.distinctId,
		sessionId: runtimeConfig.sessionId,
		systemPrompt,
		tools: options.tools,
		maxIterations: options.maxIterations ?? runtimeConfig.maxIterations,
		parentAgentId: options.parentAgentId,
		abortSignal: options.abortSignal,
		onEvent: options.onEvent,
		hooks: runtimeConfig.hooks,
		extensions: runtimeConfig.extensions,
		hookErrorMode: options.hookErrorMode,
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
	return createDelegatedRuntime(config, options.configProvider);
}

export function createDelegatedRuntime(
	config: AgentConfig,
	configProvider?: DelegatedAgentConfigProvider,
): SessionRuntime {
	const refresh = config.onAuthError;
	const session = new SessionRuntime({
		...config,
		...(refresh && configProvider
			? {
					onAuthError: async () => {
						if (!(await refresh())) return false;
						const fresh = configProvider.getConnectionConfig();
						session.updateConnection({
							apiKey: fresh.apiKey,
							baseUrl: fresh.baseUrl,
							headers: fresh.headers,
							providerConfig: fresh.providerConfig,
						});
						return true;
					},
				}
			: {}),
	});
	if (config.onEvent) {
		session.subscribeEvents(config.onEvent);
	}
	return session;
}
