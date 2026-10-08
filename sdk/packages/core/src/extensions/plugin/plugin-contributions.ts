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
} from "@cline/shared";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "./plugin-load-report";
import {
	getProcessPluginRegistry,
	type PluginRegistry,
} from "./plugin-registry";
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
}

export interface CollectPluginContributionsResult {
	plugins: CollectedPluginContributions[];
	/** Status of every plugin that failed to import or set up. */
	failed: PluginStatusRecord[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

/**
 * Runs each plugin's `setup` through the shared registry with a collecting
 * API, for settings surfaces that list what plugins contribute without
 * starting a session. Failures are recorded in the registry like any other.
 */
export async function collectPluginContributions(
	input: CollectPluginContributionsInput,
): Promise<CollectPluginContributionsResult> {
	const registry = input.registry ?? getProcessPluginRegistry();
	const workspaceInfo = input.workspacePath
		? { rootPath: input.workspacePath }
		: undefined;
	const loaded = await registry.loadForSession({
		pluginPaths: input.pluginPaths,
		disabledPluginPaths: input.disabledPluginPaths,
		discoveryFailures: input.discoveryFailures,
		providerId: input.providerId,
		modelId: input.modelId,
		cwd: input.cwd,
		setupContext: { workspaceInfo },
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
			const collected: CollectedPluginContributions = {
				pluginName: extension.name,
				pluginPath,
				extension,
				tools: [],
				rules: [],
				commands: [],
				mcpServers: [],
				providers: [],
			};
			const api: AgentExtensionApi<AgentTool, Message[]> = {
				registerTool: (tool) => collected.tools.push(tool),
				registerCommand: (command) => collected.commands.push(command),
				registerMessageBuilder: () => {},
				registerRule: (rule) => collected.rules.push(rule),
				registerProvider: (provider) => collected.providers.push(provider),
				registerAutomationEventType: () => {},
				registerMcpServer: (server) => collected.mcpServers.push(server),
			};
			await extension.setup?.(api, { workspaceInfo });
			// The registry catches setup errors and marks the plugin failed.
			const status = registry.get(pluginPath)[0];
			if (status?.state === "failed") {
				failed.push(status);
				failures.push({
					pluginPath,
					pluginName: extension.name,
					phase: "setup",
					message: status.lastError?.message ?? "Plugin setup failed",
					stack: status.lastError?.stack,
				});
				continue;
			}
			plugins.push(collected);
		}
	} finally {
		loaded.release();
	}
	return { plugins, failed, failures, warnings: loaded.warnings };
}
