import type {
	McpOAuthLoopbackHostname,
	McpServerOAuthClientConfig,
	McpServerTransportConfig,
} from "../extensions/mcp";
import {
	resolveDefaultMcpSettingsPath,
	updateMcpSettingsFileSync,
} from "../extensions/mcp";
import { normalizeMcpOAuthAllowedScopes } from "../extensions/mcp/oauth-scope-policy";
import { resolveNativeMcpTransport } from "../extensions/mcp/remote-proxy";

type McpInstallOAuthClientPolicy = Pick<
	McpServerOAuthClientConfig,
	"clientId" | "allowedScopes" | "loopbackHostname"
>;

export interface McpInstallOptions {
	name: string;
	headers?: string[];
	oauthAllowedScopes?: string[];
	oauthClientId?: string;
	oauthLoopbackHostname?: McpOAuthLoopbackHostname;
	targetArgs?: string[];
	transport?: string;
	settingsPath?: string;
}

export interface McpInstallResult {
	name: string;
	status: "installed";
	transport: McpServerTransportConfig;
	oauthClient?: McpInstallOAuthClientPolicy;
	warnings: string[];
}

function normalizeTransportType(
	value: string | undefined,
): McpServerTransportConfig["type"] {
	const normalized = (value ?? "stdio").trim();
	if (normalized === "http" || normalized === "streamable-http") {
		return "streamableHttp";
	}
	if (
		normalized === "stdio" ||
		normalized === "sse" ||
		normalized === "streamableHttp"
	) {
		return normalized;
	}
	throw new Error(
		`Unsupported MCP transport "${normalized}". Expected stdio, sse, http, streamable-http, or streamableHttp.`,
	);
}

function assertValidUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid MCP server URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`Invalid MCP server URL: ${url} (only http and https are supported)`,
		);
	}
}

function parseHeader(value: string): [string, string] {
	const separatorIndex = value.indexOf(":");
	if (separatorIndex <= 0) {
		throw new Error(
			`Invalid MCP header "${value}". Expected "Header-Name: header value".`,
		);
	}
	const name = value.slice(0, separatorIndex).trim();
	const headerValue = value.slice(separatorIndex + 1).trim();
	if (!name || !headerValue) {
		throw new Error(
			`Invalid MCP header "${value}". Expected "Header-Name: header value".`,
		);
	}
	if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
		throw new Error(`Invalid MCP header name "${name}".`);
	}
	return [name, headerValue];
}

function containsPlaceholder(value: string): boolean {
	const openIndex = value.indexOf("<");
	return openIndex >= 0 && value.indexOf(">", openIndex + 1) > openIndex + 1;
}

function splitTargetArgsAndHeaders(input: {
	headers?: string[];
	oauthAllowedScopes?: string[];
	oauthClientId?: string;
	oauthLoopbackHostname?: string;
	parseTransport?: boolean;
	targetArgs?: string[];
	transport?: string;
}): {
	headers: string[];
	oauthAllowedScopes?: string[];
	oauthClientId?: string;
	oauthLoopbackHostname?: string;
	targetArgs: string[];
	transport?: string;
} {
	const headers = [...(input.headers ?? [])];
	const oauthAllowedScopes = [...(input.oauthAllowedScopes ?? [])];
	const targetArgs: string[] = [];
	let oauthClientId = input.oauthClientId;
	let oauthLoopbackHostname = input.oauthLoopbackHostname;
	let sawOauthAllowedScope = input.oauthAllowedScopes !== undefined;
	let sawOauthClientId = input.oauthClientId !== undefined;
	let sawOauthLoopbackHostname = input.oauthLoopbackHostname !== undefined;
	let transport = input.transport;
	let sawTransport = input.transport !== undefined;
	const args = input.targetArgs ?? [];
	const requireOptionValue = (index: number, option: string): string => {
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${option} requires a value`);
		}
		return value;
	};
	const requireInlineOptionValue = (value: string, option: string): string => {
		if (!value) {
			throw new Error(`${option} requires a value`);
		}
		return value;
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		// Marketplace-style args use "--" to end option parsing (matching how
		// commander handles the CLI form); everything after it is the verbatim
		// stdio command. Without this the separator itself becomes the command.
		if (input.parseTransport && arg === "--") {
			targetArgs.push(...args.slice(index + 1));
			break;
		}
		if (input.parseTransport && (arg === "--transport" || arg === "-t")) {
			if (sawTransport) {
				throw new Error("--transport may only be specified once");
			}
			const value = requireOptionValue(index, "--transport");
			transport = value;
			sawTransport = true;
			index++;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--transport=")) {
			if (sawTransport) {
				throw new Error("--transport may only be specified once");
			}
			transport = requireInlineOptionValue(
				arg.slice("--transport=".length),
				"--transport",
			);
			sawTransport = true;
			continue;
		}
		if (input.parseTransport && arg === "--oauth-client-id") {
			if (sawOauthClientId) {
				throw new Error("--oauth-client-id may only be specified once");
			}
			oauthClientId = requireOptionValue(index, "--oauth-client-id");
			sawOauthClientId = true;
			index++;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--oauth-client-id=")) {
			if (sawOauthClientId) {
				throw new Error("--oauth-client-id may only be specified once");
			}
			oauthClientId = requireInlineOptionValue(
				arg.slice("--oauth-client-id=".length),
				"--oauth-client-id",
			);
			sawOauthClientId = true;
			continue;
		}
		if (input.parseTransport && arg === "--oauth-allowed-scope") {
			oauthAllowedScopes.push(
				requireOptionValue(index, "--oauth-allowed-scope"),
			);
			sawOauthAllowedScope = true;
			index++;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--oauth-allowed-scope=")) {
			oauthAllowedScopes.push(
				requireInlineOptionValue(
					arg.slice("--oauth-allowed-scope=".length),
					"--oauth-allowed-scope",
				),
			);
			sawOauthAllowedScope = true;
			continue;
		}
		if (input.parseTransport && arg === "--oauth-loopback-hostname") {
			if (sawOauthLoopbackHostname) {
				throw new Error("--oauth-loopback-hostname may only be specified once");
			}
			oauthLoopbackHostname = requireOptionValue(
				index,
				"--oauth-loopback-hostname",
			);
			sawOauthLoopbackHostname = true;
			index++;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--oauth-loopback-hostname=")) {
			if (sawOauthLoopbackHostname) {
				throw new Error("--oauth-loopback-hostname may only be specified once");
			}
			oauthLoopbackHostname = requireInlineOptionValue(
				arg.slice("--oauth-loopback-hostname=".length),
				"--oauth-loopback-hostname",
			);
			sawOauthLoopbackHostname = true;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--oauth-")) {
			throw new Error(`Unsupported MCP OAuth install option "${arg}".`);
		}
		if (input.parseTransport && arg === "--header") {
			const value = args[index + 1];
			if (!value) {
				throw new Error("--header requires a value");
			}
			headers.push(value);
			index++;
			continue;
		}
		if (input.parseTransport && arg?.startsWith("--header=")) {
			headers.push(arg.slice("--header=".length));
			continue;
		}
		targetArgs.push(arg);
	}
	return {
		headers,
		...(sawOauthAllowedScope ? { oauthAllowedScopes } : {}),
		...(sawOauthClientId ? { oauthClientId } : {}),
		...(sawOauthLoopbackHostname ? { oauthLoopbackHostname } : {}),
		targetArgs,
		transport,
	};
}

function normalizeMcpInstallOAuthClient(options: {
	oauthAllowedScopes?: string[];
	oauthClientId?: string;
	oauthLoopbackHostname?: string;
}): McpInstallOAuthClientPolicy | undefined {
	const clientId = options.oauthClientId?.trim();
	if (!clientId) {
		if (
			options.oauthAllowedScopes !== undefined ||
			options.oauthLoopbackHostname !== undefined
		) {
			throw new Error(
				"--oauth-client-id is required when --oauth-allowed-scope or --oauth-loopback-hostname is provided.",
			);
		}
		if (options.oauthClientId !== undefined) {
			throw new Error("--oauth-client-id requires a non-empty value");
		}
		return undefined;
	}

	const allowedScopes = normalizeMcpOAuthAllowedScopes(
		options.oauthAllowedScopes,
	);
	const rawLoopbackHostname = options.oauthLoopbackHostname;
	const loopbackHostname = rawLoopbackHostname?.trim();
	if (
		loopbackHostname !== undefined &&
		loopbackHostname !== "127.0.0.1" &&
		loopbackHostname !== "localhost"
	) {
		throw new Error(
			`Unsupported MCP OAuth loopback hostname "${rawLoopbackHostname}". Expected 127.0.0.1 or localhost.`,
		);
	}

	return {
		clientId,
		...(allowedScopes ? { allowedScopes } : {}),
		...(loopbackHostname ? { loopbackHostname } : {}),
	};
}

function buildHeaders(values: string[]): {
	headers?: Record<string, string>;
	warnings: string[];
} {
	if (values.length === 0) return { warnings: [] };
	const headers: Record<string, string> = {};
	const warnings: string[] = [];
	for (const value of values) {
		const [name, headerValue] = parseHeader(value);
		headers[name] = headerValue;
		if (containsPlaceholder(headerValue)) {
			warnings.push(
				`Header "${name}" looks like it contains a placeholder. Update it in MCP settings before using this server.`,
			);
		}
	}
	return { headers, warnings };
}

export function buildMcpInstallTransport(options: {
	headers?: string[];
	name: string;
	oauthAllowedScopes?: string[];
	oauthClientId?: string;
	oauthLoopbackHostname?: McpOAuthLoopbackHostname;
	targetArgs?: string[];
	transport?: string;
}): {
	name: string;
	oauthClient?: McpInstallOAuthClientPolicy;
	transport: McpServerTransportConfig;
	warnings: string[];
} {
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server name is required");
	}
	const parsed = splitTargetArgsAndHeaders({
		headers: options.headers,
		oauthAllowedScopes: options.oauthAllowedScopes,
		oauthClientId: options.oauthClientId,
		oauthLoopbackHostname: options.oauthLoopbackHostname,
		targetArgs: options.targetArgs,
		transport: options.transport,
	});
	const oauthClient = normalizeMcpInstallOAuthClient(parsed);
	const type = normalizeTransportType(parsed.transport);
	const targetArgs = parsed.targetArgs;
	const rawHeaders = parsed.headers;
	const { headers, warnings } = buildHeaders(rawHeaders);
	if (
		oauthClient &&
		Object.keys(headers ?? {}).some(
			(headerName) => headerName.toLowerCase() === "authorization",
		)
	) {
		throw new Error(
			"MCP OAuth installs do not support a static Authorization header.",
		);
	}
	if (type === "stdio") {
		const [command, ...args] = targetArgs;
		if (!command?.trim()) {
			throw new Error(
				"Stdio MCP install requires a command after the server name, for example: cline mcp install fs --yes -- npx -y @modelcontextprotocol/server-filesystem /tmp",
			);
		}
		const stdioTransport = resolveNativeMcpTransport({
			type,
			command,
			args: args.length > 0 ? args : undefined,
		});
		// Older marketplace entries still declare `npx mcp-remote <url>` as
		// stdio. Resolve that exact safe shape before deciding whether remote-only
		// headers and OAuth client policy are applicable.
		if (stdioTransport.type !== "stdio") {
			return {
				name,
				...(oauthClient ? { oauthClient } : {}),
				transport: headers ? { ...stdioTransport, headers } : stdioTransport,
				warnings,
			};
		}
		if (oauthClient) {
			throw new Error("Stdio MCP installs do not support OAuth client policy.");
		}
		if (rawHeaders.length > 0) {
			throw new Error("Stdio MCP installs do not support request headers.");
		}
		return {
			name,
			transport: stdioTransport,
			warnings,
		};
	}

	if (targetArgs.length !== 1) {
		throw new Error(
			"Remote MCP install requires exactly one URL argument after the server name.",
		);
	}
	const url = targetArgs[0]?.trim() ?? "";
	assertValidUrl(url);
	return {
		name,
		...(oauthClient ? { oauthClient } : {}),
		transport: headers ? { type, url, headers } : { type, url },
		warnings,
	};
}

export function parseMcpInstallArgs(args: string[]): McpInstallOptions {
	const [name, ...targetArgs] = args;
	if (!name) {
		throw new Error(
			"Marketplace MCP install args must start with a server name.",
		);
	}
	const parsed = splitTargetArgsAndHeaders({
		parseTransport: true,
		targetArgs,
	});
	const oauthClient = normalizeMcpInstallOAuthClient(parsed);
	return {
		name,
		headers: parsed.headers,
		...(oauthClient?.allowedScopes
			? { oauthAllowedScopes: oauthClient.allowedScopes }
			: {}),
		...(oauthClient ? { oauthClientId: oauthClient.clientId } : {}),
		...(oauthClient?.loopbackHostname
			? { oauthLoopbackHostname: oauthClient.loopbackHostname }
			: {}),
		targetArgs: parsed.targetArgs,
		transport: parsed.transport,
	};
}

function addMcpServer(
	name: string,
	transport: McpServerTransportConfig,
	oauthClient: McpInstallOAuthClientPolicy | undefined,
	settingsPath: string,
): void {
	updateMcpSettingsFileSync(settingsPath, (settings) => {
		const serversValue = settings.mcpServers;
		const servers =
			serversValue &&
			typeof serversValue === "object" &&
			!Array.isArray(serversValue)
				? { ...(serversValue as Record<string, unknown>) }
				: {};
		servers[name] = {
			transport,
			...(oauthClient ? { oauthClient } : {}),
		};
		settings.mcpServers = servers;
	});
}

export function installMcpServer(options: McpInstallOptions): McpInstallResult {
	const { name, oauthClient, transport, warnings } =
		buildMcpInstallTransport(options);
	addMcpServer(
		name,
		transport,
		oauthClient,
		options.settingsPath ?? resolveDefaultMcpSettingsPath(),
	);
	return {
		name,
		...(oauthClient ? { oauthClient } : {}),
		status: "installed",
		transport,
		warnings,
	};
}

export interface McpUninstallOptions {
	name: string;
	settingsPath?: string;
}

export interface McpUninstallResult {
	name: string;
	status: "uninstalled";
}

function removeMcpServer(name: string, settingsPath: string): boolean {
	return updateMcpSettingsFileSync(settingsPath, (settings) => {
		const serversValue = settings.mcpServers;
		const servers =
			serversValue &&
			typeof serversValue === "object" &&
			!Array.isArray(serversValue)
				? (serversValue as Record<string, unknown>)
				: {};
		const hadServer = Object.hasOwn(servers, name);
		if (!hadServer) {
			throw new Error(`MCP server "${name}" is not installed.`);
		}
		delete servers[name];
		settings.mcpServers = servers;
		return true;
	});
}

export function uninstallMcpServer(
	options: McpUninstallOptions,
): McpUninstallResult {
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server name is required");
	}
	const settingsPath = options.settingsPath ?? resolveDefaultMcpSettingsPath();
	removeMcpServer(name, settingsPath);
	return {
		name,
		status: "uninstalled",
	};
}
