import type { McpServerTransportConfig } from "../extensions/mcp";
import {
	resolveDefaultMcpSettingsPath,
	updateMcpSettingsFileSync,
} from "../extensions/mcp";

export interface McpInstallOptions {
	name: string;
	headers?: string[];
	targetArgs?: string[];
	transport?: string;
	settingsPath?: string;
}

export interface McpInstallResult {
	name: string;
	status: "installed";
	transport: McpServerTransportConfig;
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
	targetArgs?: string[];
}): { headers: string[]; targetArgs: string[] } {
	const headers = [...(input.headers ?? [])];
	const targetArgs: string[] = [];
	const args = input.targetArgs ?? [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--header") {
			const value = args[index + 1];
			if (!value) {
				throw new Error("--header requires a value");
			}
			headers.push(value);
			index++;
			continue;
		}
		if (arg?.startsWith("--header=")) {
			headers.push(arg.slice("--header=".length));
			continue;
		}
		targetArgs.push(arg);
	}
	return { headers, targetArgs };
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
	targetArgs?: string[];
	transport?: string;
}): { name: string; transport: McpServerTransportConfig; warnings: string[] } {
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server name is required");
	}
	const type = normalizeTransportType(options.transport);
	const { headers: rawHeaders, targetArgs } = splitTargetArgsAndHeaders({
		headers: options.headers,
		targetArgs: options.targetArgs,
	});
	const { headers, warnings } = buildHeaders(rawHeaders);
	if (type === "stdio") {
		if (rawHeaders.length > 0) {
			throw new Error("Stdio MCP installs do not support request headers.");
		}
		const [command, ...args] = targetArgs;
		if (!command?.trim()) {
			throw new Error(
				"Stdio MCP install requires a command after the server name, for example: cline mcp install fs --yes -- npx -y @modelcontextprotocol/server-filesystem /tmp",
			);
		}
		return {
			name,
			transport: {
				type,
				command,
				args: args.length > 0 ? args : undefined,
			},
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
		transport: headers ? { type, url, headers } : { type, url },
		warnings,
	};
}

function addMcpServer(
	name: string,
	transport: McpServerTransportConfig,
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
		servers[name] = { transport };
		settings.mcpServers = servers;
	});
}

export function installMcpServer(options: McpInstallOptions): McpInstallResult {
	const { name, transport, warnings } = buildMcpInstallTransport(options);
	addMcpServer(
		name,
		transport,
		options.settingsPath ?? resolveDefaultMcpSettingsPath(),
	);
	return {
		name,
		status: "installed",
		transport,
		warnings,
	};
}
