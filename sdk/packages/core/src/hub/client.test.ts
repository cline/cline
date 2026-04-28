import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeHubClient } from "./client";

type SocketListener = (...args: unknown[]) => void;
type MessageListener = (event: { data: string }) => void;
type GenericListener = (...args: unknown[]) => void;

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: MockWebSocket[] = [];

	readyState = MockWebSocket.CONNECTING;
	readonly sentFrames: unknown[] = [];
	private readonly listeners = new Map<string, SocketListener[]>();

	constructor(public readonly url: string) {
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = MockWebSocket.OPEN;
			this.emit("open");
		});
	}

	static reset(): void {
		MockWebSocket.instances = [];
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string };
		};
		this.sentFrames.push(frame);
		if (frame.kind === "command" && frame.envelope?.requestId) {
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							command: "client.register",
							requestId: frame.envelope?.requestId,
							ok: true,
							clientId: "hub",
							payload: {},
						},
					}),
				});
			});
		}
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.emit("close", { code: 1000, reason: "" });
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emit(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(...args);
		}
	}
}

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];

	public readyState = 0;
	private readonly listeners = new Map<string, Set<GenericListener>>();

	constructor(_url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: GenericListener): void {
		const current = this.listeners.get(type) ?? new Set<GenericListener>();
		current.add(listener);
		this.listeners.set(type, current);
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string; command?: string };
		};
		if (
			frame.kind === "command" &&
			frame.envelope?.command === "client.register" &&
			frame.envelope.requestId
		) {
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: frame.envelope?.requestId,
							ok: true,
							payload: {},
						},
					}),
				});
			});
		}
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	open(): void {
		this.readyState = 1;
		this.emit("open");
	}

	fail(payload?: unknown): void {
		this.emit("error", payload);
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) {
			if (type === "message") {
				(listener as MessageListener)(payload as { data: string });
				continue;
			}
			listener(payload);
		}
	}
}

describe("NodeHubClient", () => {
	describe("subscription re-registration", () => {
		afterEach(() => {
			MockWebSocket.reset();
			vi.unstubAllGlobals();
		});

		it("re-subscribes global listeners without sending the wildcard sentinel", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);

			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			await client.connect();
			client.subscribe(() => {});

			const firstSocket = MockWebSocket.instances[0];
			expect(firstSocket.sentFrames).toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
			});

			firstSocket.emit("close", { code: 1006, reason: "" });

			await client.connect();

			const secondSocket = MockWebSocket.instances[1];
			expect(secondSocket.sentFrames).toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
			});
			expect(secondSocket.sentFrames).not.toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
				sessionId: "*",
			});
		});

		it("unregisters before closing when disposed", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);

			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientType: "code-sidecar",
			});
			await client.connect();
			const socket = MockWebSocket.instances[0];

			await client.dispose();

			expect(socket.sentFrames).toContainEqual(
				expect.objectContaining({
					kind: "command",
					envelope: expect.objectContaining({
						command: "client.unregister",
						clientId: client.getClientId(),
					}),
				}),
			);
			expect(socket.readyState).toBe(MockWebSocket.CLOSED);
		});
	});

	describe("timeouts", () => {
		const originalWebSocket = globalThis.WebSocket;

		beforeEach(() => {
			vi.useFakeTimers();
			FakeWebSocket.instances = [];
			(
				globalThis as unknown as { WebSocket?: typeof FakeWebSocket }
			).WebSocket = FakeWebSocket;
		});

		afterEach(() => {
			vi.useRealTimers();
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		});

		it("times out when the hub connection never opens", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const expectation = expect(connectPromise).rejects.toThrow(
				"Timed out connecting to hub after 8000ms",
			);

			await vi.advanceTimersByTimeAsync(8_001);
			await expectation;
		});

		it("times out when a hub command never replies", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const socket = FakeWebSocket.instances[0];
			if (!socket) {
				throw new Error("expected fake websocket instance");
			}
			socket.open();
			await connectPromise;

			const commandPromise = client.command("client.list");
			const expectation = expect(commandPromise).rejects.toThrow(
				"Hub command client.list timed out after 30000ms",
			);
			await vi.advanceTimersByTimeAsync(30_001);
			await expectation;
		});

		it("allows commands to opt out of the reply timeout", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const socket = FakeWebSocket.instances[0];
			if (!socket) {
				throw new Error("expected fake websocket instance");
			}
			socket.open();
			await connectPromise;

			const commandPromise = client.command(
				"client.list",
				undefined,
				undefined,
				{ timeoutMs: null },
			);
			await vi.advanceTimersByTimeAsync(30_001);

			let settled = false;
			void commandPromise.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await Promise.resolve();

			expect(settled).toBe(false);
			const requestId = [
				...(
					client as unknown as { pendingReplies: Map<string, unknown> }
				).pendingReplies.keys(),
			][0];

			(
				socket as unknown as { emit: (type: string, payload: unknown) => void }
			).emit("message", {
				data: JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId,
						ok: true,
						payload: { clients: [] },
					},
				}),
			});
			await expect(commandPromise).resolves.toMatchObject({
				ok: true,
				payload: { clients: [] },
			});
		});
	});

	it("normalizes websocket error events during connect", async () => {
		const originalWebSocket = globalThis.WebSocket;
		(globalThis as unknown as { WebSocket?: typeof FakeWebSocket }).WebSocket =
			FakeWebSocket;
		FakeWebSocket.instances = [];

		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const connectPromise = client.connect();
		const socket = FakeWebSocket.instances[0];
		if (!socket) {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			throw new Error("expected fake websocket instance");
		}

		socket.fail({ type: "error" });

		try {
			await expect(connectPromise).rejects.toThrow(
				"Failed to connect to hub at ws://127.0.0.1:25463/hub (error event before socket open).",
			);
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		}
	});

	it("surfaces websocket error messages during connect", async () => {
		const originalWebSocket = globalThis.WebSocket;
		(globalThis as unknown as { WebSocket?: typeof FakeWebSocket }).WebSocket =
			FakeWebSocket;
		FakeWebSocket.instances = [];

		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const connectPromise = client.connect();
		const socket = FakeWebSocket.instances[0];
		if (!socket) {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			throw new Error("expected fake websocket instance");
		}

		socket.fail({ type: "error", message: "socket unavailable" });

		try {
			await expect(connectPromise).rejects.toThrow("socket unavailable");
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		}
	});
});

describe("resolveCompatibleLocalHubUrl", () => {
	// Reset the module registry *before* each test so the `vi.doMock(...)`
	// calls below register against a fresh `./client` module graph. Without
	// this, the static `import { NodeHubClient } from "./client"` at the top
	// of the file has already cached `./client` (and its real `./discovery`
	// + `./workspace` bindings) before any test runs, so `vi.doMock` never
	// takes effect for the dynamic `await import("./client")`. That cache
	// contamination causes the test to hit the real discovery/probe code
	// path and fail locally whenever a stray hub daemon is listening on
	// the default port (passes in CI only because no daemon is running).
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.CLINE_HUB_BUILD_ID;
		vi.resetModules();
	});

	it("does not clear discovery on transient probe failure", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("./workspace", () => ({
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("./discovery", async () => {
			const actual =
				await vi.importActual<typeof import("./discovery")>("./discovery");
			return {
				...actual,
				resolveHubBuildId: () => "test-build",
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "test-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => undefined),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import("./client");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBeUndefined();
		expect(clearHubDiscoveryMock).not.toHaveBeenCalled();
	});

	it("clears discovery on build mismatch", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("./workspace", () => ({
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("./discovery", async () => {
			const actual =
				await vi.importActual<typeof import("./discovery")>("./discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import("./client");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBeUndefined();
		expect(clearHubDiscoveryMock).toHaveBeenCalledWith(
			"/tmp/hub-discovery.json",
		);
	});
});
