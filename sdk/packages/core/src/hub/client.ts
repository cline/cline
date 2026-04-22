import { spawn } from "node:child_process";
import { basename } from "node:path";
import {
	augmentNodeCommandForDebug,
	createSessionId,
	type HubClientRegistration,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	type HubTransportFrame,
	withResolvedClineBuildEnv,
} from "@clinebot/shared";
import {
	type HubOwnerContext,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
} from "./discovery";
import { resolveSharedHubOwnerContext } from "./workspace";

type PendingReply = {
	resolve: (reply: HubReplyEnvelope) => void;
	reject: (error: unknown) => void;
};

type WebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

type WebSocketCtor = new (
	url: string,
	protocols?: string | string[],
) => WebSocketLike;

function getWebSocketCtor(): WebSocketCtor {
	const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (!ctor) {
		throw new Error(
			"Global WebSocket is not available in this runtime. Node 22+ is required for hub mode.",
		);
	}
	return ctor;
}

function decodeSocketData(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString();
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString();
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString();
	}
	if (
		data &&
		typeof data === "object" &&
		"data" in data &&
		typeof (data as { data?: unknown }).data !== "undefined"
	) {
		return decodeSocketData((data as { data?: unknown }).data);
	}
	return String(data);
}

function decodeCloseReason(reason: unknown): string {
	if (typeof reason === "string") {
		return reason;
	}
	if (reason instanceof Uint8Array) {
		return Buffer.from(reason).toString("utf8");
	}
	if (reason instanceof ArrayBuffer) {
		return Buffer.from(reason).toString("utf8");
	}
	return "";
}

export interface HubClientOptions {
	url: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
	authToken?: string;
}

export interface LocalHubResolutionOptions {
	endpoint?: string;
	strategy?: "prefer-hub" | "require-hub";
	workspaceRoot?: string;
	cwd?: string;
}

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;

export class NodeHubClient {
	private socket: WebSocketLike | undefined;
	private connectPromise: Promise<void> | undefined;
	private readonly clientId: string;
	private readonly pendingReplies = new Map<string, PendingReply>();
	private readonly listeners = new Set<(event: HubEventEnvelope) => void>();
	private lastCloseMessage = "Hub connection closed";

	constructor(private readonly options: HubClientOptions) {
		this.clientId =
			options.clientId ??
			`core-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
	}

	getClientId(): string {
		return this.clientId;
	}

	async connect(): Promise<void> {
		if (
			this.socket &&
			(this.socket.readyState === 1 || this.socket.readyState === 0)
		) {
			return this.connectPromise ?? Promise.resolve();
		}

		const url = new URL(this.options.url);
		if (this.options.authToken?.trim()) {
			url.searchParams.set("authToken", this.options.authToken.trim());
		}

		const WebSocketImpl = getWebSocketCtor();
		const socket = new WebSocketImpl(url.toString());
		this.socket = socket;
		this.connectPromise = new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve());
			socket.addEventListener("error", (error) => reject(error));
		});

		socket.addEventListener("message", (data: unknown) => {
			this.handleFrame(JSON.parse(decodeSocketData(data)) as HubTransportFrame);
		});
		socket.addEventListener("close", (event: unknown) => {
			const closeEvent = event as { code?: number; reason?: unknown };
			const reasonText = decodeCloseReason(closeEvent.reason);
			this.lastCloseMessage =
				closeEvent.code || reasonText
					? `Hub connection closed (code=${closeEvent.code ?? 0}${reasonText ? `, reason=${reasonText}` : ""})`
					: "Hub connection closed";
			for (const pending of this.pendingReplies.values()) {
				pending.reject(new Error(this.lastCloseMessage));
			}
			this.pendingReplies.clear();
			this.connectPromise = undefined;
			this.socket = undefined;
		});

		await this.connectPromise;
		await this.command("client.register", {
			clientId: this.clientId,
			clientType: this.options.clientType ?? "core",
			displayName: this.options.displayName ?? "core",
			transport: "native",
			actorKind: "client",
			workspaceContext: {
				workspaceRoot: this.options.workspaceRoot,
				cwd: this.options.cwd,
			},
		} satisfies HubClientRegistration);
		this.sendFrame({
			kind: "stream.subscribe",
			clientId: this.clientId,
		});
	}

	subscribe(listener: (event: HubEventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
	): Promise<HubReplyEnvelope> {
		await this.connect();
		const requestId = createSessionId("hubreq_");
		const reply = new Promise<HubReplyEnvelope>((resolve, reject) => {
			this.pendingReplies.set(requestId, { resolve, reject });
		});
		this.sendFrame({
			kind: "command",
			envelope: {
				version: "v1",
				command,
				requestId,
				clientId: this.clientId,
				sessionId,
				payload,
			},
		});
		const resolved = await reply;
		if (!resolved.ok) {
			throw new Error(
				resolved.error?.message ?? `Hub command ${command} failed`,
			);
		}
		return resolved;
	}

	close(): void {
		const socket = this.socket;
		if (!socket) {
			return;
		}
		this.lastCloseMessage = "Hub connection closed";
		for (const pending of this.pendingReplies.values()) {
			pending.reject(new Error(this.lastCloseMessage));
		}
		this.pendingReplies.clear();
		this.connectPromise = undefined;
		this.socket = undefined;
		try {
			socket.close();
		} catch {
			// best-effort close
		}
	}

	private sendFrame(frame: HubTransportFrame): void {
		if (!this.socket || this.socket.readyState !== 1) {
			throw new Error(
				this.lastCloseMessage === "Hub connection closed"
					? "Hub connection is not open."
					: this.lastCloseMessage,
			);
		}
		this.socket.send(JSON.stringify(frame));
	}

	private handleFrame(frame: HubTransportFrame): void {
		switch (frame.kind) {
			case "reply": {
				const requestId = frame.envelope.requestId;
				if (!requestId) {
					return;
				}
				const pending = this.pendingReplies.get(requestId);
				if (!pending) {
					return;
				}
				this.pendingReplies.delete(requestId);
				pending.resolve(frame.envelope);
				return;
			}
			case "event":
				for (const listener of this.listeners) {
					listener(frame.envelope);
				}
				return;
			case "command":
			case "stream.subscribe":
			case "stream.unsubscribe":
				return;
		}
	}
}

export function normalizeHubWebSocketUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
	} else if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	}
	return parsed.toString();
}

async function probeCompatibleHubUrl(url: string): Promise<string | undefined> {
	const normalized = normalizeHubWebSocketUrl(url);
	const record = await probeHubServer(normalized);
	if (!record) {
		return undefined;
	}
	const buildId = resolveHubBuildId();
	if (record.buildId?.trim() && record.buildId !== buildId) {
		return undefined;
	}
	return normalized;
}

function resolveHubModuleUrl(): string {
	const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
	return new URL(`./index.${extension}`, import.meta.url).href;
}

function isBunExecutable(command: string): boolean {
	const name = basename(command).toLowerCase();
	return name === "bun" || name === "bun.exe";
}

function buildDetachedHubBootstrapCode(options: {
	host?: string;
	port?: number;
	pathname?: string;
}): string {
	return `
import { createLocalHubScheduleRuntimeHandlers, ensureHubWebSocketServer } from ${JSON.stringify(resolveHubModuleUrl())};

const result = await ensureHubWebSocketServer({
	runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	${options.host ? `host: ${JSON.stringify(options.host)},` : ""}
	${typeof options.port === "number" ? `port: ${JSON.stringify(options.port)},` : ""}
	${options.pathname ? `pathname: ${JSON.stringify(options.pathname)},` : ""}
});

if (result.server) {
	await new Promise((resolve) => {
		const shutdown = () => resolve(undefined);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
	await result.server.close();
}
`.trim();
}

function parseLocalEndpointOverride(endpoint: string | undefined): {
	host?: string;
	port?: number;
	pathname?: string;
} {
	const trimmed = endpoint?.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `ws://${trimmed}`,
		);
		return {
			host: parsed.hostname || undefined,
			port: parsed.port ? Number.parseInt(parsed.port, 10) : undefined,
			pathname:
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname
					: undefined,
		};
	} catch {
		return {};
	}
}

function spawnDetachedLocalHub(
	owner: HubOwnerContext,
	endpoint?: string,
): void {
	const command = augmentNodeCommandForDebug([process.execPath], {
		env: process.env,
		execArgv: process.execArgv,
	});
	const launcher = command[0] ?? process.execPath;
	const childArgsPrefix = command.slice(1);
	const bootstrapCode = buildDetachedHubBootstrapCode(
		parseLocalEndpointOverride(endpoint),
	);
	const evalArgs = isBunExecutable(launcher)
		? ["-e", bootstrapCode]
		: ["--input-type=module", "-e", bootstrapCode];
	const child = spawn(launcher, [...childArgsPrefix, ...evalArgs], {
		detached: true,
		stdio: "ignore",
		env: {
			...withResolvedClineBuildEnv(process.env),
			CLINE_HUB_DISCOVERY_PATH: owner.discoveryPath,
			CLINE_NO_INTERACTIVE: "1",
		},
		cwd: process.cwd(),
	});
	child.unref();
}

async function waitForCompatibleHubUrl(
	owner: HubOwnerContext,
): Promise<string | undefined> {
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const record = await readHubDiscovery(owner.discoveryPath);
		if (record?.url) {
			const compatible = await probeCompatibleHubUrl(record.url);
			if (compatible) {
				return compatible;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	return undefined;
}

export async function resolveCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	if (options.endpoint?.trim()) {
		return await probeCompatibleHubUrl(options.endpoint);
	}

	const owner = resolveSharedHubOwnerContext();
	const record = await readHubDiscovery(owner.discoveryPath);
	if (!record?.url) {
		return undefined;
	}
	return await probeCompatibleHubUrl(record.url);
}

export async function ensureCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	const resolved = await resolveCompatibleLocalHubUrl(options);
	if (resolved) {
		return resolved;
	}
	if (options.endpoint?.trim()) {
		return undefined;
	}
	const owner = resolveSharedHubOwnerContext();
	spawnDetachedLocalHub(owner);
	return await waitForCompatibleHubUrl(owner);
}
