import { desktopClient } from "./desktop-client";

export type RuleItem = {
	source?: string;
	name: string;
	instructions: string;
	path: string;
};

export type WorkflowItem = {
	source?: string;
	id: string;
	name: string;
	instructions: string;
	path: string;
};

export type SkillItem = {
	source?: string;
	name: string;
	description?: string;
	instructions: string;
	path: string;
	enabled?: boolean;
	agentPlugin?: boolean;
	pluginName?: string;
};

export type AgentItem = {
	source?: string;
	name: string;
	path: string;
};

export type PluginItem = {
	id: string;
	name: string;
	path: string;
	enabled: boolean;
	source?: string;
	toggleable?: boolean;
	agentPlugin?: boolean;
	description?: string;
	loadError?: string;
	contributions?: PluginContributions;
};

type PluginContributions = {
	inspectionStatus?: "available" | "disabled" | "failed";
	capabilities: string[];
	tools: string[];
	skills: string[];
	rules: string[];
	hooks: string[];
	commands: string[];
	mcpServers: string[];
	providers: string[];
};

export type ToolItem = {
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	source: string;
	path?: string;
	pluginName?: string;
	headlessToolNames?: string[];
};

export type HookItem = {
	source?: string;
	fileName: string;
	hookEventName?: string;
	path: string;
};

export type McpServer = {
	source?: string;
	name: string;
	transportType: "stdio" | "sse" | "streamableHttp";
	disabled: boolean;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	metadata?: unknown;
	configurationError?: string;
	oauthStatus?: {
		supported: boolean;
		configured: boolean;
		authorizationRequired: boolean;
		lastError?: string;
		lastAuthenticatedAt?: number;
	};
};

export type McpServersResponse = {
	settingsPath: string;
	hasSettingsFile: boolean;
	servers: McpServer[];
};

export type UserInstructionListsResponse = {
	workspaceRoot: string;
	rules: RuleItem[];
	workflows: WorkflowItem[];
	skills: SkillItem[];
	agents: AgentItem[];
	plugins: PluginItem[];
	tools: ToolItem[];
	hooks: HookItem[];
	mcp: McpServersResponse;
	warnings: string[];
};

/** Derive a view of installed items without changing the shared inventory. */
export function filterBuiltinInventory(
	inventory: UserInstructionListsResponse,
	includeBuiltinItems: boolean,
): UserInstructionListsResponse {
	if (includeBuiltinItems) return inventory;
	const isNotBuiltin = (item: { source?: string }) => item.source !== "builtin";
	return {
		...inventory,
		rules: inventory.rules.filter(isNotBuiltin),
		workflows: inventory.workflows.filter(isNotBuiltin),
		skills: inventory.skills.filter(isNotBuiltin),
		agents: inventory.agents.filter(isNotBuiltin),
		plugins: inventory.plugins.filter(isNotBuiltin),
		tools: inventory.tools.filter(isNotBuiltin),
		hooks: inventory.hooks.filter(isNotBuiltin),
		mcp: {
			...inventory.mcp,
			servers: inventory.mcp.servers.filter(isNotBuiltin),
		},
	};
}

export const EMPTY_MCP_RESPONSE: McpServersResponse = {
	settingsPath: "",
	hasSettingsFile: false,
	servers: [],
};

function asArray<T>(value: T[] | null | undefined): T[] {
	return Array.isArray(value) ? value : [];
}

function normalizeInstructionListsResponse(
	response: Partial<UserInstructionListsResponse> | null | undefined,
): UserInstructionListsResponse {
	return {
		workspaceRoot:
			typeof response?.workspaceRoot === "string" ? response.workspaceRoot : "",
		rules: asArray(response?.rules),
		workflows: asArray(response?.workflows),
		skills: asArray(response?.skills),
		agents: asArray(response?.agents),
		plugins: asArray(response?.plugins),
		tools: asArray(response?.tools),
		hooks: asArray(response?.hooks),
		mcp:
			response?.mcp && typeof response.mcp === "object"
				? {
						settingsPath:
							typeof response.mcp.settingsPath === "string"
								? response.mcp.settingsPath
								: "",
						hasSettingsFile: Boolean(response.mcp.hasSettingsFile),
						servers: asArray(response.mcp.servers),
					}
				: {
						...EMPTY_MCP_RESPONSE,
					},
		warnings: asArray(response?.warnings),
	};
}

const INVENTORY_CACHE_TTL_MS = 60_000;

/** A read invalidated by a mutation follows the latest request instead of restoring old data. */
function createInventoryCache<T>(read: () => Promise<T>) {
	let snapshot: { value: T; fetchedAt: number } | null = null;
	let generation = 0;
	let inFlight: Promise<T> | null = null;
	const get = () => snapshot?.value ?? null;
	const clear = () => {
		generation += 1;
		snapshot = null;
		inFlight = null;
	};
	const commit = (value: T) => {
		generation += 1;
		inFlight = null;
		snapshot = { value, fetchedAt: Date.now() };
	};
	const fetch = (options: { force?: boolean } = {}): Promise<T> => {
		if (inFlight) return inFlight;
		if (
			!options.force &&
			snapshot &&
			Date.now() - snapshot.fetchedAt < INVENTORY_CACHE_TTL_MS
		) {
			return Promise.resolve(snapshot.value);
		}
		const requestGeneration = generation;
		const request = read()
			.then(
				(value) => {
					if (requestGeneration !== generation) return fetch();
					snapshot = { value, fetchedAt: Date.now() };
					return value;
				},
				(error: unknown) => {
					if (requestGeneration !== generation) return fetch();
					throw error;
				},
			)
			.finally(() => {
				if (inFlight === request) inFlight = null;
			});
		inFlight = request;
		return request;
	};
	return { get, clear, commit, fetch };
}

const inventoryCache = createInventoryCache(async () =>
	normalizeInstructionListsResponse(
		await desktopClient.invoke<Partial<UserInstructionListsResponse>>(
			"list_user_instruction_configs",
		),
	),
);
const mcpServersCache = createInventoryCache(() =>
	desktopClient.invoke<McpServersResponse>("list_mcp_servers"),
);

export const getCachedExtensionInventory = inventoryCache.get;
let observingInventoryInvalidations = false;
function observeInventoryInvalidations() {
	if (observingInventoryInvalidations) return;
	observingInventoryInvalidations = true;
	const invalidate = () => {
		clearInventoryCaches("settings");
	};
	// These subscriptions live with the shared client so changes made while
	// Customize is unmounted cannot leave a populated inventory cache stale.
	desktopClient.subscribe("settings.changed", invalidate);
	desktopClient.subscribe("cloud_sessions_changed", invalidate);
}

export function fetchExtensionInventory(options: { force?: boolean } = {}) {
	observeInventoryInvalidations();
	return inventoryCache.fetch(options);
}
export const getCachedMcpServers = mcpServersCache.get;
export function fetchMcpServers(options: { force?: boolean } = {}) {
	observeInventoryInvalidations();
	return mcpServersCache.fetch(options);
}

export type ExtensionInventoryInvalidationReason = "settings" | "inventory";
const invalidationListeners = new Set<
	(reason: ExtensionInventoryInvalidationReason) => void
>();
function notifyInvalidation(reason: ExtensionInventoryInvalidationReason) {
	for (const listener of invalidationListeners) listener(reason);
}

/** Clear shared snapshots before mounted views start their replacement requests. */
function clearInventoryCaches(reason: ExtensionInventoryInvalidationReason) {
	inventoryCache.clear();
	mcpServersCache.clear();
	notifyInvalidation(reason);
}

export function invalidateExtensionInventoryCache() {
	clearInventoryCaches("inventory");
}

export function subscribeToExtensionInventoryInvalidation(
	listener: (reason: ExtensionInventoryInvalidationReason) => void,
): () => void {
	observeInventoryInvalidations();
	invalidationListeners.add(listener);
	return () => {
		invalidationListeners.delete(listener);
	};
}

/** Publish mutation responses to all inventory views and supersede older reads. */
export function commitExtensionInventoryResponse(
	response: Partial<UserInstructionListsResponse>,
) {
	const normalized = normalizeInstructionListsResponse(response);
	inventoryCache.commit(normalized);
	mcpServersCache.clear();
	notifyInvalidation("inventory");
	return normalized;
}

export function commitMcpServersResponse(response: McpServersResponse) {
	mcpServersCache.commit(response);
	inventoryCache.clear();
	notifyInvalidation("inventory");
	return response;
}
