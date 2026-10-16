import type {
	HubCommandName,
	HubEventEnvelope,
	HubEventName,
} from "@cline/shared";
import {
	HUB_RECONNECT_FACTOR,
	HUB_RECONNECT_INITIAL_MS,
	HUB_RECONNECT_MAX_MS,
} from "../config";
import type { SourceState } from "../context/source";

/** The fields of a hub event envelope Next Turn reads. */
export type HubEvent = Pick<
	HubEventEnvelope,
	"event" | "sequence" | "sessionId" | "timestamp" | "payload"
>;

export type HubResolvedEndpoint = {
	url: string;
	authToken?: string;
};

/** The slice of upstream `NodeHubClient` the link uses; tests pass a fake. */
export interface HubClientPort {
	connect(): Promise<void>;
	isConnected(): boolean;
	onStatus(listener: (connected: boolean) => void): () => void;
	subscribe(listener: (event: HubEvent) => void): () => void;
	/** Resolves the reply's payload; a hub error rejects as `HubCommandFailed`. */
	command(
		name: HubCommandName,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
	dispose(): Promise<void>;
}

export type HubLinkScope = { workspaceRoot?: string; cwd?: string };

/** How hub-backed sources report themselves in the manifest. */
export type HubAvailability = Exclude<SourceState, "off">;

export type HubLinkDeps = {
	/** The running hub's endpoint, or undefined when none is running; re-read on every reconnect. Must never start one. */
	resolveEndpoint(): Promise<HubResolvedEndpoint | undefined>;
	createClient(
		endpoint: HubResolvedEndpoint,
		scope: HubLinkScope,
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
const FORBIDDEN_HUB_COMMANDS: ReadonlySet<HubCommandName> = new Set([
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
	names: ReadonlySet<HubEventName>;
	listener: (event: HubEvent) => void;
};

function sameEndpoint(
	endpoint: HubResolvedEndpoint,
	other: HubResolvedEndpoint | undefined,
): boolean {
	return endpoint.url === other?.url && endpoint.authToken === other.authToken;
}

/**
 * The engine's one connection to the hub. It never starts a hub,
 * never advertises a capability, and never answers an approval. Listeners
 * subscribe by event name; the link holds a single upstream subscription and
 * fans events out, so a reconnect re-attaches every listener at once.
 */
export class HubLink {
	private state: HubLinkStatus = "idle";
	private client: HubClientPort | undefined;
	private endpoint: HubResolvedEndpoint | undefined;
	private unsubscribe: (() => void) | undefined;
	private unstatus: (() => void) | undefined;
	private readonly listeners = new Set<Listener>();
	private readonly statusListeners = new Set<(status: HubLinkStatus) => void>();
	private startPromise: Promise<void> | undefined;
	private reconnecting = false;

	constructor(
		private readonly deps: HubLinkDeps,
		private readonly scope: HubLinkScope = {},
	) {}

	availability(): HubAvailability {
		if (this.state === "up") return "present";
		if (this.state === "off" || this.state === "disposed") return "absent";
		return "unknown";
	}

	onStatus(listener: (status: HubLinkStatus) => void): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	/** Resolve and connect, retrying with backoff while a hub exists but refuses. Idempotent. */
	start(): Promise<void> {
		this.startPromise ??= this.connect("start");
		return this.startPromise;
	}

	subscribe(
		names: ReadonlySet<HubEventName>,
		listener: (event: HubEvent) => void,
	): () => void {
		const entry: Listener = { names, listener };
		this.listeners.add(entry);
		return () => this.listeners.delete(entry);
	}

	async command(
		name: HubCommandName,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		if (FORBIDDEN_HUB_COMMANDS.has(name))
			throw new HubLinkRefusal(`Next Turn never sends ${name}`);
		const client = this.state === "up" ? this.client : undefined;
		if (!client?.isConnected())
			throw new HubLinkUnavailable(`hub link is ${this.state}`);
		return client.command(name, payload);
	}

	async dispose(): Promise<void> {
		this.setState("disposed");
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.unstatus?.();
		this.unstatus = undefined;
		this.listeners.clear();
		const client = this.client;
		this.client = undefined;
		await client?.dispose();
	}

	private bindClient(
		client: HubClientPort,
		endpoint: HubResolvedEndpoint,
	): void {
		this.unsubscribe?.();
		this.unstatus?.();
		this.client = client;
		this.endpoint = endpoint;
		this.unsubscribe = client.subscribe((event) => this.dispatch(event));
		this.unstatus = client.onStatus((connected) => {
			if (this.isDisposed() || this.client !== client) return;
			if (!connected) {
				this.setState("down");
				this.reconnect();
			} else if (this.state === "down") {
				this.setState("up");
			}
		});
		this.setState("up");
	}

	private reconnect(): void {
		if (this.reconnecting) return;
		this.reconnecting = true;
		void this.connect("reconnect").finally(() => {
			this.reconnecting = false;
			if (this.state === "down") this.reconnect();
		});
	}

	/**
	 * At start, sleeps only between attempts and reports `off` when no hub is
	 * running; on reconnect, sleeps before every attempt and stops once the link
	 * is no longer down.
	 */
	private async connect(mode: "start" | "reconnect"): Promise<void> {
		if (mode === "start") this.setState("connecting");
		const superseded = () =>
			this.isDisposed() || (mode === "reconnect" && this.state !== "down");
		let endpoint: HubResolvedEndpoint | undefined;
		let delay = HUB_RECONNECT_INITIAL_MS;
		for (let attempt = 0; !this.isDisposed(); attempt += 1) {
			if (attempt > 0 || mode === "reconnect") {
				await this.deps.sleep(delay);
				delay = Math.min(delay * HUB_RECONNECT_FACTOR, HUB_RECONNECT_MAX_MS);
				if (superseded()) return;
			}
			endpoint =
				(await this.deps.resolveEndpoint().catch(() => undefined)) ?? endpoint;
			if (superseded()) return;
			if (!endpoint) {
				if (mode === "start") {
					this.setState("off");
					return;
				}
				continue;
			}
			// The bound client reconnects on its own and replays what it missed
			// (`sinceSequence`), so only a hub at a new endpoint needs a new client.
			if (mode === "reconnect" && sameEndpoint(endpoint, this.endpoint))
				continue;
			const client = this.deps.createClient(endpoint, this.scope);
			try {
				await client.connect();
			} catch {
				await client.dispose().catch(() => undefined);
				if (mode === "start" && !this.isDisposed()) this.setState("down");
				continue;
			}
			if (superseded()) {
				await client.dispose().catch(() => undefined);
				return;
			}
			await this.client?.dispose().catch(() => undefined);
			this.bindClient(client, endpoint);
			return;
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

	private setState(next: HubLinkStatus): void {
		if (this.state === next) return;
		this.state = next;
		for (const listener of this.statusListeners) listener(next);
	}
}
