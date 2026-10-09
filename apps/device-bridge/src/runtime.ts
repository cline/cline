import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	ensureDetachedHubServer,
	HubSessionClient,
	NodeHubClient,
	ProviderSettingsManager,
} from "@cline/core";
import {
	HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
	type HubEventEnvelope,
} from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { DeviceBridge, type HubPort } from "./bridge";
import { createDeviceCloudSessions } from "./cloud";
import { advertise, lanIPv4Addresses } from "./mdns";
import { DeviceRegistry } from "./pairing";
import { startDeviceServer } from "./server";
import { ensureSelfSignedCert } from "./tls";
import { createVoiceTranscriber } from "./transcribe";
import type { DeviceBridgeStatus } from "./status";
export { type DeviceBridgeStatus, parseDeviceBridgeStatus } from "./status";
export const DEFAULT_DEVICE_PORT = 25470;
export const DEFAULT_WEB_PORT = 25471;
const CLIENT_TYPE = "cline-device-bridge";
const SEND_ACCEPT_MS = 1_500;

export interface StartDeviceBridgeOptions {
	hub?: { url: string; authToken: string };
	workspace?: string;
	host?: string;
	port?: number;
	webPort?: number;
	web?: boolean;
	webRoot?: string;
	mdns?: boolean;
	pair?: boolean;
	registry?: DeviceRegistry;
	dataDir?: string;
	providers?: ProviderSettingsManager;
	log?: (message: string) => void;
}
export interface DeviceBridgeRuntime {
	status(): DeviceBridgeStatus;
	pair(): void;
	pairingCode(): { code: string; expiresAt: number } | undefined;
	stop(): Promise<void>;
}

export async function startDeviceBridge(
	options: StartDeviceBridgeOptions = {},
): Promise<DeviceBridgeRuntime> {
	const dataDir = options.dataDir ?? resolveClineDataDir();
	const registry =
		options.registry ??
		new DeviceRegistry(join(dataDir, "device-bridge", "devices.json"));
	// Voice prompts that start a new task run in, in order of preference:
	// --workspace, the workspace of the most recent session seen on the hub,
	// or the most recent session in the hub's history at startup.
	const pinnedWorkspace = options.workspace
		? resolve(options.workspace)
		: undefined;
	let historyWorkspace: string | undefined;
	// Only client metadata for the hub connection; not where tasks run.
	const workspaceRoot = pinnedWorkspace ?? homedir();
	const port = options.port ?? DEFAULT_DEVICE_PORT;
	const log =
		options.log ??
		((message: string) => console.log(`[cline-device] ${message}`));

	const { url, authToken } =
		options.hub ?? (await ensureDetachedHubServer(workspaceRoot));
	const identity = {
		url,
		authToken,
		workspaceRoot,
		cwd: workspaceRoot,
		displayName: "Cline Device",
	};

	// Raw client: receives every hub event and advertises approval capability so
	// sessions stay interactive (approvals get routed to us) while a device is around.
	const events = new NodeHubClient({
		...identity,
		clientType: CLIENT_TYPE,
		capabilities: [{ name: HUB_CLIENT_TOOL_APPROVAL_CAPABILITY }],
	});
	const sessions = new HubSessionClient({
		address: url,
		authToken,
		clientType: `${CLIENT_TYPE}-commands`,
		displayName: "Cline Device commands",
		workspaceRoot,
		cwd: workspaceRoot,
	});
	const providers = options.providers ?? new ProviderSettingsManager();
	const cloud = createDeviceCloudSessions(log);

	/** Workspace of the most recently updated session in the hub's history. */
	async function latestSessionWorkspace(): Promise<string | undefined> {
		const reply = await events.command("session.list", { limit: 50 });
		const rows = Array.isArray(reply.payload?.sessions)
			? (reply.payload.sessions as Array<Record<string, unknown>>)
			: [];
		let best: { path: string; at: number } | undefined;
		for (const row of rows) {
			const record = (row.session ?? row) as Record<string, unknown>;
			const path = record.cwd ?? record.workspaceRoot;
			const at = Number(record.updatedAt ?? record.createdAt ?? 0);
			if (typeof path === "string" && path && (!best || at > best.at)) {
				best = { path, at };
			}
		}
		return best?.path;
	}

	const sessionListeners = new Set<(event: HubEventEnvelope) => void>();
	async function syncRunningSessions() {
		const reply = await events.command("session.list", {
			limit: 1000,
			rootOnly: true,
		});
		const rows = Array.isArray(reply.payload?.sessions)
			? reply.payload.sessions
			: [];
		if (!online) return;
		for (const row of rows) {
			const record = (row.session ?? row) as Record<string, unknown>;
			const sessionId = record.sessionId;
			if (typeof sessionId !== "string" || record.status !== "running")
				continue;
			for (const listener of sessionListeners)
				listener({
					version: "v1",
					event: "session.updated",
					sessionId,
					payload: { session: record },
				} as HubEventEnvelope);
		}
	}

	const connectionListeners = new Set<(online: boolean) => void>();
	let online = false;
	const pollConnection = () => {
		const now = events.isConnected();
		if (now !== online) {
			online = now;
			log(online ? `hub connected (${url})` : "hub unreachable");
			for (const l of connectionListeners) l(online);
			if (online)
				void syncRunningSessions().catch((error) =>
					log(`session sync failed: ${error}`),
				);
		}
	};

	/**
	 * session.send_input can stay pending for the whole turn; treat "no error
	 * within a moment" as accepted and log anything that fails later.
	 */
	async function sendInput(
		sessionId: string,
		prompt: string,
		delivery?: "queue",
	): Promise<void> {
		const pending = events.command(
			"session.send_input",
			{ prompt, ...(delivery ? { delivery } : {}) },
			sessionId,
			{ timeoutMs: null },
		);
		pending.catch((e) => log(`send to ${sessionId} failed: ${e}`));
		await Promise.race([pending, Bun.sleep(SEND_ACCEPT_MS)]);
	}

	const hub: HubPort = {
		subscribe: (listener) => {
			sessionListeners.add(listener);
			const local = events.subscribe(listener);
			const remote = cloud.subscribe(listener);
			return () => {
				sessionListeners.delete(listener);
				local();
				remote();
			};
		},
		onConnectionChange(listener) {
			connectionListeners.add(listener);
			return () => connectionListeners.delete(listener);
		},
		respondApproval: (approvalId, approved) =>
			cloud.hasApproval(approvalId)
				? cloud.respondApproval(approvalId, approved)
				: sessions.respondToolApproval({
						approvalId,
						approved,
						reason: approved ? undefined : "Denied from Cline Device",
						responderClientId: events.getClientId(),
					}),
		abort: async (sessionId) => {
			if (cloud.owns(sessionId)) await cloud.abort(sessionId);
			else await sessions.abortRuntimeSession(sessionId);
		},
		sendFollowup: (sessionId, prompt) =>
			cloud.owns(sessionId)
				? cloud.send(sessionId, prompt, "queue")
				: sendInput(sessionId, prompt, "queue"),
		startCloudTask: async (prompt, recentWorkspace) => {
			const workspace = pinnedWorkspace ?? recentWorkspace ?? historyWorkspace;
			if (!workspace)
				throw new Error(
					"Run a Cline task once, or start the bridge with --workspace",
				);
			return cloud.start(
				prompt,
				workspace,
				providers.getProviderSettings("cline")?.model,
			);
		},
		startTask: async (prompt, recentWorkspace) => {
			const workspace = pinnedWorkspace ?? recentWorkspace ?? historyWorkspace;
			if (!workspace) {
				throw new Error(
					"No workspace yet: run a Cline task once, or start the bridge with --workspace",
				);
			}
			const settings = providers.getLastUsedProviderSettings();
			if (!settings?.model) {
				throw new Error("No provider configured; run `cline auth` first");
			}
			const { sessionId } = await sessions.startRuntimeSession({
				workspaceRoot: workspace,
				cwd: workspace,
				provider: settings.provider,
				model: settings.model,
				mode: "yolo",
				autoApproveTools: true,
				enableTools: true,
				source: CLIENT_TYPE,
				interactive: true,
			});
			// A fresh, idle session takes the prompt directly; "queue" here would
			// both run it and leave it queued, running the prompt twice.
			await sendInput(sessionId, prompt);
			log(`started voice task ${sessionId} in ${workspace}`);
			return sessionId;
		},
	};

	const bridge = new DeviceBridge({
		hub,
		registry,
		log,
		transcribe: createVoiceTranscriber(providers, log),
	});

	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let server: ReturnType<typeof startDeviceServer> | undefined;
	let webServer: ReturnType<typeof startDeviceServer> | undefined;
	let mdns: ReturnType<typeof advertise> | undefined;
	let stopPromise: Promise<void> | undefined;
	const stop = () =>
		(stopPromise ??= (async () => {
			clearInterval(pollTimer);
			mdns?.stop();
			bridge.dispose();
			await Promise.allSettled([
				server?.stop(true),
				webServer?.stop(true),
				events.dispose(),
				sessions.dispose(),
				cloud.dispose(),
			]);
		})());
	function pair(): void {
		const { code } = registry.issueCode();
		log(
			`pairing code: ${code}  (enter it in the device's setup page; valid 5 minutes)`,
		);
	}
	function status(): DeviceBridgeStatus {
		const ip =
			options.host && options.host !== "0.0.0.0"
				? options.host
				: (lanIPv4Addresses()[0] ?? "127.0.0.1");
		return {
			service: "cline-device-bridge",
			hubUrl: url,
			hubConnected: events.isConnected(),
			deviceEndpoint: `ws://${ip}:${server?.port ?? port}/device`,
			...(webServer
				? { browserEndpoint: `https://${ip}:${webServer.port}/` }
				: options.web !== false && server
					? { browserEndpoint: `http://${ip}:${server.port}/` }
					: {}),
			devices: bridge.connectedDevices(),
		};
	}
	try {
		await events
			.connect()
			.catch((e) => log(`initial hub connect failed: ${e}`));
		historyWorkspace = await latestSessionWorkspace().catch(() => undefined);
		log(
			`voice tasks start in: ${pinnedWorkspace ?? `your most recent Cline workspace${historyWorkspace ? ` (now ${historyWorkspace})` : " (none yet)"}`}`,
		);
		pollConnection();
		pollTimer = setInterval(pollConnection, 2_000);

		const serveWeb = options.web !== false;
		server = startDeviceServer({
			bridge,
			port,
			hostname: options.host ?? "0.0.0.0",
			web: serveWeb,
			webRoot: options.webRoot,
			status: () => status(),
		});
		const boundPort = server.port ?? port;
		const lanIp = lanIPv4Addresses()[0] ?? "127.0.0.1";
		log(`device endpoint ws://${lanIp}:${boundPort}/device`);

		// Browser device over HTTPS: phones only allow the mic on secure origins.
		if (serveWeb) {
			try {
				const tls = ensureSelfSignedCert(
					join(dataDir, "device-bridge", "tls"),
					lanIPv4Addresses(),
				);
				webServer = startDeviceServer({
					bridge,
					port: options.webPort ?? DEFAULT_WEB_PORT,
					hostname: options.host ?? "0.0.0.0",
					tls: { cert: tls.cert, key: tls.key },
					web: true,
					webRoot: options.webRoot,
					status: () => status(),
				});
				log(
					`browser device: https://${lanIp}:${webServer.port}/  (self-signed: accept the warning once${tls.fresh ? "; new certificate" : ""})`,
				);
			} catch (error) {
				log(`browser device over HTTPS unavailable: ${error}`);
				log(`browser device (no mic): http://${lanIp}:${boundPort}/`);
			}
		}

		mdns =
			options.mdns === false
				? undefined
				: advertise({
						instance: "Cline Device Bridge",
						port: boundPort,
						txt: { v: "1", path: "/device" },
					});

		if (options.pair || registry.list().length === 0) pair();

		return { status, stop, pair, pairingCode: () => registry.pairingCode() };
	} catch (error) {
		await stop();
		throw error;
	}
}
