import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDefaultMcpSettingsPath } from "@clinebot/core";

export interface McpServerEntry {
	name: string;
	transport: McpTransport;
	disabled?: boolean;
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
			return {
				name,
				transport,
				disabled: entry.disabled === true,
			};
		});
	} catch {
		return [];
	}
}

function readRawSettings(): Record<string, unknown> {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function readRawServers(): Record<string, unknown> {
	const settings = readRawSettings();
	const servers = settings.mcpServers;
	return servers && typeof servers === "object" && !Array.isArray(servers)
		? { ...(servers as Record<string, unknown>) }
		: {};
}

function writeServers(servers: Record<string, unknown>): void {
	const path = getSettingsPath();
	const settings = readRawSettings();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ ...settings, mcpServers: servers }, null, 2)}\n`,
	);
}

export function addServer(name: string, transport: McpTransport): void {
	const servers = readRawServers();
	servers[name] = { transport };
	writeServers(servers);
}

export function removeServer(name: string): boolean {
	const servers = readRawServers();
	if (!(name in servers)) return false;
	delete servers[name];
	writeServers(servers);
	return true;
}

export function updateServer(name: string, transport: McpTransport): void {
	const servers = readRawServers();
	const existing =
		servers[name] && typeof servers[name] === "object"
			? (servers[name] as Record<string, unknown>)
			: {};
	servers[name] = { ...existing, transport };
	writeServers(servers);
}

export function toggleServer(name: string, disabled: boolean): void {
	const servers = readRawServers();
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
	writeServers(servers);
}
