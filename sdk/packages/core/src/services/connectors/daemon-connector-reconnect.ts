import { readStartingConnectorInstance } from "@cline/shared";
import {
	type ReconnectAttempt,
	reconnectPersistedConnectors,
} from "./connector-autostart";
import type { ConnectorSupervisor } from "./connector-supervisor";
import { getActiveConnectorSupervisor } from "./connector-supervisor";

/**
 * Bring persisted connectors back under the new hub's supervision.
 *
 * Called once per daemon boot, after the supervisor has adopted whatever
 * survived the previous hub. Survivors still have to be *restarted* rather than
 * left running: their hub client authenticated against the old hub's token and
 * cannot re-authenticate against this one, so the process has to come back to
 * attach to the new session.
 *
 * Spawning itself belongs to the supervisor, which is the single authority on
 * how many processes may hold one connector's credentials.
 */
export async function reconnectDaemonConnectors(
	log: (message: string) => void = (message) =>
		process.stderr.write(`[hub-daemon] ${message}\n`),
	supervisor: ConnectorSupervisor | undefined = getActiveConnectorSupervisor(),
): Promise<ReconnectAttempt[]> {
	if (!supervisor) {
		log(
			"[connect] cannot reconnect connectors: no connector supervisor is active",
		);
		return [];
	}
	const supervisedBefore = new Set(
		supervisor
			.list()
			.map((record) => `${record.channel}\0${record.instanceId}`),
	);
	// The connector that spawned this daemon is mid-startup and attaches itself.
	// Starting it here would put a second process on the same credentials, and
	// for socket-mode adapters both would hold a live connection and split
	// incoming events between them.
	const startingInstance = readStartingConnectorInstance();

	return await reconnectPersistedConnectors({
		isHealthy: ({ channel, instanceId }) =>
			startingInstance?.channel === channel &&
			startingInstance.instanceId === instanceId,
		start: async ({ channel, instanceId, args }) => {
			const survived = supervisedBefore.has(`${channel}\0${instanceId}`);
			if (survived) {
				log(
					`[connect] restarting surviving ${channel} connector ${instanceId} for the new hub session`,
				);
			}
			const result = await supervisor.start({
				channel,
				instanceId,
				args,
				restart: survived,
			});
			if (!result.started && result.reason === "already_running") {
				log(
					`[connect] ${channel} connector ${instanceId} is already running under this hub`,
				);
			}
			return result.started;
		},
		log,
	});
}
