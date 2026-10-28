import { NodeHubClient } from "@cline/core";
import { type CloudModel, HubCloudSessionClient } from "@cline/core/cloud";
import {
	CLINE_DEFAULT_MODEL_ID,
	getClineEnvironmentConfig,
} from "@cline/shared";
import { ensureCliHubServer } from "../../utils/hub-runtime";

export { isCloudSessionsEnabled } from "../../utils/cloud-sessions-enabled";

/**
 * The cloud model for a new message: an explicit pick while the catalog still
 * offers it, then the local Cline/ClinePass model if offered, then ClinePass for
 * ClinePass users, then Cline's default usage-billed model.
 */
export function resolveCloudModel(
	models: readonly CloudModel[],
	preferences: {
		explicitModelId?: string;
		localModelId?: string;
		localProviderId?: string;
	},
): CloudModel | undefined {
	const offered = (id: string | undefined) =>
		id ? models.find((model) => model.id === id) : undefined;
	return (
		offered(preferences.explicitModelId) ??
		(preferences.localProviderId === "cline" ||
		preferences.localProviderId === "cline-pass"
			? offered(preferences.localModelId)
			: undefined) ??
		(preferences.localProviderId === "cline-pass"
			? models.find((model) => model.catalogId === "cline-pass")
			: undefined) ??
		offered(CLINE_DEFAULT_MODEL_ID) ??
		models.find((model) => model.catalogId === "cline") ??
		models[0]
	);
}

export function cloudSessionUrl(sessionId: string): string {
	const appBaseUrl = getClineEnvironmentConfig().appBaseUrl.replace(/\/+$/, "");
	return `${appBaseUrl}/agents?sessionId=${encodeURIComponent(sessionId)}`;
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
