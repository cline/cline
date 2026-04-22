import type { AgentConfig, Tool } from "@clinebot/shared";
import { resolveAgentPluginPaths } from "../extensions/plugin/plugin-config-loader";
import { loadAgentPluginsFromPathsWithDiagnostics } from "../extensions/plugin/plugin-loader";
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

function collectRegisteredTools(extension: AgentExtension): Tool[] {
	if (!extension.setup) {
		return [];
	}

	const tools: Tool[] = [];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: () => {},
		registerProvider: () => {},
	};
	extension.setup(api, {});
	return tools;
}

export async function listPluginTools(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<PluginToolSummary[]> {
	const pluginPaths = resolveAgentPluginPaths({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
	});
	const disabled = resolveDisabledToolNames(input.disabledToolNames);
	const summaries: PluginToolSummary[] = [];

	for (const pluginPath of pluginPaths) {
		const report = await loadAgentPluginsFromPathsWithDiagnostics(
			[pluginPath],
			{
				cwd: input.cwd,
				providerId: input.providerId,
				modelId: input.modelId,
			},
		);
		for (const extension of report.plugins) {
			for (const tool of collectRegisteredTools(extension)) {
				summaries.push({
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
	}

	return summaries.sort((left, right) => {
		const nameOrder = left.name.localeCompare(right.name);
		if (nameOrder !== 0) {
			return nameOrder;
		}
		return left.path.localeCompare(right.path);
	});
}
