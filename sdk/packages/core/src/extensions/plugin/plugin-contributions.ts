import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionCommand,
	AgentExtensionMcpServer,
	AgentExtensionProvider,
	AgentExtensionRule,
	AgentTool,
	Message,
	PluginStatusRecord,
	SessionPluginIssue,
} from "@cline/shared";
import {
	type PluginExecutionMode,
	resolvePluginExecutionMode,
} from "./plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "./plugin-load-report";
import {
	derivePluginNameFromPath,
	getProcessPluginRegistry,
	type PluginRegistry,
} from "./plugin-registry";
import { loadSandboxedPlugins } from "./plugin-sandbox";
import type { PluginTargeting } from "./plugin-targeting";

type AgentExtensionWithPath = AgentExtension & { __clinePluginPath?: string };

export interface CollectedPluginContributions {
	pluginName: string;
	pluginPath: string;
	extension: AgentExtension;
	tools: AgentTool[];
	rules: AgentExtensionRule[];
	commands: AgentExtensionCommand[];
	mcpServers: AgentExtensionMcpServer[];
	providers: AgentExtensionProvider[];
}

export interface CollectPluginContributionsInput extends PluginTargeting {
	pluginPaths: ReadonlyArray<string>;
	disabledPluginPaths?: ReadonlyArray<string>;
	discoveryFailures?: ReadonlyArray<{ pluginPath: string; error: unknown }>;
	cwd?: string;
	workspacePath?: string;
	registry?: PluginRegistry;
	/** Defaults to the configured execution mode (`CLINE_PLUGIN_MODE`). */
	mode?: PluginExecutionMode;
}

export interface CollectPluginContributionsResult {
	plugins: CollectedPluginContributions[];
	/** Status of every plugin that failed to import or set up. */
	failed: PluginStatusRecord[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

function collectingApi(collected: CollectedPluginContributions): {
	api: AgentExtensionApi<AgentTool, Message[]>;
} {
	return {
		api: {
			registerTool: (tool) => collected.tools.push(tool),
			registerCommand: (command) => collected.commands.push(command),
			registerMessageBuilder: () => {},
			registerRule: (rule) => collected.rules.push(rule),
			registerProvider: (provider) => collected.providers.push(provider),
			registerAutomationEventType: () => {},
			registerMcpServer: (server) => collected.mcpServers.push(server),
		},
	};
}

function emptyContributions(
	extension: AgentExtension,
	pluginPath: string,
): CollectedPluginContributions {
	return {
		pluginName: extension.name,
		pluginPath,
		extension,
		tools: [],
		rules: [],
		commands: [],
		mcpServers: [],
		providers: [],
	};
}

/**
 * Runs each plugin's `setup` with a collecting API, for settings surfaces
 * that list what plugins contribute without starting a session. Plugins load
 * the same way sessions load them: through the shared in-process registry by
 * default (failures are recorded there like any other), or through the
 * subprocess sandbox when `CLINE_PLUGIN_MODE=sandbox`.
 */
export async function collectPluginContributions(
	input: CollectPluginContributionsInput,
): Promise<CollectPluginContributionsResult> {
	if (resolvePluginExecutionMode(input.mode) === "sandbox") {
		return collectSandboxedContributions(input);
	}
	const registry = input.registry ?? getProcessPluginRegistry();
	const workspaceInfo = input.workspacePath
		? { rootPath: input.workspacePath }
		: undefined;
	const setupFailures = new Map<string, SessionPluginIssue>();
	const loaded = await registry.loadForSession({
		pluginPaths: input.pluginPaths,
		disabledPluginPaths: input.disabledPluginPaths,
		discoveryFailures: input.discoveryFailures,
		providerId: input.providerId,
		modelId: input.modelId,
		cwd: input.cwd,
		setupContext: { workspaceInfo },
		// Setup failures are reported to the copy that failed, so this listing
		// knows about its own failure even when another session's setup of
		// the same plugin succeeds concurrently.
		onIssue: (issue) => {
			if (issue.lastError?.phase === "setup") {
				setupFailures.set(issue.pluginPath, issue);
			}
		},
	});
	const plugins: CollectedPluginContributions[] = [];
	const failures = [...loaded.failures];
	const failed: PluginStatusRecord[] = loaded.issues.flatMap((issue) =>
		issue.state === "failed" ? registry.get(issue.pluginPath) : [],
	);
	try {
		for (const extension of loaded.extensions) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath) continue;
			const collected = emptyContributions(extension, pluginPath);
			try {
				await extension.setup?.(collectingApi(collected).api, {
					workspaceInfo,
				});
			} catch {
				// Registration errors are recorded as setup failures below.
			}
			const issue = setupFailures.get(pluginPath);
			if (issue) {
				failed.push({
					...(registry.get(pluginPath)[0] ?? {
						name: issue.name,
						pluginPath,
						errorCount: 1,
						timeoutCount: 0,
						sessionIds: [],
						updatedAt: Date.now(),
					}),
					state: "failed",
					...(issue.lastError ? { lastError: issue.lastError } : {}),
				});
				failures.push({
					pluginPath,
					pluginName: extension.name,
					phase: "setup",
					message: issue.lastError?.message ?? "Plugin setup failed",
					stack: issue.lastError?.stack,
				});
				continue;
			}
			plugins.push(collected);
		}
	} finally {
		// Runs onDispose cleanup and clears timers the setups started.
		await loaded.release();
	}
	return { plugins, failed, failures, warnings: loaded.warnings };
}

async function collectSandboxedContributions(
	input: CollectPluginContributionsInput,
): Promise<CollectPluginContributionsResult> {
	if (input.pluginPaths.length === 0) {
		return { plugins: [], failed: [], failures: [], warnings: [] };
	}
	const workspaceInfo = input.workspacePath
		? { rootPath: input.workspacePath }
		: undefined;
	const sandboxed = await loadSandboxedPlugins({
		pluginPaths: [...input.pluginPaths],
		cwd: input.cwd,
		providerId: input.providerId,
		modelId: input.modelId,
		workspaceInfo,
	});
	const failures: PluginInitializationFailure[] = [...sandboxed.failures];
	const plugins: CollectedPluginContributions[] = [];
	try {
		for (const extension of sandboxed.extensions ?? []) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath) continue;
			const collected = emptyContributions(extension, pluginPath);
			try {
				await extension.setup?.(collectingApi(collected).api, {
					workspaceInfo,
				});
			} catch (error) {
				failures.push({
					pluginPath,
					pluginName: extension.name,
					phase: "setup",
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				continue;
			}
			plugins.push(collected);
		}
	} finally {
		await sandboxed.shutdown().catch(() => {
			// Best effort cleanup after contribution discovery.
		});
	}
	const failed: PluginStatusRecord[] = failures.map((failure) => ({
		name: failure.pluginName ?? derivePluginNameFromPath(failure.pluginPath),
		pluginPath: failure.pluginPath,
		state: "failed",
		lastError: {
			phase: failure.phase === "setup" ? "setup" : "import",
			message: failure.message,
			...(failure.stack ? { stack: failure.stack } : {}),
			pluginPath: failure.pluginPath,
			timestamp: Date.now(),
		},
		errorCount: 1,
		timeoutCount: 0,
		sessionIds: [],
		updatedAt: Date.now(),
	}));
	return { plugins, failed, failures, warnings: sandboxed.warnings };
}
