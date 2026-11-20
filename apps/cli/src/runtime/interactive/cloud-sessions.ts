import { NodeHubClient } from "@cline/core";
import { HubCloudSessionClient } from "@cline/core/cloud";
import { ensureCliHubServer } from "../../utils/hub-runtime";

/** Cloud sessions are experimental; `CLINE_CLOUD_SESSIONS=1` opts in. */
export function isCloudSessionsEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const value = env.CLINE_CLOUD_SESSIONS?.trim().toLowerCase();
	return value === "1" || value === "true";
}

/** A viewer of the shared Hub's cloud sessions; the Hub owns the cloud work. */
export function createCliCloudSessions(workspaceRoot: string): {
	client: HubCloudSessionClient;
	dispose: () => Promise<void>;
} {
	let hub: NodeHubClient | undefined;
	const client = new HubCloudSessionClient(async () => {
		if (hub) return hub;
		// No pinned token: the client re-resolves the managed Hub's token on
		// reconnect, so a restarted Hub (with a new token) is picked up.
		const { url } = await ensureCliHubServer(workspaceRoot);
		const next = new NodeHubClient({
			url,
			clientType: "cli-cloud",
			displayName: "Cline CLI cloud sessions",
			workspaceRoot,
			cwd: workspaceRoot,
		});
		try {
			await next.connect();
		} catch (error) {
			next.close();
			throw error;
		}
		hub = next;
		return next;
	});
	return {
		client,
		dispose: async () => {
			await client.dispose();
			hub?.close();
		},
	};
}
