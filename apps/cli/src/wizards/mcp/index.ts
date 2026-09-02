import * as p from "@clack/prompts";
import type {
	McpOAuthLoopbackHostname,
	McpServerOAuthClientConfig,
} from "@cline/core";
import { authorizeMcpServerOAuthWithBrowser as authorizeOAuth } from "./oauth";
import {
	addServer,
	clearServerOAuth,
	getSettingsPath,
	hasSameOAuthTransportIdentity,
	loadServers,
	type McpServerEntry,
	type McpTransport,
	removeServer,
	setServerOAuthClient,
	toggleServer,
	updateServer,
} from "./settings";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

function transportLabel(t: McpTransport): string {
	if (t.type === "stdio") return `stdio: ${t.command}`;
	return `${t.type}: ${t.url}`;
}

function statusLabel(entry: McpServerEntry): string {
	return entry.disabled ? "disabled" : "enabled";
}

function authLabel(entry: McpServerEntry): string {
	if (entry.transport.type === "stdio") return "local";
	if (entry.oauth?.lastError) return "oauth error";
	const accessToken = entry.oauth?.tokens?.access_token;
	if (typeof accessToken === "string" && accessToken.trim().length > 0) {
		return "oauth authorized";
	}
	if (entry.oauth && Object.keys(entry.oauth).length > 0) {
		return "oauth pending";
	}
	if (
		entry.transport.headers &&
		Object.keys(entry.transport.headers).length > 0
	) {
		return "static headers";
	}
	return "no auth";
}

type RemoteAuthMode = "none" | "headers" | "oauth";

interface UrlServerConfig {
	transport: McpTransport;
	authMode: RemoteAuthMode;
	oauthClient?: McpServerOAuthClientConfig;
}

interface UrlServerDefaults {
	url?: string;
	headers?: Record<string, string>;
	authMode?: RemoteAuthMode;
	oauthClient?: McpServerOAuthClientConfig;
	transport?: McpTransport;
}

// @cline/core does not currently export its ordered fallback port list. Keep
// this user-facing registration guidance aligned with the MCP OAuth defaults.
const MCP_OAUTH_CALLBACK_PORTS = [1456, 1457, 1458] as const;
const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";

export interface McpAddDefaults {
	name?: string;
	type?: McpTransport["type"];
	command?: string;
	url?: string;
	headers?: Record<string, string>;
	/**
	 * Install definitions may prefill only the public OAuth client policy. Client
	 * secrets remain an explicit wizard-only input and are never accepted from a
	 * marketplace or CLI install flag.
	 */
	oauthClient?: Omit<McpServerOAuthClientConfig, "clientSecret">;
}

export interface RunMcpWizardOptions {
	initialAction?: "add";
	addDefaults?: McpAddDefaults;
	exitAfterInitialAction?: boolean;
}

export function parseStdioCommand(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of input.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (escaping) {
		current += "\\";
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

function isOAuthScopeToken(value: string): boolean {
	if (value.length === 0) return false;
	for (const char of value) {
		const code = char.charCodeAt(0);
		if (code < 0x21 || code > 0x7e || code === 0x22 || code === 0x5c) {
			return false;
		}
	}
	return true;
}

export function parseOAuthAllowedScopes(input: string): string[] | undefined {
	const normalized = input.trim();
	if (!normalized) return undefined;
	const scopes = normalized.split(/\s+/);
	if (scopes.some((scope) => !isOAuthScopeToken(scope))) {
		throw new Error(
			"Scopes must be valid RFC 6749 scope tokens separated by spaces",
		);
	}
	if (new Set(scopes).size !== scopes.length) {
		throw new Error("Scopes must not contain duplicates");
	}
	return scopes.sort();
}

export function getMcpOAuthRedirectUris(
	hostname: McpOAuthLoopbackHostname,
): string[] {
	return MCP_OAUTH_CALLBACK_PORTS.map(
		(port) => `http://${hostname}:${port}${MCP_OAUTH_CALLBACK_PATH}`,
	);
}

function remoteAuthMode(entry: McpServerEntry): RemoteAuthMode {
	if (entry.oauthClient || entry.oauth) return "oauth";
	if (
		entry.transport.type !== "stdio" &&
		entry.transport.headers &&
		Object.keys(entry.transport.headers).length > 0
	) {
		return "headers";
	}
	return "none";
}

function formatHeaders(headers: Record<string, string> | undefined): string {
	return Object.entries(headers ?? {})
		.map(([name, value]) => `${name}:${value}`)
		.join(", ");
}

function parseHeadersInput(
	input: string,
	options: { oauth: boolean },
): Record<string, string> | undefined {
	const normalized = input.trim();
	if (!normalized) return undefined;
	const headers: Record<string, string> = {};
	for (const rawPair of normalized.split(",")) {
		const colonIndex = rawPair.indexOf(":");
		if (colonIndex <= 0) {
			throw new Error("Headers must use comma-separated KEY:VALUE pairs");
		}
		const name = rawPair.slice(0, colonIndex).trim();
		if (!name) {
			throw new Error("Header names must not be empty");
		}
		if (options.oauth && name.toLowerCase() === "authorization") {
			throw new Error(
				"Authorization is managed by OAuth and cannot be an additional header",
			);
		}
		if (Object.hasOwn(headers, name)) {
			throw new Error(`Duplicate header: ${name}`);
		}
		headers[name] = rawPair.slice(colonIndex + 1).trim();
	}
	return headers;
}

async function collectStdioTransport(
	defaultCommand?: string,
): Promise<McpTransport | null> {
	p.log.info("Quoted arguments and escaped spaces are supported");

	const command = await p.text({
		message: "Command to run",
		placeholder: "npx -y @modelcontextprotocol/server-filesystem",
		initialValue: defaultCommand,
		validate: (v) => {
			if (!v?.trim()) return "Command is required";
			return undefined;
		},
	});
	if (isCancel(command)) return null;

	const parts = parseStdioCommand(command as string);
	const cmd = parts[0] ?? "";
	const args = parts.slice(1);

	const envInput = await p.text({
		message: "Environment variables (KEY=VALUE, comma-separated)",
		placeholder: "leave empty for none",
	});
	if (isCancel(envInput)) return null;

	let env: Record<string, string> | undefined;
	const envStr = (envInput as string).trim();
	if (envStr) {
		env = {};
		for (const pair of envStr.split(",")) {
			const eqIdx = pair.indexOf("=");
			if (eqIdx > 0) {
				env[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
			}
		}
	}

	return {
		type: "stdio",
		command: cmd,
		args: args.length > 0 ? args : undefined,
		env,
	};
}

async function collectUrlTransport(
	type: "sse" | "streamableHttp",
	defaults: UrlServerDefaults = {},
): Promise<UrlServerConfig | null> {
	const url = await p.text({
		message: "Server URL",
		placeholder: "https://example.com/mcp",
		initialValue: defaults.url,
		validate: (v) => {
			if (!v?.trim()) return "URL is required";
			try {
				new URL(v.trim());
			} catch {
				return "Must be a valid URL";
			}
			return undefined;
		},
	});
	if (isCancel(url)) return null;

	const authMode = await p.select({
		message: "Authentication",
		initialValue: defaults.authMode,
		options: [
			{
				value: "oauth",
				label: "OAuth",
				hint: "open a browser and save tokens in MCP settings",
			},
			{
				value: "headers",
				label: "Static headers",
				hint: "manually configure request headers",
			},
			{
				value: "none",
				label: "No auth",
			},
		],
	});
	if (isCancel(authMode)) return null;

	if (authMode === "oauth") {
		const headersInput = await p.text({
			message: "Additional OAuth request headers (KEY:VALUE, comma-separated)",
			placeholder: "leave empty for none; Authorization is managed by OAuth",
			initialValue: formatHeaders(defaults.headers),
			validate: (value) => {
				try {
					parseHeadersInput(value ?? "", { oauth: true });
					return undefined;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
		});
		if (isCancel(headersInput)) return null;
		const headers = parseHeadersInput(headersInput as string, { oauth: true });
		const transport: McpTransport = {
			type,
			url: (url as string).trim(),
			...(headers ? { headers } : {}),
		};
		const clientId = await p.text({
			message: "OAuth client ID (leave empty for dynamic registration)",
			initialValue: defaults.oauthClient?.clientId,
		});
		if (isCancel(clientId)) return null;
		const normalizedClientId = (clientId as string).trim();
		if (!normalizedClientId) {
			return {
				transport,
				authMode,
			};
		}

		const previousSecret =
			normalizedClientId === defaults.oauthClient?.clientId
				? defaults.oauthClient.clientSecret
				: undefined;
		const mayKeepPreviousSecret = Boolean(
			previousSecret &&
				defaults.transport &&
				hasSameOAuthTransportIdentity(defaults.transport, transport),
		);
		let clientSecret: string | undefined;
		if (previousSecret) {
			const secretAction = await p.select({
				message: mayKeepPreviousSecret
					? "OAuth client secret"
					: "The endpoint changed; re-enter or explicitly clear the OAuth client secret",
				initialValue: mayKeepPreviousSecret ? "keep" : "replace",
				options: [
					...(mayKeepPreviousSecret
						? [{ value: "keep", label: "Keep saved secret" }]
						: []),
					{ value: "replace", label: "Replace saved secret" },
					{ value: "clear", label: "Clear saved secret" },
				],
			});
			if (isCancel(secretAction)) return null;
			if (secretAction === "keep") {
				clientSecret = previousSecret;
			} else if (secretAction === "replace") {
				const secret = await p.password({
					message: "New OAuth client secret",
					validate: (value) =>
						value?.trim() ? undefined : "Client secret is required",
				});
				if (isCancel(secret)) return null;
				clientSecret = (secret as string).trim();
			}
		} else {
			const secret = await p.password({
				message: "OAuth client secret (leave empty for public clients)",
			});
			if (isCancel(secret)) return null;
			clientSecret = (secret as string).trim() || undefined;
		}

		const scopesInput = await p.text({
			message: "OAuth allowed scopes (space-separated)",
			placeholder: "leave empty to use provider defaults",
			initialValue: defaults.oauthClient?.allowedScopes?.join(" "),
			validate: (value) => {
				try {
					parseOAuthAllowedScopes(value ?? "");
					return undefined;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
		});
		if (isCancel(scopesInput)) return null;
		const allowedScopes = parseOAuthAllowedScopes(scopesInput as string);

		const loopbackHostname = await p.select({
			message: "OAuth redirect hostname",
			initialValue: defaults.oauthClient?.loopbackHostname ?? "127.0.0.1",
			options: [
				{
					value: "127.0.0.1",
					label: "127.0.0.1",
					hint: "default; recommended when the provider accepts IP callbacks",
				},
				{
					value: "localhost",
					label: "localhost",
					hint: "use when the provider requires localhost redirect URIs",
				},
			],
		});
		if (isCancel(loopbackHostname)) return null;
		p.log.info(
			"Register all three redirect URIs with the OAuth provider; Cline uses the first available local port:",
		);
		for (const redirectUri of getMcpOAuthRedirectUris(
			loopbackHostname as McpOAuthLoopbackHostname,
		)) {
			p.log.message(`  ${redirectUri}`);
		}

		return {
			transport,
			authMode,
			oauthClient: {
				clientId: normalizedClientId,
				...(clientSecret ? { clientSecret } : {}),
				...(allowedScopes ? { allowedScopes } : {}),
				loopbackHostname: loopbackHostname as McpOAuthLoopbackHostname,
			},
		};
	}
	if (authMode === "none") {
		return {
			transport: { type, url: (url as string).trim() },
			authMode,
		};
	}

	const headersInput = await p.text({
		message: "Headers (KEY:VALUE, comma-separated)",
		placeholder: "leave empty for none",
		initialValue: formatHeaders(defaults.headers),
		validate: (value) => {
			try {
				parseHeadersInput(value ?? "", { oauth: false });
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		},
	});
	if (isCancel(headersInput)) return null;
	const headers = parseHeadersInput(headersInput as string, { oauth: false });

	return {
		transport: { type, url: (url as string).trim(), headers },
		authMode,
	};
}

async function actionAdd(defaults?: McpAddDefaults): Promise<void> {
	const name = await p.text({
		message: "Server name",
		placeholder: "my-mcp-server",
		initialValue: defaults?.name,
		validate: (v) => {
			if (!v?.trim()) return "Name is required";
			const existing = loadServers();
			if (existing.some((s) => s.name === v.trim())) {
				return "A server with this name already exists";
			}
			return undefined;
		},
	});
	if (isCancel(name)) return;

	const type = await p.select({
		message: "Server type",
		initialValue: defaults?.type,
		options: [
			{
				value: "stdio",
				label: "Local",
				hint: "run a command on this machine",
			},
			{
				value: "sse",
				label: "Remote (SSE)",
				hint: "connect to a URL via Server-Sent Events",
			},
			{
				value: "streamableHttp",
				label: "Remote (HTTP)",
				hint: "connect to a URL via streamable HTTP",
			},
		],
	});
	if (isCancel(type)) return;

	let transport: McpTransport | null;
	let authMode: RemoteAuthMode = "none";
	let oauthClient: UrlServerConfig["oauthClient"];
	if (type === "stdio") {
		transport = await collectStdioTransport(defaults?.command);
	} else {
		const config = await collectUrlTransport(type as "sse" | "streamableHttp", {
			url: defaults?.url,
			headers: defaults?.headers,
			authMode: defaults?.oauthClient
				? "oauth"
				: defaults?.headers
					? "headers"
					: undefined,
			oauthClient: defaults?.oauthClient,
		});
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
		oauthClient = config?.oauthClient;
	}
	if (!transport) return;

	const serverName = (name as string).trim();
	addServer(serverName, transport);
	if (authMode !== "oauth") {
		clearServerOAuth(serverName);
	} else {
		setServerOAuthClient(serverName, oauthClient);
	}
	p.log.success(`Added "${serverName}" to ${getSettingsPath()}`);
	if (authMode === "oauth") {
		await authorizeOAuth(serverName);
	}
}

async function actionList(): Promise<void> {
	const servers = loadServers();
	if (servers.length === 0) {
		p.log.info("No MCP servers configured");
		p.log.info(`Settings file: ${getSettingsPath()}`);
		return;
	}
	for (const s of servers) {
		const status = s.disabled ? " (disabled)" : "";
		p.log.info(`${s.name}${status}`);
		p.log.message(`  ${transportLabel(s.transport)}`);
		p.log.message(`  auth: ${authLabel(s)}`);
		if (s.oauth?.lastError) {
			p.log.message(`  last OAuth error: ${s.oauth.lastError}`);
		}
	}
	p.log.message(`\nSettings file: ${getSettingsPath()}`);
}

function pickServer(
	servers: McpServerEntry[],
	message: string,
): Promise<string | null> {
	if (servers.length === 0) {
		p.log.warn("No MCP servers configured");
		return Promise.resolve(null);
	}
	return p
		.select({
			message,
			options: servers.map((s) => ({
				value: s.name,
				label: s.name,
				hint: `${s.transport.type} [${statusLabel(s)}, ${authLabel(s)}]`,
			})),
		})
		.then((v) => (isCancel(v) ? null : (v as string)));
}

async function pickRemoteServer(message: string): Promise<string | null> {
	const servers = loadServers().filter(
		(server) => server.transport.type !== "stdio",
	);
	return pickServer(servers, message);
}

async function actionEdit(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "Select server to edit");
	if (!name) return;

	const current = servers.find((s) => s.name === name);
	if (!current) return;

	p.log.step(`Editing ${name} (${current.transport.type})`);

	const type = await p.select({
		message: "Server type",
		initialValue: current.transport.type,
		options: [
			{
				value: "stdio",
				label: "Local",
				hint: "run a command",
			},
			{
				value: "sse",
				label: "Remote (SSE)",
				hint: "Server-Sent Events",
			},
			{
				value: "streamableHttp",
				label: "Remote (HTTP)",
				hint: "streamable HTTP",
			},
		],
	});
	if (isCancel(type)) return;

	let transport: McpTransport | null;
	let authMode: RemoteAuthMode = "none";
	let oauthClient: UrlServerConfig["oauthClient"];
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		const currentRemote =
			current.transport.type === "stdio" ? undefined : current.transport;
		const config = await collectUrlTransport(type as "sse" | "streamableHttp", {
			url: currentRemote?.url,
			headers: currentRemote?.headers,
			authMode: remoteAuthMode(current),
			oauthClient: current.oauthClient,
			transport: current.transport,
		});
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
		oauthClient = config?.oauthClient;
	}
	if (!transport) return;

	updateServer(name, transport);
	if (type === "stdio" || authMode !== "oauth") {
		clearServerOAuth(name);
	} else {
		setServerOAuthClient(name, oauthClient);
	}
	p.log.success(`Updated "${name}"`);
	if (authMode === "oauth") {
		await authorizeOAuth(name);
	}
}

async function actionDelete(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "Select server to delete");
	if (!name) return;

	const confirm = await p.confirm({
		message: `Delete "${name}"?`,
		initialValue: false,
	});
	if (isCancel(confirm) || !confirm) return;

	if (removeServer(name)) {
		p.log.success(`Deleted "${name}"`);
	} else {
		p.log.error("Failed to delete server");
	}
}

async function actionToggle(): Promise<void> {
	const servers = loadServers();
	const name = await pickServer(servers, "Select server to enable/disable");
	if (!name) return;

	const current = servers.find((s) => s.name === name);
	if (!current) return;

	const newDisabled = !current.disabled;
	toggleServer(name, newDisabled);
	p.log.success(`${name} is now ${newDisabled ? "disabled" : "enabled"}`);
}

async function actionAuthorizeOAuth(): Promise<void> {
	const name = await pickRemoteServer("Select remote server to authorize");
	if (!name) return;
	await authorizeOAuth(name);
}

export async function runMcpWizard(
	options: RunMcpWizardOptions = {},
): Promise<number> {
	p.intro("MCP Servers");

	if (options.initialAction === "add") {
		let initialActionExitCode = 0;
		try {
			await actionAdd(options.addDefaults);
		} catch (err) {
			initialActionExitCode = 1;
			p.log.error(err instanceof Error ? err.message : String(err));
		}
		if (options.exitAfterInitialAction === true) {
			p.outro("Done");
			return initialActionExitCode;
		}
	}

	let keepGoing = true;
	while (keepGoing) {
		const action = await p.select({
			message: "What would you like to do?",
			options: [
				{
					value: "list",
					label: "List servers",
					hint: "view configured MCP servers",
				},
				{
					value: "add",
					label: "Add server",
					hint: "configure a new MCP server",
				},
				{
					value: "edit",
					label: "Edit server",
					hint: "change server configuration",
				},
				{
					value: "toggle",
					label: "Enable/disable server",
				},
				{
					value: "authorize",
					label: "Authorize OAuth",
					hint: "run or rerun browser authorization for a remote server",
				},
				{
					value: "delete",
					label: "Delete server",
				},
				{
					value: "exit",
					label: "Exit",
				},
			],
		});

		if (isCancel(action) || action === "exit") {
			keepGoing = false;
			continue;
		}

		try {
			switch (action) {
				case "list":
					await actionList();
					break;
				case "add":
					await actionAdd();
					break;
				case "edit":
					await actionEdit();
					break;
				case "toggle":
					await actionToggle();
					break;
				case "authorize":
					await actionAuthorizeOAuth();
					break;
				case "delete":
					await actionDelete();
					break;
			}
		} catch (err) {
			p.log.error(err instanceof Error ? err.message : String(err));
		}
	}

	p.outro("Done");
	return 0;
}
