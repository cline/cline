import { afterEach, expect, it, vi } from "vitest";
import { NodeHubClient, rememberRecoverableLocalHubUrl } from ".";

const ensure = vi.hoisted(() => vi.fn());
vi.mock("../daemon", () => ({ ensureDetachedHubServer: ensure }));
vi.mock("../discovery/workspace", () => ({
	resolveProductionHubOwnerContext: () => ({
		ownerId: "test",
		discoveryPath: "/unused/discovery.json",
	}),
	resolveSharedHubOwnerContext: () => ({
		ownerId: "test",
		discoveryPath: "/unused/discovery.json",
	}),
}));
vi.mock("../discovery", async (original) => ({
	...(await original<typeof import("../discovery")>()),
	readHubDiscovery: vi.fn(async () => undefined),
	probeHubServer: vi.fn(async () => undefined),
	clearHubDiscovery: vi.fn(async () => undefined),
}));

class Socket {
	static instances: Socket[] = [];
	readyState = 0;
	listeners = new Map<string, Array<(event: unknown) => void>>();
	constructor(_url: string) {
		Socket.instances.push(this);
	}
	addEventListener(type: string, listener: (event: unknown) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	emit(type: string, event: unknown) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
	open() {
		this.readyState = 1;
		this.emit("open", {});
	}
	close() {
		this.readyState = 3;
		this.emit("close", { code: 1006, reason: "" });
	}
	send(data: string) {
		const frame = JSON.parse(data);
		if (frame.kind === "command")
			queueMicrotask(() =>
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: frame.envelope.requestId,
							ok: true,
							payload: {},
						},
					}),
				}),
			);
	}
}
let client: NodeHubClient;
afterEach(async () => {
	await client?.dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	ensure.mockReset();
	Socket.instances = [];
});
async function startReconnect() {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	vi.stubGlobal("WebSocket", Socket);
	client = new NodeHubClient({
		url: rememberRecoverableLocalHubUrl("ws://127.0.0.1:25463/hub"),
	});
	const connected = client.connect();
	await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
	Socket.instances[0].open();
	await connected;
	client.subscribe(() => {});
	Socket.instances[0].close();
	await vi.advanceTimersByTimeAsync(251);
	expect(Socket.instances).toHaveLength(2);
}
it("does not start a daemon when disposed during reconnect", async () => {
	await startReconnect();
	await client.dispose();
	await vi.advanceTimersByTimeAsync(0);
	expect(ensure).not.toHaveBeenCalled();
	expect(Socket.instances).toHaveLength(2);
});
it("does not reconnect when closed during daemon recovery", async () => {
	let finish!: (value: { url: string }) => void;
	ensure.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await startReconnect();
	Socket.instances[1].close();
	await vi.advanceTimersByTimeAsync(0);
	expect(ensure).toHaveBeenCalledTimes(1);
	client.close();
	finish({ url: "ws://127.0.0.1:25464/hub" });
	await vi.advanceTimersByTimeAsync(0);
	expect(Socket.instances).toHaveLength(2);
	expect(client.isConnected()).toBe(false);
});
it("still reconnects through daemon recovery while subscribed", async () => {
	ensure.mockResolvedValue({ url: "ws://127.0.0.1:25464/hub" });
	await startReconnect();
	Socket.instances[1].close();
	await vi.advanceTimersByTimeAsync(0);
	expect(ensure).toHaveBeenCalledTimes(1);
	expect(Socket.instances).toHaveLength(3);
	Socket.instances[2].open();
	await vi.advanceTimersByTimeAsync(0);
	expect(client.isConnected()).toBe(true);
});
