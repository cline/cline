import { resolveProviderRequestHeaders } from "@cline/llms";
import type {
	AgentConfig,
	AgentEvent,
	AgentHooks,
	AgentTool,
	ExtensionContext,
	ITelemetryService,
	RuntimeConfigExtensionKind,
	ToolApprovalRequest,
	ToolApprovalResult,
	WorkspaceInfo,
} from "@cline/shared";
import { hasRuntimeConfigExtension } from "@cline/shared";
import { version as corePackageVersion } from "../../package.json";
import {
	resolveAndLoadAgentPlugins,
	resolvePluginSkillDirectoriesFromPaths,
} from "../extensions/plugin/plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import type {
	SubAgentEndContext,
	SubAgentStartContext,
	TeamEvent,
} from "../extensions/tools/team";
import { createCheckpointHooks } from "../hooks/checkpoint-hooks";
import {
	createHookAuditHooks,
	createHookConfigFileExtension,
	mergeAgentHooks,
} from "../hooks/hook-file-hooks";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import { normalizeRuntimeCapabilities } from "../runtime/capabilities";
import type {
	LocalRuntimeStartOptions,
	StartSessionInput,
} from "../runtime/host/runtime-host";
import type { RuntimeBuilderInput } from "../runtime/orchestration/session-runtime";
import { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import {
	type ProviderConfig,
	type ProviderSettings,
	toProviderConfig,
} from "../types/provider-settings";
import { resolveWorkspacePath } from "./config";
import { filterExtensionToolRegistrations } from "./global-settings";
import { hasRuntimeHooks, mergeAgentExtensions } from "./session-data";
import type { ProviderSettingsManager } from "./storage/provider-settings-manager";
import { InMemoryWorkspaceManager } from "./workspace/workspace-manager";
import { buildWorkspaceMetadataWithInfo } from "./workspace/workspace-manifest";
import type { GitWorkspaceState } from "./workspace/workspace-manifest";
import { emitWorkspaceLifecycleTelemetry } from "./workspace/workspace-telemetry";

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

function hasConfigExtension(
	extensions: ReadonlyArray<RuntimeConfigExtensionKind> | undefined,
	kind: RuntimeConfigExtensionKind,
): boolean {
	return hasRuntimeConfigExtension(extensions, kind);
}

function buildProviderConfig(
	config: CoreSessionConfig,
	sessionId: string,
	source: StartSessionInput["source"],
	providerSettingsManager: ProviderSettingsManager,
	modelCatalogDefaults?: Partial<ProviderSettings["modelCatalog"]>,
	defaultFetch?: typeof fetch,
): ProviderConfig {
	const stored = providerSettingsManager.getProviderSettings(config.providerId);
	const modelCatalog =
		modelCatalogDefaults || stored?.modelCatalog
			? {
					...(modelCatalogDefaults ?? {}),
					...(stored?.modelCatalog ?? {}),
				}
			: undefined;
	const sessionProviderConfig =
		config.providerConfig?.providerId === config.providerId
			? config.providerConfig
			: undefined;
	const resolvedHeaders = resolveProviderRequestHeaders({
		providerId: config.providerId,
		sessionId,
		source,
		defaultSource: SessionSource.CLI,
		client: {
			name: config.extensionContext?.client?.name,
			version: config.extensionContext?.client?.version,
			versionHeaderFallback: config.headers?.["X-CLIENT-VERSION"],
			platform: config.extensionContext?.client?.platform,
			platformVersion: config.extensionContext?.client?.platformVersion,
			isMultiRoot: config.extensionContext?.client?.isMultiRoot,
		},
		coreVersion: corePackageVersion,
		openAiCodex: {
			accountId: sessionProviderConfig?.accountId ?? stored?.auth?.accountId,
			accessToken:
				sessionProviderConfig?.accessToken ??
				config.apiKey ??
				stored?.auth?.accessToken ??
				stored?.apiKey,
			userAgentVersion: process.env.npm_package_version,
		},
		headers: {
			stored: stored?.headers,
			config: config.headers,
			session: sessionProviderConfig?.headers,
		},
	});
	const settings: ProviderSettings = {
		...(stored ?? {}),
		provider: config.providerId,
		model: config.modelId,
		apiKey: config.apiKey ?? stored?.apiKey,
		baseUrl: config.baseUrl ?? stored?.baseUrl,
		headers: undefined,
		reasoning: resolveReasoningSettings(config, stored?.reasoning),
		modelCatalog,
	};
	const providerConfig: ProviderConfig = {
		...toProviderConfig(settings),
		...(sessionProviderConfig ?? {}),
	};
	if (resolvedHeaders) {
		providerConfig.headers = resolvedHeaders;
	}
	if (config.knownModels) {
		providerConfig.knownModels = config.knownModels;
	}
	if (config.extensionContext) {
		providerConfig.extensionContext = config.extensionContext;
	}
	// Thread a host-provided custom fetch through to the AI gateway providers.
	// Precedence: explicit per-session config > stored provider settings > host default.
	const sessionFetch = (config as { fetch?: typeof fetch }).fetch;
	const resolvedFetch = sessionFetch ?? providerConfig.fetch ?? defaultFetch;
	if (resolvedFetch) {
		providerConfig.fetch = resolvedFetch;
	}
	return providerConfig;
}

export interface PrepareLocalRuntimeBootstrapOptions {
	input: StartSessionInput;
	localRuntime?: LocalRuntimeStartOptions;
	sessionId: string;
	providerSettingsManager: ProviderSettingsManager;
	defaultTelemetry?: ITelemetryService;
	defaultCapabilities?: RuntimeCapabilities;
	defaultToolPolicies?: AgentConfig["toolPolicies"];
	/**
	 * Host-level default `fetch` threaded into `ProviderConfig.fetch` so the
	 * AI gateway providers can use a custom HTTP implementation.
	 */
	defaultFetch?: typeof fetch;
	onPluginEvent: (event: { name: string; payload?: unknown }) => void;
	onTeamEvent: (event: TeamEvent) => void;
	createSubAgentLifecycleCallbacks?: (config: CoreSessionConfig) => {
		onSubAgentEvent?: (event: AgentEvent) => void;
		onSubAgentStart?: (context: SubAgentStartContext) => void | Promise<void>;
		onSubAgentEnd?: (context: SubAgentEndContext) => void | Promise<void>;
	};
	createSpawnTool: () => AgentTool;
	readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
	writeSessionMetadata: (
		updater: (
			current: Record<string, unknown> | undefined,
		) => Record<string, unknown>,
	) => Promise<void> | void;
}

export interface LocalRuntimeBootstrap {
	effectiveInput: StartSessionInput;
	config: CoreSessionConfig;
	providerConfig: ProviderConfig;
	workspaceMetadata: string;
	/** Structured git + path metadata generated alongside workspaceMetadata. */
	workspaceInfo: WorkspaceInfo;
	gitState: GitWorkspaceState;
	extensions: AgentConfig["extensions"];
	hooks: AgentHooks | undefined;
	toolPolicies: AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
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
		defaultCapabilities,
		defaultToolPolicies,
		defaultFetch,
		onPluginEvent,
		onTeamEvent,
		createSubAgentLifecycleCallbacks,
		createSpawnTool,
		localRuntime,
		readSessionMetadata,
		writeSessionMetadata,
	} = options;
	const workspacePath = resolveWorkspacePath(input.config);
	const {
		modelCatalogDefaults,
		userInstructionService,
		configExtensions,
		onTeamRestored,
		...localConfigFields
	} = localRuntime ?? {};
	const localConfig =
		Object.keys(localConfigFields).length > 0
			? (localConfigFields as Partial<CoreSessionConfig>)
			: undefined;

	// Generate workspace + git metadata once, early, so it can be forwarded to
	// hooks and extensions. The serialized string goes into CoreSessionConfig
	// as workspaceMetadata; the structured object is kept as workspaceInfo.
	const {
		workspaceInfo,
		workspaceMetadata,
		gitState,
		durationMs,
		vcsType,
		initError,
	} = await buildWorkspaceMetadataWithInfo(workspacePath);
	const configuredExtensionContext = localConfig?.extensionContext;
	const extensionContext: ExtensionContext = {
		...(configuredExtensionContext ?? {}),
		workspace: {
			...workspaceInfo,
			...(configuredExtensionContext?.workspace ?? {}),
		},
		session: {
			...(configuredExtensionContext?.session ?? {}),
			sessionId,
		},
		logger: configuredExtensionContext?.logger ?? localConfig?.logger,
		telemetry:
			configuredExtensionContext?.telemetry ??
			localConfig?.telemetry ??
			defaultTelemetry,
	};
	emitWorkspaceLifecycleTelemetry({
		telemetry: extensionContext.telemetry,
		rootPath: workspaceInfo.rootPath,
		workspaceInfo,
		rootCount: 1,
		vcsType,
		durationMs,
		initError,
		featureFlagEnabled: true,
	});

	const fileHookExtension = createHookConfigFileExtension({
		cwd: input.config.cwd,
		workspacePath,
		rootSessionId: sessionId,
		logger: localConfig?.logger,
		workspaceInfo,
	});
	const auditHooks = hasRuntimeHooks(localConfig?.hooks)
		? undefined
		: createHookAuditHooks({
				rootSessionId: sessionId,
				workspacePath,
				workspaceInfo,
			});
	const baseHooks = mergeAgentHooks([localConfig?.hooks, auditHooks]);

	let loadedPlugins:
		| Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>
		| undefined;
	if (hasConfigExtension(configExtensions, "plugins")) {
		try {
			loadedPlugins = await resolveAndLoadAgentPlugins({
				pluginPaths: localConfig?.pluginPaths,
				workspacePath,
				cwd: input.config.cwd,
				onEvent: onPluginEvent,
				providerId: input.config.providerId,
				modelId: input.config.modelId,
				workspaceInfo,
				session: extensionContext.session,
				client: extensionContext.client,
				user: extensionContext.user,
				logger: extensionContext.logger,
				telemetry: extensionContext.telemetry,
				automation: extensionContext.automation,
			});
			logPluginDiagnostics(
				loadedPlugins.failures,
				loadedPlugins.warnings,
				localConfig?.logger,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			localConfig?.logger?.log?.(
				`plugin loading failed; continuing without plugins (${message})`,
			);
		}
	}

	const builtInExtensions = fileHookExtension ? [fileHookExtension] : undefined;
	const extensions = mergeAgentExtensions(
		builtInExtensions,
		mergeAgentExtensions(
			localConfig?.extensions,
			filterExtensionToolRegistrations(loadedPlugins?.extensions),
		),
	);
	const pluginSkillDirectories = hasConfigExtension(configExtensions, "plugins")
		? resolvePluginSkillDirectoriesFromPaths(loadedPlugins?.pluginPaths ?? [])
		: undefined;
	const baseConfig: CoreSessionConfig = {
		...input.config,
		...(localConfig ?? {}),
		sessionId,
		hooks: baseHooks,
		extensions,
		extensionContext,
		telemetry: extensionContext.telemetry,
	};
	const providerConfig = buildProviderConfig(
		baseConfig,
		sessionId,
		input.source,
		providerSettingsManager,
		modelCatalogDefaults,
		defaultFetch,
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
	const toolPolicies =
		input.toolPolicies ?? baseConfig.toolPolicies ?? defaultToolPolicies;
	const capabilities = normalizeRuntimeCapabilities(
		defaultCapabilities,
		input.capabilities,
	);
	const requestToolApproval = capabilities?.requestToolApproval;
	const effectiveToolExecutors = capabilities?.toolExecutors;
	const subAgentLifecycleCallbacks = createSubAgentLifecycleCallbacks?.(config);
	const workspaceManager = new InMemoryWorkspaceManager({
		currentWorkspacePath: workspaceInfo.rootPath,
		workspaces: {
			[workspaceInfo.rootPath]: workspaceInfo,
		},
	});

	return {
		effectiveInput: input,
		config,
		providerConfig,
		workspaceMetadata,
		workspaceInfo,
		gitState,
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
			onTeamRestored: onTeamRestored,
			onSubAgentEvent: subAgentLifecycleCallbacks?.onSubAgentEvent,
			onSubAgentStart: subAgentLifecycleCallbacks?.onSubAgentStart,
			onSubAgentEnd: subAgentLifecycleCallbacks?.onSubAgentEnd,
			userInstructionService: userInstructionService,
			pluginSkillDirectories,
			configExtensions: configExtensions,
			toolExecutors: effectiveToolExecutors,
			toolPolicies,
			workspaceManager,
			logger: config.logger,
			telemetry: config.telemetry,
			requestToolApproval,
		},
	};
}
