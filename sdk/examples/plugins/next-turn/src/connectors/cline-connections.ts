import { readFileSync } from "node:fs";
import type { McpServerTransportConfig, McpSettingsFile } from "@cline/core";
import type { HubLink } from "../hub/link";
import { errorCode } from "../run";
import { isRecord } from "../values";

/**
 * What the person already connected to Cline. Next Turn reads these
 * through Cline's own stores and never writes to them:
 *
 * - **Composio toolkits** on the Cline account: the state file the desktop
 *   writes at `resolveComposioConnectionStatePath(accountId)`.
 * - **MCP servers** in Cline's MCP settings (`loadMcpSettingsFile`).
 * - **Chat channels** from `cline connect` (`connector.channels`).
 *
 * Names and states only: no tool schema, server environment, header or token
 * leaves this module.
 */

type ComposioToolkit = { toolkit: string; connected: boolean };
export type McpServer = {
	name: string;
	transport: McpServerTransportConfig["type"];
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
	mcp(): Promise<McpSettingsFile>;
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
		}))
		.sort((a, b) => a.toolkit.localeCompare(b.toolkit));
}

/** Where a server runs, for recognising it: the command and its arguments, or the URL's host and path. Never env or headers. */
function targetOf(transport: McpServerTransportConfig): string {
	if (transport.type === "stdio")
		return [transport.command, ...(transport.args ?? [])].join(" ").trim();
	try {
		const url = new URL(transport.url);
		return `${url.host}${url.pathname}`;
	} catch {
		return "";
	}
}

function parseMcp(settings: McpSettingsFile | undefined): McpServer[] {
	return Object.entries(settings?.mcpServers ?? {})
		.map(([name, entry]) => ({
			name,
			transport: entry.transport.type,
			disabled: entry.disabled === true,
			target: targetOf(entry.transport),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseChannels(reply: unknown): string[] {
	if (!isRecord(reply) || !Array.isArray(reply.configured)) return [];
	const types = new Set<string>();
	for (const entry of reply.configured)
		if (isRecord(entry) && typeof entry.type === "string")
			types.add(entry.type);
	return [...types].sort();
}

/**
 * Each store read independently. A store that is not there has nothing
 * connected; one that fails to read, such as MCP settings caught mid-edit,
 * keeps what `previous` read of it, so a connection is never dropped for a
 * read that did not happen.
 */
export async function readClineConnections(
	loaders: ConnectionLoaders,
	previous?: ClineConnections,
): Promise<ClineConnections> {
	const orPrevious =
		<T>(kept: T[] | undefined) =>
		(error: unknown): T[] =>
			errorCode(error) === "ENOENT" ? [] : (kept ?? []);
	const [composio, mcp, channels] = await Promise.all([
		loaders.composio().then(parseComposio, orPrevious(previous?.composio)),
		loaders.mcp().then(parseMcp, orPrevious(previous?.mcp)),
		loaders.channels().then(parseChannels, orPrevious(previous?.channels)),
	]);
	return { composio, mcp, channels };
}

/** The host's `@cline/core`: before 0.0.93 it exported the Composio state resolver as `resolveComposioToolsStatePath`. */
type HostCore = Omit<
	typeof import("@cline/core"),
	"resolveComposioConnectionStatePath"
> & {
	resolveComposioConnectionStatePath?: (accountId: string) => string;
	resolveComposioToolsStatePath?: (accountId: string) => string;
};

/**
 * The real stores. `@cline/core` is imported on first use. The Composio file
 * belongs to the signed-in Cline account; with no account there is none.
 */
export function clineConnectionLoaders(
	hub?: Pick<HubLink, "command">,
	loadCore: () => Promise<HostCore> = () => import("@cline/core"),
): ConnectionLoaders {
	return {
		async composio() {
			const core = await loadCore();
			const accountId = new core.ProviderSettingsManager()
				.getProviderSettings("cline")
				?.auth?.accountId?.trim();
			if (!accountId) return undefined;
			const statePath =
				core.resolveComposioConnectionStatePath ??
				core.resolveComposioToolsStatePath;
			if (!statePath) return undefined;
			return JSON.parse(readFileSync(statePath(accountId), "utf8")) as unknown;
		},
		async mcp() {
			const core = await loadCore();
			return core.loadMcpSettingsFile();
		},
		async channels() {
			return hub ? hub.command("connector.channels") : undefined;
		},
	};
}
