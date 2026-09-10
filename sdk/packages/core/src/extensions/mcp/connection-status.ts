/**
 * Last observed connect outcome per configured MCP server. Session runtimes
 * connect servers while they build their tools; recording the result here
 * lets settings listings (and through them the desktop MCP view) show why a
 * server contributed no tools instead of a silent blue dot. Process-wide on
 * purpose: sessions and `settings.list` both run inside the hub daemon.
 */
export interface McpServerConnectionStatus {
	connected: boolean;
	/** Number of tools the server advertised on its last successful connect. */
	toolCount?: number;
	/** Failure message from the last connect attempt, when it failed. */
	error?: string;
	/** Epoch milliseconds of the recorded attempt. */
	updatedAt: number;
}

const statuses = new Map<string, McpServerConnectionStatus>();

export function recordMcpServerConnectionStatus(
	serverName: string,
	status: Omit<McpServerConnectionStatus, "updatedAt">,
): void {
	statuses.set(serverName, { ...status, updatedAt: Date.now() });
}

export function getMcpServerConnectionStatus(
	serverName: string,
): McpServerConnectionStatus | undefined {
	return statuses.get(serverName);
}

/** @internal Test isolation. */
export function clearMcpServerConnectionStatuses(): void {
	statuses.clear();
}
