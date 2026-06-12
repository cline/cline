import { isAbsolute, relative, resolve } from "node:path";
import {
	type AgentConfig,
	type AgentExtensionMcpServer,
	type AgentTool,
} from "@cline/shared";
import {
	createDefaultMcpServerClientFactory,
	createMcpTools,
	InMemoryMcpManager,
	resolvePluginMcpServerRegistrations,
} from "../extensions/mcp";
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
	mcpServerName?: string;
}

export interface PluginMcpServerSummary {
	name: string;
	pluginName: string;
	path: string;
	source: "workspace-plugin" | "global-plugin";
	enabled: boolean;
	description?: string;
	loadError?: string;
}

export interface ListPluginToolsResult {
	tools: PluginToolSummary[];
	mcpServers: PluginMcpServerSummary[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

type PluginToolDescriptor = Omit<PluginToolSummary, "enabled">;
type PluginMcpServerDescriptor = Omit<PluginMcpServerSummary, "enabled">;

function withEnabledState(
	tools: readonly PluginToolDescriptor[],
	disabled: ReadonlySet<string>,
): PluginToolSummary[] {
	return tools.map((tool) => ({
		...tool,
		enabled: !disabled.has(tool.name),
	}));
}

function withMcpServerEnabledState(
	servers: readonly PluginMcpServerDescriptor[],
): PluginMcpServerSummary[] {
	return servers.map((server) => ({
		...server,
		enabled: !server.loadError,
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

function sortPluginMcpServerDescriptors(
	servers: PluginMcpServerDescriptor[],
): PluginMcpServerDescriptor[] {
	return servers.sort((left, right) => {
		const pluginOrder = left.pluginName.localeCompare(right.pluginName);
		if (pluginOrder !== 0) {
			return pluginOrder;
		}
		return left.name.localeCompare(right.name);
	});
}

async function collectPluginContributions(
	extension: AgentExtension,
	workspaceInfo?: { rootPath: string },
): Promise<{
	tools: AgentTool[];
	mcpServers: AgentExtensionMcpServer[];
}> {
	if (!extension.setup) {
		return { tools: [], mcpServers: [] };
	}

	const tools: AgentTool[] = [];
	const mcpServers: AgentExtensionMcpServer[] = [];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: () => {},
		registerRule: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
		registerMcpServer: (server) => {
			if (!extension.manifest.capabilities.includes("mcp")) {
				throw new Error('registerMcpServer requires the "mcp" capability');
			}
			mcpServers.push(server);
		},
	};
	await extension.setup(api, { workspaceInfo });
	return { tools, mcpServers };
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
		return { tools: [], mcpServers: [], failures: [], warnings: [] };
	}

	const tools: PluginToolDescriptor[] = [];
	const mcpServers: PluginMcpServerDescriptor[] = [];
	const pluginMcpServerCandidates: {
		server: AgentExtensionMcpServer;
		descriptor: PluginMcpServerDescriptor;
	}[] = [];
	let failures: PluginInitializationFailure[] = [];
	let warnings: PluginInitializationWarning[] = [];
	let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;
	let mcpManager: InMemoryMcpManager | undefined;

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
			for (const server of contributions.mcpServers) {
				const serverName =
					typeof server.name === "string"
						? server.name.trim() || server.name
						: "";
				const descriptor: PluginMcpServerDescriptor = {
					name: serverName,
					pluginName: extension.name,
					path: pluginPath,
					source: pluginSource,
					description:
						typeof server.transport === "object" &&
						server.transport !== null &&
						"type" in server.transport &&
						typeof server.transport.type === "string"
							? server.transport.type
							: undefined,
				};
				mcpServers.push(descriptor);
				pluginMcpServerCandidates.push({ server, descriptor });
			}
		}
		const resolvedMcpServers = resolvePluginMcpServerRegistrations(
			pluginMcpServerCandidates.map(({ server, descriptor }) => ({
				server,
				owner: descriptor,
				ownerLabel: descriptor.pluginName,
			})),
		);
		for (const result of resolvedMcpServers) {
			result.owner.name = result.name;
			if (result.loadError) {
				result.owner.loadError = result.loadError;
			}
		}

		const loadableMcpServers = resolvedMcpServers.filter(
			(
				result,
			): result is typeof result & {
				registration: NonNullable<typeof result.registration>;
			} => result.registration !== undefined && !result.loadError,
		);
		if (loadableMcpServers.length > 0) {
			const manager = new InMemoryMcpManager({
				clientFactory: createDefaultMcpServerClientFactory({
					enableOAuth: false,
				}),
			});
			mcpManager = manager;
			for (const result of loadableMcpServers) {
				await manager.registerServer(result.registration);
			}
			const toolResults = await Promise.allSettled(
				loadableMcpServers.map((result) =>
					createMcpTools({
						serverName: result.registration.name,
						provider: manager,
					}),
				),
			);
			for (const [index, toolResult] of toolResults.entries()) {
				const server = loadableMcpServers[index];
				if (!server) {
					continue;
				}
				if (toolResult.status === "rejected") {
					server.owner.loadError =
						toolResult.reason instanceof Error
							? toolResult.reason.message
							: String(toolResult.reason);
					continue;
				}
				for (const tool of toolResult.value) {
					tools.push({
						name: tool.name,
						pluginName: server.owner.pluginName,
						path: server.owner.path,
						source: server.owner.source,
						description: tool.description?.trim() || undefined,
						mcpServerName: server.name,
					});
				}
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
		await mcpManager?.dispose().catch(() => {
			// Best effort cleanup after MCP tool discovery.
		});
		await sandboxed?.shutdown().catch(() => {
			// Best effort cleanup after contribution discovery.
		});
	}

	const sortedTools = sortPluginToolDescriptors(tools);
	const sortedMcpServers = sortPluginMcpServerDescriptors(mcpServers);
	return {
		tools: withEnabledState(sortedTools, disabled),
		mcpServers: withMcpServerEnabledState(sortedMcpServers),
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
