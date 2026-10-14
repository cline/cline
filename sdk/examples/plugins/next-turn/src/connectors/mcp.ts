import type { PinnedRead } from "../settings/settings";
import type { McpServer } from "./cline-connections";
import type { Access, Route } from "./connector";
import { PinnedReadConnector, type ToolRunner } from "./pinned";

/**
 * MCP servers in Cline's settings. Mention: the server's tools are
 * the agent's already. Read: the person's pinned reads, run through Cline's
 * own MCP client with the server's stored configuration and OAuth state. A
 * stdio server starts only for the read, so Read on it costs a process start
 * each time; the settings row says so.
 */

export function mcpRoute(server: McpServer): Route {
	const how =
		server.transport === "stdio" ? "stdio; each read starts it" : "HTTP";
	return {
		id: `mcp:${server.name}`,
		label: `MCP server "${server.name}" (${how})`,
		mention: true,
		read: true,
	};
}

export function mcpConnector(
	server: McpServer,
	deps: {
		enabled: () => boolean | undefined;
		access: () => Access;
		reads: () => readonly PinnedRead[];
		runner: () => Promise<ToolRunner | { reason: string }>;
		now?: () => number;
	},
): PinnedReadConnector {
	return new PinnedReadConnector({
		id: `mcp:${server.name}`,
		kind: "mcp",
		label: `MCP server "${server.name}"`,
		route: mcpRoute(server),
		runner: deps.runner,
		reads: deps.reads,
		access: deps.access,
		present: () => {
			const enabled = deps.enabled();
			if (enabled === undefined) return "unknown";
			return enabled && deps.access().role !== "off" ? "present" : "absent";
		},
		now: deps.now,
	});
}
