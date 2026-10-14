import type { ClineConnections } from "./cline-connections";
import { composioConnectorId, type Route } from "./connector";
import { PinnedReadConnector, type PinnedReadDeps } from "./pinned";

/**
 * Composio toolkits on the Cline account, other than GitHub, which the GitHub
 * connector covers. The agent reaches them through Cline's Composio tools, so
 * Mention works: a suggestion may ask the agent to use Linear. Read needs
 * Cline to expose per-tool execution to plugins; until it does, Read says so.
 */

export const GITHUB_TOOLKIT = "github";

export const COMPOSIO_READ_UNAVAILABLE =
	"Reading through Composio needs a Cline update that exposes its connector tools to plugins";

export const COMPOSIO_ROUTE: Route = {
	id: "composio",
	label: "Composio, through your Cline account",
	read: { reason: COMPOSIO_READ_UNAVAILABLE },
};

export function composioToolkits(connections: ClineConnections): string[] {
	return connections.composio
		.filter((entry) => entry.connected && entry.toolkit !== GITHUB_TOOLKIT)
		.map((entry) => entry.toolkit);
}

export function composioConnector(
	toolkit: string,
	deps: Omit<PinnedReadDeps, "runner">,
): PinnedReadConnector {
	return new PinnedReadConnector({
		...deps,
		id: composioConnectorId(toolkit),
		label: toolkit,
		namespace: toolkit,
		route: COMPOSIO_ROUTE,
		runner: async () => ({ reason: COMPOSIO_READ_UNAVAILABLE }),
	});
}
