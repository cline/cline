import {
	HUB_CLIENT_TYPE,
	HUB_COMMAND_TIMEOUT_MS,
	HUB_RECONNECT_FACTOR,
	HUB_RECONNECT_INITIAL_MS,
	HUB_RECONNECT_MAX_MS,
} from "../config";

/** The fields of a hub event envelope Next Turn reads. */
export type HubEvent = {
	event: string;
	sequence?: number;
	sessionId?: string;
	timestamp?: number;
	payload?: unknown;
};

export type HubReply = {
	ok: boolean;
	payload?: Record<string, unknown>;
	error?: { code?: string; message?: string };
};

export type HubResolvedEndpoint = {
	url: string;
	authToken?: string;
};

/** The slice of upstream `NodeHubClient` the link uses; tests pass a fake. */
export interface HubClientPort {
	connect(): Promise<void>;
	isConnected?(): boolean;
	onStatus?(
		listener: (status: "up" | "down", meta?: { resumed?: boolean }) => void,
	): () => void;
	subscribe(listener: (event: HubEvent) => void): () => void;
	command(
		name: string,
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number },
	): Promise<HubReply>;
	dispose(): Promise<void>;
}

export type HubLinkScope = { workspaceRoot?: string; cwd?: string };

export type HubLinkOptions = {
	/** When false, opens a command-only socket with no event subscription. */
	subscribe?: boolean;
};

export type HubLinkDeps = {
	/** The running hub's URL, or undefined when none is running. Must never start one. */
	resolveUrl(scope: HubLinkScope): Promise<string | undefined>;
	/** Optional richer resolver returning `{ url, authToken }`, re-read on every reconnect. */
	resolveEndpoint?(
		scope: HubLinkScope,
	): Promise<HubResolvedEndpoint | undefined>;
	createClient(
		url: string,
		scope: HubLinkScope,
		authToken?: string,
	): HubClientPort;
	sleep(ms: number): Promise<void>;
};

/**
 * - `off`: no hub is running here, so hub-backed sources are absent;
 * - `connecting` / `down`: a hub exists but is not reachable now, so they are unknown;
 * - `up`: connected and registered.
 */
export type HubLinkStatus =
	| "idle"
	| "off"
	| "connecting"
	| "up"
	| "down"
	| "disposed";

/**
 * Commands the engine must never send. Any connection may answer any approval
 * (`approval.respond` has no permission check upstream), so the plugin
 * refusing is the only guard; capability replies belong to the client that
 * owns the session.
 */
export const FORBIDDEN_HUB_COMMANDS: ReadonlySet<string> = new Set([
	"approval.respond",
	"capability.respond",
]);

export class HubLinkRefusal extends Error {}

export class HubLinkUnavailable extends Error {}

export class HubCommandFailed extends Error {
	constructor(
		readonly command: string,
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
	}
}

type Listener = {
	names: ReadonlySet<string>;
	listener: (event: HubEvent) => void;
};
type PendingCommand = {
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

/**
 * The engine's one connection to the hub. It never starts a hub,
 * never advertises a capability, and never answers an approval. Listeners
 * subscribe by event name; the link holds a single upstream subscription and
 * fans events out, so a reconnect re-attaches every listener at once.
 */
export class HubLink {
	private state: HubLinkStatus = "idle";
	private client: HubClientPort | undefined;
	private unsubscribe: (() => void) | undefined;
	private unstatus: (() => void) | undefined;
	private readonly listeners = new Set<Listener>();
	private readonly statusListeners = new Set<
		(status: HubLinkStatus, meta?: { resumed?: boolean }) => void
	>();
	private readonly pendingCommands = new Set<PendingCommand>();
	private startPromise: Promise<void> | undefined;
	private reconnecting: Promise<void> | undefined;

	constructor(
		private readonly deps: HubLinkDeps,
		private readonly scope: HubLinkScope = {},
		private readonly options: HubLinkOptions = {},
	) {}

	status(): HubLinkStatus {
		return this.state;
	}

	/** How hub-backed sources should report themselves in the manifest. */
	availability(): "present" | "unknown" | "absent" {
		if (this.state === "up") return "present";
		if (this.state === "off" || this.state === "disposed") return "absent";
		return "unknown";
	}

	onStatus(
		listener: (status: HubLinkStatus, meta?: { resumed?: boolean }) => void,
	): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	/** Resolve and connect, retrying with backoff while a hub exists but refuses. Idempotent. */
	start(): Promise<void> {
		this.startPromise ??= this.run();
		return this.startPromise;
	}

	subscribe(
		names: ReadonlySet<string>,
		listener: (event: HubEvent) => void,
	): () => void {
		const entry: Listener = { names, listener };
		this.listeners.add(entry);
		return () => this.listeners.delete(entry);
	}

	async command(
		name: string,
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number },
	): Promise<Record<string, unknown>> {
		if (FORBIDDEN_HUB_COMMANDS.has(name))
			throw new HubLinkRefusal(`Next Turn never sends ${name}`);
		if (
			this.state !== "up" ||
			!this.client ||
			this.client.isConnected?.() === false
		) {
			throw new HubLinkUnavailable(`hub link is ${this.state}`);
		}
		const target = this.client;
		const timeoutMs = options?.timeoutMs ?? HUB_COMMAND_TIMEOUT_MS;
		const reply = await new Promise<HubReply>((resolve, reject) => {
			const pending: PendingCommand = {
				reject: (error) => {
					clearTimeout(pending.timer);
					this.pendingCommands.delete(pending);
					reject(error);
				},
				timer: setTimeout(() => {
					this.pendingCommands.delete(pending);
					reject(
						new HubCommandFailed(
							name,
							"hub_command_timeout",
							`${name} timed out after ${timeoutMs}ms`,
						),
					);
				}, timeoutMs),
			};
			this.pendingCommands.add(pending);
			target.command(name, payload, sessionId, { timeoutMs }).then(
				(res) => {
					clearTimeout(pending.timer);
					this.pendingCommands.delete(pending);
					resolve(res);
				},
				(err) => {
					clearTimeout(pending.timer);
					this.pendingCommands.delete(pending);
					reject(err);
				},
			);
		});
		if (!reply.ok)
			throw new HubCommandFailed(
				name,
				reply.error?.code,
				reply.error?.message ?? `${name} failed`,
			);
		return reply.payload ?? {};
	}

	async dispose(): Promise<void> {
		this.setState("disposed");
		this.rejectPending(new HubLinkUnavailable("hub link disposed"));
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.unstatus?.();
		this.unstatus = undefined;
		this.listeners.clear();
		const client = this.client;
		this.client = undefined;
		await client?.dispose();
	}

	private rejectPending(error: Error): void {
		for (const pending of [...this.pendingCommands]) {
			pending.reject(error);
		}
	}

	private async resolveTarget(): Promise<HubResolvedEndpoint | undefined> {
		if (this.deps.resolveEndpoint) {
			return this.deps.resolveEndpoint(this.scope).catch(() => undefined);
		}
		const url = await this.deps.resolveUrl(this.scope).catch(() => undefined);
		return url ? { url } : undefined;
	}

	private bindClient(client: HubClientPort, resumed: boolean): void {
		this.unsubscribe?.();
		this.unstatus?.();
		this.client = client;
		if (this.options.subscribe !== false) {
			this.unsubscribe = client.subscribe((event) => this.dispatch(event));
		}
		this.unstatus = client.onStatus?.((status) => {
			if (this.isDisposed() || this.client !== client) return;
			if (status === "down") {
				this.rejectPending(new HubLinkUnavailable("hub connection closed"));
				this.setState("down");
				void this.reconnectLoop();
			}
		});
		this.setState("up", { resumed });
	}

	private async reconnectLoop(): Promise<void> {
		if (this.reconnecting || this.isDisposed()) return;
		this.reconnecting = (async () => {
			let delay = HUB_RECONNECT_INITIAL_MS;
			while (!this.isDisposed() && this.state === "down") {
				await this.deps.sleep(delay);
				if (this.isDisposed() || this.state !== "down") return;
				const endpoint = await this.resolveTarget();
				if (this.isDisposed()) return;
				if (endpoint) {
					const previous = this.client;
					const next = this.deps.createClient(
						endpoint.url,
						this.scope,
						endpoint.authToken,
					);
					try {
						await next.connect();
						if (this.isDisposed()) {
							await next.dispose();
							return;
						}
						await previous?.dispose().catch(() => undefined);
						this.bindClient(next, true);
						return;
					} catch {
						await next.dispose().catch(() => undefined);
					}
				}
				delay = Math.min(delay * HUB_RECONNECT_FACTOR, HUB_RECONNECT_MAX_MS);
			}
		})().finally(() => {
			this.reconnecting = undefined;
		});
		await this.reconnecting;
	}

	private async run(): Promise<void> {
		this.setState("connecting");
		const initial = await this.resolveTarget();
		if (this.isDisposed()) return;
		if (!initial) {
			this.setState("off");
			return;
		}
		let endpoint: HubResolvedEndpoint | undefined = initial;
		let delay = HUB_RECONNECT_INITIAL_MS;
		let attempt = 0;
		while (!this.isDisposed()) {
			if (attempt > 0) {
				endpoint = (await this.resolveTarget()) ?? endpoint;
			}
			attempt += 1;
			const client = this.deps.createClient(
				endpoint.url,
				this.scope,
				endpoint.authToken,
			);
			try {
				await client.connect();
				if (this.isDisposed()) {
					await client.dispose();
					return;
				}
				this.bindClient(client, attempt > 1);
				return;
			} catch {
				await client.dispose().catch(() => undefined);
				if (this.isDisposed()) return;
				this.setState("down");
				await this.deps.sleep(delay);
				delay = Math.min(delay * HUB_RECONNECT_FACTOR, HUB_RECONNECT_MAX_MS);
			}
		}
	}

	private dispatch(event: HubEvent): void {
		for (const { names, listener } of this.listeners) {
			if (!names.has(event.event)) continue;
			try {
				listener(event);
			} catch {}
		}
	}

	private isDisposed(): boolean {
		return this.state === "disposed";
	}

	private setState(next: HubLinkStatus, meta?: { resumed?: boolean }): void {
		if (this.state === next && !meta?.resumed) return;
		this.state = next;
		for (const listener of this.statusListeners) listener(next, meta);
	}
}

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
		async resolveUrl(scope) {
			const endpoint = await this.resolveEndpoint?.(scope);
			return endpoint?.url;
		},
		async resolveEndpoint() {
			return resolveDiscoveredHubEndpoint();
		},
		createClient(url, scope, authToken) {
			let client: import("@cline/core/hub").NodeHubClient | undefined;
			const statusListeners = new Set<
				(status: "up" | "down", meta?: { resumed?: boolean }) => void
			>();
			let pollTimer: ReturnType<typeof setInterval> | undefined;
			let lastConnected = false;

			const startMonitor = (
				target: import("@cline/core/hub").NodeHubClient,
			) => {
				lastConnected = target.isConnected();
				pollTimer = setInterval(() => {
					const connected = target.isConnected();
					if (connected !== lastConnected) {
						lastConnected = connected;
						for (const listener of statusListeners) {
							listener(
								connected ? "up" : "down",
								connected ? { resumed: true } : undefined,
							);
						}
					}
				}, HUB_RECONNECT_INITIAL_MS);
				pollTimer.unref?.();
			};

			const ready = import("@cline/core/hub").then((hub) => {
				client = new hub.NodeHubClient({
					url,
					...(authToken ? { authToken } : {}),
					clientType: HUB_CLIENT_TYPE,
					displayName: "Next Turn",
					workspaceRoot: scope.workspaceRoot,
					cwd: scope.cwd,
				});
				return client;
			});

			return {
				async connect() {
					const target = await ready;
					await target.connect();
					startMonitor(target);
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
					return client.subscribe((event) => listener(event));
				},
				async command(name, payload, sessionId, options) {
					const target = await ready;
					try {
						return await target.command(
							name as Parameters<typeof target.command>[0],
							payload,
							sessionId,
							options,
						);
					} catch (error) {
						if (error instanceof Error && error.name === "HubCommandError") {
							const code = (error as { code?: string }).code;
							return { ok: false, error: { code, message: error.message } };
						}
						if (lastConnected && !target.isConnected()) {
							lastConnected = false;
							for (const listener of statusListeners) listener("down");
						}
						throw error;
					}
				},
				async dispose() {
					if (pollTimer) clearInterval(pollTimer);
					pollTimer = undefined;
					statusListeners.clear();
					await (await ready.catch(() => undefined))?.dispose();
				},
			};
		},
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
}
