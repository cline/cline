#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	ensureDetachedHubServer,
	HubSessionClient,
	NodeHubClient,
	ProviderSettingsManager,
} from "@cline/core";
import { HUB_CLIENT_TOOL_APPROVAL_CAPABILITY } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { DeviceBridge, type HubPort } from "./bridge";
import { advertise, lanIPv4Addresses } from "./mdns";
import { DeviceRegistry } from "./pairing";
import { startDeviceServer } from "./server";
import { ensureSelfSignedCert } from "./tls";
import { createVoiceTranscriber } from "./transcribe";

export const DEFAULT_DEVICE_PORT = 25470;
export const DEFAULT_WEB_PORT = 25471;
const CLIENT_TYPE = "cline-pet-bridge";
const SEND_ACCEPT_MS = 1_500;

const { values } = parseArgs({
	options: {
		port: { type: "string", default: process.env.CLINE_PET_PORT },
		host: { type: "string", default: process.env.CLINE_PET_HOST ?? "0.0.0.0" },
		workspace: { type: "string", default: process.env.CLINE_PET_WORKSPACE },
		pair: { type: "boolean", default: false },
		"list-devices": { type: "boolean", default: false },
		revoke: { type: "string" },
		"no-mdns": { type: "boolean", default: false },
		"web-port": { type: "string", default: process.env.CLINE_PET_WEB_PORT },
		"no-web": { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(`cline-device-bridge — LAN bridge for the Cline Pet e-ink companion

  --pair              print a one-time pairing code (valid 5 min)
  --port <n>          device WebSocket port (default ${DEFAULT_DEVICE_PORT})
  --host <addr>       bind address (default 0.0.0.0)
  --workspace <dir>   pin the workspace for voice prompts that start a new task
                      (default: the workspace you last used Cline in)
  --list-devices      list paired devices
  --revoke <name>     unpair a device
  --no-mdns           don't advertise _clinepet._tcp on the LAN
  --web-port <n>      HTTPS port for the browser pet (default ${DEFAULT_WEB_PORT})
  --no-web            don't serve the browser pet`);
	process.exit(0);
}

const registry = new DeviceRegistry(
	join(resolveClineDataDir(), "device-bridge", "devices.json"),
);

if (values["list-devices"]) {
	for (const d of registry.list()) {
		console.log(
			`${d.name}\tpaired ${d.pairedAt}\tlast seen ${d.lastSeenAt ?? "never"}`,
		);
	}
	process.exit(0);
}
if (values.revoke) {
	console.log(
		registry.revoke(values.revoke)
			? `revoked ${values.revoke}`
			: "no such device",
	);
	process.exit(0);
}

// Voice prompts that start a new task run in, in order of preference:
// --workspace, the workspace of the most recent session seen on the hub,
// or the most recent session in the hub's history at startup.
const pinnedWorkspace = values.workspace
	? resolve(values.workspace)
	: undefined;
let historyWorkspace: string | undefined;
// Only client metadata for the hub connection; not where tasks run.
const workspaceRoot = pinnedWorkspace ?? homedir();
const port = Number(values.port ?? DEFAULT_DEVICE_PORT);
const log = (message: string) => console.log(`[cline-pet] ${message}`);

const { url, authToken } = await ensureDetachedHubServer(workspaceRoot);
const identity = {
	url,
	authToken,
	workspaceRoot,
	cwd: workspaceRoot,
	displayName: "Cline Pet",
};

// Raw client: receives every hub event and advertises approval capability so
// sessions stay interactive (approvals get routed to us) while a pet is around.
const events = new NodeHubClient({
	...identity,
	clientType: CLIENT_TYPE,
	capabilities: [{ name: HUB_CLIENT_TOOL_APPROVAL_CAPABILITY }],
});
const sessions = new HubSessionClient({
	address: url,
	authToken,
	clientType: `${CLIENT_TYPE}-commands`,
	displayName: "Cline Pet commands",
	workspaceRoot,
	cwd: workspaceRoot,
});
const providers = new ProviderSettingsManager();

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

const connectionListeners = new Set<(online: boolean) => void>();
let online = false;
const pollConnection = () => {
	const now = events.isConnected();
	if (now !== online) {
		online = now;
		log(online ? `hub connected (${url})` : "hub unreachable");
		for (const l of connectionListeners) l(online);
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
	const pending = sessions.sendRuntimeSession(
		sessionId,
		{
			prompt,
			...(delivery ? { delivery } : {}),
			config: { mode: "act" },
		} as Parameters<HubSessionClient["sendRuntimeSession"]>[1],
		{ timeoutMs: null },
	);
	pending.catch((e) => log(`send to ${sessionId} failed: ${e}`));
	await Promise.race([pending, Bun.sleep(SEND_ACCEPT_MS)]);
}

const hub: HubPort = {
	subscribe: (listener) => events.subscribe(listener),
	onConnectionChange(listener) {
		connectionListeners.add(listener);
		return () => connectionListeners.delete(listener);
	},
	respondApproval: (approvalId, approved) =>
		sessions.respondToolApproval({
			approvalId,
			approved,
			reason: approved ? undefined : "Denied from Cline Pet",
			responderClientId: events.getClientId(),
		}),
	abort: async (sessionId) => {
		await sessions.abortRuntimeSession(sessionId);
	},
	sendFollowup: (sessionId, prompt) => sendInput(sessionId, prompt, "queue"),
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
			mode: "act",
			enableTools: true,
			source: CLIENT_TYPE,
			interactive: true,
		} as Parameters<HubSessionClient["startRuntimeSession"]>[0]);
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

await events.connect().catch((e) => log(`initial hub connect failed: ${e}`));
historyWorkspace = await latestSessionWorkspace().catch(() => undefined);
log(
	`voice tasks start in: ${pinnedWorkspace ?? `your most recent Cline workspace${historyWorkspace ? ` (now ${historyWorkspace})` : " (none yet)"}`}`,
);
pollConnection();
const pollTimer = setInterval(pollConnection, 2_000);

const serveWeb = !values["no-web"];
const server = startDeviceServer({
	bridge,
	port,
	hostname: values.host,
	web: serveWeb,
});
const boundPort = server.port ?? port;
const lanIp = lanIPv4Addresses()[0] ?? values.host;
log(`device endpoint ws://${lanIp}:${boundPort}/device`);

// Browser pet over HTTPS: phones only allow the mic on secure origins.
let webServer: ReturnType<typeof startDeviceServer> | undefined;
if (serveWeb) {
	try {
		const tls = ensureSelfSignedCert(
			join(resolveClineDataDir(), "device-bridge", "tls"),
			lanIPv4Addresses(),
		);
		webServer = startDeviceServer({
			bridge,
			port: Number(values["web-port"] ?? DEFAULT_WEB_PORT),
			hostname: values.host,
			tls: { cert: tls.cert, key: tls.key },
			web: true,
		});
		log(
			`browser pet: https://${lanIp}:${webServer.port}/  (self-signed: accept the warning once${tls.fresh ? "; new certificate" : ""})`,
		);
	} catch (error) {
		log(`browser pet over HTTPS unavailable: ${error}`);
		log(`browser pet (no mic): http://${lanIp}:${boundPort}/`);
	}
}

const mdns = values["no-mdns"]
	? undefined
	: advertise({
			instance: "Cline Pet Bridge",
			port: boundPort,
			txt: { v: "1", path: "/device" },
		});

if (values.pair || registry.list().length === 0) {
	const { code } = registry.issueCode();
	log(
		`pairing code: ${code}  (enter it in the pet's setup page; valid 5 minutes)`,
	);
}

const shutdown = async () => {
	clearInterval(pollTimer);
	mdns?.stop();
	bridge.dispose();
	server.stop(true);
	webServer?.stop(true);
	await Promise.allSettled([events.dispose(), sessions.dispose()]);
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
