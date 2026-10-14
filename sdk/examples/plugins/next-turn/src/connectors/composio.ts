import type { PinnedRead } from "../settings/settings";
import type { ClineConnections } from "./cline-connections";
import type { Access, Route } from "./connector";
import { PinnedReadConnector, type ToolRunner } from "./pinned";

/**
 * Composio toolkits on the Cline account, other than GitHub, which
 * the GitHub connector covers. Their tools are already in the agent's list,
 * so Mention works today: a suggestion may ask the agent to use Linear.
 * Read runs the person's pinned reads through Cline's own Composio tools once
 * upstream exports them (U4).
 */

export const COMPOSIO_ROUTE: Route = {
	id: "composio",
	label: "Composio, through your Cline account",
	mention: true,
	read: true,
};

export function composioToolkits(connections: ClineConnections): string[] {
	return connections.composio
		.filter((entry) => entry.connected && entry.toolkit !== "github")
		.map((entry) => entry.toolkit);
}

export function composioConnector(
	toolkit: string,
	deps: {
		connected: () => boolean | undefined;
		access: () => Access;
		reads: () => readonly PinnedRead[];
		runner: () => Promise<ToolRunner | { reason: string }>;
		now?: () => number;
	},
): PinnedReadConnector {
	return new PinnedReadConnector({
		id: `composio:${toolkit}`,
		kind: "composio",
		label: toolkit,
		namespace: toolkit,
		route: COMPOSIO_ROUTE,
		runner: deps.runner,
		reads: deps.reads,
		access: deps.access,
		present: () => {
			const connected = deps.connected();
			if (connected === undefined) return "unknown";
			return connected && deps.access().role !== "off" ? "present" : "absent";
		},
		now: deps.now,
	});
}
