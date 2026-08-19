import type {
	AgentExtensionMcpEnvValue,
	AgentExtensionMcpServer,
} from "@cline/shared";
import type { McpServerRegistration } from "./types";

export interface PluginMcpServerResolution<TOwner> {
	owner: TOwner;
	name: string;
	registration?: McpServerRegistration;
	loadError?: string;
}

type ResolvedPluginMcpEnv =
	| {
			ok: true;
			env?: Record<string, string>;
	  }
	| {
			ok: false;
			reason: string;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function isPluginMcpEnvValue(
	value: unknown,
): value is AgentExtensionMcpEnvValue {
	if (!isRecord(value)) {
		return false;
	}
	return (
		(value.fromEnv === undefined || typeof value.fromEnv === "string") &&
		(value.value === undefined || typeof value.value === "string") &&
		(value.required === undefined || typeof value.required === "boolean")
	);
}

function resolvePluginMcpEnv(
	server: AgentExtensionMcpServer,
): ResolvedPluginMcpEnv {
	const entries = server.env ? Object.entries(server.env) : [];
	if (entries.length === 0) {
		return { ok: true };
	}

	const env: Record<string, string> = {};
	for (const [targetName, value] of entries) {
		if (typeof value === "string") {
			env[targetName] = value;
			continue;
		}

		const sourceName = value.fromEnv?.trim() || targetName;
		const sourceValue = process.env[sourceName];
		if (typeof sourceValue === "string" && sourceValue.length > 0) {
			env[targetName] = sourceValue;
			continue;
		}
		if (typeof value.value === "string") {
			env[targetName] = value.value;
			continue;
		}
		if (value.required === true) {
			return {
				ok: false,
				reason: `required environment variable "${sourceName}" is not set`,
			};
		}
	}

	return { ok: true, env: Object.keys(env).length > 0 ? env : undefined };
}

export function normalizePluginMcpServerRegistration(
	server: AgentExtensionMcpServer,
): {
	name: string;
	registration?: McpServerRegistration;
	loadError?: string;
} {
	if (!isRecord(server)) {
		return { name: "", loadError: "invalid MCP server registration" };
	}
	const name = typeof server.name === "string" ? server.name.trim() : "";
	if (!name) {
		return {
			name,
			loadError: "empty MCP server name",
		};
	}

	const envValue = server.env;
	const env = envValue === undefined ? undefined : envValue;
	if (env !== undefined) {
		if (!isRecord(env)) {
			return { name, loadError: "invalid env" };
		}
		for (const [key, value] of Object.entries(env)) {
			if (typeof value !== "string" && !isPluginMcpEnvValue(value)) {
				return { name, loadError: `invalid env "${key}"` };
			}
		}
	}

	const transport = server.transport;
	if (!isRecord(transport)) {
		return { name, loadError: "invalid MCP transport" };
	}
	const type = transport.type;
	if (type !== "stdio" && type !== "sse" && type !== "streamableHttp") {
		return { name, loadError: "invalid MCP transport type" };
	}
	if (type !== "stdio" && env !== undefined) {
		return {
			name,
			loadError: "top-level env is only supported for stdio MCP transports",
		};
	}

	const metadata = isRecord(server.metadata) ? server.metadata : undefined;
	if (type === "stdio") {
		const command = transport.command;
		if (typeof command !== "string" || !command.trim()) {
			return { name, loadError: "stdio MCP transport requires command" };
		}
		const args = transport.args;
		if (args !== undefined && !isStringArray(args)) {
			return { name, loadError: "stdio MCP transport args must be strings" };
		}
		const cwd = transport.cwd;
		if (cwd !== undefined && typeof cwd !== "string") {
			return { name, loadError: "stdio MCP transport cwd must be a string" };
		}
		const transportEnv = transport.env;
		if (transportEnv !== undefined && !isStringRecord(transportEnv)) {
			return { name, loadError: "stdio MCP transport env must be strings" };
		}

		const resolvedEnv = resolvePluginMcpEnv({
			name,
			transport: {
				type: "stdio",
				command,
				args,
				cwd,
				env: transportEnv,
			},
			env,
			metadata,
		});
		if (!resolvedEnv.ok) {
			return { name, loadError: resolvedEnv.reason };
		}

		const resolvedTransportEnv =
			transportEnv || resolvedEnv.env
				? {
						...(transportEnv ?? {}),
						...(resolvedEnv.env ?? {}),
					}
				: undefined;
		return {
			name,
			registration: {
				name,
				transport: {
					type: "stdio",
					command,
					args,
					cwd,
					env: resolvedTransportEnv,
				},
				metadata,
			},
		};
	}

	if (typeof transport.url !== "string" || !transport.url.trim()) {
		return { name, loadError: `${type} MCP transport requires url` };
	}
	const headers = transport.headers;
	if (headers !== undefined && !isStringRecord(headers)) {
		return { name, loadError: `${type} MCP transport headers must be strings` };
	}

	return {
		name,
		registration: {
			name,
			transport:
				type === "sse"
					? {
							type: "sse",
							url: transport.url,
							headers,
						}
					: {
							type: "streamableHttp",
							url: transport.url,
							headers,
						},
			metadata,
		},
	};
}

export function resolvePluginMcpServerRegistrations<TOwner>(
	servers: readonly {
		server: AgentExtensionMcpServer;
		owner: TOwner;
		ownerLabel?: string;
	}[],
): PluginMcpServerResolution<TOwner>[] {
	const firstOwnerByName = new Map<string, string | undefined>();
	return servers.map(({ server, owner, ownerLabel }) => {
		const normalized = normalizePluginMcpServerRegistration(server);
		if (!normalized.registration) {
			return {
				owner,
				name: normalized.name,
				loadError: normalized.loadError ?? "invalid MCP server registration",
			};
		}

		const firstOwner = firstOwnerByName.get(normalized.registration.name);
		if (firstOwnerByName.has(normalized.registration.name)) {
			const ownerText = firstOwner
				? ` already registered by ${firstOwner}`
				: "";
			return {
				owner,
				name: normalized.registration.name,
				loadError: `duplicate MCP server name "${normalized.registration.name}"${ownerText}`,
			};
		}

		firstOwnerByName.set(normalized.registration.name, ownerLabel);
		return {
			owner,
			name: normalized.registration.name,
			registration: normalized.registration,
		};
	});
}
