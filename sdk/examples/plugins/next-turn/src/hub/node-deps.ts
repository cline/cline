import { HUB_COMMAND_TIMEOUT_MS, HUB_CONNECTION_POLL_MS } from "../config";
import {
	HubCommandFailed,
	type HubLinkDeps,
	HubLinkUnavailable,
	type HubResolvedEndpoint,
} from "./link";

/** The link's client type, as the hub's client list shows it. */
const HUB_CLIENT_TYPE = "next-turn-engine";

async function resolveDiscoveredHubEndpoint(): Promise<
	HubResolvedEndpoint | undefined
> {
	const [hub, shared] = await Promise.all([
		import("@cline/core/hub"),
		import("@cline/shared"),
	]);
	const owner =
		shared.resolveClineBuildEnv() === "production"
			? hub.resolveProductionHubOwnerContext()
			: hub.resolveSharedHubOwnerContext();
	const record = await hub.readHubDiscovery(owner.discoveryPath);
	if (!record?.url) return undefined;
	const probed = await hub.probeHubServer(record.url, {
		authToken: record.authToken,
	});
	if (!probed) return undefined;
	const compatibility = shared.isHubProtocolCompatible(probed);
	if (!compatibility.compatible) return undefined;
	return { url: probed.url || record.url, authToken: record.authToken };
}

/**
 * The real link: reads the owner's discovery record and checks protocol
 * compatibility directly (`readHubDiscovery` + `probeHubServer`, never calling
 * `rememberRecoverableLocalHubUrl`, `ensureCompatibleLocalHubUrl` or
 * `clearHubDiscovery`), and passes `authToken` to `NodeHubClient`.
 */
export function nodeHubLinkDeps(): HubLinkDeps {
	return {
		resolveEndpoint: resolveDiscoveredHubEndpoint,
		createClient({ url, authToken }, scope) {
			let client: import("@cline/core/hub").NodeHubClient | undefined;
			const statusListeners = new Set<(connected: boolean) => void>();
			let pollTimer: ReturnType<typeof setInterval> | undefined;
			let lastConnected = false;
			const report = (connected: boolean) => {
				if (connected === lastConnected) return;
				lastConnected = connected;
				for (const listener of statusListeners) listener(connected);
			};

			const ready = import("@cline/core/hub").then((hub) => {
				client = new hub.NodeHubClient({
					url,
					authToken,
					clientType: HUB_CLIENT_TYPE,
					displayName: "Next Turn",
					workspaceRoot: scope.workspaceRoot,
					cwd: scope.cwd,
				});
				return { hub, target: client };
			});

			return {
				async connect() {
					const { target } = await ready;
					await target.connect();
					lastConnected = target.isConnected();
					pollTimer = setInterval(
						() => report(target.isConnected()),
						HUB_CONNECTION_POLL_MS,
					);
					pollTimer.unref?.();
				},
				isConnected() {
					return client?.isConnected() ?? false;
				},
				onStatus(listener) {
					statusListeners.add(listener);
					return () => statusListeners.delete(listener);
				},
				subscribe(listener) {
					if (!client)
						throw new HubLinkUnavailable("hub client is not connected");
					return client.subscribe(listener);
				},
				async command(name, payload) {
					const { hub, target } = await ready;
					try {
						const reply = await target.command(name, payload, undefined, {
							timeoutMs: HUB_COMMAND_TIMEOUT_MS,
						});
						return reply.payload ?? {};
					} catch (error) {
						if (error instanceof hub.HubCommandError)
							throw new HubCommandFailed(name, error.code, error.message);
						if (lastConnected && !target.isConnected()) report(false);
						throw error;
					}
				},
				async dispose() {
					if (pollTimer) clearInterval(pollTimer);
					pollTimer = undefined;
					statusListeners.clear();
					await (await ready.catch(() => undefined))?.target.dispose();
				},
			};
		},
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
}
