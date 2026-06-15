import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type {
	AgentConfig,
	AgentExtensionMcpServer,
	AgentTool,
} from "@cline/shared";
import {
	type McpServerRegistration,
	resolveDefaultMcpSettingsPath,
	resolvePluginMcpServerRegistrations,
} from "../extensions/mcp";
import { loadSandboxedPlugins } from "../extensions/plugin/plugin-sandbox";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];
type AgentExtensionWithPath = AgentExtension & { __clinePluginPath?: string };

export interface PluginMcpSettingsMutation {
	name: string;
	pluginName: string;
	pluginPath: string;
	action: "created" | "updated" | "skipped" | "removed" | "disabled";
	reason?: string;
}

export interface PluginMcpSettingsSyncResult {
	mutations: PluginMcpSettingsMutation[];
	failures: Array<{
		pluginPath: string;
		pluginName?: string;
		message: string;
	}>;
}

export interface SyncPluginMcpServersToSettingsOptions {
	pluginPaths: ReadonlyArray<string>;
	cwd?: string;
	workspacePath?: string;
	settingsPath?: string;
	providerId?: string;
	modelId?: string;
}

export interface RemovePluginMcpServersFromSettingsOptions {
	pluginPaths?: ReadonlyArray<string>;
	pluginNames?: ReadonlyArray<string>;
	settingsPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function readRawSettings(filePath: string): Record<string, unknown> {
	if (!existsSync(filePath)) {
		return { mcpServers: {} };
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		if (isRecord(parsed)) {
			return parsed;
		}
	} catch (error) {
		throw new Error(
			`Invalid MCP settings at "${filePath}": ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	throw new Error(`Invalid MCP settings at "${filePath}": expected an object`);
}

function getServers(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	if (isRecord(settings.mcpServers)) {
		return { ...settings.mcpServers };
	}
	return {};
}

function writeRawSettings(
	filePath: string,
	settings: Record<string, unknown>,
	servers: Record<string, unknown>,
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`${JSON.stringify({ ...settings, mcpServers: servers }, null, 2)}\n`,
		"utf8",
	);
}

function collectOwnerInputs(input: RemovePluginMcpServersFromSettingsOptions): {
	pluginPaths: string[];
	pluginNames: string[];
} {
	return {
		pluginPaths: [
			...new Set(
				(input.pluginPaths ?? [])
					.map((path) => path.trim())
					.filter((path) => path.length > 0),
			),
		],
		pluginNames: [
			...new Set(
				(input.pluginNames ?? [])
					.map((name) => name.trim())
					.filter((name) => name.length > 0),
			),
		],
	};
}

function getMetadata(record: unknown): Record<string, unknown> | undefined {
	if (!isRecord(record)) {
		return undefined;
	}
	const metadata = record.metadata;
	return isRecord(metadata) ? metadata : undefined;
}

function isPluginOwnedRecord(
	record: unknown,
	input: {
		pluginName?: string;
		pluginPath?: string;
		pluginPaths?: ReadonlyArray<string>;
		pluginNames?: ReadonlyArray<string>;
	},
): boolean {
	const metadata = getMetadata(record);
	if (!metadata || metadata.source !== "plugin") {
		return false;
	}
	const recordPluginName =
		typeof metadata.pluginName === "string"
			? metadata.pluginName
			: typeof metadata.plugin === "string"
				? metadata.plugin
				: undefined;
	const recordPluginPath =
		typeof metadata.pluginPath === "string" ? metadata.pluginPath : undefined;

	if (input.pluginName && recordPluginName === input.pluginName) {
		if (!input.pluginPath || recordPluginPath === input.pluginPath) {
			return true;
		}
	}
	if (
		recordPluginPath &&
		input.pluginPath &&
		(recordPluginPath === input.pluginPath ||
			isPathWithin(input.pluginPath, recordPluginPath) ||
			isPathWithin(recordPluginPath, input.pluginPath))
	) {
		return true;
	}
	if (
		recordPluginName &&
		input.pluginNames?.some((name) => name === recordPluginName)
	) {
		return true;
	}
	if (
		recordPluginPath &&
		input.pluginPaths?.some(
			(path) =>
				recordPluginPath === path ||
				isPathWithin(path, recordPluginPath) ||
				isPathWithin(recordPluginPath, path),
		)
	) {
		return true;
	}
	return false;
}

function createSettingsEntry(input: {
	registration: McpServerRegistration;
	pluginName: string;
	pluginPath: string;
	existing?: Record<string, unknown>;
	disabled?: boolean;
}): Record<string, unknown> {
	const existingOauth = isRecord(input.existing?.oauth)
		? { oauth: input.existing.oauth }
		: {};
	return {
		transport: input.registration.transport,
		...(input.disabled ? { disabled: true } : {}),
		...existingOauth,
		metadata: {
			...(input.registration.metadata ?? {}),
			source: "plugin",
			pluginName: input.pluginName,
			pluginPath: input.pluginPath,
		},
	};
}

async function collectPluginMcpServers(
	options: SyncPluginMcpServersToSettingsOptions,
): Promise<{
	plugins: Array<{
		pluginName: string;
		pluginPath: string;
	}>;
	servers: Array<{
		pluginName: string;
		pluginPath: string;
		server: AgentExtensionMcpServer;
	}>;
}> {
	if (options.pluginPaths.length === 0) {
		return { plugins: [], servers: [] };
	}
	const sandboxed = await loadSandboxedPlugins({
		pluginPaths: [...options.pluginPaths],
		cwd: options.cwd,
		providerId: options.providerId,
		modelId: options.modelId,
		workspaceInfo: options.workspacePath
			? { rootPath: options.workspacePath }
			: undefined,
	});
	try {
		const plugins: Array<{
			pluginName: string;
			pluginPath: string;
		}> = [];
		const servers: Array<{
			pluginName: string;
			pluginPath: string;
			server: AgentExtensionMcpServer;
		}> = [];
		for (const extension of sandboxed.extensions ?? []) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath || !extension.setup) {
				continue;
			}
			plugins.push({
				pluginName: extension.name,
				pluginPath,
			});
			const mcpServers: AgentExtensionMcpServer[] = [];
			const api: AgentExtensionApi = {
				registerTool: (_tool: AgentTool) => {},
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
			await extension.setup(api, {
				workspaceInfo: options.workspacePath
					? { rootPath: options.workspacePath }
					: undefined,
			});
			for (const server of mcpServers) {
				servers.push({
					pluginName: extension.name,
					pluginPath,
					server: {
						...server,
						metadata: {
							...(server.metadata ?? {}),
							source: "plugin",
							pluginName: extension.name,
							pluginPath,
						},
					},
				});
			}
		}
		return { plugins, servers };
	} finally {
		await sandboxed.shutdown().catch(() => {
			// Best-effort cleanup after contribution discovery.
		});
	}
}

export async function syncPluginMcpServersToSettings(
	options: SyncPluginMcpServersToSettingsOptions,
): Promise<PluginMcpSettingsSyncResult> {
	const settingsPath = options.settingsPath ?? resolveDefaultMcpSettingsPath();
	const result: PluginMcpSettingsSyncResult = {
		mutations: [],
		failures: [],
	};
	let collected: Awaited<ReturnType<typeof collectPluginMcpServers>>;
	try {
		collected = await collectPluginMcpServers(options);
	} catch (error) {
		for (const pluginPath of options.pluginPaths) {
			result.failures.push({
				pluginPath,
				message: error instanceof Error ? error.message : String(error),
			});
		}
		return result;
	}

	let settings: Record<string, unknown>;
	try {
		settings = readRawSettings(settingsPath);
	} catch (error) {
		for (const pluginPath of options.pluginPaths) {
			result.failures.push({
				pluginPath,
				message: error instanceof Error ? error.message : String(error),
			});
		}
		return result;
	}
	const servers = getServers(settings);
	const declaredNamesByPluginPath = new Map<string, Set<string>>();
	const pluginNameByPath = new Map<string, string>();
	for (const plugin of collected.plugins) {
		declaredNamesByPluginPath.set(plugin.pluginPath, new Set());
		pluginNameByPath.set(plugin.pluginPath, plugin.pluginName);
	}
	const resolved = resolvePluginMcpServerRegistrations(
		collected.servers.map((entry) => ({
			server: entry.server,
			owner: entry,
			ownerLabel: entry.pluginName,
		})),
	);

	for (const resolution of resolved) {
		const owner = resolution.owner;
		if (!declaredNamesByPluginPath.has(owner.pluginPath)) {
			declaredNamesByPluginPath.set(owner.pluginPath, new Set());
		}
		if (resolution.name) {
			declaredNamesByPluginPath.get(owner.pluginPath)?.add(resolution.name);
		}
		if (!resolution.registration) {
			result.mutations.push({
				name: resolution.name,
				pluginName: owner.pluginName,
				pluginPath: owner.pluginPath,
				action: "skipped",
				reason: resolution.loadError ?? "invalid MCP server registration",
			});
			continue;
		}

		const existing = servers[resolution.registration.name];
		if (existing !== undefined) {
			if (
				!isPluginOwnedRecord(existing, {
					pluginName: owner.pluginName,
					pluginPath: owner.pluginPath,
				})
			) {
				result.mutations.push({
					name: resolution.registration.name,
					pluginName: owner.pluginName,
					pluginPath: owner.pluginPath,
					action: "skipped",
					reason: "MCP server name is already configured",
				});
				continue;
			}
		}

		servers[resolution.registration.name] = createSettingsEntry({
			registration: resolution.registration,
			pluginName: owner.pluginName,
			pluginPath: owner.pluginPath,
			existing: isRecord(existing) ? existing : undefined,
		});
		result.mutations.push({
			name: resolution.registration.name,
			pluginName: owner.pluginName,
			pluginPath: owner.pluginPath,
			action: existing === undefined ? "created" : "updated",
		});
	}

	for (const [serverName, record] of Object.entries(servers)) {
		const metadata = getMetadata(record);
		const pluginPath =
			typeof metadata?.pluginPath === "string" ? metadata.pluginPath : "";
		const declaredNames = declaredNamesByPluginPath.get(pluginPath);
		if (
			declaredNames &&
			isPluginOwnedRecord(record, { pluginPath }) &&
			!declaredNames.has(serverName)
		) {
			delete servers[serverName];
			result.mutations.push({
				name: serverName,
				pluginName:
					typeof metadata?.pluginName === "string"
						? metadata.pluginName
						: (pluginNameByPath.get(pluginPath) ?? "plugin"),
				pluginPath,
				action: "removed",
				reason: "plugin no longer declares this MCP server",
			});
		}
	}

	if (result.mutations.some((mutation) => mutation.action !== "skipped")) {
		writeRawSettings(settingsPath, settings, servers);
	}
	return result;
}

export function disablePluginMcpServersInSettings(
	options: RemovePluginMcpServersFromSettingsOptions,
): PluginMcpSettingsMutation[] {
	const settingsPath = options.settingsPath ?? resolveDefaultMcpSettingsPath();
	let settings: Record<string, unknown>;
	try {
		settings = readRawSettings(settingsPath);
	} catch {
		return [];
	}
	const servers = getServers(settings);
	const ownerInput = collectOwnerInputs(options);
	const mutations: PluginMcpSettingsMutation[] = [];
	for (const [serverName, record] of Object.entries(servers)) {
		if (!isRecord(record) || !isPluginOwnedRecord(record, ownerInput)) {
			continue;
		}
		const metadata = getMetadata(record);
		servers[serverName] = { ...record, disabled: true };
		mutations.push({
			name: serverName,
			pluginName:
				typeof metadata?.pluginName === "string"
					? metadata.pluginName
					: "plugin",
			pluginPath:
				typeof metadata?.pluginPath === "string" ? metadata.pluginPath : "",
			action: "disabled",
		});
	}
	if (mutations.length > 0) {
		writeRawSettings(settingsPath, settings, servers);
	}
	return mutations;
}

export function removePluginMcpServersFromSettings(
	options: RemovePluginMcpServersFromSettingsOptions,
): PluginMcpSettingsMutation[] {
	const settingsPath = options.settingsPath ?? resolveDefaultMcpSettingsPath();
	let settings: Record<string, unknown>;
	try {
		settings = readRawSettings(settingsPath);
	} catch {
		return [];
	}
	const servers = getServers(settings);
	const ownerInput = collectOwnerInputs(options);
	const mutations: PluginMcpSettingsMutation[] = [];
	for (const [serverName, record] of Object.entries(servers)) {
		if (!isPluginOwnedRecord(record, ownerInput)) {
			continue;
		}
		const metadata = getMetadata(record);
		delete servers[serverName];
		mutations.push({
			name: serverName,
			pluginName:
				typeof metadata?.pluginName === "string"
					? metadata.pluginName
					: "plugin",
			pluginPath:
				typeof metadata?.pluginPath === "string" ? metadata.pluginPath : "",
			action: "removed",
		});
	}
	if (mutations.length > 0) {
		writeRawSettings(settingsPath, settings, servers);
	}
	return mutations;
}
