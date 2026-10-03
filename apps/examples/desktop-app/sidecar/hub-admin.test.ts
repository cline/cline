import type { NodeHubClient } from "@cline/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	mocks.probe.mockResolvedValue(undefined);
	mocks.ensure.mockResolvedValue({ url: "ws://127.0.0.1:5678" });
});

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
		await expect(restartHub(ctx, client)).resolves.toBeUndefined();
	});
	it("reports client-list errors", async () => {
		command.mockResolvedValue({
			ok: false,
			error: { message: "Disconnected" },
		});
		await expect(getHubStatus(ctx, client)).rejects.toThrow("Disconnected");
	});
});
