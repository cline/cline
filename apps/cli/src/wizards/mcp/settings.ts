import { existsSync, readFileSync } from "node:fs";
import {
	type McpServerOAuthClientConfig,
	type McpServerOAuthState,
	McpSettingsUpdateSkippedError,
	resolveDefaultMcpSettingsPath,
	updateMcpSettingsFileSync,
} from "@cline/core";

export interface McpServerEntry {
	name: string;
	transport: McpTransport;
	disabled?: boolean;
	oauthClient?: McpServerOAuthClientConfig;
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
			const oauth =
				entry.oauth &&
				typeof entry.oauth === "object" &&
				!Array.isArray(entry.oauth)
					? (entry.oauth as McpServerOAuthState)
					: undefined;
			return {
				name,
				transport,
				disabled: entry.disabled === true,
				oauthClient: entry.oauthClient as
					| McpServerOAuthClientConfig
					| undefined,
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

function canonicalRemoteHeaders(headers: unknown): string | undefined {
	if (headers === undefined) {
		return "omitted";
	}
	if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
		return undefined;
	}
	const entries = Object.entries(headers);
	if (entries.some(([, value]) => typeof value !== "string")) {
		return undefined;
	}
	entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `present:${JSON.stringify(entries)}`;
}

export function hasSameOAuthTransportIdentity(
	previousValue: unknown,
	next: McpTransport,
): boolean {
	if (
		!previousValue ||
		typeof previousValue !== "object" ||
		Array.isArray(previousValue)
	) {
		return false;
	}
	const previous = previousValue as Record<string, unknown>;
	if (previous.type !== next.type) {
		return false;
	}
	if (next.type === "stdio") {
		return true;
	}
	if (previous.url !== next.url) {
		return false;
	}
	const previousHeaders = canonicalRemoteHeaders(previous.headers);
	const nextHeaders = canonicalRemoteHeaders(next.headers);
	return (
		previousHeaders !== undefined &&
		nextHeaders !== undefined &&
		previousHeaders === nextHeaders
	);
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
		const existing = getOwnServerRecord(servers, name) ?? {};
		const previousTransport = existing.transport ?? existing;
		if (!hasSameOAuthTransportIdentity(previousTransport, transport)) {
			delete existing.oauth;
			delete existing.oauthClient;
		}
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
			delete existing.oauthClient;
			servers[name] = existing;
		});
	} catch (error) {
		if (error instanceof McpSettingsUpdateSkippedError) {
			return;
		}
		throw error;
	}
}

export function setServerOAuthClient(
	name: string,
	client: McpServerOAuthClientConfig | undefined,
): void {
	mutateServers((servers) => {
		const existing = getOwnServerRecord(servers, name);
		if (!existing)
			throw new McpSettingsUpdateSkippedError(`MCP server not found: ${name}`);
		const previous = existing.oauthClient as
			| McpServerOAuthClientConfig
			| undefined;
		const previousScopes = [...(previous?.allowedScopes ?? [])].sort();
		const nextScopes = [...(client?.allowedScopes ?? [])].sort();
		if (
			previous?.clientId !== client?.clientId ||
			previous?.clientSecret !== client?.clientSecret ||
			previousScopes.length !== nextScopes.length ||
			previousScopes.some((scope, index) => scope !== nextScopes[index]) ||
			(previous?.loopbackHostname ?? "127.0.0.1") !==
				(client?.loopbackHostname ?? "127.0.0.1")
		) {
			delete existing.oauth;
		}
		if (client) existing.oauthClient = client;
		else delete existing.oauthClient;
		servers[name] = existing;
	});
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
