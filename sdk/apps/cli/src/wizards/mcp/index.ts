import * as p from "@clack/prompts";
import {
	addServer,
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

function transportLabel(t: McpTransport): string {
	if (t.type === "stdio") return `stdio: ${t.command}`;
	return `${t.type}: ${t.url}`;
}

function statusLabel(entry: McpServerEntry): string {
	return entry.disabled ? "disabled" : "enabled";
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
): Promise<McpTransport | null> {
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

	// FIXME: when the SDK adds OAuth support for MCP, add OAuth auth flow here
	// For now, only static headers are supported for remote servers.

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

	return { type, url: (url as string).trim(), headers };
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
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		transport = await collectUrlTransport(type as "sse" | "streamableHttp");
	}
	if (!transport) return;

	addServer((name as string).trim(), transport);
	p.log.success(`Added "${(name as string).trim()}" to ${getSettingsPath()}`);
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
				hint: `${s.transport.type} [${statusLabel(s)}]`,
			})),
		})
		.then((v) => (isCancel(v) ? null : (v as string)));
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
	if (type === "stdio") {
		transport = await collectStdioTransport();
	} else {
		transport = await collectUrlTransport(type as "sse" | "streamableHttp");
	}
	if (!transport) return;

	updateServer(name, transport);
	p.log.success(`Updated "${name}"`);
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
