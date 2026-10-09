import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { HubCommandName } from "@cline/shared";
import {
	HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
	type HubEventEnvelope,
} from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import type { NativeHubTransport } from "../server/native-transport";
import { DeviceBridge, type HubPort } from "./bridge";
import { createDeviceCloudSessions } from "./cloud";
import { advertise, lanIPv4Addresses } from "./mdns";
import { DeviceRegistry } from "./pairing";
import { startDeviceServer } from "./server";
import type { DeviceServiceStatus } from "./status";
import { ensureSelfSignedCert } from "./tls";
import { createVoiceTranscriber } from "./transcribe";

export { type DeviceServiceStatus, parseDeviceServiceStatus } from "./status";
export const DEFAULT_DEVICE_PORT = 25470;
export const DEFAULT_WEB_PORT = 25471;
const CLIENT_TYPE = "cline-device";
const SEND_ACCEPT_MS = 1_500;

export interface StartDeviceServiceOptions {
	transport: NativeHubTransport;
	hubUrl: string;
	changed?: () => void;
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
export interface DeviceServiceRuntime {
	status(): DeviceServiceStatus;
	pair(): void;
	pairingCode(): { code: string; expiresAt: number } | undefined;
	stop(): Promise<void>;
}

export async function startDeviceService(
	options: StartDeviceServiceOptions,
): Promise<DeviceServiceRuntime> {
	const dataDir = options.dataDir ?? resolveClineDataDir();
	const registry =
		options.registry ??
		new DeviceRegistry(join(dataDir, "devices", "devices.json"));
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

	const url = options.hubUrl;
	const clientId = `device-service-${randomUUID()}`;
	async function command(
		command: HubCommandName,
		payload: Record<string, unknown> = {},
		sessionId?: string,
	) {
		const reply = await options.transport.handleCommand(
			{
				version: "v1",
				command,
				clientId,
				requestId: randomUUID(),
				payload,
				sessionId,
			},
			{
				clientId,
				workspaceContext: {
					workspaceRoot:
						typeof payload.workspaceRoot === "string"
							? payload.workspaceRoot
							: workspaceRoot,
					cwd: typeof payload.cwd === "string" ? payload.cwd : workspaceRoot,
				},
			},
		);
		if (!reply.ok)
			throw new Error(
				reply.error?.message ?? `Device command failed: ${command}`,
			);
		return reply;
	}
	await command("client.register", {
		clientId,
		clientType: CLIENT_TYPE,
		displayName: "Cline Devices",
		workspaceRoot,
		cwd: workspaceRoot,
		capabilities: [{ name: HUB_CLIENT_TOOL_APPROVAL_CAPABILITY }],
	});
	const providers = options.providers ?? new ProviderSettingsManager();
	const cloud = createDeviceCloudSessions(log);

	/** Workspace of the most recently updated session in the hub's history. */
	async function latestSessionWorkspace(): Promise<string | undefined> {
		const reply = await command("session.list", { limit: 50 });
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
		const reply = await command("session.list", {
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
	let online = true;

	/**
	 * session.send_input can stay pending for the whole turn; treat "no error
	 * within a moment" as accepted and log anything that fails later.
	 */
	async function sendInput(
		sessionId: string,
		prompt: string,
		delivery?: "queue",
	): Promise<void> {
		const pending = command(
			"session.send_input",
			{ prompt, ...(delivery ? { delivery } : {}) },
			sessionId,
		);
		pending.catch((e) => log(`send to ${sessionId} failed: ${e}`));
		await Promise.race([pending, delay(SEND_ACCEPT_MS)]);
	}

	const hub: HubPort = {
		subscribe: (listener) => {
			sessionListeners.add(listener);
			const local = options.transport.subscribe(clientId, listener);
			const remote = cloud.subscribe(listener);
			return () => {
				sessionListeners.delete(listener);
				local();
				remote();
			};
		},
		onConnectionChange(listener) {
			connectionListeners.add(listener);
			queueMicrotask(() => {
				if (connectionListeners.has(listener)) listener(online);
			});
			return () => connectionListeners.delete(listener);
		},
		respondApproval: async (approvalId, approved) => {
			if (cloud.hasApproval(approvalId))
				await cloud.respondApproval(approvalId, approved);
			else
				await command("approval.respond", {
					approvalId,
					approved,
					responderClientId: clientId,
				});
		},
		abort: async (sessionId) => {
			if (cloud.owns(sessionId)) await cloud.abort(sessionId);
			else await command("run.abort", { sessionId }, sessionId);
		},
		sendFollowup: (sessionId, prompt) =>
			cloud.owns(sessionId)
				? cloud.send(sessionId, prompt, "queue")
				: sendInput(sessionId, prompt, "queue"),
		startCloudTask: async (prompt, recentWorkspace) => {
			const workspace = pinnedWorkspace ?? recentWorkspace ?? historyWorkspace;
			if (!workspace)
				throw new Error(
					"Run a Cline task once, or configure a device workspace",
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
					"No workspace yet: run a Cline task once, or configure a device workspace",
				);
			}
			const settings = providers.getLastUsedProviderSettings();
			if (!settings?.model) {
				throw new Error("No provider configured; run `cline auth` first");
			}
			const reply = await command("session.create", {
				workspaceRoot: workspace,
				cwd: workspace,
				sessionConfig: {
					providerId: settings.provider,
					modelId: settings.model,
					cwd: workspace,
					workspaceRoot: workspace,
					mode: "yolo",
					enableTools: true,
				},
				metadata: {
					source: CLIENT_TYPE,
					provider: settings.provider,
					model: settings.model,
					interactive: true,
				},
				runtimeOptions: {
					mode: "yolo",
					autoApproveTools: true,
					enableTools: true,
				},
				modelSelection: { provider: settings.provider, model: settings.model },
			});
			const record = (reply.payload?.session ?? reply.payload) as
				| Record<string, unknown>
				| undefined;
			const sessionId = record?.sessionId;
			if (typeof sessionId !== "string")
				throw new Error("Hub returned no session ID");
			// A fresh, idle session takes the prompt directly; "queue" here would
			// both run it and leave it queued, running the prompt twice.
			await sendInput(sessionId, prompt);
			log(`started voice task ${sessionId} in ${workspace}`);
			return sessionId;
		},
	};

	const bridge = new DeviceBridge({
		devicesChanged: options.changed,
		hub,
		registry,
		log,
		transcribe: createVoiceTranscriber(providers, log),
	});

	let server: Awaited<ReturnType<typeof startDeviceServer>> | undefined;
	let webServer: Awaited<ReturnType<typeof startDeviceServer>> | undefined;
	let mdns: ReturnType<typeof advertise> | undefined;
	let stopPromise: Promise<void> | undefined;
	const stop = () =>
		(stopPromise ??= (async () => {
			online = false;
			for (const listener of connectionListeners) listener(false);
			mdns?.stop();
			bridge.dispose();
			await Promise.allSettled([
				server?.stop(),
				webServer?.stop(),
				command("client.unregister", { clientId }),
				cloud.dispose(),
			]);
		})());
	function pair(): void {
		const { code } = registry.issueCode();
		log(
			`pairing code: ${code}  (enter it in the device's setup page; valid 5 minutes)`,
		);
	}
	function status(): DeviceServiceStatus {
		const ip =
			options.host && options.host !== "0.0.0.0"
				? options.host
				: (lanIPv4Addresses()[0] ?? "127.0.0.1");
		return {
			service: "cline-device-service",
			hubUrl: url,
			hubConnected: online,
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
		historyWorkspace = await latestSessionWorkspace().catch(() => undefined);
		log(
			`voice tasks start in: ${pinnedWorkspace ?? `your most recent Cline workspace${historyWorkspace ? ` (now ${historyWorkspace})` : " (none yet)"}`}`,
		);
		await syncRunningSessions();

		const serveWeb = options.web !== false;
		server = await startDeviceServer({
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
					join(dataDir, "devices", "tls"),
					lanIPv4Addresses(),
				);
				webServer = await startDeviceServer({
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
