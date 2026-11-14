import type { NodeHubClient } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const mocks = vi.hoisted(() => ({
	ensure: vi.fn(),
	probe: vi.fn(),
	shutdown: vi.fn(),
}));
vi.mock("@cline/core", () => ({
	ensureDetachedHubServer: mocks.ensure,
	probeHubServer: mocks.probe,
	requestHubShutdown: mocks.shutdown,
}));

import { getHubStatus, recordHubActivity, restartHub } from "./hub-admin";

const ctx = { localWorkspaceRoot: "/workspace" } as SidecarContext;
const command = vi.fn();
const client = {
	command,
	getUrl: () => "ws://127.0.0.1:1234",
} as unknown as NodeHubClient;

beforeEach(() => {
	vi.resetAllMocks();
	command.mockResolvedValue({ ok: true, payload: { clients: [] } });
	mocks.shutdown.mockResolvedValue(true);
	mocks.probe
		.mockResolvedValue(undefined)
		.mockResolvedValueOnce({ hubId: "original" });
	mocks.ensure.mockResolvedValue({ url: "ws://127.0.0.1:5678" });
});

afterEach(() => vi.useRealTimers());

describe("hub administration", () => {
	it("bounds activity and excludes streamed content and client metadata", async () => {
		const context = {} as SidecarContext;
		for (let i = 0; i < 105; i++)
			recordHubActivity(context, {
				event: "hub.client.registered",
				payload: { displayName: `Client ${i}` },
			});
		recordHubActivity(context, {
			event: "message.delta",
			payload: { text: "private content" },
		});
		command.mockResolvedValue({
			ok: true,
			payload: {
				clients: [
					{
						clientId: "one",
						clientType: "cli",
						connectedAt: 1,
						metadata: { secret: "hidden" },
					},
				],
			},
		});
		const status = await getHubStatus(context, client);
		expect(status.events).toHaveLength(100);
		expect(status.events[0].detail).toBe("Client 104");
		expect(status.clients[0]).not.toHaveProperty("metadata");
		expect((await getHubStatus({} as SidecarContext, client)).events).toEqual(
			[],
		);
	});
	it("shares concurrent restarts and reconnects after starting the replacement", async () => {
		const order: string[] = [];
		mocks.shutdown.mockImplementation(async () => {
			order.push("stop");
			return true;
		});
		mocks.ensure.mockImplementation(async () => {
			order.push("start");
		});
		command.mockImplementation(async () => {
			order.push("reconnect");
			return { ok: true };
		});
		await Promise.all([restartHub(ctx, client), restartHub(ctx, client)]);
		expect(order).toEqual(["stop", "start", "reconnect"]);
		expect(mocks.ensure).toHaveBeenCalledWith("/workspace");
	});
	it("does not spawn a replacement when shutdown is rejected, and allows retry", async () => {
		mocks.shutdown.mockResolvedValueOnce(false);
		await expect(restartHub(ctx, client)).rejects.toThrow("did not accept");
		expect(mocks.ensure).not.toHaveBeenCalled();
		mocks.probe.mockResolvedValueOnce({ hubId: "original" });
		await expect(restartHub(ctx, client)).resolves.toBeUndefined();
	});
	it("accepts a replacement started by another client at the same address", async () => {
		mocks.probe.mockResolvedValue({ hubId: "replacement" });
		await expect(restartHub(ctx, client)).resolves.toBeUndefined();
		expect(mocks.probe).toHaveBeenCalledTimes(2);
		expect(mocks.shutdown).toHaveBeenCalledTimes(1);
		expect(mocks.ensure).toHaveBeenCalledOnce();
		expect(command).toHaveBeenCalledWith("client.list");
	});
	it("waits for the original hub to retire before ensuring a replacement", async () => {
		vi.useFakeTimers();
		mocks.probe.mockResolvedValueOnce({ hubId: "original" });
		const pending = restartHub(ctx, client);
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.ensure).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(100);
		await expect(pending).resolves.toBeUndefined();
		expect(mocks.ensure).toHaveBeenCalledOnce();
	});
	it("times out if the original hub stays alive", async () => {
		vi.useFakeTimers();
		mocks.probe.mockResolvedValue({ hubId: "original" });
		const pending = expect(restartHub(ctx, client)).rejects.toThrow(
			"did not stop in time",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await pending;
		expect(mocks.ensure).not.toHaveBeenCalled();
	});
	it("does not stop a hub whose instance cannot be identified", async () => {
		mocks.probe.mockReset().mockResolvedValue({});
		await expect(restartHub(ctx, client)).rejects.toThrow("Unable to identify");
		expect(mocks.shutdown).not.toHaveBeenCalled();
	});
	it("reports client-list errors", async () => {
		command.mockResolvedValue({
			ok: false,
			error: { message: "Disconnected" },
		});
		await expect(getHubStatus(ctx, client)).rejects.toThrow("Disconnected");
	});
});
