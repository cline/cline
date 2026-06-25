import { existsSync, readFileSync } from "node:fs";
import { updateMcpSettingsFileSync } from "@cline/core";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import type { JsonRecord } from "./types";

export function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = parsed.mcpServers as JsonRecord | undefined;
	const entries = Object.entries(servers ?? {}).map(([name, body]) => {
		const record = body as JsonRecord;
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		const transportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "stdio",
		).trim();
		return {
			name,
			transportType,
			disabled: record.disabled === true,
			command:
				typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: Array.isArray(transport?.args)
				? transport.args
				: Array.isArray(record.args)
					? record.args
					: undefined,
			cwd:
				typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env:
				transport?.env && typeof transport.env === "object"
					? transport.env
					: record.env && typeof record.env === "object"
						? record.env
						: undefined,
			url:
				typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers:
				transport?.headers && typeof transport.headers === "object"
					? transport.headers
					: record.headers && typeof record.headers === "object"
						? record.headers
						: undefined,
			metadata: record.metadata,
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
		const servers = ((settings.mcpServers as JsonRecord | undefined) ?? {}) as JsonRecord;
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
		const servers = ((settings.mcpServers as JsonRecord | undefined) ?? {}) as JsonRecord;
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
		const servers = ((settings.mcpServers as JsonRecord | undefined) ?? {}) as JsonRecord;
		delete servers[name];
		settings.mcpServers = servers;
	});
	return readMcpServersResponse();
}
