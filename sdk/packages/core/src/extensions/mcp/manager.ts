import type {
	McpConnectionStatus,
	McpManager,
	McpManagerOptions,
	McpServerClient,
	McpServerRegistration,
	McpServerSnapshot,
	McpToolCallRequest,
	McpToolCallResult,
	McpToolDescriptor,
} from "./types";

const DEFAULT_TOOLS_CACHE_TTL_MS = 5000;

type ManagedServerState = {
	registration: McpServerRegistration;
	client?: McpServerClient;
	status: McpConnectionStatus;
	lastError?: string;
	updatedAt: number;
	toolCache?: readonly McpToolDescriptor[];
	toolCacheUpdatedAt?: number;
};

function nowMs(): number {
	return Date.now();
}

function cloneTools(
	tools: readonly McpToolDescriptor[],
): readonly McpToolDescriptor[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

export class InMemoryMcpManager implements McpManager {
	private readonly toolsCacheTtlMs: number;
	private readonly clientFactory: McpManagerOptions["clientFactory"];
	private readonly servers = new Map<string, ManagedServerState>();
	private readonly operationLocks = new Map<string, Promise<void>>();

	constructor(options: McpManagerOptions) {
		this.clientFactory = options.clientFactory;
		this.toolsCacheTtlMs =
			options.toolsCacheTtlMs ?? DEFAULT_TOOLS_CACHE_TTL_MS;
	}

	async registerServer(registration: McpServerRegistration): Promise<void> {
		await this.runExclusive(registration.name, async () => {
			const existing = this.servers.get(registration.name);
			if (!existing) {
				this.servers.set(registration.name, {
					registration: { ...registration },
					status: "disconnected",
					updatedAt: nowMs(),
				});
				return;
			}

			const didTransportChange =
				JSON.stringify(existing.registration.transport) !==
				JSON.stringify(registration.transport);
			existing.registration = { ...registration };
			existing.updatedAt = nowMs();

			if (didTransportChange) {
				await this.disconnectState(existing);
				existing.client = undefined;
				existing.toolCache = undefined;
				existing.toolCacheUpdatedAt = undefined;
			}
		});
	}

	async unregisterServer(serverName: string): Promise<void> {
		await this.runExclusive(serverName, async () => {
			const state = this.requireServer(serverName);
			await this.disconnectState(state);
			this.servers.delete(serverName);
		});
	}

	async connectServer(serverName: string): Promise<void> {
		await this.runExclusive(serverName, async () => {
			const state = this.requireServer(serverName);
			await this.connectState(state);
		});
	}

	async disconnectServer(serverName: string): Promise<void> {
		await this.runExclusive(serverName, async () => {
			const state = this.requireServer(serverName);
			await this.disconnectState(state);
		});
	}

	async setServerDisabled(
		serverName: string,
		disabled: boolean,
	): Promise<void> {
		await this.runExclusive(serverName, async () => {
			const state = this.requireServer(serverName);
			state.registration = {
				...state.registration,
				disabled,
			};
			state.updatedAt = nowMs();
			if (disabled) {
				await this.disconnectState(state);
			}
		});
	}

	listServers(): readonly McpServerSnapshot[] {
		return [...this.servers.values()]
			.map((state) => ({
				name: state.registration.name,
				status: state.status,
				disabled: state.registration.disabled === true,
				lastError: state.lastError,
				toolCount: state.toolCache?.length ?? 0,
				updatedAt: state.updatedAt,
				metadata: state.registration.metadata,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		const state = this.requireServer(serverName);
		const fetchedAt = state.toolCacheUpdatedAt ?? 0;
		if (state.toolCache && nowMs() - fetchedAt <= this.toolsCacheTtlMs) {
			return state.toolCache;
		}
		return this.refreshTools(serverName);
	}

	async refreshTools(
		serverName: string,
	): Promise<readonly McpToolDescriptor[]> {
		return this.runExclusive(serverName, async () => {
			const state = this.requireServer(serverName);
			const client = await this.ensureConnectedClient(state);
			const tools = await client.listTools();
			const cloned = cloneTools(tools);
			state.toolCache = cloned;
			state.toolCacheUpdatedAt = nowMs();
			state.updatedAt = nowMs();
			return cloned;
		});
	}

	async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
		return this.runExclusive(request.serverName, async () => {
			const state = this.requireServer(request.serverName);
			const client = await this.ensureConnectedClient(state);
			state.updatedAt = nowMs();
			return client.callTool({
				name: request.toolName,
				arguments: request.arguments,
				context: request.context,
			});
		});
	}

	async dispose(): Promise<void> {
		const names = [...this.servers.keys()];
		for (const name of names) {
			await this.unregisterServer(name);
		}
	}

	private async ensureConnectedClient(
		state: ManagedServerState,
	): Promise<McpServerClient> {
		await this.connectState(state);
		if (!state.client) {
			throw new Error(
				`MCP server "${state.registration.name}" does not have an initialized client.`,
			);
		}
		return state.client;
	}

	private async connectState(state: ManagedServerState): Promise<void> {
		if (state.registration.disabled) {
			throw new Error(
				`MCP server "${state.registration.name}" is disabled and cannot be connected.`,
			);
		}
		if (state.status === "connected" && state.client) {
			return;
		}
		state.status = "connecting";
		state.updatedAt = nowMs();
		try {
			const client =
				state.client ?? (await this.clientFactory(state.registration));
			await client.connect();
			state.client = client;
			state.status = "connected";
			state.lastError = undefined;
			state.updatedAt = nowMs();
		} catch (error) {
			state.status = "disconnected";
			state.lastError = error instanceof Error ? error.message : String(error);
			state.updatedAt = nowMs();
			throw error;
		}
	}

	private async disconnectState(state: ManagedServerState): Promise<void> {
		if (!state.client) {
			state.status = "disconnected";
			state.updatedAt = nowMs();
			return;
		}

		try {
			await state.client.disconnect();
		} finally {
			state.status = "disconnected";
			state.updatedAt = nowMs();
		}
	}

	private requireServer(serverName: string): ManagedServerState {
		const state = this.servers.get(serverName);
		if (!state) {
			throw new Error(`Unknown MCP server: ${serverName}`);
		}
		return state;
	}

	private async runExclusive<T>(
		serverName: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const previous = this.operationLocks.get(serverName) ?? Promise.resolve();
		let releaseCurrent: (() => void) | undefined;
		const current = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});
		const queued = previous.catch(() => undefined).then(() => current);
		this.operationLocks.set(serverName, queued);

		await previous.catch(() => undefined);
		try {
			return await operation();
		} finally {
			releaseCurrent?.();
			const lock = this.operationLocks.get(serverName);
			if (lock === queued) {
				this.operationLocks.delete(serverName);
			}
		}
	}
}
