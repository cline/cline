import type {
	AgentConfig,
	AgentHooks,
	ITelemetryService,
	Tool,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import { resolveAndLoadAgentPlugins } from "../extensions/plugin/plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import type { ToolExecutors } from "../extensions/tools";
import type { TeamEvent } from "../extensions/tools/team";
import { createCheckpointHooks } from "../hooks/checkpoint-hooks";
import {
	createHookAuditHooks,
	createHookConfigFileHooks,
	mergeAgentHooks,
} from "../hooks/hook-file-hooks";
import type {
	LocalRuntimeConfigOverrides,
	LocalRuntimeStartOptions,
	StartSessionInput,
} from "../runtime/runtime-host";
import type {
	RuntimeBuilderInput,
	TeamToolsFactory,
} from "../runtime/session-runtime";
import type { CoreSessionConfig } from "../types/config";
import {
	type ProviderConfig,
	type ProviderSettings,
	toProviderConfig,
} from "../types/provider-settings";
import { resolveWorkspacePath } from "./config";
import { hasRuntimeHooks, mergeAgentExtensions } from "./session-data";
import type { ProviderSettingsManager } from "./storage/provider-settings-manager";
import { buildWorkspaceMetadata } from "./workspace-manifest";

function formatPluginFailure(failure: PluginInitializationFailure): string {
	const label = failure.pluginName ?? failure.pluginPath;
	return `${label}: ${failure.message}`;
}

function logPluginDiagnostics(
	failures: PluginInitializationFailure[],
	warnings: PluginInitializationWarning[],
	logger: CoreSessionConfig["logger"],
): void {
	if (warnings.length > 0) {
		for (const warning of warnings) {
			logger?.log(warning.message, { severity: "warn" });
		}
	}
	if (failures.length === 0) {
		return;
	}
	const preview = failures.slice(0, 3).map(formatPluginFailure).join("; ");
	const suffix = failures.length > 3 ? `; and ${failures.length - 3} more` : "";
	logger?.log(
		`Some plugins failed to initialize. ${preview}${suffix}. Use --verbose for more details.`,
		{ severity: "warn" },
	);
	for (const failure of failures) {
		logger?.log(
			`Plugin initialization failed (${failure.phase}) for ${failure.pluginPath}`,
			{
				severity: "warn",
				stack: failure.stack,
				pluginPath: failure.pluginPath,
				pluginName: failure.pluginName,
			},
		);
	}
}

function resolveReasoningSettings(
	config: CoreSessionConfig,
	storedReasoning: ProviderSettings["reasoning"],
): ProviderSettings["reasoning"] {
	const hasThinking = typeof config.thinking === "boolean";
	const hasEffort = typeof config.reasoningEffort === "string";
	if (!hasThinking && !hasEffort) return storedReasoning;
	return {
		...(storedReasoning ?? {}),
		...(hasThinking ? { enabled: config.thinking } : {}),
		...(hasEffort ? { effort: config.reasoningEffort } : {}),
	};
}

function buildProviderConfig(
	config: CoreSessionConfig,
	providerSettingsManager: ProviderSettingsManager,
): ProviderConfig {
	const stored = providerSettingsManager.getProviderSettings(config.providerId);
	const settings: ProviderSettings = {
		...(stored ?? {}),
		provider: config.providerId,
		model: config.modelId,
		apiKey: config.apiKey ?? stored?.apiKey,
		baseUrl: config.baseUrl ?? stored?.baseUrl,
		headers: config.headers ?? stored?.headers,
		reasoning: resolveReasoningSettings(config, stored?.reasoning),
	};
	const providerConfig = toProviderConfig(settings);
	if (config.knownModels) {
		providerConfig.knownModels = config.knownModels;
	}
	if (config.extensionContext) {
		providerConfig.extensionContext = config.extensionContext;
	}
	return providerConfig;
}

export interface PrepareLocalRuntimeBootstrapOptions {
	input: StartSessionInput;
	localRuntime?: LocalRuntimeStartOptions;
	sessionId: string;
	providerSettingsManager: ProviderSettingsManager;
	defaultTelemetry?: ITelemetryService;
	defaultToolExecutors?: Partial<ToolExecutors>;
	teamToolsFactory?: TeamToolsFactory;
	defaultToolPolicies?: AgentConfig["toolPolicies"];
	defaultRequestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	onPluginEvent: (event: { name: string; payload?: unknown }) => void;
	onTeamEvent: (event: TeamEvent) => void;
	createSpawnTool: () => Tool;
	readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
	writeSessionMetadata: (
		metadata: Record<string, unknown>,
	) => Promise<void> | void;
}

export interface LocalRuntimeBootstrap {
	effectiveInput: StartSessionInput;
	config: CoreSessionConfig;
	providerConfig: ProviderConfig;
	workspaceMetadata: string;
	extensions: AgentConfig["extensions"];
	hooks: AgentHooks | undefined;
	toolPolicies: AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	pluginSandboxShutdown?: () => Promise<void>;
	runtimeBuilderInput: RuntimeBuilderInput;
}

export async function prepareLocalRuntimeBootstrap(
	options: PrepareLocalRuntimeBootstrapOptions,
): Promise<LocalRuntimeBootstrap> {
	const {
		input,
		sessionId,
		providerSettingsManager,
		defaultTelemetry,
		defaultToolExecutors,
		teamToolsFactory,
		defaultToolPolicies,
		defaultRequestToolApproval,
		onPluginEvent,
		onTeamEvent,
		createSpawnTool,
		localRuntime,
		readSessionMetadata,
		writeSessionMetadata,
	} = options;
	const workspacePath = resolveWorkspacePath(input.config);
	const configOverrides = localRuntime?.configOverrides as
		| Partial<LocalRuntimeConfigOverrides>
		| undefined;

	const fileHooks = createHookConfigFileHooks({
		cwd: input.config.cwd,
		workspacePath,
		rootSessionId: sessionId,
		logger: configOverrides?.logger,
	});
	const auditHooks = hasRuntimeHooks(configOverrides?.hooks)
		? undefined
		: createHookAuditHooks({
				rootSessionId: sessionId,
				workspacePath,
			});
	const baseHooks = mergeAgentHooks([
		configOverrides?.hooks,
		fileHooks,
		auditHooks,
	]);

	let loadedPlugins:
		| Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>
		| undefined;
	try {
		loadedPlugins = await resolveAndLoadAgentPlugins({
			pluginPaths: configOverrides?.pluginPaths,
			workspacePath,
			cwd: input.config.cwd,
			onEvent: onPluginEvent,
		});
		logPluginDiagnostics(
			loadedPlugins.failures,
			loadedPlugins.warnings,
			configOverrides?.logger,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		configOverrides?.logger?.log?.(
			`plugin loading failed; continuing without plugins (${message})`,
		);
	}

	const extensions = mergeAgentExtensions(
		configOverrides?.extensions,
		loadedPlugins?.extensions,
	);
	const workspaceMetadata = await buildWorkspaceMetadata(input.config.cwd);
	const baseConfig: CoreSessionConfig = {
		...input.config,
		...(configOverrides ?? {}),
		hooks: baseHooks,
		extensions,
		telemetry: configOverrides?.telemetry ?? defaultTelemetry,
	};
	const providerConfig = buildProviderConfig(
		baseConfig,
		providerSettingsManager,
	);
	const hooks = mergeAgentHooks([
		baseConfig.hooks,
		baseConfig.checkpoint?.enabled === true
			? createCheckpointHooks({
					cwd: baseConfig.cwd,
					sessionId,
					logger: baseConfig.logger,
					createCheckpoint: baseConfig.checkpoint?.createCheckpoint,
					readSessionMetadata,
					writeSessionMetadata,
				})
			: undefined,
	]);
	const config: CoreSessionConfig = {
		...baseConfig,
		providerConfig,
		workspaceMetadata,
		hooks,
	};
	const toolPolicies = input.toolPolicies ?? defaultToolPolicies;
	const requestToolApproval =
		input.requestToolApproval ?? defaultRequestToolApproval;

	return {
		effectiveInput: input,
		config,
		providerConfig,
		workspaceMetadata,
		extensions,
		hooks,
		toolPolicies,
		requestToolApproval,
		pluginSandboxShutdown: loadedPlugins?.shutdown,
		runtimeBuilderInput: {
			config,
			hooks,
			extensions,
			onTeamEvent,
			createSpawnTool,
			onTeamRestored: localRuntime?.onTeamRestored,
			userInstructionWatcher: localRuntime?.userInstructionWatcher,
			defaultToolExecutors,
			logger: config.logger,
			telemetry: config.telemetry,
			teamToolsFactory,
		},
	};
}
