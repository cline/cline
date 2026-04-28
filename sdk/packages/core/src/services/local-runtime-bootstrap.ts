import type {
	AgentConfig,
	AgentHooks,
	ExtensionContext,
	ITelemetryService,
	RuntimeConfigExtensionKind,
	Tool,
	ToolApprovalRequest,
	ToolApprovalResult,
	WorkspaceInfo,
} from "@clinebot/shared";
import { decodeJwtPayload } from "../auth/utils";
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
import type { RuntimeBuilderInput } from "../runtime/session-runtime";
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
import { buildWorkspaceMetadataWithInfo } from "./workspace-manifest";

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

const ALL_CONFIG_EXTENSIONS: readonly RuntimeConfigExtensionKind[] = [
	"rules",
	"skills",
	"plugins",
];

function hasConfigExtension(
	extensions: ReadonlyArray<RuntimeConfigExtensionKind> | undefined,
	kind: RuntimeConfigExtensionKind,
): boolean {
	return new Set(extensions ?? ALL_CONFIG_EXTENSIONS).has(kind);
}

function buildOpenAICodexHeaders(input: {
	sessionId: string;
	configHeaders: CoreSessionConfig["headers"];
	storedHeaders: ProviderSettings["headers"];
	accountId?: string;
	accessToken?: string;
}): Record<string, string> | undefined {
	const headers: Record<string, string> = {
		...(input.storedHeaders ?? {}),
		...(input.configHeaders ?? {}),
	};
	const resolvedAccountId =
		input.accountId?.trim() || deriveOpenAICodexAccountId(input.accessToken);
	headers.originator = "cline";
	headers.session_id = input.sessionId;
	headers["User-Agent"] = `Cline/${process.env.npm_package_version || "1.0.0"}`;
	if (resolvedAccountId) {
		headers["ChatGPT-Account-Id"] = resolvedAccountId;
	}
	return headers;
}

function deriveOpenAICodexAccountId(
	accessToken: string | undefined,
): string | undefined {
	const trimmed = accessToken?.trim();
	if (!trimmed) {
		return undefined;
	}
	const payload = decodeJwtPayload(trimmed) as {
		"https://api.openai.com/auth"?: { chatgpt_account_id?: string };
		organizations?: Array<{ id?: string }>;
		chatgpt_account_id?: string;
	} | null;
	const authAccountId =
		payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
	if (typeof authAccountId === "string" && authAccountId.length > 0) {
		return authAccountId;
	}
	const orgAccountId = payload?.organizations?.[0]?.id;
	if (typeof orgAccountId === "string" && orgAccountId.length > 0) {
		return orgAccountId;
	}
	const rootAccountId = payload?.chatgpt_account_id;
	if (typeof rootAccountId === "string" && rootAccountId.length > 0) {
		return rootAccountId;
	}
	return undefined;
}

function buildProviderConfig(
	config: CoreSessionConfig,
	sessionId: string,
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
	const settings: ProviderSettings = {
		...(stored ?? {}),
		provider: config.providerId,
		model: config.modelId,
		apiKey: config.apiKey ?? stored?.apiKey,
		baseUrl: config.baseUrl ?? stored?.baseUrl,
		headers:
			config.providerId === "openai-codex"
				? buildOpenAICodexHeaders({
						sessionId,
						configHeaders: config.headers,
						storedHeaders: stored?.headers,
						accountId: stored?.auth?.accountId,
						accessToken:
							config.apiKey ?? stored?.auth?.accessToken ?? stored?.apiKey,
					})
				: (config.headers ?? stored?.headers),
		reasoning: resolveReasoningSettings(config, stored?.reasoning),
		modelCatalog,
	};
	const providerConfig = toProviderConfig(settings);
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
	defaultToolExecutors?: Partial<ToolExecutors>;
	defaultToolPolicies?: AgentConfig["toolPolicies"];
	defaultRequestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	/**
	 * Host-level default `fetch` threaded into `ProviderConfig.fetch` so the
	 * AI gateway providers can use a custom HTTP implementation.
	 */
	defaultFetch?: typeof fetch;
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
	/** Structured git + path metadata generated alongside workspaceMetadata. */
	workspaceInfo: WorkspaceInfo;
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
		defaultToolPolicies,
		defaultRequestToolApproval,
		defaultFetch,
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
	const localConfig = configOverrides as Partial<CoreSessionConfig> | undefined;

	// Generate workspace + git metadata once, early, so it can be forwarded to
	// hooks and extensions. The serialized string goes into CoreSessionConfig
	// as workspaceMetadata; the structured object is kept as workspaceInfo.
	const { workspaceInfo, workspaceMetadata } =
		await buildWorkspaceMetadataWithInfo(input.config.cwd);
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
		logger: configuredExtensionContext?.logger ?? configOverrides?.logger,
		telemetry:
			configuredExtensionContext?.telemetry ??
			configOverrides?.telemetry ??
			defaultTelemetry,
	};

	const fileHooks = createHookConfigFileHooks({
		cwd: input.config.cwd,
		workspacePath,
		rootSessionId: sessionId,
		logger: configOverrides?.logger,
		workspaceInfo,
	});
	const auditHooks = hasRuntimeHooks(configOverrides?.hooks)
		? undefined
		: createHookAuditHooks({
				rootSessionId: sessionId,
				workspacePath,
				workspaceInfo,
			});
	const baseHooks = mergeAgentHooks([
		configOverrides?.hooks,
		fileHooks,
		auditHooks,
	]);

	let loadedPlugins:
		| Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>
		| undefined;
	if (hasConfigExtension(localRuntime?.configExtensions, "plugins")) {
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
				configOverrides?.logger,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			configOverrides?.logger?.log?.(
				`plugin loading failed; continuing without plugins (${message})`,
			);
		}
	}

	const extensions = mergeAgentExtensions(
		configOverrides?.extensions,
		filterExtensionToolRegistrations(loadedPlugins?.extensions),
	);
	const baseConfig: CoreSessionConfig = {
		...input.config,
		...(configOverrides ?? {}),
		hooks: baseHooks,
		extensions,
		extensionContext,
		telemetry: extensionContext.telemetry,
	};
	const providerConfig = buildProviderConfig(
		baseConfig,
		sessionId,
		providerSettingsManager,
		localRuntime?.modelCatalogDefaults,
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
	const requestToolApproval =
		input.requestToolApproval ?? defaultRequestToolApproval;
	const effectiveToolExecutors =
		localRuntime?.defaultToolExecutors ?? defaultToolExecutors;

	return {
		effectiveInput: input,
		config,
		providerConfig,
		workspaceMetadata,
		workspaceInfo,
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
			configExtensions: localRuntime?.configExtensions,
			defaultToolExecutors: effectiveToolExecutors,
			logger: config.logger,
			telemetry: config.telemetry,
		},
	};
}
