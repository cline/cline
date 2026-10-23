import { hostname } from "node:os";
import { readHubDiscovery } from "@cline/core";
import {
	loadOrCreateHubIdentity,
	openDeviceRegistry,
} from "@cline/core/hub/pairing";
import { cleanMachineName } from "./handoff";
import { startPersistentRelayHost } from "./handoff-relay";
import { resolveCliHubOwnerContext } from "./hub";
import {
	clearRemoteHostStatus,
	readRemoteHostConfig,
	writeRemoteHostStatus,
} from "./remote-host-lifecycle";

/** Entrypoint for the detached outbound-only remote-access companion. */
export async function runRemoteHostDaemon(): Promise<void> {
	const config = await readRemoteHostConfig();
	if (config?.enabled !== true) return;
	const discovery = await readHubDiscovery(
		resolveCliHubOwnerContext().discoveryPath,
	);
	if (!discovery?.url || !discovery.authToken) {
		throw new Error("The local Cline Hub is not running or has no auth token.");
	}
	const machineName = config.machineName || cleanMachineName(hostname());
	const host = await startPersistentRelayHost({
		identity: await loadOrCreateHubIdentity(),
		registry: await openDeviceRegistry(),
		hubUrl: discovery.url,
		hubAuthToken: discovery.authToken,
		machineName,
	});
	await writeRemoteHostStatus({
		pid: process.pid,
		startedAt: new Date().toISOString(),
		machineName,
	});

	await new Promise<void>((resolve) => {
		let closing = false;
		const close = () => {
			if (closing) return;
			closing = true;
			void host.close().finally(resolve);
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	});
	await clearRemoteHostStatus();
}
