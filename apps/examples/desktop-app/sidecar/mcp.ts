import { existsSync, readFileSync } from "node:fs";
import {
	getMcpServerOAuthStatus,
	parseMcpServerRegistration,
	updateMcpSettingsFileSync,
} from "@cline/core";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import type { JsonRecord } from "./types";

interface StoredMcpOAuthClient {
	clientId: string;
	clientSecret?: string;
	allowedScopes?: string[];
}

// RFC 6749 section 3.3 scope-token: printable ASCII excluding DQUOTE and "\\".
const MCP_OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export interface McpOAuthClientUpdate {
	oauthClient: unknown;
	oauthClientUnchanged: boolean;
}

function parseMcpOAuthAllowedScopes(
	value: unknown,
	canonicalize: boolean,
): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error("OAuth allowedScopes must be an array");
	}
	if (value.length === 0) {
		throw new Error("OAuth allowedScopes must contain at least one scope");
	}
	const scopes: string[] = [];
	const seen = new Set<string>();
	for (const scope of value) {
		if (
			typeof scope !== "string" ||
			!MCP_OAUTH_SCOPE_TOKEN_PATTERN.test(scope)
		) {
			throw new Error(
				"OAuth allowedScopes entries must be valid RFC 6749 scope tokens without whitespace",
			);
		}
		if (seen.has(scope)) {
			throw new Error(`Duplicate OAuth scope: ${scope}`);
		}
		seen.add(scope);
		scopes.push(scope);
	}
	return canonicalize ? scopes.sort() : scopes;
}

function readStoredMcpOAuthClient(value: unknown): StoredMcpOAuthClient | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as JsonRecord;
	if (typeof record.clientId !== "string" || record.clientId.length === 0) {
		return null;
	}
	if (
		record.clientSecret !== undefined &&
		(typeof record.clientSecret !== "string" ||
			record.clientSecret.length === 0)
	) {
		return null;
	}
	let allowedScopes: string[] | undefined;
	try {
		allowedScopes = parseMcpOAuthAllowedScopes(record.allowedScopes, false);
	} catch {
		return null;
	}
	return {
		clientId: record.clientId,
		...(typeof record.clientSecret === "string"
			? { clientSecret: record.clientSecret }
			: {}),
		...(allowedScopes ? { allowedScopes } : {}),
	};
}

function mcpOAuthScopePoliciesEqual(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	if (left.length !== right.length) {
		return false;
	}
	const leftSorted = [...left].sort();
	const rightSorted = [...right].sort();
	return leftSorted.every((scope, index) => scope === rightSorted[index]);
}

function mcpOAuthClientsEqual(left: unknown, right: unknown): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	const leftClient = readStoredMcpOAuthClient(left);
	const rightClient = readStoredMcpOAuthClient(right);
	return Boolean(
		leftClient &&
			rightClient &&
			leftClient.clientId === rightClient.clientId &&
			leftClient.clientSecret === rightClient.clientSecret &&
			mcpOAuthScopePoliciesEqual(
				leftClient.allowedScopes,
				rightClient.allowedScopes,
			),
	);
}

/**
 * Resolve the editor's redacted OAuth-client update into the persisted shape.
 * An omitted update preserves compatible existing settings for older callers;
 * null clears them; and preserveClientSecret keeps a secret that was never sent
 * to the webview.
 */
export function resolveMcpOAuthClientUpdate(options: {
	requestedOAuthClient: unknown;
	existingOAuthClient: unknown;
	transportIdentityUnchanged: boolean;
}): McpOAuthClientUpdate {
	const {
		requestedOAuthClient,
		existingOAuthClient,
		transportIdentityUnchanged,
	} = options;
	if (requestedOAuthClient === undefined) {
		const oauthClient = transportIdentityUnchanged
			? existingOAuthClient
			: undefined;
		return {
			oauthClient,
			oauthClientUnchanged: transportIdentityUnchanged
				? true
				: existingOAuthClient === undefined,
		};
	}
	if (requestedOAuthClient === null) {
		return {
			oauthClient: undefined,
			oauthClientUnchanged: existingOAuthClient === undefined,
		};
	}
	if (
		typeof requestedOAuthClient !== "object" ||
		Array.isArray(requestedOAuthClient)
	) {
		throw new Error("oauthClient must be an object or null");
	}

	const requested = requestedOAuthClient as JsonRecord;
	const allowedKeys = new Set([
		"clientId",
		"clientSecret",
		"preserveClientSecret",
		"allowedScopes",
	]);
	const unknownKey = Object.keys(requested).find(
		(key) => !allowedKeys.has(key),
	);
	if (unknownKey) {
		throw new Error(`unknown oauthClient field: ${unknownKey}`);
	}
	if (typeof requested.clientId !== "string" || !requested.clientId.trim()) {
		throw new Error("OAuth client ID is required");
	}
	if (
		requested.clientSecret !== undefined &&
		(typeof requested.clientSecret !== "string" ||
			requested.clientSecret.length === 0)
	) {
		throw new Error("OAuth client secret must be a non-empty string");
	}
	if (
		requested.preserveClientSecret !== undefined &&
		typeof requested.preserveClientSecret !== "boolean"
	) {
		throw new Error("preserveClientSecret must be a boolean");
	}
	if (
		requested.preserveClientSecret === true &&
		requested.clientSecret !== undefined
	) {
		throw new Error(
			"OAuth client secret cannot be replaced and preserved at the same time",
		);
	}

	const clientId = requested.clientId.trim();
	const existing = readStoredMcpOAuthClient(existingOAuthClient);
	const existingRecord =
		existingOAuthClient &&
		typeof existingOAuthClient === "object" &&
		!Array.isArray(existingOAuthClient)
			? (existingOAuthClient as JsonRecord)
			: undefined;
	const existingHasAllowedScopes =
		existingRecord !== undefined &&
		Object.hasOwn(existingRecord, "allowedScopes") &&
		existingRecord.allowedScopes !== undefined;
	let existingAllowedScopes: string[] | undefined;
	if (existingHasAllowedScopes) {
		try {
			existingAllowedScopes = parseMcpOAuthAllowedScopes(
				existingRecord?.allowedScopes,
				false,
			);
		} catch {
			if (requested.allowedScopes === undefined) {
				throw new Error(
					"The existing OAuth allowedScopes policy is invalid; replace or clear it explicitly",
				);
			}
		}
	}
	let allowedScopes: string[] | undefined;
	if (requested.allowedScopes === null) {
		allowedScopes = undefined;
	} else if (requested.allowedScopes !== undefined) {
		allowedScopes = parseMcpOAuthAllowedScopes(requested.allowedScopes, true);
	} else if (existingAllowedScopes) {
		if (!transportIdentityUnchanged || existingRecord?.clientId !== clientId) {
			throw new Error(
				"Specify allowedScopes when changing an OAuth client's server endpoint or client ID",
			);
		}
		// Older callers do not know about scope policy. Preserve the existing
		// validated order losslessly unless the policy is explicitly edited.
		allowedScopes = [...existingAllowedScopes];
	}
	let clientSecret: string | undefined;
	if (requested.preserveClientSecret === true) {
		if (!transportIdentityUnchanged) {
			throw new Error(
				"Re-enter the OAuth client secret after changing the server transport, URL, or headers",
			);
		}
		if (!existing?.clientSecret || existing.clientId !== clientId) {
			throw new Error(
				"The saved OAuth client secret cannot be preserved for this client ID",
			);
		}
		clientSecret = existing.clientSecret;
	} else if (typeof requested.clientSecret === "string") {
		clientSecret = requested.clientSecret;
	}

	const oauthClient: StoredMcpOAuthClient = {
		clientId,
		...(clientSecret !== undefined ? { clientSecret } : {}),
		...(allowedScopes ? { allowedScopes } : {}),
	};
	return {
		oauthClient,
		oauthClientUnchanged: mcpOAuthClientsEqual(
			existingOAuthClient,
			oauthClient,
		),
	};
}

export function shouldProbeMcpServerAfterUpsert(options: {
	isRemote: boolean;
	requestedDisabled: boolean;
	existingWasEnabled: boolean;
	transportIdentityUnchanged: boolean;
	oauthClientUnchanged?: boolean;
}): boolean {
	return (
		options.isRemote &&
		!options.requestedDisabled &&
		!(
			options.existingWasEnabled &&
			options.transportIdentityUnchanged &&
			options.oauthClientUnchanged !== false
		)
	);
}

export function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	return buildMcpServersResponse(settingsPath, parsed);
}

export function buildMcpServersResponse(
	settingsPath: string,
	parsed: JsonRecord,
): JsonRecord {
	const serversValue = parsed.mcpServers;
	const servers =
		serversValue &&
		typeof serversValue === "object" &&
		!Array.isArray(serversValue)
			? (serversValue as JsonRecord)
			: {};
	const entries = Object.entries(servers).map(([name, body]) => {
		const record =
			body && typeof body === "object" && !Array.isArray(body)
				? (body as JsonRecord)
				: {};
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		let registration: ReturnType<typeof parseMcpServerRegistration> | undefined;
		let configurationError: string | undefined;
		try {
			registration = parseMcpServerRegistration(name, body);
		} catch (error) {
			configurationError =
				error instanceof Error ? error.message : String(error);
		}
		const resolvedTransport = registration?.transport;
		const rawTransportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "",
		).trim();
		const hasRawUrl =
			typeof transport?.url === "string" || typeof record.url === "string";
		const fallbackTransportType =
			rawTransportType === "sse"
				? "sse"
				: rawTransportType === "streamableHttp" || rawTransportType === "http"
					? "streamableHttp"
					: hasRawUrl
						? "sse"
						: "stdio";
		const oauthStatus = registration
			? getMcpServerOAuthStatus(registration)
			: undefined;
		return {
			name,
			transportType: resolvedTransport?.type ?? fallbackTransportType,
			disabled: record.disabled === true,
			command: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.command
					: undefined
				: typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.args
					: undefined
				: Array.isArray(transport?.args)
					? transport.args
					: Array.isArray(record.args)
						? record.args
						: undefined,
			cwd: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.cwd
					: undefined
				: typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.env
					: undefined
				: transport?.env && typeof transport.env === "object"
					? transport.env
					: record.env && typeof record.env === "object"
						? record.env
						: undefined,
			url: resolvedTransport
				? resolvedTransport.type !== "stdio"
					? resolvedTransport.url
					: undefined
				: typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers: resolvedTransport
				? resolvedTransport.type !== "stdio"
					? resolvedTransport.headers
					: undefined
				: transport?.headers && typeof transport.headers === "object"
					? transport.headers
					: record.headers && typeof record.headers === "object"
						? record.headers
						: undefined,
			metadata: registration?.metadata ?? record.metadata,
			oauthClient: registration?.oauthClient
				? {
						clientId: registration.oauthClient.clientId,
						hasClientSecret:
							typeof registration.oauthClient.clientSecret === "string",
						...(registration.oauthClient.allowedScopes
							? {
									allowedScopes: [...registration.oauthClient.allowedScopes],
								}
							: {}),
					}
				: undefined,
			...(configurationError ? { configurationError } : {}),
			oauthStatus: oauthStatus
				? {
						supported: oauthStatus.oauthSupported,
						configured: oauthStatus.oauthConfigured,
						authorizationRequired: oauthStatus.authorizationRequired,
						lastError: oauthStatus.lastError,
						lastAuthenticatedAt: oauthStatus.lastAuthenticatedAt,
					}
				: undefined,
		};
	});
	return { settingsPath, hasSettingsFile: true, servers: entries };
}

export function writeMcpServersMap(servers: JsonRecord): void {
	updateMcpSettingsFileSync(resolveMcpSettingsPath(), (settings) => {
		settings.mcpServers = servers;
	});
}

export function ensureMcpSettingsFile(): string {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path)) {
		writeMcpServersMap({});
	}
	return path;
}

export function setMcpServerDisabled(
	name: string,
	disabled: boolean,
): JsonRecord {
	// Hold the cross-process lock across read-modify-write so a concurrent writer
	// (the extension, the CLI) cannot clobber this change.
	updateMcpSettingsFileSync(resolveMcpSettingsPath(), (settings) => {
		const servers = ((settings.mcpServers as JsonRecord | undefined) ??
			{}) as JsonRecord;
		const current = servers[name];
		if (!current || typeof current !== "object") {
			throw new Error(`unknown MCP server: ${name}`);
		}
		servers[name] = { ...(current as JsonRecord), disabled };
		settings.mcpServers = servers;
	});
	return readMcpServersResponse();
}

export function upsertMcpServer(input: JsonRecord): JsonRecord {
	const name = String(input.name ?? "").trim();
	if (!name) throw new Error("server name is required");
	const previousName = String(
		input.previousName ?? input.previous_name ?? "",
	).trim();
	const transportType = String(
		input.transportType ?? input.transport_type ?? "",
	).trim();
	const next: JsonRecord =
		transportType === "stdio"
			? {
					transport: {
						type: "stdio",
						command: input.command,
						args: input.args,
						cwd: input.cwd,
						env: input.env,
					},
					disabled: input.disabled === true,
				}
			: {
					transport: {
						type: transportType === "sse" ? "sse" : "streamableHttp",
						url: input.url,
						headers: input.headers,
					},
					disabled: input.disabled === true,
				};
	// Hold the cross-process lock across read-modify-write so a concurrent writer
	// cannot clobber this upsert.
	updateMcpSettingsFileSync(resolveMcpSettingsPath(), (settings) => {
		const servers = ((settings.mcpServers as JsonRecord | undefined) ??
			{}) as JsonRecord;
		if (previousName && previousName !== name) {
			delete servers[previousName];
		}
		servers[name] = next;
		settings.mcpServers = servers;
	});
	return readMcpServersResponse();
}

export function deleteMcpServer(name: string): JsonRecord {
	if (!name) throw new Error("server name is required");
	// Hold the cross-process lock across read-modify-write so a concurrent writer
	// cannot resurrect the deleted server from a stale snapshot.
	updateMcpSettingsFileSync(resolveMcpSettingsPath(), (settings) => {
		const servers = ((settings.mcpServers as JsonRecord | undefined) ??
			{}) as JsonRecord;
		delete servers[name];
		settings.mcpServers = servers;
	});
	return readMcpServersResponse();
}
