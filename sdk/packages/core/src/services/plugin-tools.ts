import { isAbsolute, relative, resolve } from "node:path";
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
type AgentExtensionWithPath = AgentExtension & { __clinePluginPath?: string };

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

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

type PluginToolDescriptor = Omit<PluginToolSummary, "enabled">;

function withEnabledState(
	tools: readonly PluginToolDescriptor[],
	disabled: ReadonlySet<string>,
): PluginToolSummary[] {
	return tools.map((tool) => ({
		...tool,
		enabled: !disabled.has(tool.name),
	}));
}

function sortPluginToolDescriptors(
	tools: PluginToolDescriptor[],
): PluginToolDescriptor[] {
	return tools.sort((left, right) => {
		const nameOrder = left.name.localeCompare(right.name);
		if (nameOrder !== 0) {
			return nameOrder;
		}
		return left.path.localeCompare(right.path);
	});
}

async function collectPluginContributions(
	extension: AgentExtension,
	workspaceInfo?: { rootPath: string },
): Promise<{
	tools: AgentTool[];
}> {
	if (!extension.setup) {
		return { tools: [] };
	}

	const tools: AgentTool[] = [];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: () => {},
		registerRule: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
		registerMcpServer: (_server) => {
			if (!extension.manifest.capabilities.includes("mcp")) {
				throw new Error('registerMcpServer requires the "mcp" capability');
			}
		},
	};
	await extension.setup(api, { workspaceInfo });
	return { tools };
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
	if (pluginPaths.length === 0) {
		return { tools: [], failures: [], warnings: [] };
	}

	const tools: PluginToolDescriptor[] = [];
	let failures: PluginInitializationFailure[] = [];
	let warnings: PluginInitializationWarning[] = [];
	let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;

	try {
		sandboxed = await loadSandboxedPlugins({
			pluginPaths,
			cwd: input.cwd,
			providerId: input.providerId,
			modelId: input.modelId,
			workspaceInfo: { rootPath: input.workspacePath },
		});
		failures = [...sandboxed.failures];
		warnings = [...sandboxed.warnings];
		for (const extension of sandboxed.extensions ?? []) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath) {
				continue;
			}
			const pluginSource = isPathWithin(input.workspacePath, pluginPath)
				? "workspace-plugin"
				: "global-plugin";
			let contributions: Awaited<ReturnType<typeof collectPluginContributions>>;
			try {
				contributions = await collectPluginContributions(extension, {
					rootPath: input.workspacePath,
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
			for (const tool of contributions.tools) {
				tools.push({
					name: tool.name,
					pluginName: extension.name,
					path: pluginPath,
					source: pluginSource,
					description: tool.description?.trim() || undefined,
				});
			}
		}
	} catch (error) {
		failures = pluginPaths.map((pluginPath) => ({
			pluginPath,
			phase: "load" as const,
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		}));
	} finally {
		await sandboxed?.shutdown().catch(() => {
			// Best effort cleanup after contribution discovery.
		});
	}

	const sortedTools = sortPluginToolDescriptors(tools);
	return {
		tools: withEnabledState(sortedTools, disabled),
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
