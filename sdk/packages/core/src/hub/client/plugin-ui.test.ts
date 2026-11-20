import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HUB_URL = "ws://127.0.0.1:25463/hub";
const sessionId = "sess-ui";
const SLOT = "composer.suggestions";
const attach = {
	sessionId,
	slot: SLOT,
	action: { verb: "attach", surface: "desktop" },
} as const;
const detach = { sessionId, slot: SLOT, action: { verb: "detach" } } as const;

type Listener = (payload?: unknown) => void;

/** A hub connection that keeps the plugin UI leases its attaches took until it closes, as the hub does. */
class LeasingHubSocket {
	static sockets: LeasingHubSocket[] = [];
	static invokes: string[] = [];
	static dropOnNextAttach = false;

	readyState = 0;
	readonly id = LeasingHubSocket.sockets.length + 1;
	readonly leases = new Set<string>();
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor(readonly url: string) {
		LeasingHubSocket.sockets.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open");
		});
	}

	static liveLeases(): string[] {
		return LeasingHubSocket.sockets
			.filter((socket) => socket.readyState === 1)
			.flatMap((socket) => [...socket.leases]);
	}

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	send(data: string): void {
		const { kind, envelope } = JSON.parse(data) as {
			kind?: string;
			envelope?: {
				requestId?: string;
				command?: string;
				sessionId?: string;
				payload?: { action?: { verb?: string } };
			};
		};
		if (kind !== "command" || !envelope?.requestId) return;
		if (envelope.command === "plugins.ui.invoke") {
			const verb = envelope.payload?.action?.verb;
			LeasingHubSocket.invokes.push(`S${this.id}:${verb}`);
			if (verb === "attach" && LeasingHubSocket.dropOnNextAttach) {
				LeasingHubSocket.dropOnNextAttach = false;
				queueMicrotask(() => this.drop());
				return;
			}
			if (verb === "attach") this.leases.add(envelope.sessionId ?? "");
			if (verb === "detach") this.leases.delete(envelope.sessionId ?? "");
		}
		queueMicrotask(() =>
			this.emit("message", {
				data: JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId: envelope.requestId,
						ok: true,
						payload:
							envelope.command === "plugins.ui.invoke" ? { outcome: "ok" } : {},
					},
				}),
			}),
		);
	}

	drop(): void {
		this.end(1006);
	}

	close(): void {
		this.end(1000);
	}

	private end(code: number): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.leases.clear();
		this.emit("close", { code, reason: "" });
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(payload);
	}
}

/**
 * A NodeHubClient on a recoverable local hub whose transport recovery waits
 * for `recover()`, so a test can act while a dropped command awaits its retry.
 */
async function connectWithHeldRecovery() {
	const record = {
		hubId: "hub-test",
		protocolVersion: "v1",
		buildId: "test-build",
		authToken: "token",
		host: "127.0.0.1",
		port: 25463,
		url: HUB_URL,
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	let recover!: () => void;
	const recovered = new Promise<void>((resolve) => {
		recover = resolve;
	});
	let recovering = false;
	vi.doMock("../daemon", () => ({
		ensureDetachedHubServer: vi.fn(async () => {
			throw new Error("unexpected ensureDetachedHubServer call");
		}),
	}));
	vi.doMock("../discovery/workspace", () => ({
		resolveProductionHubOwnerContext: () => ({
			ownerId: "hub-test",
			discoveryPath: "/nonexistent/hub-discovery.json",
		}),
		resolveSharedHubOwnerContext: () => ({
			ownerId: "hub-test",
			discoveryPath: "/nonexistent/hub-discovery.json",
		}),
	}));
	vi.doMock("../discovery", async () => {
		const actual =
			await vi.importActual<typeof import("../discovery")>("../discovery");
		return {
			...actual,
			resolveHubBuildId: () => "test-build",
			readHubDiscovery: vi.fn(async () => {
				recovering = true;
				await recovered;
				return record;
			}),
			probeHubServer: vi.fn(async () => record),
			clearHubDiscovery: vi.fn(async () => undefined),
		};
	});
	const { NodeHubClient, rememberRecoverableLocalHubUrl } = await import(".");
	const { createHubPluginUiApi } = await import("./plugin-ui");
	rememberRecoverableLocalHubUrl(HUB_URL);
	const client = new NodeHubClient({
		url: HUB_URL,
		workspaceRoot: "/tmp/project",
		cwd: "/tmp/project",
	});
	const commands: Promise<unknown>[] = [];
	const pluginUi = createHubPluginUiApi({
		command: (...args) => {
			const reply = client.command(...args);
			commands.push(reply);
			return reply;
		},
	});
	client.onRegistered(() => pluginUi.onRegistered());
	return {
		client,
		pluginUi,
		recovering: () => recovering,
		async recover() {
			recover();
			await Promise.allSettled(commands);
		},
	};
}

describe("createHubPluginUiApi over a recovering hub connection", () => {
	const originalWebSocket = globalThis.WebSocket;

	beforeEach(() => {
		vi.resetModules();
		(globalThis as unknown as { WebSocket: unknown }).WebSocket =
			LeasingHubSocket;
	});

	afterEach(() => {
		LeasingHubSocket.sockets = [];
		LeasingHubSocket.invokes = [];
		LeasingHubSocket.dropOnNextAttach = false;
		if (originalWebSocket) {
			globalThis.WebSocket = originalWebSocket;
		} else {
			delete (globalThis as { WebSocket?: unknown }).WebSocket;
		}
		vi.resetModules();
	});

	it("withdraws a re-sent attach whose retry on the recovered connection would follow the detach", async () => {
		const hub = await connectWithHeldRecovery();
		await hub.pluginUi.invoke(attach);

		LeasingHubSocket.sockets[0]?.drop();
		LeasingHubSocket.dropOnNextAttach = true;
		await hub.client.connect();
		await vi.waitFor(() => expect(hub.recovering()).toBe(true));
		await expect(hub.pluginUi.invoke(detach)).resolves.toEqual({
			outcome: "ok",
		});
		await hub.recover();

		expect(LeasingHubSocket.invokes).toEqual([
			"S1:attach",
			"S2:attach",
			"S3:detach",
		]);
		expect(LeasingHubSocket.liveLeases()).toEqual([]);
		await hub.client.dispose();
	});

	it("withdraws an in-flight attach whose retry on the recovered connection would follow the detach", async () => {
		const hub = await connectWithHeldRecovery();
		LeasingHubSocket.dropOnNextAttach = true;
		const attaching = hub.pluginUi.invoke(attach);
		await vi.waitFor(() => expect(hub.recovering()).toBe(true));

		await expect(hub.pluginUi.invoke(detach)).resolves.toEqual({
			outcome: "ok",
		});
		await hub.recover();

		await expect(attaching).resolves.toEqual({ outcome: "unavailable" });
		expect(LeasingHubSocket.invokes).toEqual(["S1:attach", "S2:detach"]);
		expect(LeasingHubSocket.liveLeases()).toEqual([]);
		await hub.client.dispose();
	});
});
