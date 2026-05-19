import type { AgentConfig, AgentTool } from "@cline/shared";
import { resolveAgentPluginPaths } from "../extensions/plugin/plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import { loadSandboxedPlugins } from "../extensions/plugin/plugin-sandbox";
import { resolveDisabledToolNames } from "./global-settings";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];

export interface PluginToolSummary {
	name: string;
	pluginName: string;
	path: string;
	source: "workspace-plugin" | "global-plugin";
	enabled: boolean;
	description?: string;
}

export interface ListPluginToolsResult {
	tools: PluginToolSummary[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

function collectRegisteredTools(
	extension: AgentExtension,
	workspaceInfo?: { rootPath: string },
): AgentTool[] {
	if (!extension.setup) {
		return [];
	}

	const tools: AgentTool[] = [];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: () => {},
		registerRule: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
	};
	extension.setup(api, { workspaceInfo });
	return tools;
}

export async function listPluginToolsWithDiagnostics(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<ListPluginToolsResult> {
	const pluginPaths = resolveAgentPluginPaths({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
	});
	const disabled = resolveDisabledToolNames(input.disabledToolNames);
	const tools: PluginToolSummary[] = [];
	const failures: PluginInitializationFailure[] = [];
	const warnings: PluginInitializationWarning[] = [];

	for (const pluginPath of pluginPaths) {
		let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;
		try {
			sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
				cwd: input.cwd,
				providerId: input.providerId,
				modelId: input.modelId,
				workspaceInfo: { rootPath: input.workspacePath },
			});
			failures.push(...sandboxed.failures);
			warnings.push(...sandboxed.warnings);
			for (const extension of sandboxed.extensions ?? []) {
				for (const tool of collectRegisteredTools(extension, {
					rootPath: input.workspacePath,
				})) {
					tools.push({
						name: tool.name,
						pluginName: extension.name,
						path: pluginPath,
						source: pluginPath.startsWith(input.workspacePath)
							? "workspace-plugin"
							: "global-plugin",
						enabled: !disabled.has(tool.name),
						description: tool.description?.trim() || undefined,
					});
				}
			}
		} catch (error) {
			failures.push({
				pluginPath,
				phase: "load",
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		} finally {
			await sandboxed?.shutdown().catch(() => {
				// Best effort cleanup after contribution discovery.
			});
		}
	}

	return {
		tools: tools.sort((left, right) => {
			const nameOrder = left.name.localeCompare(right.name);
			if (nameOrder !== 0) {
				return nameOrder;
			}
			return left.path.localeCompare(right.path);
		}),
		failures,
		warnings,
	};
}

export async function listPluginTools(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<PluginToolSummary[]> {
	return (await listPluginToolsWithDiagnostics(input)).tools;
}
