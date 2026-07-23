import { existsSync, readFileSync } from "node:fs";
import {
	type McpServerOAuthState,
	McpSettingsUpdateSkippedError,
	resolveDefaultMcpSettingsPath,
	updateMcpSettingsFileSync,
} from "@cline/core";
import { sanitizeMcpDiagnosticText } from "@cline/shared";

export interface McpServerEntry {
	name: string;
	transport: McpTransport;
	disabled?: boolean;
	oauth?: McpServerOAuthState;
}

export type McpTransport =
	| {
			type: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| { type: "sse"; url: string; headers?: Record<string, string> }
	| { type: "streamableHttp"; url: string; headers?: Record<string, string> };

export function getSettingsPath(): string {
	return resolveDefaultMcpSettingsPath();
}

export function loadServers(): McpServerEntry[] {
	const path = getSettingsPath();
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as {
			mcpServers?: Record<string, unknown>;
		};
		const servers = parsed.mcpServers ?? {};
		return Object.entries(servers).map(([name, value]) => {
			const entry = value as Record<string, unknown>;
			const transport = (entry.transport ?? entry) as McpTransport;
			const oauthState =
				entry.oauth &&
				typeof entry.oauth === "object" &&
				!Array.isArray(entry.oauth)
					? (entry.oauth as McpServerOAuthState)
					: undefined;
			const oauth = oauthState
				? {
						...oauthState,
						...(oauthState.lastError
							? {
									lastError: sanitizeMcpDiagnosticText(oauthState.lastError),
								}
							: {}),
					}
				: undefined;
			return {
				name,
				transport,
				disabled: entry.disabled === true,
				oauth,
			};
		});
	} catch {
		return [];
	}
}

function getOwnServerRecord(
	servers: Record<string, unknown>,
	name: string,
): Record<string, unknown> | undefined {
	if (!Object.hasOwn(servers, name)) {
		return undefined;
	}
	const value = servers[name];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

/**
 * Mutate the MCP settings file through @cline/core's locked read-update-write
 * helper. The mutator must be synchronous and pure; the helper may call it more
 * than once to verify deterministic output. Throw McpSettingsUpdateSkippedError
 * for normal no-op cases instead of returning a boolean that callers can ignore.
 */
function mutateServers(
	mutate: (servers: Record<string, unknown>) => void,
): void {
	updateMcpSettingsFileSync(getSettingsPath(), (settings) => {
		const serversValue = settings.mcpServers;
		const servers =
			serversValue &&
			typeof serversValue === "object" &&
			!Array.isArray(serversValue)
				? { ...(serversValue as Record<string, unknown>) }
				: {};
		mutate(servers);
		settings.mcpServers = servers;
	});
}

export function addServer(name: string, transport: McpTransport): void {
	mutateServers((servers) => {
		servers[name] = { transport };
	});
}

export function removeServer(name: string): boolean {
	try {
		mutateServers((servers) => {
			if (!(name in servers)) {
				throw new McpSettingsUpdateSkippedError(
					`MCP server not found: ${name}`,
				);
			}
			delete servers[name];
		});
		return true;
	} catch (error) {
		if (error instanceof McpSettingsUpdateSkippedError) {
			return false;
		}
		throw error;
	}
}

export function updateServer(name: string, transport: McpTransport): void {
	mutateServers((servers) => {
		const existing =
			servers[name] && typeof servers[name] === "object"
				? (servers[name] as Record<string, unknown>)
				: {};
		servers[name] = { ...existing, transport };
	});
}

export function clearServerOAuth(name: string): void {
	try {
		mutateServers((servers) => {
			const existing = getOwnServerRecord(servers, name);
			if (!existing) {
				throw new McpSettingsUpdateSkippedError(
					`MCP server not found: ${name}`,
				);
			}
			delete existing.oauth;
			servers[name] = existing;
		});
	} catch (error) {
		if (error instanceof McpSettingsUpdateSkippedError) {
			return;
		}
		throw error;
	}
}

export function toggleServer(name: string, disabled: boolean): void {
	mutateServers((servers) => {
		const existing =
			servers[name] && typeof servers[name] === "object"
				? (servers[name] as Record<string, unknown>)
				: {};
		if (disabled) {
			existing.disabled = true;
		} else {
			delete existing.disabled;
		}
		servers[name] = existing;
	});
}
