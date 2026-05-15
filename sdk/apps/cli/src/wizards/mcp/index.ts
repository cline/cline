import * as p from "@clack/prompts";
import { authorizeMcpServerOAuth } from "@cline/core";
import open from "open";
import {
	addServer,
	clearServerOAuth,
	getSettingsPath,
	loadServers,
	type McpServerEntry,
	type McpTransport,
	removeServer,
	toggleServer,
	updateServer,
} from "./settings";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return String(error);
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

async function collectStdioTransport(): Promise<McpTransport | null> {
	p.log.info("Quoted arguments and escaped spaces are supported");

	const command = await p.text({
		message: "Command to run",
		placeholder: "npx -y @modelcontextprotocol/server-filesystem",
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
): Promise<UrlServerConfig | null> {
	const url = await p.text({
		message: "Server URL",
		placeholder: "https://example.com/mcp",
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

	if (authMode === "oauth" || authMode === "none") {
		return {
			transport: { type, url: (url as string).trim() },
			authMode,
		};
	}

	const headersInput = await p.text({
		message: "Headers (KEY:VALUE, comma-separated)",
		placeholder: "leave empty for none",
	});
	if (isCancel(headersInput)) return null;

	let headers: Record<string, string> | undefined;
	const headersStr = (headersInput as string).trim();
	if (headersStr) {
		headers = {};
		for (const pair of headersStr.split(",")) {
			const colonIdx = pair.indexOf(":");
			if (colonIdx > 0) {
				headers[pair.slice(0, colonIdx).trim()] = pair
					.slice(colonIdx + 1)
					.trim();
			}
		}
	}

	return {
		transport: { type, url: (url as string).trim(), headers },
		authMode,
	};
}

async function authorizeOAuth(name: string): Promise<void> {
	p.log.info("Opening browser for MCP OAuth authorization");
	try {
		const result = await authorizeMcpServerOAuth({
			serverName: name,
			filePath: getSettingsPath(),
			openUrl: async (url) => {
				p.log.message(`Authorization URL: ${url}`);
				await open(url, { wait: false });
			},
			onServerListening: (info) => {
				p.log.message(`Waiting for OAuth callback at ${info.callbackUrl}`);
			},
		});
		p.log.success(result.message);
	} catch (error) {
		p.log.error(`OAuth authorization failed: ${toErrorMessage(error)}`);
		p.log.warn(
			`Server "${name}" is still saved. Choose "Authorize OAuth" to retry.`,
		);
	}
}

async function actionAdd(): Promise<void> {
	const name = await p.text({
		message: "Server name",
		placeholder: "my-mcp-server",
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
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		const config = await collectUrlTransport(type as "sse" | "streamableHttp");
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
	}
	if (!transport) return;

	const serverName = (name as string).trim();
	addServer(serverName, transport);
	if (authMode !== "oauth") {
		clearServerOAuth(serverName);
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
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		const config = await collectUrlTransport(type as "sse" | "streamableHttp");
		transport = config?.transport ?? null;
		authMode = config?.authMode ?? "none";
	}
	if (!transport) return;

	updateServer(name, transport);
	if (type === "stdio" || authMode !== "oauth") {
		clearServerOAuth(name);
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

export async function runMcpWizard(): Promise<number> {
	p.intro("MCP Servers");

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
