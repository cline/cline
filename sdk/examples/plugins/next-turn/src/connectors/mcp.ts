import type { McpServer } from "./cline-connections";
import { mcpConnectorId, type Route } from "./connector";
import { PinnedReadConnector, type PinnedReadDeps } from "./pinned";

/**
 * MCP servers in Cline's settings. Mention: the server's tools are
 * the agent's already. Read: the person's pinned reads, run through Cline's
 * own MCP client with the server's stored configuration and OAuth state. A
 * stdio server starts only for the read, so Read on it costs a process start
 * each time.
 */

export function mcpServerLabel(serverName: string): string {
	return `MCP server "${serverName}"`;
}

export function mcpRoute(server: McpServer): Pick<Route, "id" | "label"> {
	const how =
		server.transport === "stdio" ? "stdio; each read starts it" : "HTTP";
	return {
		id: mcpConnectorId(server.name),
		label: `${mcpServerLabel(server.name)} (${how})`,
	};
}

export function mcpConnector(
	server: McpServer,
	deps: PinnedReadDeps,
): PinnedReadConnector {
	return new PinnedReadConnector({
		...deps,
		id: mcpConnectorId(server.name),
		label: mcpServerLabel(server.name),
		route: mcpRoute(server),
	});
}
