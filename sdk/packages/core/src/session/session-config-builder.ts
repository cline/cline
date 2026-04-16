import type { ITelemetryService } from "@clinebot/shared";
import { resolveAndLoadAgentPlugins } from "../extensions/plugin/plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import {
	createHookAuditHooks,
	createHookConfigFileHooks,
	mergeAgentHooks,
} from "../runtime/hook-file-hooks";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import type { CoreSessionConfig } from "../types/config";
import {
	type ProviderConfig,
	type ProviderSettings,
	toProviderConfig,
} from "../types/provider-settings";
import type { StartSessionInput } from "./session-manager";
import { hasRuntimeHooks, mergeAgentExtensions } from "./utils/helpers";

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

export function resolveWorkspacePath(config: CoreSessionConfig): string {
	return config.workspaceRoot ?? config.cwd;
}

export async function buildEffectiveConfig(
	input: StartSessionInput,
	sessionId: string,
	defaultTelemetry: ITelemetryService | undefined,
	onPluginEvent?: (event: { name: string; payload?: unknown }) => void,
): Promise<{
	config: CoreSessionConfig;
	pluginSandboxShutdown?: () => Promise<void>;
}> {
	const workspacePath = resolveWorkspacePath(input.config);

	const fileHooks = createHookConfigFileHooks({
		cwd: input.config.cwd,
		workspacePath,
		rootSessionId: sessionId,
		logger: input.config.logger,
	});
	const auditHooks = hasRuntimeHooks(input.config.hooks)
		? undefined
		: createHookAuditHooks({
				rootSessionId: sessionId,
				workspacePath,
			});
	const effectiveHooks = mergeAgentHooks([
		input.config.hooks,
		fileHooks,
		auditHooks,
	]);

	let loadedPlugins:
		| Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>
		| undefined;
	try {
		loadedPlugins = await resolveAndLoadAgentPlugins({
			pluginPaths: input.config.pluginPaths,
			workspacePath,
			cwd: input.config.cwd,
			onEvent: onPluginEvent,
		});
		logPluginDiagnostics(
			loadedPlugins.failures,
			loadedPlugins.warnings,
			input.config.logger,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.config.logger?.log?.(
			`plugin loading failed; continuing without plugins (${message})`,
		);
	}
	const effectiveExtensions = mergeAgentExtensions(
		input.config.extensions,
		loadedPlugins?.extensions,
	);

	return {
		config: {
			...input.config,
			hooks: effectiveHooks,
			extensions: effectiveExtensions,
			telemetry: input.config.telemetry ?? defaultTelemetry,
		},
		pluginSandboxShutdown: loadedPlugins?.shutdown,
	};
}

export function buildResolvedProviderConfig(
	config: CoreSessionConfig,
	providerSettingsManager: ProviderSettingsManager,
	resolveReasoningFn: (
		config: CoreSessionConfig,
		storedReasoning: ProviderSettings["reasoning"],
	) => ProviderSettings["reasoning"],
): ProviderConfig {
	const stored = providerSettingsManager.getProviderSettings(config.providerId);
	const settings: ProviderSettings = {
		...(stored ?? {}),
		provider: config.providerId,
		model: config.modelId,
		apiKey: config.apiKey ?? stored?.apiKey,
		baseUrl: config.baseUrl ?? stored?.baseUrl,
		headers: config.headers ?? stored?.headers,
		reasoning: resolveReasoningFn(config, stored?.reasoning),
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

export function resolveReasoningSettings(
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
