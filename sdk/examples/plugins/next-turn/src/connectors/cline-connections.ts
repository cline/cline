import { readFileSync } from "node:fs";
import { isRecord } from "../hub/fold";

/**
 * What the person already connected to Cline. Next Turn reads these
 * through Cline's own stores and never writes to them:
 *
 * - **Composio toolkits** on the Cline account: the state file the desktop
 *   writes at `resolveComposioToolsStatePath(accountId)`. Its tools run
 *   through Cline's connector proxy and are already in the agent's tool list.
 * - **MCP servers** in Cline's MCP settings (`loadMcpSettingsFile`).
 * - **Chat channels** from `cline connect` (`connector.channels`).
 *
 * Names and states only: no tool schema, server environment, header or token
 * leaves this module.
 */

export type ComposioToolkit = {
	toolkit: string;
	connected: boolean;
	tools: number;
};
export type McpServer = {
	name: string;
	transport: "stdio" | "sse" | "streamableHttp";
	disabled: boolean;
	target: string;
};
export type ClineConnections = {
	composio: ComposioToolkit[];
	mcp: McpServer[];
	channels: string[];
};

export type ConnectionLoaders = {
	/** The Composio state file's parsed contents, or nothing when signed out or not connected. */
	composio(): Promise<unknown>;
	/** `loadMcpSettingsFile()`'s result. */
	mcp(): Promise<unknown>;
	/** The `connector.channels` reply payload. */
	channels(): Promise<unknown>;
};

export function parseComposio(state: unknown): ComposioToolkit[] {
	if (!isRecord(state) || !isRecord(state.toolkits)) return [];
	return Object.entries(state.toolkits)
		.map(([toolkit, entry]) => ({
			toolkit: toolkit.toLowerCase(),
			connected:
				isRecord(entry) &&
				typeof entry.connectedAccountId === "string" &&
				entry.connectedAccountId.length > 0,
			tools:
				isRecord(entry) && Array.isArray(entry.tools) ? entry.tools.length : 0,
		}))
		.sort((a, b) => a.toolkit.localeCompare(b.toolkit));
}

/** Where a server runs, for recognising it: the command and its arguments, or the URL's host and path. Never env or headers. */
function targetOf(transport: Record<string, unknown>): string {
	if (typeof transport.url === "string") {
		try {
			const url = new URL(transport.url);
			return `${url.host}${url.pathname}`;
		} catch {
			return "";
		}
	}
	const args = Array.isArray(transport.args)
		? transport.args.filter((arg): arg is string => typeof arg === "string")
		: [];
	return [
		typeof transport.command === "string" ? transport.command : "",
		...args,
	]
		.join(" ")
		.trim();
}

export function parseMcp(settings: unknown): McpServer[] {
	if (!isRecord(settings) || !isRecord(settings.mcpServers)) return [];
	const servers: McpServer[] = [];
	for (const [name, entry] of Object.entries(settings.mcpServers)) {
		if (!isRecord(entry) || !isRecord(entry.transport)) continue;
		const type = entry.transport.type;
		if (type !== "stdio" && type !== "sse" && type !== "streamableHttp")
			continue;
		servers.push({
			name,
			transport: type,
			disabled: entry.disabled === true,
			target: targetOf(entry.transport),
		});
	}
	return servers.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseChannels(reply: unknown): string[] {
	if (!isRecord(reply) || !Array.isArray(reply.configured)) return [];
	const types = new Set<string>();
	for (const entry of reply.configured)
		if (isRecord(entry) && typeof entry.type === "string")
			types.add(entry.type);
	return [...types].sort();
}

/** Each store read independently: one that fails reads as empty and the others still count. */
export async function readClineConnections(
	loaders: ConnectionLoaders,
): Promise<ClineConnections> {
	const [composio, mcp, channels] = await Promise.all([
		loaders.composio().catch(() => undefined),
		loaders.mcp().catch(() => undefined),
		loaders.channels().catch(() => undefined),
	]);
	return {
		composio: parseComposio(composio),
		mcp: parseMcp(mcp),
		channels: parseChannels(channels),
	};
}

/**
 * The real stores. `@cline/core` is imported on first use. The Composio file
 * belongs to the signed-in Cline account; with no account there is none.
 */
export function clineConnectionLoaders(hub?: {
	command(name: string): Promise<Record<string, unknown>>;
}): ConnectionLoaders {
	return {
		async composio() {
			const core = (await import(
				"@cline/core"
			)) as typeof import("@cline/core") & {
				resolveComposioConnectionStatePath?: (accountId: string) => string;
				resolveComposioToolsStatePath?: (accountId: string) => string;
			};
			const accountId = new core.ProviderSettingsManager()
				.getProviderSettings("cline")
				?.auth?.accountId?.trim();
			if (!accountId) return undefined;
			const resolvePath =
				core.resolveComposioConnectionStatePath ??
				core.resolveComposioToolsStatePath;
			if (!resolvePath) return undefined;
			return JSON.parse(
				readFileSync(resolvePath(accountId), "utf8"),
			) as unknown;
		},
		async mcp() {
			const core = await import("@cline/core");
			return core.loadMcpSettingsFile();
		},
		async channels() {
			return hub ? hub.command("connector.channels") : undefined;
		},
	};
}
